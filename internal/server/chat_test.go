package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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

func TestForkSessionCreatesBackendBranch(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "fork@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{
		Label: "Fork Source",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	messageIDs := seedSessionMessages(t, testServer, created.SessionKey, []map[string]any{
		newUserTextMessage("Original question"),
		newAssistantTextMessage("Original answer"),
		newUserTextMessage("Second question"),
	})

	forkResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/fork", forkSessionRequest{
		MessageID: messageIDs[1],
	}, []*http.Cookie{cookie})
	assertStatusCode(t, forkResponse, http.StatusOK)

	var forked sessionMutationResponse
	decodeResponseJSON(t, forkResponse, &forked)
	if forked.SessionKey == "" || forked.FriendlyID == "" {
		t.Fatal("forked session identifiers = empty")
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var sessionsPayload sessionsResponse
	decodeResponseJSON(t, listResponse, &sessionsPayload)
	if len(sessionsPayload.Sessions) != 2 {
		t.Fatalf("sessions count after fork = %d, want 2", len(sessionsPayload.Sessions))
	}

	var forkedSummary *SessionSummary
	for index := range sessionsPayload.Sessions {
		session := &sessionsPayload.Sessions[index]
		if session.FriendlyID == forked.FriendlyID {
			forkedSummary = session
			break
		}
	}
	if forkedSummary == nil {
		t.Fatal("forked session summary not found")
	}
	if forkedSummary.ParentSessionKey != created.SessionKey {
		t.Fatalf("fork parent key = %q, want %q", forkedSummary.ParentSessionKey, created.SessionKey)
	}
	if forkedSummary.ParentFriendlyID != created.FriendlyID {
		t.Fatalf("fork parent friendlyId = %q, want %q", forkedSummary.ParentFriendlyID, created.FriendlyID)
	}
	if forkedSummary.ForkPointMessageID != messageIDs[1] {
		t.Fatalf("fork point message id = %q, want %q", forkedSummary.ForkPointMessageID, messageIDs[1])
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+forked.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("forked history count = %d, want 2", len(historyPayload.Messages))
	}
	if messageIDFromMap(historyPayload.Messages[0]) != messageIDs[0] {
		t.Fatalf("forked first message id = %q, want %q", messageIDFromMap(historyPayload.Messages[0]), messageIDs[0])
	}
	if messageIDFromMap(historyPayload.Messages[1]) != messageIDs[1] {
		t.Fatalf("forked second message id = %q, want %q", messageIDFromMap(historyPayload.Messages[1]), messageIDs[1])
	}
}

func TestDeleteUserMessageCreatesBackendBranch(t *testing.T) {
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

	var forked sessionMutationResponse
	decodeResponseJSON(t, deleteResponse, &forked)

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+forked.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("deleted-branch history count = %d, want 2", len(historyPayload.Messages))
	}
	if messageIDFromMap(historyPayload.Messages[1]) != messageIDs[1] {
		t.Fatalf("deleted-branch last message id = %q, want %q", messageIDFromMap(historyPayload.Messages[1]), messageIDs[1])
	}
}

