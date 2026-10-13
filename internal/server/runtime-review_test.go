package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRuntimeAppendRejectsAnotherClientsStaleEditAndDelete(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{OutputText: "answer"}, nil
	}}
	first := startRuntimeTurn(t, app, user, session, "first")
	waitForRunStatus(t, app, first.RunID, "completed")
	snapshot, err := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	second := startRuntimeTurn(t, app, user, session, "second")
	waitForRunStatus(t, app, second.RunID, "completed")
	if second.Revision != first.Revision+1 {
		t.Fatalf("send revision did not advance: %d %d", first.Revision, second.Revision)
	}
	_, err = app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, EditMessageID: first.UserTurnID, Message: "stale edit", ExpectedRevision: &snapshot.Revision})
	if !errors.Is(err, errConversationConflict) {
		t.Fatalf("stale edit=%v", err)
	}
	_, err = app.app.conversations.DeleteUserMessageAtRevision(context.Background(), user, session.FriendlyID, first.UserTurnID, &snapshot.Revision)
	if !errors.Is(err, errConversationConflict) {
		t.Fatalf("stale delete=%v", err)
	}
	current, _ := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if len(current.Messages) != 4 || current.Revision != second.Revision {
		t.Fatal("stale client truncated newer turns")
	}
	repeated := startRuntimeTurn(t, app, user, session, "second")
	if repeated.Revision != second.Revision {
		t.Fatal("idempotent repeat advanced revision")
	}
}

func TestRuntimeSnapshotSkipsSupersededJournal(t *testing.T) {
	app, user, session := runtimeFixture(t)
	tx, err := app.app.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 1000; i++ {
		if err := insertChatEventExec(context.Background(), tx, ConversationEvent{SessionKey: session.Key, State: "delta", Message: map[string]any{"id": "old", "content": fmt.Sprint(i)}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	stop := errors.New("stop")
	var snapshotCursor int64
	received := 0
	err = app.app.runtime.StreamSessionFromCursor(context.Background(), user, session.FriendlyID, 1, func(event ConversationEvent) error {
		if event.Snapshot != nil {
			snapshotCursor = event.Snapshot.Cursor
			return insertChatEventExec(context.Background(), app.app.db, ConversationEvent{SessionKey: session.Key, State: "final", TurnID: "new"})
		}
		received++
		if event.Cursor <= snapshotCursor || event.TurnID != "new" {
			t.Fatalf("snapshot superseded event delivered: %#v", event)
		}
		return stop
	})
	if !errors.Is(err, stop) || received != 1 {
		t.Fatalf("stream result=%v received=%d", err, received)
	}
}

func TestRuntimeDelayedStopCannotCancelNewRun(t *testing.T) {
	app, user, session := runtimeFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(ctx context.Context, n int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if n == 2 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return ChatGenerationResult{}, ctx.Err()
			}
		}
		return ChatGenerationResult{OutputText: "answer"}, nil
	}}
	first := startRuntimeTurn(t, app, user, session, "first")
	waitForRunStatus(t, app, first.RunID, "completed")
	second := startRuntimeTurn(t, app, user, session, "second")
	requireSignal(t, entered)
	cancelled, err := app.app.runtime.CancelRun(context.Background(), user, session.FriendlyID, first.RunID)
	if err != nil || cancelled {
		t.Fatalf("delayed cancellation=%v %v", cancelled, err)
	}
	close(release)
	waitForRunStatus(t, app, second.RunID, "completed")
}

func TestResponsesHTTPRetryPolicy(t *testing.T) {
	for _, status := range []int{429, 500, 503, 400} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) < 3 {
					http.Error(w, "provider unavailable", status)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{}}\n\n")
			}))
			defer server.Close()
			driver := &OpenAICompatibleDriver{httpClient: server.Client()}
			_, err := generateWithRetry(context.Background(), driver, resolvedProvider{BaseURL: server.URL, Record: ProviderRecord{Kind: openAIResponsesProviderKind}}, ChatGenerationRequest{Model: "test"}, true, func(ChatGenerationDelta) error { return nil })
			if status == 400 {
				if err == nil || calls.Load() != 1 {
					t.Fatal("retried permanent error")
				}
			} else if err != nil || calls.Load() != 3 {
				t.Fatalf("retry result=%v calls=%d", err, calls.Load())
			}
		})
	}
}

func TestRuntimeShutdownBeforeRegistrationRequeuesClaim(t *testing.T) {
	app, user, session := runtimeFixture(t)
	claimed, release := make(chan struct{}), make(chan struct{})
	app.app.runtime.afterClaim = func(executionRecord) { close(claimed); <-release }
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		t.Error("execution started before shutdown checkpoint")
		return ChatGenerationResult{}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "claimed")
	requireSignal(t, claimed)
	closed := make(chan struct{})
	go func() { app.app.runtime.Close(); close(closed) }()
	deadline := time.Now().Add(time.Second)
	for app.app.runtime.workerContext.Err() == nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if app.app.runtime.workerContext.Err() == nil {
		t.Fatal("shutdown did not cancel dispatcher")
	}
	close(release)
	requireSignal(t, closed)
	waitForRunStatus(t, app, run.RunID, "queued")
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{OutputText: "recovered"}, nil
	}}
	runtime := NewAgentRuntime(app.app.db, app.app.conversations, app.app.providers, app.app.webTools)
	defer runtime.Close()
	runtime.StartWorkers()
	waitForRunStatus(t, app, run.RunID, "completed")
}
