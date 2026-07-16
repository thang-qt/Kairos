package server

import (
	"context"
	"net/http"
	"testing"
)

type scriptedToolLoopDriver struct {
	requests []ChatGenerationRequest
}

func (driver *scriptedToolLoopDriver) Kind() string { return openRouterProviderKind }

func (driver *scriptedToolLoopDriver) ListModels(_ context.Context, _ resolvedProvider) ([]ProviderModel, error) {
	return []ProviderModel{{ID: "test-model", Object: "model", OwnedBy: "test"}}, nil
}

func (driver *scriptedToolLoopDriver) GenerateChatStream(
	_ context.Context,
	_ resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	driver.requests = append(driver.requests, request)
	if len(driver.requests) == 1 {
		call := ProviderToolCall{ID: "call-1", Name: "missing_tool", ArgsJSON: `{"value":1}`, Args: map[string]any{"value": 1}}
		if err := onDelta(ChatGenerationDelta{Text: "I will check that.", ToolCalls: []ProviderToolCall{call}}); err != nil {
			return ChatGenerationResult{}, err
		}
		return ChatGenerationResult{Model: "test-model", OutputText: "I will check that.", ToolCalls: []ProviderToolCall{call}}, nil
	}
	if err := onDelta(ChatGenerationDelta{Text: "The tool failed, so I cannot complete that check."}); err != nil {
		return ChatGenerationResult{}, err
	}
	return ChatGenerationResult{Model: "test-model", OutputText: "The tool failed, so I cannot complete that check.", TotalTokens: 12}, nil
}

func TestToolLoopPersistsConventionalAssistantToolResultTurns(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	driver := &scriptedToolLoopDriver{}
	testServer.app.providers.drivers[openRouterProviderKind] = driver
	cookie := signupAndRequireCookie(t, testServer, "tool-loop@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message:   "Check this with a tool",
		Model:     "test-model",
		MathTools: true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)
	var sent SendMessageResult
	decodeResponseJSON(t, sendResponse, &sent)
	waitForRunStatus(t, testServer, sent.RunID, "completed")

	if len(driver.requests) != 2 {
		t.Fatalf("provider requests = %d, want 2", len(driver.requests))
	}
	secondRequest := driver.requests[1]
	if len(secondRequest.Messages) != 4 || secondRequest.Messages[2].Role != "assistant" || secondRequest.Messages[3].Role != "tool" {
		t.Fatalf("second provider messages = %#v, want system, user, assistant, tool", secondRequest.Messages)
	}
	if secondRequest.Messages[3].ToolCallID != "call-1" {
		t.Fatalf("tool result call ID = %q, want call-1", secondRequest.Messages[3].ToolCallID)
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)
	var history HistoryPayload
	decodeResponseJSON(t, historyResponse, &history)
	if len(history.Messages) != 4 {
		t.Fatalf("history messages = %d, want user, assistant, tool result, assistant", len(history.Messages))
	}
	if history.Messages[1]["role"] != "assistant" || history.Messages[2]["role"] != "toolResult" || history.Messages[3]["role"] != "assistant" {
		t.Fatalf("history roles = %#v, want conventional tool loop", []any{history.Messages[1]["role"], history.Messages[2]["role"], history.Messages[3]["role"]})
	}
	firstAssistantContent, ok := history.Messages[1]["content"].([]any)
	if !ok || len(firstAssistantContent) != 2 || firstAssistantContent[0].(map[string]any)["type"] != "text" || firstAssistantContent[1].(map[string]any)["type"] != "toolCall" {
		t.Fatalf("first assistant content = %#v, want text before tool call", history.Messages[1]["content"])
	}
	if history.Messages[2]["toolCallId"] != "call-1" || history.Messages[2]["toolName"] != "missing_tool" || history.Messages[2]["isError"] != true {
		t.Fatalf("tool result = %#v, want linked failed tool result", history.Messages[2])
	}
}
