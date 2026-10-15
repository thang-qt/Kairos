package server

import (
	"context"
	"testing"
)

func TestUnchangedSearchTitleDoesNotRewriteFTS(t *testing.T) {
	fixture := newTestApp(t, nil)
	app := fixture.app
	app.runtime.Close()
	app.conversations.assets.closeCleanup()
	signupAndRequireCookie(t, fixture, "title-update@example.invalid")
	var userID string
	if err := app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "title-update@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	session, err := app.conversations.CreateSession(context.Background(), userID, "Original")
	if err != nil {
		t.Fatal(err)
	}
	var before, after int
	if err := app.db.QueryRow(`SELECT total_changes()`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(`UPDATE chat_sessions SET derived_title=derived_title WHERE id=?`, session.Key); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(`SELECT total_changes()`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after-before != 1 {
		t.Fatalf("unchanged title rewrote search index: changes=%d", after-before)
	}
	if _, err := app.conversations.RenameSession(context.Background(), userID, session.FriendlyID, "Replacement"); err != nil {
		t.Fatal(err)
	}
	results, err := app.conversations.SearchSessions(context.Background(), userID, "Replacement")
	if err != nil || len(results) != 1 {
		t.Fatalf("rename not indexed: %+v %v", results, err)
	}
	results, err = app.conversations.SearchSessions(context.Background(), userID, "Original")
	if err != nil || len(results) != 0 {
		t.Fatalf("old title still indexed: %+v %v", results, err)
	}
}
