package server

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"sync"
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

func TestPinSessionPersistsAndSortsToTop(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "pin@example.com")

	firstResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Older",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, firstResponse, http.StatusCreated)
	var first sessionMutationResponse
	decodeResponseJSON(t, firstResponse, &first)

	secondResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Newer",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, secondResponse, http.StatusCreated)
	var second sessionMutationResponse
	decodeResponseJSON(t, secondResponse, &second)

	pinResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/sessions/"+first.FriendlyID+"/pin", pinSessionRequest{
		IsPinned: true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, pinResponse, http.StatusOK)

	var pinned SessionSummary
	decodeResponseJSON(t, pinResponse, &pinned)
	if !pinned.IsPinned {
		t.Fatal("pin response isPinned = false, want true")
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 2 {
		t.Fatalf("sessions count after pin = %d, want 2", len(sessionsPayload.Sessions))
	}
	if sessionsPayload.Sessions[0].FriendlyID != first.FriendlyID {
		t.Fatalf("first listed session = %q, want pinned %q", sessionsPayload.Sessions[0].FriendlyID, first.FriendlyID)
	}
	if !sessionsPayload.Sessions[0].IsPinned {
		t.Fatal("first listed session isPinned = false, want true")
	}

	reloadResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, reloadResponse, http.StatusOK)
	decodeResponseJSON(t, reloadResponse, &sessionsPayload)
	if !sessionsPayload.Sessions[0].IsPinned {
		t.Fatal("reloaded pinned session isPinned = false, want true")
	}
}

func TestCloneSessionCopiesMessages(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "clone@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Clone Source",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	messageIDs := seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		newUserTextMessage("Original question"),
		newAssistantTextMessage("Original answer"),
		newUserTextMessage("Second question"),
	})

	cloneResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/clone", cloneSessionRequest{
		MessageID: messageIDs[1],
	}, []*http.Cookie{cookie})
	assertStatusCode(t, cloneResponse, http.StatusOK)

	var cloned sessionMutationResponse
	decodeResponseJSON(t, cloneResponse, &cloned)
	if cloned.SessionKey == "" || cloned.FriendlyID == "" {
		t.Fatal("cloned session identifiers = empty")
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 2 {
		t.Fatalf("sessions count after clone = %d, want 2", len(sessionsPayload.Sessions))
	}

	var clonedSummary *SessionSummary
	for index := range sessionsPayload.Sessions {
		session := &sessionsPayload.Sessions[index]
		if session.FriendlyID == cloned.FriendlyID {
			clonedSummary = session
			break
		}
	}
	if clonedSummary == nil {
		t.Fatal("cloned session summary not found")
	}
	if cloned.Title != "Clone Source (forked)" {
		t.Fatalf("clone response title = %q, want forked source title", cloned.Title)
	}
	if clonedSummary.Title != "Clone Source (forked)" {
		t.Fatalf("clone list title = %q, want forked source title", clonedSummary.Title)
	}
	if clonedSummary.Label != "" {
		t.Fatalf("clone list label = %q, want empty", clonedSummary.Label)
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+cloned.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("cloned history count = %d, want 2", len(historyPayload.Messages))
	}
	if messageIDFromMap(historyPayload.Messages[0]) != messageIDs[0] {
		t.Fatalf("cloned first message id = %q, want %q", messageIDFromMap(historyPayload.Messages[0]), messageIDs[0])
	}
	if messageIDFromMap(historyPayload.Messages[1]) != messageIDs[1] {
		t.Fatalf("cloned second message id = %q, want %q", messageIDFromMap(historyPayload.Messages[1]), messageIDs[1])
	}
}

