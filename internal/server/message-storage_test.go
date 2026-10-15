package server

import (
	"context"
	"strings"
	"testing"
)

func TestMessageContentUsesSingleStoredJSONAndLightweightSummary(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	record, err := app.app.conversations.findSessionByFriendlyID(context.Background(), user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.TrimSpace(strings.Repeat("unique body ", 10000))
	message := map[string]any{"id": "single-copy", "role": "user", "content": []any{map[string]any{"type": "text", "text": text}}}
	if _, err := app.app.conversations.appendMessageWithOptions(context.Background(), record, message, 1, appendMessageOptions{}); err != nil {
		t.Fatal(err)
	}
	var projected, last string
	if err := app.app.db.QueryRow(`SELECT content_json FROM chat_messages WHERE id='single-copy'`).Scan(&projected); err != nil || !strings.Contains(projected, text) {
		t.Fatal("virtual content projection lost text", err)
	}
	if err := app.app.db.QueryRow(`SELECT last_message_json FROM chat_sessions WHERE id=?`, session.Key).Scan(&last); err != nil || strings.Contains(last, "unique body") || len(last) > 200 {
		t.Fatalf("session retained full body: %d %v", len(last), err)
	}
	var hidden int
	if err := app.app.db.QueryRow(`SELECT hidden FROM pragma_table_xinfo('chat_messages') WHERE name='content_json'`).Scan(&hidden); err != nil || hidden != 2 {
		t.Fatalf("content is not virtual: %d %v", hidden, err)
	}
	// A summary never parses legacy last-message bytes; title generation still can
	// distinguish an occupied session through its normal record lookup.
	if _, err := app.app.db.Exec(`UPDATE chat_sessions SET last_message_json='invalid legacy JSON' WHERE id=?`, session.Key); err != nil {
		t.Fatal(err)
	}
	summary, err := app.app.conversations.GetSessionSummary(context.Background(), user, session.FriendlyID)
	if err != nil || summary.LastMessage != nil {
		t.Fatalf("summary loaded last message: %+v %v", summary, err)
	}
	history, err := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil || len(history.Messages) != 1 || !strings.Contains(stringValueFromMap(contentPartsToMaps(contentPartsFromAny(history.Messages[0]["content"]))[0], "text"), text) {
		t.Fatalf("history lost content: %v", err)
	}
}
