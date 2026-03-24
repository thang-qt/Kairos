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

func TestSendMessagePersistsHistoryAndStreamsFinalEvent(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "stream@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Streaming",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	userID := userIDFromCookie(t, testServer, cookie)

	eventResult := make(chan []ChatEvent, 1)
	streamContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		events := make([]ChatEvent, 0, 2)
		err := testServer.app.runs.StreamSession(streamContext, userID, created.FriendlyID, func(event ChatEvent) error {
			events = append(events, event)
			if event.State == "final" {
				eventResult <- events
				cancel()
			}
			return nil
		})
		if err != nil && streamContext.Err() == nil {
			t.Errorf("stream session error = %v", err)
			eventResult <- nil
			return
		}
	}()

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Explain the new slice",
		Model:   "kairos-balanced",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	select {
	case events := <-eventResult:
		if len(events) == 0 {
			t.Fatal("stream events = empty, want delta/final events")
		}
		if events[len(events)-1].State != "final" {
			t.Fatalf("final stream state = %q, want final", events[len(events)-1].State)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for streamed events")
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("history message count after send = %d, want 2", len(historyPayload.Messages))
	}
	if historyPayload.Messages[0]["role"] != "user" {
		t.Fatalf("first message role = %v, want user", historyPayload.Messages[0]["role"])
	}
	if historyPayload.Messages[1]["role"] != "assistant" {
		t.Fatalf("second message role = %v, want assistant", historyPayload.Messages[1]["role"])
	}
}

func TestSessionEventsAreUserScoped(t *testing.T) {
	testServer := newTestApp(t, nil)
	ownerCookie := signupAndRequireCookie(t, testServer, "event-owner@example.com")
	otherCookie := signupAndRequireCookie(t, testServer, "event-other@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Private stream",
	}, []*http.Cookie{ownerCookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/events", nil, []*http.Cookie{otherCookie})
	assertStatusCode(t, response, http.StatusNotFound)
}

func userIDFromCookie(t *testing.T, testServer *testApp, cookie *http.Cookie) string {
	t.Helper()

	user, err := testServer.app.auth.CurrentUser(context.Background(), cookie.Value)
	if err != nil {
		t.Fatalf("CurrentUser() error = %v", err)
	}
	return user.ID
}
