package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

type runtimeTestDriver struct {
	calls    atomic.Int32
	generate func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error)
}

func (driver *runtimeTestDriver) Kind() string { return openAIProviderKind }
func (driver *runtimeTestDriver) ListModels(context.Context, resolvedProvider) ([]ProviderModel, error) {
	return []ProviderModel{{ID: "test-model"}}, nil
}
func (driver *runtimeTestDriver) GenerateChatStream(ctx context.Context, _ resolvedProvider, request ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
	return driver.generate(ctx, int(driver.calls.Add(1)), request, emit)
}

type runtimeTestTool struct {
	execute func(context.Context, ProviderToolCall) (WebToolResult, error)
}

func (tool runtimeTestTool) Execute(ctx context.Context, call ProviderToolCall) (WebToolResult, error) {
	return tool.execute(ctx, call)
}

func runtimeFixture(t *testing.T) (*testApp, string, SessionSummary) {
	t.Helper()
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
		config.SystemProviderLabel = "Fake"
	})
	cookie := signupAndRequireCookie(t, app, "runtime@example.com")
	userID := userIDFromCookie(t, app, cookie)
	session, err := app.app.conversations.CreateSession(context.Background(), userID, "Runtime")
	if err != nil {
		t.Fatal(err)
	}
	return app, userID, session
}
func requireSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for execution checkpoint")
	}
}
func startRuntimeTurn(t *testing.T, app *testApp, userID string, session SessionSummary, key string) SubmitTurnResult {
	t.Helper()
	result, err := app.app.runtime.StartRun(context.Background(), userID, SubmitTurnInput{FriendlyID: session.FriendlyID, Message: "run tools", Model: "test-model", MathTools: true, IdempotencyKey: key})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func requireTwoTurns(t *testing.T, app *testApp, userID string, session SessionSummary, id, status string) HistoryPayload {
	t.Helper()
	history, err := app.app.conversations.GetHistory(context.Background(), userID, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Messages) != 2 || history.Messages[1]["id"] != id || history.Messages[1]["status"] != status {
		t.Fatalf("canonical history=%#v", history.Messages)
	}
	return history
}

func TestRuntimeEditDeleteFenceLateWorker(t *testing.T) {
	for _, mutation := range []string{"edit", "delete"} {
		t.Run(mutation, func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			entered := make(chan struct{})
			release := make(chan struct{})
			late := make(chan struct{})
			driver := &runtimeTestDriver{generate: func(ctx context.Context, call int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				if call == 1 {
					if err := emit(ChatGenerationDelta{Text: "old partial"}); err != nil {
						return ChatGenerationResult{}, err
					}
					close(entered)
					<-release
					defer close(late)
					if err := emit(ChatGenerationDelta{Text: " obsolete output"}); err != nil {
						return ChatGenerationResult{}, err
					}
					return ChatGenerationResult{OutputText: "obsolete output"}, nil
				}
				if err := emit(ChatGenerationDelta{Text: "new response"}); err != nil {
					return ChatGenerationResult{}, err
				}
				return ChatGenerationResult{OutputText: "new response"}, nil
			}}
			app.app.providers.drivers[openAIProviderKind] = driver
			first := startRuntimeTurn(t, app, user, session, "first")
			requireSignal(t, entered)
			var next SubmitTurnResult
			var err error
			revision := int64(0)
			if mutation == "edit" {
				next, err = app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, EditMessageID: first.UserTurnID, Message: "edited", Model: "test-model", ExpectedRevision: &revision, IdempotencyKey: "edit"})
			} else {
				_, err = app.app.conversations.DeleteUserMessageAtRevision(context.Background(), user, session.FriendlyID, first.UserTurnID, &revision)
				if err == nil {
					next, err = app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, Message: "replacement", Model: "test-model"})
				}
			}
			close(release)
			requireSignal(t, late)
			if err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, app, next.RunID, "completed")
			history := requireTwoTurns(t, app, user, session, next.AssistantTurnID, "completed")
			if history.Revision != 1 {
				t.Fatalf("revision=%d", history.Revision)
			}
			transcript, err := app.app.conversations.getTranscript(context.Background(), user, session.FriendlyID)
			if err != nil {
				t.Fatal(err)
			}
			for _, message := range transcript.Messages {
				if stringValueFromMap(message, "runId") == first.RunID {
					t.Fatalf("old transcript write survived: %#v", message)
				}
			}
		})
	}
}