func TestDeleteUserMessageUpdatesThread(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "delete-turn@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Delete Source",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	messageIDs := seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		newUserTextMessage("First question"),
		newAssistantTextMessage("First answer"),
		newUserTextMessage("Second question"),
		newAssistantTextMessage("Second answer"),
	})

	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/sessions/"+created.FriendlyID+"/messages/"+messageIDs[2], nil, []*http.Cookie{cookie})
	assertStatusCode(t, deleteResponse, http.StatusOK)

	var deleted sessionMutationResponse
	decodeResponseJSON(t, deleteResponse, &deleted)
	if deleted.FriendlyID != created.FriendlyID {
		t.Fatalf("delete friendlyId = %q, want original %q", deleted.FriendlyID, created.FriendlyID)
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)
	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count after delete = %d, want 1", len(sessionsPayload.Sessions))
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("deleted history count = %d, want 2", len(historyPayload.Messages))
	}
	if messageIDFromMap(historyPayload.Messages[1]) != messageIDs[1] {
		t.Fatalf("deleted last message id = %q, want %q", messageIDFromMap(historyPayload.Messages[1]), messageIDs[1])
	}
}

func TestSendMessageReplacesTrailingUserMessage(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output: "Second answer",
	}
	cookie := signupAndRequireCookie(t, testServer, "dedupe-user-turn@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Dedupe Source",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		newUserTextMessage("First draft"),
	})

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Second draft",
		Model:   "test-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	waitForAssistantMessage(t, testServer, cookie, created.FriendlyID)

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("history message count after dedupe = %d, want 2", len(historyPayload.Messages))
	}
	if historyPayload.Messages[0]["role"] != "user" {
		t.Fatalf("first message role = %v, want user", historyPayload.Messages[0]["role"])
	}
	if text := textContentFromMessage(historyPayload.Messages[0]); text != "Second draft" {
		t.Fatalf("first user message text = %q, want second draft", text)
	}
}

func TestEditUserMessageUpdatesThreadAndRuns(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Test Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output: "Edited answer.",
	}
	cookie := signupAndRequireCookie(t, testServer, "edit-turn@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Edit Source",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	messageIDs := seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		newUserTextMessageWithAttachment("Original question", "image/png", "Zm9v"),
		newAssistantTextMessage("Original answer"),
	})

	editResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages/"+messageIDs[0]+"/edit", sendMessageRequest{
		Message: "Edited question",
		Model:   "test-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, editResponse, http.StatusOK)

	var editPayload struct {
		SessionKey string `json:"sessionKey"`
		FriendlyID string `json:"friendlyId"`
		RunID      string `json:"runId"`
	}
	decodeResponseJSON(t, editResponse, &editPayload)
	if editPayload.RunID == "" {
		t.Fatal("edit runId = empty, want populated value")
	}
	if editPayload.FriendlyID != created.FriendlyID {
		t.Fatalf("edit friendlyId = %q, want original %q", editPayload.FriendlyID, created.FriendlyID)
	}

	waitForRunStatus(t, testServer, editPayload.RunID, "completed")

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)
	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count after edit = %d, want 1", len(sessionsPayload.Sessions))
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("edited history count = %d, want 2", len(historyPayload.Messages))
	}
	if textContentFromMessage(historyPayload.Messages[0]) != "Edited question" {
		t.Fatalf("edited user message text = %q, want %q", textContentFromMessage(historyPayload.Messages[0]), "Edited question")
	}
	attachments := extractAttachmentPayloads(historyPayload.Messages[0])
	if len(attachments) != 1 || attachments[0].MimeType != "image/png" || attachments[0].Content != "Zm9v" {
		t.Fatalf("edited message attachments = %#v, want preserved image attachment", attachments)
	}
	if textContentFromMessage(historyPayload.Messages[1]) != "Edited answer." {
		t.Fatalf("edited assistant text = %q, want %q", textContentFromMessage(historyPayload.Messages[1]), "Edited answer.")
	}
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
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Test Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output:           "This reply came from the provider runtime.",
		promptTokens:     96,
		completionTokens: 24,
		totalTokens:      120,
	}
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
		Model:   "test-model",
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
		finalMessage := events[len(events)-1].Message
		details, ok := finalMessage["details"].(map[string]any)
		if !ok {
			t.Fatalf("final event details = %T, want map[string]any", finalMessage["details"])
		}
		usage, ok := details["usage"].(map[string]any)
		if !ok {
			t.Fatalf("final event usage = %T, want map[string]any", details["usage"])
		}
		if usage["totalTokens"] != int64(120) {
			t.Fatalf("final event usage totalTokens = %v, want 120", usage["totalTokens"])
		}
		if finalMessage["modelName"] != "Test Model" {
			t.Fatalf("final event modelName = %v, want Test Model", finalMessage["modelName"])
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
	userMessage := findHistoryMessageByRole(historyPayload.Messages, "user")
	if userMessage == nil {
		t.Fatal("user message missing from history")
	}
	assistantMessage := findHistoryMessageByRole(historyPayload.Messages, "assistant")
	if assistantMessage == nil {
		t.Fatal("assistant message missing from history")
	}
	assistantContent, ok := assistantMessage["content"].([]any)
	if !ok {
		t.Fatalf("assistant content = %T, want []any", assistantMessage["content"])
	}
	if len(assistantContent) != 1 {
		t.Fatalf("assistant content length = %d, want 1 text part", len(assistantContent))
	}
	assistantPart, ok := assistantContent[0].(map[string]any)
	if !ok {
		t.Fatalf("assistant content part = %T, want map[string]any", assistantContent[0])
	}
	if assistantPart["type"] != "text" {
		t.Fatalf("assistant content part type = %v, want text", assistantPart["type"])
	}
	if assistantMessage["model"] != "test-model" {
		t.Fatalf("assistant model = %v, want test-model", assistantMessage["model"])
	}
	if assistantMessage["modelName"] != "Test Model" {
		t.Fatalf("assistant modelName = %v, want Test Model", assistantMessage["modelName"])
	}
	if assistantMessage["modelDescription"] != "Fake test provider" {
		t.Fatalf("assistant modelDescription = %v, want Fake test provider", assistantMessage["modelDescription"])
	}

	details, ok := assistantMessage["details"].(map[string]any)
	if !ok {
		t.Fatalf("assistant details = %T, want map[string]any", assistantMessage["details"])
	}
	usage, ok := details["usage"].(map[string]any)
	if !ok {
		t.Fatalf("assistant usage = %T, want map[string]any", details["usage"])
	}
	if usage["promptTokens"] != float64(96) {
		t.Fatalf("assistant promptTokens = %v, want 96", usage["promptTokens"])
	}
	if usage["completionTokens"] != float64(24) {
		t.Fatalf("assistant completionTokens = %v, want 24", usage["completionTokens"])
	}
	if usage["totalTokens"] != float64(120) {
		t.Fatalf("assistant totalTokens = %v, want 120", usage["totalTokens"])
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count after send = %d, want 1", len(sessionsPayload.Sessions))
	}
	if sessionsPayload.Sessions[0].TotalTokens != 120 {
		t.Fatalf("session totalTokens = %d, want 120", sessionsPayload.Sessions[0].TotalTokens)
	}
}

