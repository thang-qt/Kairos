package server

import (
	"context"
	"net/http"
	"testing"
	"time"
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
	if got := secondRequest.Messages[3].Parts[0].Text; got != "unknown tool: missing_tool" {
		t.Fatalf("tool result provider text = %q, want canonical raw error", got)
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
	if history.Messages[1]["runId"] != sent.RunID || history.Messages[1]["roundIndex"] != float64(0) || history.Messages[1]["messageIndex"] != float64(0) {
		t.Fatalf("assistant lineage = %#v, want run/round/message metadata", history.Messages[1])
	}
	if history.Messages[2]["toolCallId"] != "call-1" || history.Messages[2]["toolName"] != "missing_tool" || history.Messages[2]["isError"] != true {
		t.Fatalf("tool result = %#v, want linked failed tool result", history.Messages[2])
	}
	if history.Messages[2]["runId"] != sent.RunID || history.Messages[2]["roundIndex"] != float64(0) || history.Messages[2]["messageIndex"] != float64(1) {
		t.Fatalf("tool result lineage = %#v, want run/round/message metadata", history.Messages[2])
	}
}

func TestEphemeralToolLoopSharesOneRunLineage(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	driver := &scriptedToolLoopDriver{}
	testServer.app.providers.drivers[openRouterProviderKind] = driver
	cookie := signupAndRequireCookie(t, testServer, "ephemeral-tool-loop@example.com")

	response := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPost,
		"/api/ephemeral/messages",
		ephemeralMessageRequest{
			Message:   "Check this without saving",
			Model:     "test-model",
			MathTools: true,
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, response, http.StatusOK)

	events := decodeSSEChatEvents(t, response)
	if len(events) < 5 {
		t.Fatalf("ephemeral tool events = %d, want streamed tool loop", len(events))
	}
	runID := events[0].RunID
	if runID == "" {
		t.Fatal("ephemeral runId = empty, want shared lineage")
	}
	foundToolResult := false
	for index, event := range events {
		if event.RunID != runID {
			t.Fatalf("ephemeral event %d runId = %q, want %q", index, event.RunID, runID)
		}
		if event.Message["role"] == "toolResult" {
			foundToolResult = true
		}
		if messageRunID := stringValueFromMap(event.Message, "runId"); len(event.Message) > 0 && messageRunID != runID {
			t.Fatalf("ephemeral message %d runId = %q, want %q", index, messageRunID, runID)
		}
	}
	if !foundToolResult {
		t.Fatal("ephemeral stream missing tool result event")
	}
	finalEvent := events[len(events)-1]
	if finalEvent.State != "final" || finalEvent.Message["role"] != "assistant" {
		t.Fatalf("ephemeral final event = %#v, want final assistant", finalEvent)
	}
}

type twoToolCallDriver struct {
	requests int
}

func (driver *twoToolCallDriver) Kind() string { return openRouterProviderKind }

func (driver *twoToolCallDriver) ListModels(_ context.Context, _ resolvedProvider) ([]ProviderModel, error) {
	return []ProviderModel{{ID: "test-model", Object: "model", OwnedBy: "test"}}, nil
}

func (driver *twoToolCallDriver) GenerateChatStream(
	_ context.Context,
	_ resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	driver.requests++
	calls := []ProviderToolCall{
		{ID: "call-1", Name: "missing_tool", Args: map[string]any{"value": 1}},
		{ID: "call-2", Name: "missing_tool", Args: map[string]any{"value": 2}},
	}
	if err := onDelta(ChatGenerationDelta{Text: "Need tools", ToolCalls: calls}); err != nil {
		return ChatGenerationResult{}, err
	}
	return ChatGenerationResult{Model: request.Model, OutputText: "Need tools", ToolCalls: calls}, nil
}

func TestFinalCompletionDoesNotPersistAfterAbortClaim(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	cookie := signupAndRequireCookie(t, testServer, "terminal-race@example.com")
	userID := userIDFromCookie(t, testServer, cookie)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	session, err := testServer.app.chat.findSessionByFriendlyID(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("find session: %v", err)
	}
	record := runRecord{
		ID:                 newID(),
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              "test-model",
		AssistantMessageID: newID(),
	}
	if err := testServer.app.runs.insertRun(context.Background(), record, SendMessageInput{FriendlyID: created.FriendlyID, Message: "race", Model: "test-model"}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	claimed, err := testServer.app.runs.claimRunAborted(context.Background(), record.ID)
	if err != nil {
		t.Fatalf("claim abort: %v", err)
	}
	if !claimed {
		t.Fatal("claim abort = false, want true")
	}

	finalMessage := buildAssistantMessageWithLineage(
		record.AssistantMessageID,
		assistantModelDisplay{ID: "test-model", Name: "Test Model", Description: "Test provider"},
		time.Now().UnixMilli(),
		buildAssistantContent("", "final answer", nil),
		record.ID,
		0,
	)
	_, completed, err := testServer.app.runs.completeRunWithFinalMessage(context.Background(), record, session, finalMessage, int64Value(finalMessage["timestamp"]), 0)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if completed {
		t.Fatal("complete after abort = true, want false")
	}
	status, err := testServer.app.runs.runStatus(context.Background(), record.ID)
	if err != nil {
		t.Fatalf("load status: %v", err)
	}
	if status != "aborted" {
		t.Fatalf("status = %q, want aborted", status)
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)
	var history HistoryPayload
	decodeResponseJSON(t, historyResponse, &history)
	if len(history.Messages) != 0 {
		t.Fatalf("history messages = %d, want no final assistant persisted", len(history.Messages))
	}
}

func TestStagedToolRoundDoesNotPersistAfterAbortClaim(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	cookie := signupAndRequireCookie(t, testServer, "staged-race@example.com")
	userID := userIDFromCookie(t, testServer, cookie)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	session, err := testServer.app.chat.findSessionByFriendlyID(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("find session: %v", err)
	}
	record := runRecord{
		ID:                 newID(),
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              "test-model",
		AssistantMessageID: newID(),
	}
	if err := testServer.app.runs.insertRun(context.Background(), record, SendMessageInput{FriendlyID: created.FriendlyID, Message: "race", Model: "test-model"}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	claimed, err := testServer.app.runs.claimRunAborted(context.Background(), record.ID)
	if err != nil {
		t.Fatalf("claim abort: %v", err)
	}
	if !claimed {
		t.Fatal("claim abort = false, want true")
	}

	call := ProviderToolCall{ID: "call-1", Name: "missing_tool", Args: map[string]any{"value": 1}}
	assistantMessage := buildAssistantMessageWithLineage(
		record.AssistantMessageID,
		assistantModelDisplay{ID: "test-model", Name: "Test Model", Description: "Test provider"},
		time.Now().UnixMilli(),
		buildAssistantContent("", "Need a tool", []ProviderToolCall{call}),
		record.ID,
		0,
	)
	toolMessage := buildToolResultMessageWithLineage(newID(), call, WebToolResult{Content: "result"}, nil, time.Now().UnixMilli()+1, 1, record.ID, 0, 1)
	_, committed, err := testServer.app.runs.appendStagedRunMessagesIfRunning(
		context.Background(),
		record,
		session,
		[]map[string]any{assistantMessage, toolMessage},
		appendMessageOptions{SkipDerivedTitle: true},
	)
	if err != nil {
		t.Fatalf("append staged round: %v", err)
	}
	if committed {
		t.Fatal("append staged round committed after abort, want false")
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)
	var history HistoryPayload
	decodeResponseJSON(t, historyResponse, &history)
	if len(history.Messages) != 0 {
		t.Fatalf("history messages = %d, want no staged assistant/tool messages", len(history.Messages))
	}
}

func TestCompleteRunWithFinalMessageStoresFinalTokensAtomically(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	cookie := signupAndRequireCookie(t, testServer, "final-tokens@example.com")
	userID := userIDFromCookie(t, testServer, cookie)

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	session, err := testServer.app.chat.findSessionByFriendlyID(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("find session: %v", err)
	}
	record := runRecord{
		ID:                 newID(),
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              "test-model",
		AssistantMessageID: newID(),
	}
	if err := testServer.app.runs.insertRun(context.Background(), record, SendMessageInput{FriendlyID: created.FriendlyID, Message: "final", Model: "test-model"}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	finalMessage := buildAssistantMessageWithLineage(
		record.AssistantMessageID,
		assistantModelDisplay{ID: "test-model", Name: "Test Model", Description: "Test provider"},
		time.Now().UnixMilli(),
		buildAssistantContent("", "final answer", nil),
		record.ID,
		0,
	)
	summary, completed, err := testServer.app.runs.completeRunWithFinalMessage(context.Background(), record, session, finalMessage, int64Value(finalMessage["timestamp"]), 42)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if !completed {
		t.Fatal("complete run = false, want true")
	}
	if summary.TotalTokens != 42 {
		t.Fatalf("summary total tokens = %d, want 42", summary.TotalTokens)
	}
	updatedSession, err := testServer.app.chat.findSessionByFriendlyID(context.Background(), userID, created.FriendlyID)
	if err != nil {
		t.Fatalf("reload session: %v", err)
	}
	if updatedSession.TotalTokens != 42 {
		t.Fatalf("persisted total tokens = %d, want 42", updatedSession.TotalTokens)
	}
}

func TestToolLoopEnforcesTotalToolCallLimitAndLinksRejectedCalls(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Test provider"
		config.SystemProviderStaticModels = []string{"test-model"}
		config.MaxToolCalls = 1
	})
	driver := &twoToolCallDriver{}
	testServer.app.providers.drivers[openRouterProviderKind] = driver
	cookie := signupAndRequireCookie(t, testServer, "tool-limit@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions", createSessionRequest{}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)
	var created sessionMutationResponse
	decodeResponseJSON(t, createResponse, &created)

	sendResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{
		Message:   "Use too many tools",
		Model:     "test-model",
		MathTools: true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, sendResponse, http.StatusOK)
	var sent SendMessageResult
	decodeResponseJSON(t, sendResponse, &sent)
	waitForRunStatus(t, testServer, sent.RunID, "error")

	if driver.requests != 1 {
		t.Fatalf("provider requests = %d, want exactly first round", driver.requests)
	}

	historyResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/sessions/"+created.FriendlyID+"/history", nil, []*http.Cookie{cookie})
	assertStatusCode(t, historyResponse, http.StatusOK)
	var history HistoryPayload
	decodeResponseJSON(t, historyResponse, &history)
	if len(history.Messages) != 4 {
		t.Fatalf("history messages = %d, want user, assistant, two tool results", len(history.Messages))
	}
	if history.Messages[2]["toolCallId"] != "call-1" || history.Messages[3]["toolCallId"] != "call-2" {
		t.Fatalf("tool result call IDs = %#v/%#v", history.Messages[2], history.Messages[3])
	}
	if history.Messages[3]["isError"] != true {
		t.Fatalf("rejected tool result = %#v, want synthetic error", history.Messages[3])
	}
}
