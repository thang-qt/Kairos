package server

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestIdleDispatcherWaitsAndUsesDeadlineIndexes(t *testing.T) {
	app, _, _ := runtimeFixture(t)
	app.app.runtime.Close()
	delay, err := app.app.runtime.nextDispatchDelay(context.Background())
	if err != nil || delay < 29*time.Second {
		t.Fatalf("idle dispatcher still polls: %s %v", delay, err)
	}
	for _, query := range []string{
		`EXPLAIN QUERY PLAN SELECT id FROM chat_runs WHERE status='running' AND lease_until<0`,
		`EXPLAIN QUERY PLAN UPDATE chat_runs SET status='queued' WHERE status='preparing' AND lease_until<0`,
	} {
		rows, err := app.app.db.Query(query)
		if err != nil {
			t.Fatal(err)
		}
		indexed := false
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(detail, "idx_chat_runs_status_lease") {
				indexed = true
			}
		}
		rows.Close()
		if !indexed {
			t.Fatal("lease recovery does not use its status/lease index")
		}
	}
}
func TestDispatcherSchedulesFutureJobs(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	result, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, Message: "future", Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.app.db.Exec(`UPDATE chat_jobs SET available_at=? WHERE run_id=?`, time.Now().Add(time.Second).UnixMilli(), result.RunID); err != nil {
		t.Fatal(err)
	}
	delay, err := app.app.runtime.nextDispatchDelay(context.Background())
	if err != nil || delay < 500*time.Millisecond || delay > time.Second {
		t.Fatalf("future job timer: %s %v", delay, err)
	}
}