func TestEditUserMessageCreatesBackendBranchAndRuns(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers["openai_compatible"] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
		output: "Edited branch answer.",
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

	waitForRunStatus(t, testServer, editPayload.RunID, "completed")

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+editPayload.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)

	var historyPayload HistoryPayload
	decodeResponseJSON(t, historyResponse, &historyPayload)
	if len(historyPayload.Messages) != 2 {
		t.Fatalf("edited-branch history count = %d, want 2", len(historyPayload.Messages))
	}
	if textContentFromMessage(historyPayload.Messages[0]) != "Edited question" {
		t.Fatalf("edited user message text = %q, want %q", textContentFromMessage(historyPayload.Messages[0]), "Edited question")
	}
	attachments := extractAttachmentPayloads(historyPayload.Messages[0])
	if len(attachments) != 1 || attachments[0].MimeType != "image/png" || attachments[0].Content != "Zm9v" {
		t.Fatalf("edited message attachments = %#v, want preserved image attachment", attachments)
	}
	if textContentFromMessage(historyPayload.Messages[1]) != "Edited branch answer." {
		t.Fatalf("edited branch assistant text = %q, want %q", textContentFromMessage(historyPayload.Messages[1]), "Edited branch answer.")
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

func seedSessionMessages(t *testing.T, testServer *testApp, sessionKey string, messages []map[string]any) []string {
	t.Helper()

	messageIDs := make([]string, 0, len(messages))
	var lastMessageJSON string
	var lastTimestamp int64
	var totalTokens int64
	derivedTitle := ""

	for index, message := range messages {
		messageJSON, err := json.Marshal(message)
		if err != nil {
			t.Fatalf("marshal message %d: %v", index, err)
		}
		contentJSON, err := encodeMessageContent(message["content"])
		if err != nil {
			t.Fatalf("encode message content %d: %v", index, err)
		}
		timestamp := int64(1710000000000 + index)
		message["timestamp"] = timestamp
		messageJSON, err = json.Marshal(message)
		if err != nil {
			t.Fatalf("marshal timestamped message %d: %v", index, err)
		}
		if _, err := testServer.app.db.Exec(`
			INSERT INTO chat_messages(
				id,
				session_id,
				role,
				content_json,
				timestamp,
				message_json,
				created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, newID(), sessionKey, stringValueFromMap(message, "role"), contentJSON, timestamp, string(messageJSON), time.Now().UnixMilli()+int64(index)); err != nil {
			t.Fatalf("insert message %d error = %v", index, err)
		}

		messageID := messageIDFromMap(message)
		messageIDs = append(messageIDs, messageID)
		lastMessageJSON = string(messageJSON)
		lastTimestamp = timestamp
		totalTokens += approximateMessageTokens(message)
		if derivedTitle == "" {
			derivedTitle = deriveTitleFromMessage(message)
		}
	}

	if _, err := testServer.app.db.Exec(`
		UPDATE chat_sessions
		SET
			last_message_json = ?,
			updated_at = ?,
			derived_title = ?,
			total_tokens = ?
		WHERE id = ?
	`, lastMessageJSON, lastTimestamp, nullableString(derivedTitle), totalTokens, sessionKey); err != nil {
		t.Fatalf("update seeded session metadata error = %v", err)
	}

	return messageIDs
}

func newUserTextMessage(text string) map[string]any {
	return map[string]any{
		"id":   newID(),
		"role": "user",
		"content": []map[string]any{
			{
				"type": "text",
				"text": text,
			},
		},
	}
}

func newUserTextMessageWithAttachment(text string, mimeType string, data string) map[string]any {
	return map[string]any{
		"id":   newID(),
		"role": "user",
		"content": []map[string]any{
			{
				"type": "image",
				"source": map[string]any{
					"type":       "base64",
					"media_type": mimeType,
					"data":       data,
				},
			},
			{
				"type": "text",
				"text": text,
			},
		},
	}
}

func newAssistantTextMessage(text string) map[string]any {
	return map[string]any{
		"id":   newID(),
		"role": "assistant",
		"content": []map[string]any{
			{
				"type": "text",
				"text": text,
			},
		},
	}
}

func textContentFromMessage(message map[string]any) string {
	content, ok := message["content"].([]any)
	if !ok {
		return ""
	}
	var textParts []string
	for _, item := range content {
		part, ok := item.(map[string]any)
		if !ok || stringValueFromMap(part, "type") != "text" {
			continue
		}
		text := stringValueFromMap(part, "text")
		if text != "" {
			textParts = append(textParts, text)
		}
	}
	return strings.Join(textParts, "")
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
	testServer.app.providers.drivers["openai_compatible"] = fakeProviderDriver{
		models: []ProviderModel{
			{
				ID:            "test-model",
				Object:        "model",
				OwnedBy:       "test",
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

func TestSendMessageIncludesProviderThinkingWhenAvailable(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers["openai_compatible"] = fakeProviderDriver{
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
	delay            time.Duration
	promptTokens     int64
	completionTokens int64
	totalTokens      int64
}

func (driver fakeProviderDriver) Kind() string {
	return "openai_compatible"
}

func (driver fakeProviderDriver) ListModels(
	_ context.Context,
	_ resolvedProvider,
) ([]ProviderModel, error) {
	return append([]ProviderModel(nil), driver.models...), nil
}

func (driver fakeProviderDriver) GenerateChatStream(
	ctx context.Context,
	_ resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	if driver.thinking != "" {
		if err := onDelta(ChatGenerationDelta{Thinking: driver.thinking}); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := onDelta(ChatGenerationDelta{Text: driver.output[:12]}); err != nil {
		return ChatGenerationResult{}, err
	}
	if driver.delay > 0 {
		select {
		case <-ctx.Done():
			return ChatGenerationResult{}, ctx.Err()
		case <-time.After(driver.delay):
		}
	}
	if err := onDelta(ChatGenerationDelta{Text: driver.output[12:]}); err != nil {
		return ChatGenerationResult{}, err
	}
	return ChatGenerationResult{
		Model:            request.Model,
		ModelName:        request.Model,
		ModelDescription: "Fake test provider",
		ThinkingText:     driver.thinking,
		OutputText:       driver.output,
		PromptTokens:     driver.promptTokens,
		CompletionTokens: driver.completionTokens,
		TotalTokens:      driver.totalTokens,
	}, nil
}

func TestStopSessionRunPublishesAbortedEventAndKeepsPartialAssistantHistory(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	testServer.app.providers.drivers["openai_compatible"] = fakeProviderDriver{
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

func waitForAssistantThinking(
	t *testing.T,
	testServer *testApp,
	cookie *http.Cookie,
	friendlyID string,
) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+friendlyID+"/history", nil, []*http.Cookie{cookie})
		assertStatusCode(t, historyResponse, http.StatusOK)

		var historyPayload HistoryPayload
		decodeResponseJSON(t, historyResponse, &historyPayload)
		assistantMessage := findHistoryMessageByRole(historyPayload.Messages, "assistant")
		if assistantMessage == nil {
			time.Sleep(20 * time.Millisecond)
			continue
		}
		content, ok := assistantMessage["content"].([]any)
		if !ok {
			time.Sleep(20 * time.Millisecond)
			continue
		}
		for _, item := range content {
			part, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if part["type"] == "thinking" {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for assistant thinking in history for %s", friendlyID)
}

func findHistoryMessageByRole(messages []map[string]any, role string) map[string]any {
	for _, message := range messages {
		if message["role"] == role {
			return message
		}
	}
	return nil
}
