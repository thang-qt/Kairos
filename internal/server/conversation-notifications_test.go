package server

import (
	"context"
	"testing"
	"time"
)

func TestConversationNotificationsOnlyFollowCommit(t *testing.T) {
	app, _, session := runtimeFixture(t)
	app.app.runtime.Close()
	service := app.app.conversations
	changed, unsubscribe := service.notifications.subscribe(session.Key)
	defer unsubscribe()
	other, unsubscribeOther := service.notifications.subscribe("unrelated")
	defer unsubscribeOther()
	tx, err := service.beginEventTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := insertChatEventExec(context.Background(), tx, ConversationEvent{SessionKey: session.Key, State: "delta"}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
		t.Fatal("uncommitted event notified subscribers")
	default:
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
		t.Fatal("rolled-back event notified subscribers")
	default:
	}
	tx, err = service.beginEventTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := insertChatEventExec(context.Background(), tx, ConversationEvent{SessionKey: session.Key, State: "delta"}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	default:
		t.Fatal("committed event did not notify subscribers")
	}
	select {
	case <-other:
		t.Fatal("unrelated conversation was notified")
	default:
	}
}
func TestConversationStreamDrainsCoalescedNotification(t *testing.T) {
	app, user, session := runtimeFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	snapshot := make(chan struct{})
	done := make(chan error, 1)
	count := 0
	go func() {
		done <- app.app.runtime.StreamSession(ctx, user, session.FriendlyID, func(event ConversationEvent) error {
			if event.State == "reconcile" {
				close(snapshot)
			}
			if event.State == "delta" {
				count++
				if count == 600 {
					cancel()
				}
			}
			return nil
		})
	}()
	select {
	case <-snapshot:
	case <-ctx.Done():
		t.Fatal("no snapshot")
	}
	tx, err := app.app.conversations.beginEventTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for range 600 {
		if err := insertChatEventExec(context.Background(), tx, ConversationEvent{SessionKey: session.Key, State: "delta"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if count != 600 {
		t.Fatalf("coalesced notification lost events: %d", count)
	}
}
