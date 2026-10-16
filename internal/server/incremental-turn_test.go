package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"
)

func applyProjectionTestValue(value any, path []string, patch TurnPatchOperation) any {
	if len(path) == 0 {
		if patch.Op == "append" {
			return value.(string) + patch.Value.(string)
		}
		return cloneTurnValue(patch.Value)
	}
	key := path[0]
	switch container := value.(type) {
	case map[string]any:
		if len(path) == 1 && patch.Op == "remove" {
			delete(container, key)
		} else {
			container[key] = applyProjectionTestValue(container[key], path[1:], patch)
		}
		return container
	case []any:
		index, _ := strconv.Atoi(key)
		if len(path) == 1 && patch.Op == "remove" {
			return append(container[:index], container[index+1:]...)
		}
		if index == len(container) {
			container = append(container, nil)
		}
		container[index] = applyProjectionTestValue(container[index], path[1:], patch)
		return container
	default:
		panic("invalid test patch path")
	}
}
func applyProjectionTestPatch(t *testing.T, turn map[string]any, patches []TurnPatchOperation) map[string]any {
	t.Helper()
	root := cloneTurnValue(turn)
	for _, patch := range patches {
		root = applyProjectionTestValue(root, patch.Path, patch)
	}
	return root.(map[string]any)
}
func TestIncrementalTurnPatchesAcrossBoundaries(t *testing.T) {
	previous := map[string]any{"content": []any{}, "steps": []any{}}
	messages := []map[string]any{
		{"id": "first", "role": "assistant", "model": "test", "details": map[string]any{"old": true}, "content": []any{map[string]any{"type": "thinking", "thinking": "reason"}, map[string]any{"type": "text", "text": "first"}}},
		{"id": "tool", "role": "toolResult", "content": []any{map[string]any{"type": "text", "text": "result"}}},
		{"id": "second", "role": "assistant", "model": "test", "content": []any{map[string]any{"type": "text", "text": "second"}}},
		{"id": "second", "role": "assistant", "model": "test", "content": []any{}},
	}
	for _, message := range messages {
		next, patches := advanceRunProjection(previous, message)
		actual, _ := json.Marshal(applyProjectionTestPatch(t, previous, patches))
		expected, _ := json.Marshal(next)
		if string(actual) != string(expected) {
			t.Fatalf("patch differs across boundary: got=%s want=%s", actual, expected)
		}
		previous = next
	}
	if _, exists := previous["details"]; exists {
		t.Fatal("prior round details leaked into next round")
	}
}