func TestSendMessageIdempotencyKeyReusesExistingRun(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output: "Only one reply.",
	}
	cookie := signupAndRequireCookie(t, testServer, "idempotent@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	payload := sendMessageRequest{
		Message:        "Send this once",
		Model:          "test-model",
		IdempotencyKey: "same-send",
	}
	firstResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", payload, []*http.Cookie{cookie})
	assertStatusCode(t, firstResponse, http.StatusOK)

	var firstResult SendMessageResult
	decodeResponseJSON(t, firstResponse, &firstResult)

	secondResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", payload, []*http.Cookie{cookie})
	assertStatusCode(t, secondResponse, http.StatusOK)

	var secondResult SendMessageResult
	decodeResponseJSON(t, secondResponse, &secondResult)
	if secondResult.RunID != firstResult.RunID {
		t.Fatalf("second run id = %q, want %q", secondResult.RunID, firstResult.RunID)
	}

	waitForAssistantMessage(t, testServer, cookie, created.FriendlyID)

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("history message count after idempotent retry = %d, want 2", len(historyPayload.Messages))
	}
}

func TestSendMessageIncludesProviderThinkingWhenAvailable(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		thinking: "Provider summary of its reasoning.",
		output:   "This reply includes reasoning.",
	}
	cookie := signupAndRequireCookie(t, testServer, "thinking@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Thinking",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Explain the new slice",
		Model:   "test-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	waitForAssistantThinking(t, testServer, cookie, created.FriendlyID)

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	assistantMessage := findHistoryMessageByRole(historyPayload.Messages, "assistant")
	if assistantMessage == nil {
		t.Fatal("assistant message missing from history")
	}
	assistantContent, ok := assistantMessage["content"].([]any)
	if !ok {
		t.Fatalf("assistant content = %T, want []any", assistantMessage["content"])
	}
	if len(assistantContent) != 2 {
		t.Fatalf("assistant content length = %d, want thinking + text", len(assistantContent))
	}
	firstPart, ok := assistantContent[0].(map[string]any)
	if !ok {
		t.Fatalf("assistant first part = %T, want map[string]any", assistantContent[0])
	}
	if firstPart["type"] != "thinking" {
		t.Fatalf("assistant first part type = %v, want thinking", firstPart["type"])
	}
	if firstPart["thinking"] != "Provider summary of its reasoning." {
		t.Fatalf("assistant thinking = %v, want provider reasoning", firstPart["thinking"])
	}
}

