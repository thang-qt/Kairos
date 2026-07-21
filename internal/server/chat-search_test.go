package server

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestSessionSearchIndexesVisibleTextAndSessionLifecycle(t *testing.T) {
	testServer := newTestApp(t, nil)
	ownerCookie := signupAndRequireCookie(t, testServer, "search-owner@example.com")
	otherCookie := signupAndRequireCookie(t, testServer, "search-other@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Invoice filing",
	}, []*http.Cookie{ownerCookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	messageIDs := seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		{
			"id":   newID(),
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": "Plan Project Aurora milestones"},
				{"type": "thinking", "thinking": "hidden user reasoning"},
				{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "private-base64-data"}},
			},
		},
		{
			"id":   newID(),
			"role": "assistant",
			"content": []map[string]any{
				{"type": "text", "text": "Aurora delivery is scheduled for Friday."},
				{"type": "thinking", "thinking": "hidden assistant reasoning"},
				{"type": "toolCall", "name": "web_search", "arguments": map[string]any{"query": "private tool input"}},
				{"type": "toolResult", "content": []map[string]any{{"type": "text", "text": "private tool result"}}},
			},
		},
		{
			"id":   newID(),
			"role": "assistant",
			"content": []map[string]any{
				{"type": "text", "text": "Aurora text-only response is searchable."},
			},
		},
	})
	if _, err := testServer.app.db.Exec(`
		UPDATE chat_sessions SET derived_title = 'Unrelated session metadata' WHERE id = ?
	`, created.SessionKey); err != nil {
		t.Fatalf("set unrelated derived title: %v", err)
	}

	expectedMessageIDs := map[string]struct{}{
		messageIDs[0]: {},
		messageIDs[2]: {},
	}

	searchResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=aurora", nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, searchResponse, http.StatusOK)
	var searchPayload sessionSearchResponse
	decodeResponseJSON(t, searchResponse, &searchPayload)
	if len(searchPayload.Sessions) != 2 {
		t.Fatalf("aurora search results = %d, want 2", len(searchPayload.Sessions))
	}
	messageResults := make(map[string]SessionSearchResult, len(searchPayload.Sessions))
	for _, result := range searchPayload.Sessions {
		if result.FriendlyID != created.FriendlyID {
			t.Fatalf("aurora result friendlyId = %q, want %q", result.FriendlyID, created.FriendlyID)
		}
		messageResults[result.MessageID] = result
	}
	for messageID := range expectedMessageIDs {
		result, ok := messageResults[messageID]
		if !ok {
			t.Fatalf("aurora results missing message ID %q: %#v", messageID, searchPayload.Sessions)
		}
		if !strings.Contains(strings.ToLower(result.Snippet), "aurora") {
			t.Fatalf("aurora result snippet = %q, want visible text", result.Snippet)
		}
		if strings.Contains(result.Snippet, "Unrelated session metadata") {
			t.Fatalf("aurora result snippet = %q, want matching message content", result.Snippet)
		}
	}

	for _, query := range []string{"hidden", "private", "base64"} {
		response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q="+query, nil, []*http.Cookie{ownerCookie})
		assertStatusCode(t, response, http.StatusOK)
		decodeResponseJSON(t, response, &searchPayload)
		if len(searchPayload.Sessions) != 0 {
			t.Fatalf("%q search results = %d, want 0", query, len(searchPayload.Sessions))
		}
	}

	otherUserSearch := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=aurora", nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, otherUserSearch, http.StatusOK)
	decodeResponseJSON(t, otherUserSearch, &searchPayload)
	if len(searchPayload.Sessions) != 0 {
		t.Fatalf("other user search results = %d, want 0", len(searchPayload.Sessions))
	}

	cloneResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/clone", cloneSessionRequest{
		MessageID: messageIDs[0],
	}, []*http.Cookie{ownerCookie})
	assertStatusCode(t, cloneResponse, http.StatusOK)
	var clone sessionMutationResponse
	decodeResponseJSON(t, cloneResponse, &clone)

	searchResponse = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=aurora", nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, searchResponse, http.StatusOK)
	decodeResponseJSON(t, searchResponse, &searchPayload)
	if len(searchPayload.Sessions) != 3 {
		t.Fatalf("search results after clone = %d, want 3", len(searchPayload.Sessions))
	}
	var cloneResult *SessionSearchResult
	for index := range searchPayload.Sessions {
		result := &searchPayload.Sessions[index]
		if result.FriendlyID == clone.FriendlyID && result.MessageID != "" {
			cloneResult = result
			break
		}
	}
	if cloneResult == nil || cloneResult.MessageID != messageIDs[0] {
		t.Fatalf("clone search result = %#v, want gateway message ID %q", cloneResult, messageIDs[0])
	}

	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/sessions/"+created.FriendlyID+"/messages/"+messageIDs[0], nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, deleteResponse, http.StatusOK)

	searchResponse = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=aurora", nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, searchResponse, http.StatusOK)
	decodeResponseJSON(t, searchResponse, &searchPayload)
	if len(searchPayload.Sessions) != 1 {
		t.Fatalf("search results after truncation = %d, want 1", len(searchPayload.Sessions))
	}

	deleteCloneResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/sessions/"+clone.FriendlyID, nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, deleteCloneResponse, http.StatusOK)
	searchResponse = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=aurora", nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, searchResponse, http.StatusOK)
	decodeResponseJSON(t, searchResponse, &searchPayload)
	if len(searchPayload.Sessions) != 0 {
		t.Fatalf("search results after cascade delete = %d, want 0", len(searchPayload.Sessions))
	}

	renameResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/sessions/"+created.FriendlyID, createSessionRequest{
		Label: "Renamed ledger",
	}, []*http.Cookie{ownerCookie})
	assertStatusCode(t, renameResponse, http.StatusOK)

	seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		{
			"id":   newID(),
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": "Ledger entry"},
			},
		},
	})
	searchResponse = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=ledger", nil, []*http.Cookie{ownerCookie})
	assertStatusCode(t, searchResponse, http.StatusOK)
	decodeResponseJSON(t, searchResponse, &searchPayload)
	if len(searchPayload.Sessions) != 2 || searchPayload.Sessions[0].FriendlyID != created.FriendlyID {
		t.Fatalf("renamed title search results = %#v, want title and message results", searchPayload.Sessions)
	}
	if searchPayload.Sessions[0].MessageID != "" {
		t.Fatalf("renamed title messageId = %q, want empty title fallback", searchPayload.Sessions[0].MessageID)
	}
	if searchPayload.Sessions[1].MessageID == "" {
		t.Fatalf("ledger message result = %#v, want a message ID", searchPayload.Sessions[1])
	}
	if !strings.Contains(strings.ToLower(searchPayload.Sessions[0].Snippet), "ledger") {
		t.Fatalf("renamed title snippet = %q, want matching title metadata", searchPayload.Sessions[0].Snippet)
	}
}

