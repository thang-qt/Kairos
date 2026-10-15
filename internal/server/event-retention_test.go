package server

import (
	"context"
	"testing"
)

func TestEventRetentionPreservesCurrentReplayAndRollback(t *testing.T) {
	app, _, session := runtimeFixture(t)
	app.app.runtime.Close()
	ctx := context.Background()
	service := app.app.conversations
	for range 300 {
		if err := insertChatEventExec(ctx, app.app.db, ConversationEvent{SessionKey: session.Key, State: "delta", Revision: 0}); err != nil {
			t.Fatal(err)
		}
	}
	var oldCursor int64
	if err := app.app.db.QueryRow(`SELECT MAX(sequence) FROM chat_events WHERE session_id=?`, session.Key).Scan(&oldCursor); err != nil {
		t.Fatal(err)
	}
	tx, err := service.beginEventTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE chat_sessions SET revision=1 WHERE id=?`, session.Key); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_events WHERE session_id=?`, session.Key).Scan(&count); err != nil || count != 300 {
		t.Fatalf("rollback lost events: %d %v", count, err)
	}
	tx, err = service.beginEventTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE chat_sessions SET revision=1 WHERE id=?`, session.Key); err != nil {
		t.Fatal(err)
	}
	if err := insertChatEventExec(ctx, tx, ConversationEvent{SessionKey: session.Key, State: "user", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	events, err := app.app.runtime.readEvents(ctx, session.Key, oldCursor)
	if err != nil || len(events) != 1 || events[0].Cursor <= oldCursor {
		t.Fatalf("cursor replay failed: %+v %v", events, err)
	}
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_events WHERE session_id=?`, session.Key).Scan(&count); err != nil || count != 1 {
		t.Fatalf("obsolete events retained: %d %v", count, err)
	}
}
