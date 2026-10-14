package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestSessionCursorPaginationAndDirectLookup(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "pages@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "pages@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 123; index++ {
		session, err := app.app.conversations.CreateSession(context.Background(), userID, fmt.Sprintf("Synthetic session %d", index))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = app.app.db.Exec(`UPDATE chat_sessions SET updated_at=1000,created_at=2000,is_pinned=? WHERE id=?`, boolAsInt(index < 5), session.Key); err != nil {
			t.Fatal(err)
		}
	}
	response := performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)
	var first sessionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Sessions) != 50 || first.NextCursor == "" {
		t.Fatal("default page was not bounded")
	}
	ordered, err := app.app.conversations.ListSessions(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	cursor := ""
	seen := map[string]bool{}
	index := 0
	for {
		page, err := app.app.conversations.ListSessionPage(context.Background(), userID, 17, cursor)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Sessions) > 17 {
			t.Fatal("oversized page")
		}
		for _, session := range page.Sessions {
			if seen[session.Key] || index >= len(ordered) || session.Key != ordered[index].Key {
				t.Fatal("cursor skipped, duplicated, or reordered a session with tied timestamps")
			}
			seen[session.Key] = true
			index++
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != 123 {
		t.Fatalf("incomplete pagination: %d", len(seen))
	}
	old := ordered[len(ordered)-1]
	response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions/"+old.FriendlyID, nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)
	var summary SessionSummary
	if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil || summary.Key != old.Key {
		t.Fatal("direct lookup failed", err)
	}
	other := signupAndRequireCookie(t, app, "other-pages@example.invalid")
	response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions/"+old.FriendlyID, nil, []*http.Cookie{other})
	assertStatusCode(t, response, http.StatusNotFound)
	response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions?cursor="+first.NextCursor, nil, []*http.Cookie{other})
	assertStatusCode(t, response, http.StatusOK)
	var otherPage sessionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &otherPage); err != nil || len(otherPage.Sessions) != 0 {
		t.Fatal("cursor escaped owner scope", err)
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=bad", "cursor=invalid!"} {
		response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions?"+query, nil, []*http.Cookie{cookie})
		assertStatusCode(t, response, http.StatusBadRequest)
	}
}