func TestIncrementalTurnPatchesAndCompletedToolIsolation(t *testing.T) {
	assistant := map[string]any{"id": "answer", "role": "assistant", "model": "test", "content": []any{map[string]any{"type": "text", "text": "first"}}}
	tool := map[string]any{"id": "tool", "role": "toolResult", "content": []any{map[string]any{"type": "text", "text": strings.Repeat("large", 10000)}}}
	previous := map[string]any{"content": assistant["content"], "steps": []any{tool, assistant}, "model": "test"}
	message := map[string]any{"id": "answer", "role": "assistant", "model": "test", "content": []any{map[string]any{"type": "text", "text": "first second"}}}
	next, patches := advanceRunProjection(previous, message)
	patched := applyProjectionTestPatch(t, previous, patches)
	encoded, _ := json.Marshal(next)
	actual, _ := json.Marshal(patched)
	if string(actual) != string(encoded) {
		t.Fatalf("patch differs from projection: %s", actual)
	}
	payload, _ := json.Marshal(patches)
	if len(payload) > 1000 || strings.Contains(string(payload), "large") {
		t.Fatalf("patch repeats completed tool: %d bytes", len(payload))
	}
	// Callers may reuse or mutate their next snapshot after accepting a checkpoint.
	message["content"].([]any)[0].(map[string]any)["text"] = "mutated"
	if strings.Contains(string(encoded), "mutated") || next["steps"].([]any)[1].(map[string]any)["content"].([]any)[0].(map[string]any)["text"] != "first second" {
		t.Fatal("projection aliases caller data")
	}
}
func TestDirtyTurnHistoryRecoversLastDurableStep(t *testing.T) {
	app, user, session := runtimeFixture(t)
	runtime := app.app.runtime
	runtime.Close()
	ctx := context.Background()
	record := executionRecord{ID: newID(), UserID: user, SessionID: session.Key, AssistantTurnID: newID(), Status: "running", Model: "test-model"}
	if err := runtime.insertRun(ctx, record, SubmitTurnInput{Message: "checkpoint"}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	sessionRecord, err := app.app.conversations.findSessionByFriendlyID(ctx, user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	sink := persistedGenerationSink{service: runtime, record: record, session: &sessionRecord}
	message := map[string]any{"id": "model-step", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "first"}}}
	if err := sink.Delta(message); err != nil {
		t.Fatal(err)
	}
	sink.lastCheckpoint = time.Time{}
	message["content"] = []any{map[string]any{"type": "text", "text": "first second"}}
	if err := sink.Delta(message); err != nil {
		t.Fatal(err)
	}
	var snapshot string
	var dirty int
	if err := app.app.db.QueryRow(`SELECT turn_json,turn_dirty FROM chat_runs WHERE id=?`, record.ID).Scan(&snapshot, &dirty); err != nil || dirty != 1 || strings.Contains(snapshot, "second") {
		t.Fatalf("full snapshot rewritten between boundaries: dirty=%d %v", dirty, err)
	}
	history, err := app.app.conversations.GetHistory(ctx, user, session.FriendlyID)
	if err != nil || len(history.Messages) != 1 {
		t.Fatalf("recovery history: %+v %v", history, err)
	}
	content, _ := json.Marshal(history.Messages[0]["content"])
	if !strings.Contains(string(content), "first second") {
		t.Fatalf("durable step missing: %s", content)
	}
	var countBefore, countAfter int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_events WHERE session_id=?`, session.Key).Scan(&countBefore); err != nil {
		t.Fatal(err)
	}
	tx, err := runtime.beginEventTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.refreshTurnExec(ctx, tx, record.ID, "delta"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_events WHERE session_id=?`, session.Key).Scan(&countAfter); err != nil || countBefore != countAfter {
		t.Fatalf("boundary duplicated accepted append patches: %d -> %d %v", countBefore, countAfter, err)
	}
	sink.lastCheckpoint = time.Time{}
	message["content"] = []any{map[string]any{"type": "text", "text": "first second third"}}
	if err := sink.Delta(message); err != nil {
		t.Fatal(err)
	}
	runtime.finishOwnedRun(record, "interrupted", errors.New("crash simulation"))
	if err := app.app.db.QueryRow(`SELECT turn_json,turn_dirty FROM chat_runs WHERE id=?`, record.ID).Scan(&snapshot, &dirty); err != nil || dirty != 0 || !strings.Contains(snapshot, "first second third") {
		t.Fatalf("terminal snapshot lost latest checkpoint: %d %v", dirty, err)
	}
	sink.lastCheckpoint = time.Time{}
	if err := sink.Delta(message); !errors.Is(err, errGenerationInactive) {
		t.Fatalf("terminal run accepted checkpoint: %v", err)
	}
}
func BenchmarkIncrementalTurnWithToolOutput(b *testing.B) {
	for _, size := range []int{1024, 1 << 20} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			assistant := map[string]any{"id": "answer", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "first"}}}
			tool := map[string]any{"id": "tool", "role": "toolResult", "content": []any{map[string]any{"type": "text", "text": strings.Repeat("x", size)}}}
			previous := map[string]any{"content": assistant["content"], "steps": []any{tool, assistant}}
			message := map[string]any{"id": "answer", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "first second"}}}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				advanceRunProjection(previous, message)
			}
		})
	}
}