func TestSendMessagePassesModelSettingsToProvider(t *testing.T) {
	var capturedRequest ChatGenerationRequest

	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output:      "Configured output.",
		requestSink: &capturedRequest,
	}
	cookie := signupAndRequireCookie(t, testServer, "settings@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Settings",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message:      "Use the configured settings",
		Model:        "test-model",
		SystemPrompt: "You are terse and precise.",
		WebSearch:    true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	waitForAssistantMessage(t, testServer, cookie, created.FriendlyID)

	if capturedRequest.Model != "test-model" {
		t.Fatalf("request model = %q, want test-model", capturedRequest.Model)
	}
	if !strings.HasPrefix(capturedRequest.SystemPrompt, "You are terse and precise.\n\nRuntime context:\n- Current time: ") {
		t.Fatalf("request system prompt = %q, want configured system prompt with runtime context", capturedRequest.SystemPrompt)
	}
	if capturedRequest.WebSearch == nil {
		t.Fatalf("request web search = nil, want enabled")
	}
	if len(capturedRequest.Messages) < 2 {
		t.Fatalf("request messages length = %d, want system + user", len(capturedRequest.Messages))
	}
	if capturedRequest.Messages[0].Role != "system" {
		t.Fatalf("first request message role = %q, want system", capturedRequest.Messages[0].Role)
	}
	if capturedRequest.Messages[0].Parts[0].Text != capturedRequest.SystemPrompt {
		t.Fatalf("first request message text = %q, want effective system prompt", capturedRequest.Messages[0].Parts[0].Text)
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

func waitForRunStatus(t *testing.T, testServer *testApp, runID string, expectedStatus string) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var status string
		err := testServer.app.db.QueryRow(`
			SELECT status
			FROM chat_runs
			WHERE id = ?
		`, runID).Scan(&status)
		if err == nil && status == expectedStatus {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for run %s status %q", runID, expectedStatus)
}

type fakeProviderDriver struct {
	models           []ProviderModel
	thinking         string
	output           string
	titleOutput      string
	outputsByModel   map[string]string
	requestSink      *ChatGenerationRequest
	delay            time.Duration
	titleDelay       time.Duration
	promptTokens     int64
	completionTokens int64
	totalTokens      int64
}

func (driver fakeProviderDriver) Kind() string {
	return openRouterProviderKind
}

func (driver fakeProviderDriver) ListModels(
	_ context.Context,
	_ resolvedProvider,
) ([]ProviderModel, error) {
	return append([]ProviderModel(nil), driver.models...), nil
}

func isFakeTitleGenerationRequest(request ChatGenerationRequest) bool {
	if len(request.Messages) == 0 || strings.TrimSpace(request.Messages[0].Role) != "system" {
		return false
	}
	if len(request.Messages[0].Parts) == 0 {
		return false
	}
	return strings.Contains(
		request.Messages[0].Parts[0].Text,
		"conversation title generator",
	)
}

func (driver fakeProviderDriver) GenerateChatStream(
	ctx context.Context,
	_ resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	isTitleRequest := isFakeTitleGenerationRequest(request)
	output := driver.output
	if isTitleRequest && driver.titleOutput != "" {
		output = driver.titleOutput
	} else if modelOutput, ok := driver.outputsByModel[strings.TrimSpace(request.Model)]; ok {
		output = modelOutput
	}

	if driver.thinking != "" && !isTitleRequest {
		if err := onDelta(ChatGenerationDelta{Thinking: driver.thinking}); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if driver.requestSink != nil {
		*driver.requestSink = request
	}
	outputParts := splitFakeProviderOutput(output)
	for _, part := range outputParts {
		if err := onDelta(ChatGenerationDelta{Text: part}); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	delay := driver.delay
	if isTitleRequest && driver.titleDelay > 0 {
		delay = driver.titleDelay
	}
	if delay > 0 {
		select {
		case <-ctx.Done():
			return ChatGenerationResult{}, ctx.Err()
		case <-time.After(delay):
		}
	}
	return ChatGenerationResult{
		Model:            request.Model,
		ModelDescription: "Fake test provider",
		ThinkingText:     driver.thinking,
		OutputText:       output,
		PromptTokens:     driver.promptTokens,
		CompletionTokens: driver.completionTokens,
		TotalTokens:      driver.totalTokens,
	}, nil
}

type gatedCancellationDriver struct {
	models        []ProviderModel
	firstDelta    chan struct{}
	firstCanceled chan struct{}
	releaseFirst  <-chan struct{}
	secondStarted chan struct{}
	mu            sync.Mutex
	calls         int
}

func (driver *gatedCancellationDriver) Kind() string {
	return openRouterProviderKind
}

func (driver *gatedCancellationDriver) ListModels(
	_ context.Context,
	_ resolvedProvider,
) ([]ProviderModel, error) {
	return append([]ProviderModel(nil), driver.models...), nil
}

func (driver *gatedCancellationDriver) GenerateChatStream(
	ctx context.Context,
	_ resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	driver.mu.Lock()
	driver.calls++
	call := driver.calls
	driver.mu.Unlock()

	if call == 1 {
		if err := onDelta(ChatGenerationDelta{Text: "Partial A"}); err != nil {
			return ChatGenerationResult{}, err
		}
		close(driver.firstDelta)
		<-ctx.Done()
		close(driver.firstCanceled)
		<-driver.releaseFirst
		return ChatGenerationResult{}, ctx.Err()
	}

	close(driver.secondStarted)
	if err := onDelta(ChatGenerationDelta{Text: "Reply B"}); err != nil {
		return ChatGenerationResult{}, err
	}
	return ChatGenerationResult{
		Model:            request.Model,
		ModelDescription: "Gated test provider",
		OutputText:       "Reply B",
	}, nil
}

func splitFakeProviderOutput(output string) []string {
	if len(output) <= 12 {
		if output == "" {
			return nil
		}
		return []string{output}
	}
	return []string{output[:12], output[12:]}
}

func TestSendMessageAutoGeneratesSessionTitleFromFirstTurn(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"chat-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "chat-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Chat Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output:      "Assistant answer from the main model.",
		titleOutput: "### Weekly roadmap review",
	}
	cookie := signupAndRequireCookie(t, testServer, "auto-title@example.com")

	preferencesResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/preferences",
		UpdateUserPreferencesInput{
			AutoGenerateTitle: boolPointer(true),
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, preferencesResponse, http.StatusOK)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Let's prepare the weekly roadmap review agenda",
		Model:   "chat-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	var sendPayload SendMessageResult
	decodeResponseJSON(t, sendResponse, &sendPayload)
	waitForRunStatus(t, testServer, sendPayload.RunID, "completed")
	waitForSessionTitle(t, testServer, created.SessionKey, "Weekly roadmap review")
}

func TestSendMessageDoesNotExposeDerivedTitleBeforeGeneratedTitleArrives(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"chat-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "chat-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Chat Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output:      "Assistant answer from the main model.",
		titleOutput: "Weekly roadmap review",
		titleDelay:  500 * time.Millisecond,
	}
	cookie := signupAndRequireCookie(t, testServer, "delayed-title@example.com")

	preferencesResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/preferences",
		UpdateUserPreferencesInput{
			AutoGenerateTitle: boolPointer(true),
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, preferencesResponse, http.StatusOK)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Let's prepare the weekly roadmap review agenda",
		Model:   "chat-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 1 {
		t.Fatalf("sessions count = %d, want 1", len(sessionsPayload.Sessions))
	}
	if sessionsPayload.Sessions[0].Title != "" {
		t.Fatalf("session title = %q, want empty before generation completes", sessionsPayload.Sessions[0].Title)
	}
	if sessionsPayload.Sessions[0].DerivedTitle != "" {
		t.Fatalf("session derivedTitle = %q, want empty before generation completes", sessionsPayload.Sessions[0].DerivedTitle)
	}

	waitForSessionTitle(t, testServer, created.SessionKey, "Weekly roadmap review")
}

func TestSendMessagePublishesTitleEvent(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"chat-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "chat-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Chat Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output:      "Assistant answer from the main model.",
		titleOutput: "Weekly roadmap review",
	}
	cookie := signupAndRequireCookie(t, testServer, "title-event@example.com")

	preferencesResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/preferences",
		UpdateUserPreferencesInput{
			AutoGenerateTitle: boolPointer(true),
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, preferencesResponse, http.StatusOK)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	userID := userIDFromCookie(t, testServer, cookie)

	titleEventResult := make(chan ChatEvent, 1)
	streamContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		err := testServer.app.runs.StreamSession(streamContext, userID, created.FriendlyID, func(event ChatEvent) error {
			if event.State == "title" {
				titleEventResult <- event
				cancel()
			}
			return nil
		})
		if err != nil && streamContext.Err() == nil {
			t.Errorf("stream session error = %v", err)
		}
	}()

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Let's prepare the weekly roadmap review agenda",
		Model:   "chat-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	select {
	case event := <-titleEventResult:
		if event.State != "title" {
			t.Fatalf("title event state = %q, want title", event.State)
		}
		if event.Session == nil {
			t.Fatal("title event session = nil, want populated summary")
		}
		if event.Session.Title != "Weekly roadmap review" {
			t.Fatalf(
				"title event session title = %q, want %q",
				event.Session.Title,
				"Weekly roadmap review",
			)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for title event")
	}
}