func TestRuntimeConcurrentEditsAndIdempotency(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{OutputText: "answer"}, nil
	}}
	first := startRuntimeTurn(t, app, user, session, "same-key")
	repeated := startRuntimeTurn(t, app, user, session, "same-key")
	if repeated.RunID != first.RunID {
		t.Fatal("duplicate command scheduled new turn")
	}
	waitForRunStatus(t, app, first.RunID, "completed")
	revision := int64(0)
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, EditMessageID: first.UserTurnID, Message: "edited", Model: "test-model", ExpectedRevision: &revision})
			results <- err
		}()
	}
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, errConversationConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
	var jobs int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_runs WHERE session_id=? AND invalidated=0`, session.Key).Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if jobs != 1 {
		t.Fatalf("runs=%d", jobs)
	}
}

func TestRuntimeCancellationDuringToolAndArgumentStream(t *testing.T) {
	for _, phase := range []string{"arguments", "tool"} {
		t.Run(phase, func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			entered := make(chan struct{})
			release := make(chan struct{})
			ended := make(chan struct{})
			app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(ctx context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				call := ProviderToolCall{ID: "call", Name: "fake", ArgsJSON: `{"value":`}
				if err := emit(ChatGenerationDelta{Text: "checking", ToolCalls: []ProviderToolCall{call}}); err != nil {
					return ChatGenerationResult{}, err
				}
				if phase == "arguments" {
					close(entered)
					<-release
					defer close(ended)
					return ChatGenerationResult{}, context.Canceled
				}
				call.ArgsJSON = `{"value":1}`
				call.Args = map[string]any{"value": 1}
				return ChatGenerationResult{OutputText: "checking", ToolCalls: []ProviderToolCall{call}}, nil
			}}
			var effects atomic.Int32
			app.app.runtime.toolRuntime = func(context.Context, string, SubmitTurnInput) (toolExecutor, error) {
				return runtimeTestTool{execute: func(context.Context, ProviderToolCall) (WebToolResult, error) {
					effects.Add(1)
					close(entered)
					<-release
					defer close(ended)
					return WebToolResult{Content: "late result"}, nil
				}}, nil
			}
			run := startRuntimeTurn(t, app, user, session, "stop")
			requireSignal(t, entered)
			stopped, err := app.app.runtime.CancelSessionRuns(context.Background(), user, session.FriendlyID)
			if err != nil || !stopped {
				t.Fatalf("stop=%v %v", stopped, err)
			}
			close(release)
			requireSignal(t, ended)
			history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "aborted")
			if len(contentPartsFromAny(history.Messages[1]["content"])) == 0 {
				t.Fatal("lost partial output")
			}
			for _, step := range history.Messages[1]["steps"].([]any) {
				if step.(map[string]any)["role"] == "toolResult" {
					t.Fatal("late tool result committed after cancel")
				}
			}
			if phase == "tool" && effects.Load() != 1 {
				t.Fatal("unexpected tool replay")
			}
			again, err := app.app.runtime.CancelSessionRuns(context.Background(), user, session.FriendlyID)
			if err != nil || again {
				t.Fatal("cancel resurrected terminal run")
			}
		})
	}
}

func TestRuntimeLeaseExpiryRejectsStaleWorker(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	record := executionRecord{ID: newID(), UserID: user, SessionID: session.Key, Status: "running", Model: "test-model", AssistantTurnID: newID(), LeaseToken: "old-owner"}
	if err := app.app.runtime.insertRun(context.Background(), record, SubmitTurnInput{Message: "leased"}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if _, err := app.app.db.Exec(`UPDATE chat_runs SET lease_until=0 WHERE id=?`, record.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.app.runtime.dispatchJobs(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, record.ID, "interrupted")
	sessionRecord, err := app.app.conversations.findSessionByFriendlyID(context.Background(), user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	message := buildAssistantMessageWithLineage(record.AssistantTurnID, assistantModelDisplay{ID: "test-model"}, time.Now().UnixMilli(), buildAssistantContent("", "stale", nil), record.ID, 0)
	if _, committed, err := app.app.runtime.completeRunWithFinalMessage(context.Background(), record, sessionRecord, message, time.Now().UnixMilli(), 0); err != nil || committed {
		t.Fatalf("stale completion=%v %v", committed, err)
	}
	// A replacement ownership token also fences a duplicate delivery before its lease expires.
	if _, err := app.app.db.Exec(`UPDATE chat_runs SET status='running',lease_token='new-owner',lease_until=? WHERE id=?`, time.Now().Add(time.Minute).UnixMilli(), record.ID); err != nil {
		t.Fatal(err)
	}
	if valid, err := app.app.runtime.guardRunExec(context.Background(), app.app.db, record); err != nil || valid {
		t.Fatalf("old owner valid=%v %v", valid, err)
	}
}

func TestRuntimeRetryRetainsTurnAndNoDuplicateUser(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, call int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if call == 1 {
			_ = emit(ChatGenerationDelta{Text: "partial"})
			return ChatGenerationResult{}, errors.New("provider disconnected")
		}
		return ChatGenerationResult{OutputText: "recovered"}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "start")
	waitForRunStatus(t, app, run.RunID, "error")
	first, err := app.app.runtime.RetryRun(context.Background(), user, session.FriendlyID, run.RunID, "retry", nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.app.runtime.RetryRun(context.Background(), user, session.FriendlyID, run.RunID, "retry", nil)
	if err != nil || first.RunID != second.RunID {
		t.Fatalf("retry=%#v %v", second, err)
	}
	waitForRunStatus(t, app, run.RunID, "completed")
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "completed")
	if text := textFromContentParts(contentPartsFromAny(history.Messages[1]["content"])); text != "recovered" {
		t.Fatalf("retry retained obsolete partial: %s", text)
	}
	_, err = app.app.runtime.CancelSessionRuns(context.Background(), user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, run.RunID, "completed")
}

func TestRuntimeEventsReplayAndSnapshotAgree(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		_ = emit(ChatGenerationDelta{Thinking: "Available summary"})
		return ChatGenerationResult{ThinkingText: "Available summary", OutputText: "final"}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "events")
	waitForRunStatus(t, app, run.RunID, "completed")
	events, err := app.app.runtime.readEvents(context.Background(), session.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 3 {
		t.Fatalf("events=%d", len(events))
	}
	cursor := int64(0)
	for _, event := range events {
		if event.Cursor <= cursor {
			t.Fatal("unordered durable cursor")
		}
		cursor = event.Cursor
		if event.State != "user" && event.TurnID != run.AssistantTurnID {
			t.Fatal("changed visible identity")
		}
	}
	replay, err := app.app.runtime.readEvents(context.Background(), session.Key, events[0].Cursor)
	if err != nil || len(replay) != len(events)-1 {
		t.Fatalf("replay=%d %v", len(replay), err)
	}
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "completed")
	if history.Cursor != cursor {
		t.Fatalf("snapshot cursor=%d journal=%d", history.Cursor, cursor)
	}
	// A new runtime has no in-memory stream state and still replays all events.
	other := NewAgentRuntime(app.app.db, app.app.conversations, app.app.providers, app.app.webTools)
	replay, err = other.readEvents(context.Background(), session.Key, 0)
	if err != nil || len(replay) != len(events) {
		t.Fatal("replay depends on process memory")
	}
}

func TestRuntimeInvalidEditRollsBackHistoryAndQueue(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	run := startRuntimeTurn(t, app, user, session, "queued")
	_, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, EditMessageID: run.UserTurnID, Message: "", Model: "test-model"})
	if err == nil {
		t.Fatal("accepted empty edit")
	}
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "queued")
	if history.Revision != 0 {
		t.Fatal("failed edit truncated history")
	}
	var jobs int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_jobs WHERE run_id=?`, run.RunID).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("queued work lost: %d %v", jobs, err)
	}
	// HTTP mutations map a stale revision to a conflict.
	revision := int64(42)
	response := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions/"+session.FriendlyID+"/messages", sendMessageRequest{Message: "new", ExpectedRevision: &revision}, nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatal("authentication weakened")
	}
}

