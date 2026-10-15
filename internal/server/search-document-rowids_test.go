package server

import (
	"context"
	"strings"
	"testing"
)

func TestSearchDocumentMappingsTrackClonesAndDeletes(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	service := app.app.conversations
	for _, text := range []string{"alpha", "beta", "gamma"} {
		record, err := service.findSessionByFriendlyID(context.Background(), user, session.FriendlyID)
		if err != nil {
			t.Fatal(err)
		}
		message := map[string]any{"id": newID(), "role": "user", "content": []any{map[string]any{"type": "text", "text": text}}}
		if _, err := service.appendMessageWithOptions(context.Background(), record, message, 1, appendMessageOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	var documents int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_search_documents WHERE session_id=?`, session.Key).Scan(&documents); err != nil || documents != 4 {
		t.Fatalf("missing documents: %d %v", documents, err)
	}
	if err := service.DeleteSession(context.Background(), user, session.FriendlyID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"chat_search_documents", "chat_session_search"} {
		if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE session_id=?`, session.Key).Scan(&documents); err != nil || documents != 0 {
			t.Fatalf("stale %s documents: %d %v", table, documents, err)
		}
	}
	rows, err := app.app.db.Query(`EXPLAIN QUERY PLAN DELETE FROM chat_session_search WHERE rowid=(SELECT fts_rowid FROM chat_search_documents WHERE message_id=?)`, "message")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	indexed := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(detail, "idx_chat_search_documents_message") {
			indexed = true
		}
	}
	if !indexed {
		t.Fatal("message lookup did not use the document mapping index")
	}
}
