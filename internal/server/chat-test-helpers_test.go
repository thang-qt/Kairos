package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

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

func waitForAssistantMessage(
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
		if findHistoryMessageByRole(historyPayload.Messages, "assistant") != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for assistant message in history for %s", friendlyID)
}

func findHistoryMessageByRole(messages []map[string]any, role string) map[string]any {
	for _, message := range messages {
		if message["role"] == role {
			return message
		}
	}
	return nil
}