type providerTimeout struct{}

func (providerTimeout) Error() string   { return "timeout" }
func (providerTimeout) Timeout() bool   { return true }
func (providerTimeout) Temporary() bool { return true }
func TestProviderRetryIsBoundedAndDoesNotReplayObservedOutputOrEffects(t *testing.T) {
	for _, scenario := range []struct {
		name              string
		observed, allowed bool
		calls             int
	}{{"timeout", false, true, 3}, {"partial", true, true, 1}, {"tool_effect", false, false, 1}} {
		t.Run(scenario.name, func(t *testing.T) {
			driver := &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				if scenario.observed {
					_ = emit(ChatGenerationDelta{Text: "partial"})
				}
				return ChatGenerationResult{}, providerTimeout{}
			}}
			_, err := generateWithRetry(context.Background(), driver, resolvedProvider{}, ChatGenerationRequest{}, scenario.allowed, func(ChatGenerationDelta) error { return nil })
			if err == nil || int(driver.calls.Load()) != scenario.calls {
				t.Fatalf("calls=%d err=%v", driver.calls.Load(), err)
			}
		})
	}
}

func TestRuntimeDelayedReasoningShowsProgressBeforeText(t *testing.T) {
	app, user, session := runtimeFixture(t)
	reasoning := make(chan struct{})
	release := make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if err := emit(ChatGenerationDelta{Thinking: "Provider supplied summary"}); err != nil {
			return ChatGenerationResult{}, err
		}
		close(reasoning)
		<-release
		return ChatGenerationResult{ThinkingText: "Provider supplied summary", OutputText: "answer"}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "reasoning")
	requireSignal(t, reasoning)
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "running")
	parts := contentPartsFromAny(history.Messages[1]["content"])
	close(release)
	if len(parts) != 1 || parts[0].Type != "thinking" {
		t.Fatalf("progress=%#v", parts)
	}
	waitForRunStatus(t, app, run.RunID, "completed")
}