func TestSendMessageUsesSeparateTitleModelWhenConfigured(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"chat-model", "title-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "chat-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Chat Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
			{
				ID:            "title-model",
				Object:        "model",
				OwnedBy:       "test",
				Name:          "Title Model",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		outputsByModel: map[string]string{
			"chat-model":  "Assistant answer from chat model.",
			"title-model": "Priority bugs triage",
		},
	}
	cookie := signupAndRequireCookie(t, testServer, "separate-title-model@example.com")

	preferencesResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/preferences",
		UpdateUserPreferencesInput{
			AutoGenerateTitle:      boolPointer(true),
			UseSeparateTitleModel:  boolPointer(true),
			TitleGenerationModelID: stringPointer("title-model"),
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, preferencesResponse, http.StatusOK)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "We need to triage the current priority bugs",
		Model:   "chat-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	var sendPayload SendMessageResult
	decodeResponseJSON(t, sendResponse, &sendPayload)
	waitForRunStatus(t, testServer, sendPayload.RunID, "completed")
	waitForSessionTitle(t, testServer, created.SessionKey, "Priority bugs triage")

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	assistantMessage := findHistoryMessageByRole(historyPayload.Messages, "assistant")
	if assistantMessage == nil {
		t.Fatal("assistant message missing from history")
	}
	if textContentFromMessage(assistantMessage) != "Assistant answer from chat model." {
		t.Fatalf(
			"assistant message text = %q, want %q",
			textContentFromMessage(assistantMessage),
			"Assistant answer from chat model.",
		)
	}
}

