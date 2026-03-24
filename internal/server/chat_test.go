package server

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestSessionsRequireAuthentication(t *testing.T) {
	testServer := newTestApp(t, nil)

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, nil)
	assertStatusCode(t, response, http.StatusUnauthorized)
}

func TestCreateListAndLoadSessionHistory(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "history@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Roadmap",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	if created.SessionKey == "" {
		t.Fatal("created sessionKey = empty, want populated value")
	}
	if created.FriendlyID == "" {
		t.Fatal("created friendlyId = empty, want populated value")
	}

	if _, err := testServer.app.db.Exec(`
		INSERT INTO chat_messages(
			id,
			session_id,
			role,
			content_json,
			message_json,
			timestamp,
			created_at
		)
		VALUES (?, ?, 'user', ?, ?, ?, ?)
	`, newID(), created.SessionKey, `[{"type":"text","text":"hello kairos"}]`, `{"id":"msg-1","role":"user","timestamp":1710000000000,"content":[{"type":"text","text":"hello kairos"}]}`, 1710000000000, time.Now().UnixMilli()); err != nil {
		t.Fatalf("insert message error = %v", err)
	}

	if _, err := testServer.app.db.Exec(`
		UPDATE chat_sessions
		SET
			last_message_json = ?,
			updated_at = ?,
			derived_title = ?
		WHERE id = ?
	`, `{"id":"msg-1","role":"user","timestamp":1710000000000,"content":[{"type":"text","text":"hello kairos"}]}`, 1710000000000, "hello kairos", created.SessionKey); err != nil {
		t.Fatalf("update session metadata error = %v", err)
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count = %d, want 1", len(sessionsPayload.Sessions))
	}
	session := sessionsPayload.Sessions[0]
	if session.Key != created.SessionKey {
		t.Fatalf("session key = %q, want %q", session.Key, created.SessionKey)
	}
	if session.FriendlyID != created.FriendlyID {
		t.Fatalf("session friendlyId = %q, want %q", session.FriendlyID, created.FriendlyID)
	}
	if session.Label != "Roadmap" {
		t.Fatalf("session label = %q, want Roadmap", session.Label)
	}
	if session.LastMessage == nil {
		t.Fatal("session lastMessage = nil, want populated message")
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if historyPayload.SessionKey != created.SessionKey {
		t.Fatalf("history sessionKey = %q, want %q", historyPayload.SessionKey, created.SessionKey)
	}
	if len(historyPayload.Messages) != 1 {
		t.Fatalf("history message count = %d, want 1", len(historyPayload.Messages))
	}
}

func TestSessionEndpointsAreUserScoped(t *testing.T) {
	testServer := newTestApp(t, nil)
	ownerCookie := signupAndRequireCookie(t, testServer, "owner@example.com")
	otherCookie := signupAndRequireCookie(t, testServer, "other@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Private",
	}, []*http.Cookie{ownerCookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	otherListResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, otherListResponse, http.StatusOK)

	var otherSessions sessionsResponse
	decodeResponseJSON(t, otherListResponse, &otherSessions)
	if len(otherSessions.Sessions) != 0 {
		t.Fatalf("other user sessions count = %d, want 0", len(otherSessions.Sessions))
	}

	otherHistoryResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, otherHistoryResponse, http.StatusNotFound)

	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/sessions/"+created.FriendlyID, nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, deleteResponse, http.StatusNotFound)
}

func TestRenameAndDeleteSession(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "rename@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Draft",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	renameResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/sessions/"+created.FriendlyID, createSessionRequest{
		Label: "Renamed",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, renameResponse, http.StatusOK)

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count after rename = %d, want 1", len(sessionsPayload.Sessions))
	}
	if sessionsPayload.Sessions[0].Label != "Renamed" {
		t.Fatalf("renamed label = %q, want Renamed", sessionsPayload.Sessions[0].Label)
	}

	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/sessions/"+created.FriendlyID, nil, []*http.Cookie{cookie})
	assertStatusCode(t, deleteResponse, http.StatusOK)

	afterDelete := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, afterDelete, http.StatusOK)

	decodeResponseJSON(t, afterDelete, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 0 {
		t.Fatalf("sessions count after delete = %d, want 0", len(sessionsPayload.Sessions))
	}
}

func signupAndRequireCookie(t *testing.T, testServer *testApp, email string) *http.Cookie {
	t.Helper()

	response := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    email,
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, response, http.StatusCreated)
	return requireSessionCookie(t, response)
}

func TestChatServiceCreateSessionCreatesUserPreferencesIncrementally(t *testing.T) {
	testServer := newTestApp(t, nil)
	user, _, _, err := testServer.app.auth.Signup(context.Background(), "prefs@example.com", "tracepass123", RequestMeta{})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}

	if _, err := testServer.app.chat.CreateSession(context.Background(), user.ID, ""); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
}