func TestRuntimeCloneIncludesWholeStoppedTurn(t *testing.T) {
	app, user, session := runtimeFixture(t)
	entered := make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(ctx context.Context, _ int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if err := emit(ChatGenerationDelta{Text: "partial", ToolCalls: []ProviderToolCall{{ID: "unfinished", Name: "fake", ArgsJSON: "{"}}}); err != nil {
			return ChatGenerationResult{}, err
		}
		close(entered)
		<-ctx.Done()
		return ChatGenerationResult{}, ctx.Err()
	}}
	run := startRuntimeTurn(t, app, user, session, "clone")
	requireSignal(t, entered)
	if _, err := app.app.runtime.CancelSessionRuns(context.Background(), user, session.FriendlyID); err != nil {
		t.Fatal(err)
	}
	clone, err := app.app.conversations.CloneSession(context.Background(), user, session.FriendlyID, run.AssistantTurnID)
	if err != nil {
		t.Fatal(err)
	}
	history, err := app.app.conversations.GetHistory(context.Background(), user, clone.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Messages) != 2 || history.Messages[1]["status"] != "aborted" || history.Messages[1]["id"] != run.AssistantTurnID {
		t.Fatalf("cloned turn=%#v", history.Messages)
	}
	if history.Messages[1]["canRetry"] != false {
		t.Fatal("cloned historical turn advertised an unavailable retry")
	}
	transcript, err := app.app.conversations.getTranscript(context.Background(), user, clone.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range transcript.Messages {
		for _, part := range contentPartsFromAny(message["content"]) {
			if part.Type == "toolCall" {
				t.Fatal("unfinished tool call leaked into provider transcript")
			}
		}
	}
}

