package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

func TestRecentSessionCursorPaginationUsesUpdatedAtAndAscendingID(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "recent-pages@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "recent-pages@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	otherCookie := signupAndRequireCookie(t, app, "other-recent-pages@example.invalid")
	var otherUserID string
	if err := app.app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "other-recent-pages@example.invalid").Scan(&otherUserID); err != nil {
		t.Fatal(err)
	}

	type sessionSeed struct {
		label   string
		updated int64
		pinned  bool
	}
	seeds := []sessionSeed{
		{label: "old pinned", updated: 100, pinned: true},
		{label: "recent unpinned", updated: 1000},
		{label: "tie A", updated: 800},
		{label: "tie B", updated: 800, pinned: true},
		{label: "tie C", updated: 800},
	}
	keysByUpdated := map[int64][]string{}
	for _, seed := range seeds {
		session, err := app.app.conversations.CreateSession(context.Background(), userID, seed.label)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := app.app.db.Exec(`UPDATE chat_sessions SET updated_at=?,is_pinned=? WHERE id=?`, seed.updated, boolAsInt(seed.pinned), session.Key); err != nil {
			t.Fatal(err)
		}
		keysByUpdated[seed.updated] = append(keysByUpdated[seed.updated], session.Key)
	}
	otherSession, err := app.app.conversations.CreateSession(context.Background(), otherUserID, "other owner session")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.app.db.Exec(`UPDATE chat_sessions SET updated_at=700 WHERE user_id=?`, otherUserID); err != nil {
		t.Fatal(err)
	}

	response := performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions?order=recent&limit=2", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)
	var first sessionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Sessions) != 2 || first.Sessions[0].Label != "recent unpinned" || first.NextCursor == "" {
		t.Fatalf("first recent page = %#v", first)
	}
	if first.Sessions[0].IsPinned {
		t.Fatal("recent order prioritized an older pinned session")
	}

	orderedTies := keysByUpdated[800]
	sort.Strings(orderedTies)
	if first.Sessions[1].Key != orderedTies[0] {
		t.Fatalf("first tie across page boundary = %q, want %q", first.Sessions[1].Key, orderedTies[0])
	}
	cursor := first.NextCursor
	seen := map[string]bool{first.Sessions[0].Key: true, first.Sessions[1].Key: true}
	pageIndex := 0
	for cursor != "" {
		page, err := app.app.conversations.ListRecentSessionPage(context.Background(), userID, 2, cursor)
		if err != nil {
			t.Fatal(err)
		}
		for _, session := range page.Sessions {
			if seen[session.Key] {
				t.Fatalf("recent pagination duplicated session %q", session.Key)
			}
			seen[session.Key] = true
		}
		if pageIndex == 0 {
			if len(page.Sessions) != 2 || page.Sessions[0].Key != orderedTies[1] || page.Sessions[1].Key != orderedTies[2] {
				t.Fatalf("tied recent order across pages = %#v, want %v", page.Sessions, orderedTies[1:])
			}
		}
		cursor = page.NextCursor
		pageIndex++
	}
	if len(seen) != len(seeds) {
		t.Fatalf("recent pagination returned %d sessions, want %d", len(seen), len(seeds))
	}
	if _, err := app.app.conversations.ListSessionPage(context.Background(), userID, 2, first.NextCursor); !errors.Is(err, errInvalidSessionPage) {
		t.Fatalf("recent cursor accepted by pinned order: %v", err)
	}
	pinnedPage, err := app.app.conversations.ListSessionPage(context.Background(), userID, 2, "")
	if err != nil || pinnedPage.NextCursor == "" {
		t.Fatalf("load pinned cursor: %v", err)
	}
	if _, err := app.app.conversations.ListRecentSessionPage(context.Background(), userID, 2, pinnedPage.NextCursor); !errors.Is(err, errInvalidSessionPage) {
		t.Fatalf("pinned cursor accepted by recent order: %v", err)
	}

	response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions?order=recent&limit=2&cursor="+first.NextCursor, nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, response, http.StatusOK)
	var otherPage sessionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &otherPage); err != nil || len(otherPage.Sessions) != 1 || otherPage.Sessions[0].Key != otherSession.Key {
		t.Fatal("recent cursor escaped owner scope", err)
	}
	response = performJSONRequest(t, app.handler, http.MethodGet, "/api/sessions?order=unknown", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusBadRequest)
}
