package server

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Run as a subprocess and exit without Close to exercise an actual process crash.
func TestRuntimeCrashChild(t *testing.T) {
	mode := os.Getenv("KAIROS_TEST_CRASH_MODE")
	if mode == "" {
		t.Skip("subprocess only")
	}
	var config Config
	if err := json.Unmarshal([]byte(os.Getenv("KAIROS_TEST_CONFIG")), &config); err != nil {
		t.Fatal(err)
	}
	app, err := NewApp(config)
	if err != nil {
		t.Fatal(err)
	}
	user := os.Getenv("KAIROS_TEST_USER")
	friendly := os.Getenv("KAIROS_TEST_SESSION")
	if mode == "queued" {
		app.runtime.Close()
		_, err := app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: friendly, Message: "recover queued", Model: "test-model", IdempotencyKey: "crash"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := app.db.Exec(`UPDATE chat_jobs SET available_at=?`, time.Now().Add(time.Second).UnixMilli()); err != nil {
			t.Fatal(err)
		}
		os.Exit(0)
	}
	app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		call := ProviderToolCall{ID: "crash-call", Name: "effect", ArgsJSON: "{}"}
		if err := emit(ChatGenerationDelta{Text: "partial before crash", ToolCalls: []ProviderToolCall{call}}); err != nil {
			return ChatGenerationResult{}, err
		}
		if mode == "model" {
			os.Exit(0)
		}
		return ChatGenerationResult{OutputText: "partial before crash", ToolCalls: []ProviderToolCall{call}}, nil
	}}
	app.runtime.toolRuntime = func(context.Context, string, SubmitTurnInput) (toolExecutor, error) {
		return runtimeTestTool{execute: func(context.Context, ProviderToolCall) (WebToolResult, error) {
			if err := os.WriteFile(os.Getenv("KAIROS_TEST_EFFECT"), []byte("one effect"), 0600); err != nil {
				return WebToolResult{}, err
			}
			os.Exit(0)
			return WebToolResult{}, nil
		}}, nil
	}
	_, err = app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: friendly, Message: "crash active", Model: "test-model", MathTools: true, IdempotencyKey: "crash"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-time.After(5 * time.Second):
		t.Fatal("subprocess did not reach crash boundary")
	}
}

func TestRuntimeRecoversAcrossProcessCrash(t *testing.T) {
	for _, mode := range []string{"queued", "model", "tool"} {
		t.Run(mode, func(t *testing.T) {
			fixture, user, session := runtimeFixture(t)
			config := fixture.app.config
			if err := fixture.app.Close(); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(t.TempDir(), "tool-effect")
			command := exec.Command(os.Args[0], "-test.run=^TestRuntimeCrashChild$", "-test.timeout=10s")
			command.Env = append(os.Environ(), "KAIROS_TEST_CRASH_MODE="+mode, "KAIROS_TEST_CONFIG="+string(encoded), "KAIROS_TEST_USER="+user, "KAIROS_TEST_SESSION="+session.FriendlyID, "KAIROS_TEST_EFFECT="+marker)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("crash subprocess: %v\n%s", err, output)
			}
			recovered, err := NewApp(config)
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.Close()
			fixture.app = recovered
			fixture.handler = recovered.Handler()
			driver := &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				return ChatGenerationResult{OutputText: "recovered queued job"}, nil
			}}
			recovered.providers.drivers[openAIProviderKind] = driver
			var runID, turnID string
			if err := recovered.db.QueryRow(`SELECT id,assistant_message_id FROM chat_runs WHERE session_id=? AND idempotency_key='crash'`, session.Key).Scan(&runID, &turnID); err != nil {
				t.Fatal(err)
			}
			if mode == "queued" {
				waitForRunStatus(t, fixture, runID, "completed")
				requireTwoTurns(t, fixture, user, session, turnID, "completed")
			} else {
				// Advance the persisted clock boundary instead of waiting thirty seconds.
				if _, err := recovered.db.Exec(`UPDATE chat_runs SET lease_until=0 WHERE id=?`, runID); err != nil {
					t.Fatal(err)
				}
				recovered.runtime.notifyQueue()
				waitForRunStatus(t, fixture, runID, "interrupted")
				history := requireTwoTurns(t, fixture, user, session, turnID, "interrupted")
				if len(contentPartsFromAny(history.Messages[1]["content"])) == 0 {
					t.Fatal("crash lost checkpoint")
				}
				if driver.calls.Load() != 0 {
					t.Fatal("uncertain execution was automatically replayed")
				}
				if mode == "tool" {
					contents, err := os.ReadFile(marker)
					if err != nil || string(contents) != "one effect" {
						t.Fatal("missing external side effect evidence")
					}
				}
			}
		})
	}
}