func TestRuntimeNewConversationCommandIsAtomicAndIdempotent(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	app.app.runtime.Close()
	input := SubmitTurnInput{NewConversation: &newConversationInput{Label: "Atomic", Settings: defaultConversationSettings()}, Message: "first", Model: "test-model", IdempotencyKey: "create-key"}
	first, err := app.app.runtime.StartRun(context.Background(), user, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.app.runtime.StartRun(context.Background(), user, input)
	if err != nil || second.SessionKey != first.SessionKey || second.RunID != first.RunID || second.UserTurnID != first.UserTurnID {
		t.Fatalf("repeated create=%#v %v", second, err)
	}
	var conversations, jobs int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM conversation_commands WHERE user_id=? AND command_key='create-key'`, user).Scan(&conversations); err != nil {
		t.Fatal(err)
	}
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_jobs WHERE run_id=?`, first.RunID).Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if conversations != 1 || jobs != 1 {
		t.Fatalf("created commands=%d jobs=%d", conversations, jobs)
	}
	before, err := app.app.conversations.ListSessions(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	input.IdempotencyKey = "bad-create"
	input.Message = ""
	input.Attachments = []AttachmentPayload{{MimeType: "", Content: ""}}
	if _, err := app.app.runtime.StartRun(context.Background(), user, input); err == nil {
		t.Fatal("accepted invalid creation")
	}
	after, err := app.app.conversations.ListSessions(context.Background(), user)
	if err != nil || len(after) != len(before) {
		t.Fatal("failed creation left an empty conversation")
	}
}

func TestRuntimeMultipleToolRoundsKeepOneTurn(t *testing.T) {
	app, user, session := runtimeFixture(t)
	var effects atomic.Int32
	driver := &runtimeTestDriver{generate: func(_ context.Context, round int, request ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if round <= 2 {
			call := ProviderToolCall{ID: fmt.Sprintf("call-%d", round), Name: "fake", ArgsJSON: "{}"}
			if err := emit(ChatGenerationDelta{Text: "checking", ToolCalls: []ProviderToolCall{call}}); err != nil {
				return ChatGenerationResult{}, err
			}
			return ChatGenerationResult{OutputText: "checking", ToolCalls: []ProviderToolCall{call}}, nil
		}
		if len(request.Messages) != 6 || request.Messages[5].Role != "tool" {
			t.Errorf("transcript order=%#v", request.Messages)
		}
		return ChatGenerationResult{OutputText: "done"}, nil
	}}
	app.app.providers.drivers[openAIProviderKind] = driver
	app.app.runtime.toolRuntime = func(context.Context, string, SubmitTurnInput) (toolExecutor, error) {
		return runtimeTestTool{execute: func(context.Context, ProviderToolCall) (WebToolResult, error) {
			effects.Add(1)
			return WebToolResult{Content: "result"}, nil
		}}, nil
	}
	run := startRuntimeTurn(t, app, user, session, "rounds")
	waitForRunStatus(t, app, run.RunID, "completed")
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "completed")
	if len(history.Messages[1]["steps"].([]any)) != 5 || effects.Load() != 2 || driver.calls.Load() != 3 {
		t.Fatalf("steps/effects/calls=%#v/%d/%d", history.Messages[1]["steps"], effects.Load(), driver.calls.Load())
	}
}

func TestRuntimeTimeoutAfterToolEffectIsNotAutomaticallyRetried(t *testing.T) {
	app, user, session := runtimeFixture(t)
	var effects atomic.Int32
	driver := &runtimeTestDriver{generate: func(_ context.Context, round int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if round == 1 {
			return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: "effect", Name: "fake", ArgsJSON: "{}"}}}, nil
		}
		return ChatGenerationResult{}, providerTimeout{}
	}}
	app.app.providers.drivers[openAIProviderKind] = driver
	app.app.runtime.toolRuntime = func(context.Context, string, SubmitTurnInput) (toolExecutor, error) {
		return runtimeTestTool{execute: func(context.Context, ProviderToolCall) (WebToolResult, error) {
			effects.Add(1)
			return WebToolResult{Content: "effect saved"}, nil
		}}, nil
	}
	run := startRuntimeTurn(t, app, user, session, "effect-timeout")
	waitForRunStatus(t, app, run.RunID, "error")
	requireTwoTurns(t, app, user, session, run.AssistantTurnID, "error")
	if effects.Load() != 1 || driver.calls.Load() != 2 {
		t.Fatalf("automatic effect replay: effects=%d requests=%d", effects.Load(), driver.calls.Load())
	}
}