func waitForSessionTitle(
	t *testing.T,
	testServer *testApp,
	sessionKey string,
	expectedTitle string,
) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var title sql.NullString
		err := testServer.app.db.QueryRow(`
			SELECT title
			FROM chat_sessions
			WHERE id = ?
		`, sessionKey).Scan(&title)
		if err == nil && strings.TrimSpace(title.String) == expectedTitle {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for session %s title %q", sessionKey, expectedTitle)
}

func TestStopSessionRunPublishesAbortedEventAndKeepsPartialAssistantHistory(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers[openRouterProviderKind] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output: "This reply should never finish.",
		delay:  500 * time.Millisecond,
	}
	cookie := signupAndRequireCookie(t, testServer, "stop@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Stop",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	userID := userIDFromCookie(t, testServer, cookie)

	eventResult := make(chan []ChatEvent, 1)
	deltaSeen := make(chan struct{}, 1)
	streamContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		events := make([]ChatEvent, 0, 2)
		err := testServer.app.runs.StreamSession(streamContext, userID, created.FriendlyID, func(event ChatEvent) error {
			events = append(events, event)
			if event.State == "delta" {
				select {
				case deltaSeen <- struct{}{}:
				default:
				}
			}
			if event.State == "aborted" {
				eventResult <- events
				cancel()
			}
			return nil
		})
		if err != nil && streamContext.Err() == nil {
			t.Errorf("stream session error = %v", err)
			eventResult <- nil
		}
	}()

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message: "Start then stop",
		Model:   "test-model",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)

	select {
	case <-deltaSeen:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for first streamed delta")
	}

	stopResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/stop", nil, []*http.Cookie{cookie})
	assertStatusCode(t, stopResponse, http.StatusOK)

	select {
	case events := <-eventResult:
		if len(events) == 0 {
			t.Fatal("stream events = empty, want aborted event")
		}
		if events[len(events)-1].State != "aborted" {
			t.Fatalf("final stream state = %q, want aborted", events[len(events)-1].State)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for aborted event")
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("history message count after stop = %d, want 2", len(historyPayload.Messages))
	}
	if role := historyPayload.Messages[0]["role"]; role != "user" {
		t.Fatalf("first history role after stop = %v, want user", role)
	}
	if role := historyPayload.Messages[1]["role"]; role != "assistant" {
		t.Fatalf("second history role after stop = %v, want assistant", role)
	}
	content, ok := historyPayload.Messages[1]["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("assistant content after stop = %T, want partial content", historyPayload.Messages[1]["content"])
	}
}

