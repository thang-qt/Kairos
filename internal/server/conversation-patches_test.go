package server

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestCompactJournalGrowthWithLargeToolOutput(t *testing.T) {
	app, user, session := runtimeFixture(t)
	runtime := app.app.runtime
	runtime.Close()
	ctx := context.Background()
	now := time.Now().UnixMilli()
	record := executionRecord{ID: newID(), UserID: user, SessionID: session.Key, AssistantTurnID: newID(), Status: "running", Model: "test-model"}
	if err := runtime.insertRun(ctx, record, SubmitTurnInput{Message: "stress"}, now); err != nil {
		t.Fatal(err)
	}
	tool := map[string]any{"id": "large-tool", "role": "toolResult", "toolCallId": "call", "timestamp": now + 2, "content": []any{map[string]any{"type": "text", "text": strings.Repeat("x", 256<<10)}}}
	if err := checkpointStepExec(ctx, app.app.db, record.ID, tool); err != nil {
		t.Fatal(err)
	}
	if err := runtime.refreshTurnExec(ctx, app.app.db, record.ID, "delta"); err != nil {
		t.Fatal(err)
	}
	latencies := []time.Duration{}
	for i := 1; i <= 500; i++ {
		started := time.Now()
		message := map[string]any{"id": "model-step", "role": "assistant", "timestamp": now + 3, "content": []any{map[string]any{"type": "text", "text": strings.Repeat("a", i*120)}}}
		tx, err := app.app.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := checkpointStepExec(ctx, tx, record.ID, message); err != nil {
			t.Fatal(err)
		}
		if err := runtime.refreshTurnExec(ctx, tx, record.ID, "delta"); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		latencies = append(latencies, time.Since(started))
	}
	if err := runtime.refreshTurnExec(ctx, app.app.db, record.ID, "final"); err != nil {
		t.Fatal(err)
	}
	var journalBytes, snapshotBytes, fullDeltaCount int64
	if err := app.app.db.QueryRow(`SELECT SUM(LENGTH(event_json)),SUM(CASE WHEN json_extract(event_json,'$.state')='delta' AND json_type(event_json,'$.message') IS NOT NULL THEN 1 ELSE 0 END) FROM chat_events WHERE session_id=?`, session.Key).Scan(&journalBytes, &fullDeltaCount); err != nil {
		t.Fatal(err)
	}
	if err := app.app.db.QueryRow(`SELECT LENGTH(turn_json) FROM chat_runs WHERE id=?`, record.ID).Scan(&snapshotBytes); err != nil {
		t.Fatal(err)
	}
	if journalBytes > 2<<20 || fullDeltaCount != 1 {
		t.Fatalf("journal grew with repeated snapshots: bytes=%d full deltas=%d", journalBytes, fullDeltaCount)
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	var pages, size int64
	_ = app.app.db.QueryRow(`PRAGMA page_count`).Scan(&pages)
	_ = app.app.db.QueryRow(`PRAGMA page_size`).Scan(&size)
	t.Logf("500 checkpoints, 60KB text + 256KiB tool: journal=%d bytes snapshot=%d bytes SQLite=%d bytes p95 write=%s", journalBytes, snapshotBytes, pages*size, latencies[475])
	events, err := runtime.readEvents(ctx, session.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 || len(events[1].TurnPatch) == 0 {
		t.Fatal("tool boundary did not journal a compact patch")
	}
}

func TestTurnPatchEncodesStringSuffixAndNull(t *testing.T) {
	previous := map[string]any{"text": "before", "unchanged": strings.Repeat("x", 10000), "removed": true}
	next := map[string]any{"text": "before after", "unchanged": previous["unchanged"], "nullable": nil}
	operations := diffTurn(previous, next)
	data, err := json.Marshal(operations)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), strings.Repeat("x", 100)) || !strings.Contains(string(data), `"value":null`) || !strings.Contains(string(data), `"op":"append"`) {
		t.Fatalf("patch=%s", data)
	}
}