func TestRuntimeCompletedToolCheckpointSurvivesStoppingNextTool(t *testing.T) {
	app, user, session := runtimeFixture(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{OutputText: "two checks", ToolCalls: []ProviderToolCall{{ID: "first", Name: "fake", ArgsJSON: "{}"}, {ID: "second", Name: "fake", ArgsJSON: "{}"}}}, nil
	}}
	app.app.runtime.toolRuntime = func(context.Context, string, SubmitTurnInput) (toolExecutor, error) {
		return runtimeTestTool{execute: func(_ context.Context, call ProviderToolCall) (WebToolResult, error) {
			if call.ID == "second" {
				close(entered)
				<-release
				defer close(finished)
			}
			return WebToolResult{Content: call.ID}, nil
		}}, nil
	}
	run := startRuntimeTurn(t, app, user, session, "tool-boundary")
	requireSignal(t, entered)
	if _, err := app.app.runtime.CancelSessionRuns(context.Background(), user, session.FriendlyID); err != nil {
		close(release)
		t.Fatal(err)
	}
	close(release)
	requireSignal(t, finished)
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "aborted")
	steps := history.Messages[1]["steps"].([]any)
	if len(steps) != 2 || steps[1].(map[string]any)["toolCallId"] != "first" {
		t.Fatalf("lost completed boundary or committed late result: %#v", steps)
	}
}

func TestRuntimeTitleWorkerCannotWriteAfterEdit(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, request ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if isFakeTitleGenerationRequest(request) {
			close(entered)
			<-release
			defer close(finished)
			return ChatGenerationResult{OutputText: "Obsolete generated title"}, nil
		}
		return ChatGenerationResult{OutputText: "answer"}, nil
	}}
	if _, err := app.app.providers.UpdatePreferences(context.Background(), user, UpdateUserPreferencesInput{AutoGenerateTitle: boolPointer(true)}); err != nil {
		t.Fatal(err)
	}
	first, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{NewConversation: &newConversationInput{Settings: defaultConversationSettings()}, Message: "original", Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	requireSignal(t, entered)
	next, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: first.FriendlyID, EditMessageID: first.UserTurnID, Message: "edited", Model: "test-model"})
	close(release)
	requireSignal(t, finished)
	if err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, next.RunID, "completed")
	// Wait for title publication/commit to finish, not just its provider call.
	app.app.runtime.Close()
	summary, err := app.app.conversations.GetSessionSummary(context.Background(), user, first.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Title == "Obsolete generated title" {
		t.Fatal("title worker crossed the edit revision")
	}
	events, err := app.app.runtime.readEvents(context.Background(), first.SessionKey, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.State == "title" && event.Session != nil && event.Session.Title == "Obsolete generated title" {
			t.Fatal("obsolete title event leaked into the new revision")
		}
	}
}

func TestRuntimeOldAttemptCannotRemoveNewCancellationControl(t *testing.T) {
	app, _, _ := runtimeFixture(t)
	old := executionRecord{ID: "shared-turn", LeaseToken: "old"}
	fresh := executionRecord{ID: "shared-turn", LeaseToken: "new"}
	var cancelled atomic.Bool
	app.app.runtime.registerRunCancel(old, func() {})
	app.app.runtime.registerRunCancel(fresh, func() { cancelled.Store(true) })
	app.app.runtime.unregisterRunCancel(old)
	app.app.Stop()
	if !cancelled.Load() {
		t.Fatal("stale worker removed the current attempt's cancellation control")
	}
	app.app.runtime.unregisterRunCancel(fresh)
}

func TestRuntimeServiceShutdownCancelsRequestStreams(t *testing.T) {
	app, _, _ := runtimeFixture(t)
	ctx, cancel := app.app.runtime.requestContext(context.Background())
	defer cancel()
	app.app.Stop()
	requireSignal(t, ctx.Done())
}