func TestSessionSearchValidatesAuthenticationAndQueryLength(t *testing.T) {
	testServer := newTestApp(t, nil)

	unauthorized := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=anything", nil, nil)
	assertStatusCode(t, unauthorized, http.StatusUnauthorized)

	cookie := signupAndRequireCookie(t, testServer, "search-bounds@example.com")
	tooLong := strings.Repeat("a", maxSessionSearchQueryRunes+1)
	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q="+tooLong, nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusBadRequest)

	if _, err := testServer.app.db.Exec(`DROP TABLE chat_session_search`); err != nil {
		t.Fatalf("drop search table: %v", err)
	}
	response = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/search?q=anything", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusInternalServerError)
	var errorPayload map[string]string
	decodeResponseJSON(t, response, &errorPayload)
	if errorPayload["error"] != "Unable to search sessions." {
		t.Fatalf("internal search error = %q, want generic error", errorPayload["error"])
	}
}

func TestSessionSearchMigrationBackfillsPre0016Database(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "pre-0016.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("close database: %v", err)
		}
	})
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	applyMigrationsBefore(t, db, "0016_chat_session_search.sql")

	if _, err := db.Exec(`
		INSERT INTO users(id, email, password_hash, role, created_at, updated_at)
		VALUES ('user-1', 'search@example.com', 'hash', 'user', 1, 1);
		INSERT INTO chat_sessions(id, user_id, friendly_id, title, label, updated_at, created_at)
		VALUES ('session-1', 'user-1', 'session-friendly', 'Quarterly review', 'Budget', 2, 1);
		INSERT INTO chat_messages(id, session_id, role, content_json, timestamp, message_json, created_at)
		VALUES
			(
				'message-1',
				'session-1',
				'user',
				'[{"type":"text","text":"Discuss Aurora launch milestones"}]',
				2,
				'{"id":"gateway-message-1"}',
				2
			),
			(
				'message-2',
				'session-1',
				'assistant',
				'[{"type":"text","text":"Aurora tool-call text"},{"type":"toolCall","id":"call-1","name":"search"}]',
				3,
				'{"id":"gateway-message-2"}',
				3
			),
			(
				'message-3',
				'session-1',
				'assistant',
				'[{"type":"text","text":"Aurora text-only response"}]',
				4,
				'{"id":"gateway-message-3"}',
				4
			);
	`); err != nil {
		t.Fatalf("seed pre-0016 database: %v", err)
	}

	if err := applyMigrations(db); err != nil {
		t.Fatalf("upgrade database: %v", err)
	}

	var documentCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_session_search WHERE session_id = 'session-1'`).Scan(&documentCount); err != nil {
		t.Fatalf("count backfilled search documents: %v", err)
	}
	if documentCount != 3 {
		t.Fatalf("backfilled search documents = %d, want 3", documentCount)
	}

	results, err := NewChatService(db).SearchSessions(t.Context(), "user-1", "aurora")
	if err != nil {
		t.Fatalf("search backfilled message: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("backfilled message results = %#v, want user and text-only assistant matches", results)
	}
	messageIDs := make(map[string]struct{}, len(results))
	for _, result := range results {
		messageIDs[result.MessageID] = struct{}{}
		if !strings.Contains(result.Snippet, "Aurora") {
			t.Fatalf("backfilled message snippet = %q, want matching content", result.Snippet)
		}
	}
	if _, ok := messageIDs["gateway-message-1"]; !ok {
		t.Fatalf("backfilled message IDs = %#v, want gateway user ID", messageIDs)
	}
	if _, ok := messageIDs["gateway-message-3"]; !ok {
		t.Fatalf("backfilled message IDs = %#v, want gateway text-only assistant ID", messageIDs)
	}
	if _, ok := messageIDs["gateway-message-2"]; ok {
		t.Fatalf("backfilled message IDs = %#v, must exclude tool-call assistant", messageIDs)
	}
}

func TestSessionSearchMigrationPurgesPreviouslyIndexedToolCallMessages(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "pre-0017.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("close database: %v", err)
		}
	})
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	applyMigrationsBefore(t, db, "0017_chat_session_search_visible_messages.sql")

	if _, err := db.Exec(`
		INSERT INTO users(id, email, password_hash, role, created_at, updated_at)
		VALUES ('user-1', 'purge@example.com', 'hash', 'user', 1, 1);
		INSERT INTO chat_sessions(id, user_id, friendly_id, updated_at, created_at)
		VALUES ('session-1', 'user-1', 'session-friendly', 1, 1);
		INSERT INTO chat_messages(id, session_id, role, content_json, timestamp, message_json, created_at)
		VALUES (
			'message-1',
			'session-1',
			'assistant',
			'[{"type":"text","text":"Legacy tool-call content"},{"type":"toolCall","id":"call-1","name":"search"}]',
			1,
			'{"id":"gateway-message-1"}',
			1
		);
		INSERT INTO chat_session_search(session_id, user_id, message_id, document_kind, title, content)
		VALUES ('session-1', 'user-1', 'message-1', 'message', '', 'Legacy tool-call content');
	`); err != nil {
		t.Fatalf("seed legacy indexed tool-call message: %v", err)
	}

	if err := applyMigrations(db); err != nil {
		t.Fatalf("upgrade database: %v", err)
	}

	var indexedCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM chat_session_search WHERE message_id = 'message-1'
	`).Scan(&indexedCount); err != nil {
		t.Fatalf("count purged search documents: %v", err)
	}
	if indexedCount != 0 {
		t.Fatalf("indexed tool-call documents after migration = %d, want 0", indexedCount)
	}

	if _, err := db.Exec(`
		UPDATE chat_messages
		SET content_json = '[{"type":"text","text":"Text-only assistant content"}]'
		WHERE id = 'message-1'
	`); err != nil {
		t.Fatalf("update to text-only assistant: %v", err)
	}
	results, err := NewChatService(db).SearchSessions(t.Context(), "user-1", "text-only")
	if err != nil {
		t.Fatalf("search text-only assistant: %v", err)
	}
	if len(results) != 1 || results[0].MessageID != "gateway-message-1" {
		t.Fatalf("text-only assistant results = %#v, want gateway message result", results)
	}

	if _, err := db.Exec(`
		UPDATE chat_messages
		SET content_json = '[{"type":"text","text":"Tool-call content again"},{"type":"toolCall","id":"call-2","name":"search"}]'
		WHERE id = 'message-1'
	`); err != nil {
		t.Fatalf("update to tool-call assistant: %v", err)
	}
	results, err = NewChatService(db).SearchSessions(t.Context(), "user-1", "tool-call")
	if err != nil {
		t.Fatalf("search updated tool-call assistant: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("updated tool-call assistant results = %#v, want none", results)
	}
}

func applyMigrationsBefore(t *testing.T, db *sql.DB, stopAt string) {
	t.Helper()
	if _, err := db.Exec(`
		CREATE TABLE schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`); err != nil {
		t.Fatalf("create migration table: %v", err)
	}

	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	versions := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && entry.Name() < stopAt {
			versions = append(versions, entry.Name())
		}
	}
	sort.Strings(versions)
	for _, version := range versions {
		sqlBytes, err := migrationFiles.ReadFile("migrations/" + version)
		if err != nil {
			t.Fatalf("read migration %s: %v", version, err)
		}
		if _, err := db.Exec(string(sqlBytes)); err != nil {
			t.Fatalf("apply migration %s: %v", version, err)
		}
		if _, err := db.Exec(
			`INSERT INTO schema_migrations(version, applied_at) VALUES (?, 1)`,
			version,
		); err != nil {
			t.Fatalf("record migration %s: %v", version, err)
		}
	}
	if len(versions) == 0 {
		t.Fatalf("no migrations found before %s", stopAt)
	}
}