func TestStartingNextRunWaitsForStoppedRunToPersistPartialAssistantHistory(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	releaseFirst := make(chan struct{})
	driver := &gatedCancellationDriver{
		models: []ProviderModel{{
			ID:            "test-model",
			Object:        "model",
			OwnedBy:       "test",
			ProviderRef:   "system:system-default",
			ProviderLabel: "Server Default",
		}},
		firstDelta:    make(chan struct{}),
		firstCanceled: make(chan struct{}),
		releaseFirst:  releaseFirst,
		secondStarted: make(chan struct{}),
	}
	testServer.app.providers.drivers[openRouterProviderKind] = driver
	cookie := signupAndRequireCookie(t, testServer, "stop-next@example.com")
	userID := userIDFromCookie(t, testServer, cookie)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Stop then send",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	_, err := testServer.app.runs.StartRun(context.Background(), userID, SendMessageInput{
		FriendlyID: created.FriendlyID,
		Message:    "Prompt A",
		Model:      "test-model",
	})
	if err != nil {
		t.Fatalf("start first run: %v", err)
	}
	select {
	case <-driver.firstDelta:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for first run delta")
	}

	stopped, err := testServer.app.runs.CancelSessionRuns(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("stop first run: %v", err)
	}
	if !stopped {
		t.Fatal("stop first run = false, want true")
	}
	select {
	case <-driver.firstCanceled:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for first run cancellation")
	}

	type startResult struct {
		run SendMessageResult
		err error
	}
	startedSecond := make(chan struct{})
	secondResult := make(chan startResult, 1)
	go func() {
		close(startedSecond)
		run, startErr := testServer.app.runs.StartRun(context.Background(), userID, SendMessageInput{
			FriendlyID: created.FriendlyID,
			Message:    "Prompt B",
			Model:      "test-model",
		})
		secondResult <- startResult{run: run, err: startErr}
	}()
	<-startedSecond

	select {
	case <-driver.secondStarted:
		t.Fatal("second run started before the stopped run persisted its partial message")
	case <-time.After(100 * time.Millisecond):
	}

	close(releaseFirst)
	select {
	case <-driver.secondStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for second run to start")
	}
	var second startResult
	select {
	case second = <-secondResult:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out starting second run")
	}
	if second.err != nil {
		t.Fatalf("start second run: %v", second.err)
	}
	waitForRunStatus(t, testServer, second.run.RunID, "completed")

	history, err := testServer.app.chat.GetHistory(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("get history: %v", err)
	}
	if len(history.Messages) != 4 {
		t.Fatalf("history message count = %d, want 4", len(history.Messages))
	}
	for index, role := range []string{"user", "assistant", "user", "assistant"} {
		if actual := history.Messages[index]["role"]; actual != role {
			t.Fatalf("history message %d role = %v, want %q", index, actual, role)
		}
	}
}