func TestProviderErrorFlushPreservesFinalPartialOutput(t *testing.T) {
	app, user, session := runtimeFixture(t)
	runtime := app.app.runtime
	runtime.Close()
	ctx := context.Background()
	record := executionRecord{ID: newID(), UserID: user, SessionID: session.Key, AssistantTurnID: newID(), Status: "running", Model: "test-model"}
	if err := runtime.insertRun(ctx, record, SubmitTurnInput{Message: "checkpoint"}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	sessionRecord, err := app.app.conversations.findSessionByFriendlyID(ctx, user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	sink := persistedGenerationSink{service: runtime, record: record, session: &sessionRecord}
	message := map[string]any{"id": "model-step", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "first"}}}
	if err := sink.Delta(message); err != nil {
		t.Fatal(err)
	}
	// Simulate termination while the next normal checkpoint is throttled.
	sink.lastCheckpoint = time.Now()
	message["content"] = []any{map[string]any{"type": "text", "text": "first final fragment"}}
	message["details"] = map[string]any{"finishReason": "length"}
	if err := sink.FlushDelta(message); err != nil {
		t.Fatal(err)
	}
	runtime.finishOwnedRun(record, "error", fmt.Errorf("Response truncated"))
	history, err := app.app.conversations.GetHistory(ctx, user, session.FriendlyID)
	if err != nil || len(history.Messages) != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	turn := history.Messages[0]
	encoded, _ := json.Marshal(turn)
	if turn["status"] != "error" || turn["error"] != "Response truncated" || !strings.Contains(string(encoded), "first final fragment") || !strings.Contains(string(encoded), `"finishReason":"length"`) {
		t.Fatalf("incomplete turn lost output or diagnostics: %s", encoded)
	}
}

func TestRunBoundaryPreservesCompleteMessageAfterDirtyCheckpoint(t *testing.T) {
	for _, final := range []bool{true, false} {
		t.Run(fmt.Sprintf("final=%t", final), func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			runtime := app.app.runtime
			runtime.Close()
			ctx := context.Background()
			record := executionRecord{ID: newID(), UserID: user, SessionID: session.Key, AssistantTurnID: newID(), Status: "running", Model: "test-model"}
			if err := runtime.insertRun(ctx, record, SubmitTurnInput{Message: "checkpoint"}, time.Now().UnixMilli()); err != nil {
				t.Fatal(err)
			}
			sessionRecord, err := app.app.conversations.findSessionByFriendlyID(ctx, user, session.FriendlyID)
			if err != nil {
				t.Fatal(err)
			}
			sink := persistedGenerationSink{service: runtime, record: record, session: &sessionRecord}
			message := map[string]any{"id": "model-step", "role": "assistant", "runId": record.ID, "roundIndex": 0, "timestamp": time.Now().UnixMilli(), "content": []any{map[string]any{"type": "text", "text": "first"}}}
			if err := sink.Delta(message); err != nil {
				t.Fatal(err)
			}
			sink.lastCheckpoint = time.Time{}
			message["content"] = []any{map[string]any{"type": "text", "text": "first second"}}
			if err := sink.Delta(message); err != nil {
				t.Fatal(err)
			}
			var dirty bool
			if err := app.app.db.QueryRow(`SELECT turn_dirty FROM chat_runs WHERE id=?`, record.ID).Scan(&dirty); err != nil || !dirty {
				t.Fatalf("expected dirty incremental checkpoint: %t %v", dirty, err)
			}
			message["content"] = []any{map[string]any{"type": "text", "text": "first second final fragment"}}
			message["details"] = map[string]any{"usage": map[string]any{"totalTokens": 42}}
			if final {
				err = sink.Final(message, 42)
			} else {
				err = sink.ToolRound([]map[string]any{message}, 42)
			}
			if err != nil {
				t.Fatal(err)
			}
			history, err := app.app.conversations.GetHistory(ctx, user, session.FriendlyID)
			if err != nil || len(history.Messages) != 1 {
				t.Fatalf("history: %+v %v", history, err)
			}
			encoded, _ := json.Marshal(history.Messages[0])
			if !strings.Contains(string(encoded), "first second final fragment") || !strings.Contains(string(encoded), `"totalTokens":42`) {
				t.Fatalf("boundary reverted complete message to checkpoint: %s", encoded)
			}
			var raw string
			if err := app.app.db.QueryRow(`SELECT event_json FROM chat_events WHERE session_id=? ORDER BY sequence DESC LIMIT 1`, session.Key).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(raw, "final fragment") {
				t.Fatalf("boundary event lost final output: %s", raw)
			}
		})
	}
}