func TestUserChatSettingsPreferencesPersistDefaultsAndModelOverrides(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "user-chat-settings@example.com")
	settings := defaultConversationSettings()
	settings.SystemPrompt = "Default instructions"
	settings.WebSearch = false

	updateDefaults := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/me/chat-settings", updateChatSettingsPreferencesRequest{
		DefaultSettings: &settings,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateDefaults, http.StatusOK)

	modelSettings := settings
	modelSettings.SystemPrompt = "Model instructions"
	modelSettings.MathTools = false
	updateModel := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/me/chat-settings", updateChatSettingsPreferencesRequest{
		ModelID:       "provider/model-a",
		ModelSettings: &modelSettings,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateModel, http.StatusOK)

	loadResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me/chat-settings", nil, []*http.Cookie{cookie})
	assertStatusCode(t, loadResponse, http.StatusOK)
	var payload chatSettingsPreferencesResponse
	decodeResponseJSON(t, loadResponse, &payload)
	if payload.Settings.DefaultSettings != settings {
		t.Fatalf("default settings = %#v, want %#v", payload.Settings.DefaultSettings, settings)
	}
	if payload.Settings.ModelOverrides["provider/model-a"] != modelSettings {
		t.Fatalf("model settings = %#v, want %#v", payload.Settings.ModelOverrides["provider/model-a"], modelSettings)
	}

	clearModel := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/me/chat-settings", updateChatSettingsPreferencesRequest{
		ModelID:             "provider/model-a",
		ClearModelOverrides: true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, clearModel, http.StatusOK)
}

func TestConversationSettingsPersistPerSession(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "conversation-settings@example.com")
	settings := ConversationSettings{
		Model:        "provider/model-a",
		SystemPrompt: "Be concise.",
		WebSearch:    false,
		MathTools:    true,
		Advanced: ConversationAdvancedSettings{
			Reasoning:       true,
			ReasoningEffort: "high",
			Sampling:        true,
			Temperature:     1.1,
			TopP:            0.8,
			MaxTokens:       true,
			MaxTokensValue:  8192,
		},
	}

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Settings: &settings,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	if created.Settings != settings {
		t.Fatalf("created settings = %#v, want %#v", created.Settings, settings)
	}

	settings.Model = "provider/model-b"
	settings.MathTools = false
	updateResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/sessions/"+created.FriendlyID+"/settings", updateConversationSettingsRequest{
		Settings: settings,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateResponse, http.StatusOK)

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)
	var listed sessionsResponse
	decodeResponseJSON(t, listResponse, &listed)
	if len(listed.Sessions) != 1 {
		t.Fatalf("sessions count = %d, want 1", len(listed.Sessions))
	}
	if listed.Sessions[0].Settings != settings {
		t.Fatalf("stored settings = %#v, want %#v", listed.Sessions[0].Settings, settings)
	}
}

func TestBuildAssistantContentPreservesAssistantPartOrder(t *testing.T) {
	content := buildAssistantContent(
		"thinking",
		"I will search for that.",
		[]ProviderToolCall{{ID: "call-1", Name: "web_search", Args: map[string]any{"query": "kairos"}}},
	)

	if len(content) != 3 {
		t.Fatalf("content length = %d, want 3", len(content))
	}
	if content[0].Type != "thinking" || content[0].Thinking != "thinking" {
		t.Fatalf("content[0] = %#v, want thinking", content[0])
	}
	if content[1].Type != "text" || content[1].Text != "I will search for that." {
		t.Fatalf("content[1] = %#v, want text before tool call", content[1])
	}
	if content[2].Type != "toolCall" || content[2].ID != "call-1" {
		t.Fatalf("content[2] = %#v, want tool call", content[2])
	}
}
