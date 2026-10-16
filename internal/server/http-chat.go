package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

type sessionsResponse struct {
	Sessions   []SessionSummary `json:"sessions"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

type sessionSearchResponse struct {
	Sessions []SessionSearchResult `json:"sessions"`
}

type createSessionRequest struct {
	Label                   string                `json:"label"`
	Message                 string                `json:"message"`
	Model                   string                `json:"model"`
	SystemPrompt            string                `json:"systemPrompt"`
	WebSearch               bool                  `json:"webSearch"`
	MathTools               bool                  `json:"mathTools"`
	Advanced                *ChatAdvancedOptions  `json:"advanced"`
	IdempotencyKey          string                `json:"idempotencyKey"`
	ClientID                string                `json:"clientId"`
	ClientTime              string                `json:"clientTime"`
	ClientTimeZone          string                `json:"clientTimeZone"`
	Attachments             []AttachmentPayload   `json:"attachments"`
	Settings                *ConversationSettings `json:"settings"`
	UseConversationSettings bool                  `json:"useConversationSettings,omitempty"`
}

type updateConversationSettingsRequest struct {
	Settings ConversationSettings `json:"settings"`
}

type sendMessageRequest struct {
	ExpectedRevision        *int64               `json:"expectedRevision,omitempty"`
	UseConversationSettings bool                 `json:"useConversationSettings,omitempty"`
	Message                 string               `json:"message"`
	Model                   string               `json:"model"`
	SystemPrompt            string               `json:"systemPrompt"`
	WebSearch               bool                 `json:"webSearch"`
	MathTools               bool                 `json:"mathTools"`
	Advanced                *ChatAdvancedOptions `json:"advanced"`
	IdempotencyKey          string               `json:"idempotencyKey"`
	ClientID                string               `json:"clientId"`
	ClientTime              string               `json:"clientTime"`
	ClientTimeZone          string               `json:"clientTimeZone"`
	Attachments             []AttachmentPayload  `json:"attachments"`
}

type ephemeralMessageRequest struct {
	History        []map[string]any     `json:"history"`
	Message        string               `json:"message"`
	Model          string               `json:"model"`
	SystemPrompt   string               `json:"systemPrompt"`
	WebSearch      bool                 `json:"webSearch"`
	MathTools      bool                 `json:"mathTools"`
	Advanced       *ChatAdvancedOptions `json:"advanced"`
	ClientID       string               `json:"clientId"`
	ClientTime     string               `json:"clientTime"`
	ClientTimeZone string               `json:"clientTimeZone"`
	Attachments    []AttachmentPayload  `json:"attachments"`
}

type cloneSessionRequest struct {
	MessageID string `json:"messageId"`
}

type pinSessionRequest struct {
	IsPinned bool `json:"isPinned"`
}

type sessionMutationResponse struct {
	UserTurn map[string]any `json:"userTurn,omitempty"`
	SessionSummary
	SessionKey      string `json:"sessionKey"`
	RunID           string `json:"runId,omitempty"`
	UserTurnID      string `json:"userTurnId,omitempty"`
	AssistantTurnID string `json:"assistantTurnId,omitempty"`
	ClientID        string `json:"clientId,omitempty"`
}

func newSessionMutationResponse(session SessionSummary) sessionMutationResponse {
	return sessionMutationResponse{
		SessionSummary: session,
		SessionKey:     session.Key,
	}
}

func (app *App) handleListSessions(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	limit := 50
	if value := request.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "Invalid session page size.")
			return
		}
		limit = parsed
	}
	var page sessionsResponse
	var err error
	if request.URL.Query().Get("order") == "recent" {
		page, err = app.conversations.ListRecentSessionPage(request.Context(), user.ID, limit, request.URL.Query().Get("cursor"))
	} else if request.URL.Query().Get("order") == "" || request.URL.Query().Get("order") == "pinned" {
		page, err = app.conversations.ListSessionPage(request.Context(), user.ID, limit, request.URL.Query().Get("cursor"))
	} else {
		writeError(writer, http.StatusBadRequest, "Invalid session pagination.")
		return
	}
	if err != nil {
		if errors.Is(err, errInvalidSessionPage) {
			writeError(writer, http.StatusBadRequest, "Invalid session pagination.")
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	writeJSON(writer, http.StatusOK, page)
}

func (app *App) handleGetSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	summary, err := app.conversations.GetSessionSummary(request.Context(), user.ID, request.PathValue("friendlyId"))
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, "Session not found.")
			return
		}
		writeError(writer, http.StatusInternalServerError, "Unable to load session.")
		return
	}
	// Summary lookups should not transfer inline image data from the last message.
	summary.LastMessage = nil
	writeJSON(writer, http.StatusOK, summary)
}

func (app *App) handleSearchSessions(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	sessions, err := app.conversations.SearchSessions(request.Context(), user.ID, request.URL.Query().Get("q"))
	if err != nil {
		if errors.Is(err, errSessionSearchQueryTooLong) {
			writeError(writer, http.StatusBadRequest, "Search query is too long.")
			return
		}
		writeError(writer, http.StatusInternalServerError, "Unable to search sessions.")
		return
	}

	writeJSON(writer, http.StatusOK, sessionSearchResponse{Sessions: sessions})
}

func (app *App) handleCreateSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload createSessionRequest
	if err := decodeJSONWithLimit(writer, request, &payload, maxChatJSONRequestBytes); err != nil {
		writeJSONDecodeError(writer, err)
		return
	}

	settings := defaultConversationSettings()
	if payload.Settings != nil {
		settings = *payload.Settings
	}
	var response sessionMutationResponse
	if strings.TrimSpace(payload.Message) != "" || len(payload.Attachments) > 0 {
		result, err := app.runtime.StartRun(request.Context(), user.ID, SubmitTurnInput{UseConversationSettings: payload.UseConversationSettings, NewConversation: &newConversationInput{Label: payload.Label, Settings: settings}, Message: payload.Message, Model: payload.Model, SystemPrompt: payload.SystemPrompt, WebSearch: payload.WebSearch, MathTools: payload.MathTools, Advanced: payload.Advanced, IdempotencyKey: payload.IdempotencyKey, ClientID: payload.ClientID, ClientTime: payload.ClientTime, ClientTimeZone: payload.ClientTimeZone, Attachments: payload.Attachments})
		if err != nil {
			if errors.Is(err, errConversationConflict) {
				writeError(writer, http.StatusConflict, err.Error())
			} else {
				writeError(writer, http.StatusBadRequest, err.Error())
			}
			return
		}
		session, err := app.conversations.GetSessionSummary(request.Context(), user.ID, result.FriendlyID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "failed to load created conversation")
			return
		}
		response = newSessionMutationResponse(session)
		response.RunID = result.RunID
		response.UserTurnID = result.UserTurnID
		response.AssistantTurnID = result.AssistantTurnID
		response.ClientID = result.ClientID
		response.UserTurn = result.UserTurn
	} else {
		session, err := app.conversations.CreateSessionWithSettings(request.Context(), user.ID, payload.Label, settings)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "failed to create session")
			return
		}
		response = newSessionMutationResponse(session)
	}

	writeJSON(writer, http.StatusCreated, response)
}

func (app *App) handleUpdateConversationSettings(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload updateConversationSettingsRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, err := app.conversations.UpdateConversationSettings(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		payload.Settings,
	)
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to update conversation settings")
		return
	}

	writeJSON(writer, http.StatusOK, newSessionMutationResponse(session))
}

func (app *App) handleRenameSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload createSessionRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, err := app.conversations.RenameSession(request.Context(), user.ID, request.PathValue("friendlyId"), payload.Label)
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to rename session")
		return
	}

	writeJSON(writer, http.StatusOK, newSessionMutationResponse(session))
}

func (app *App) handleDeleteSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	if err := app.conversations.DeleteSession(request.Context(), user.ID, request.PathValue("friendlyId")); err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to delete session")
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}

func (app *App) handlePinSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload pinSessionRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, err := app.conversations.PinSession(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		payload.IsPinned,
	)
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to pin session")
		return
	}

	writeJSON(writer, http.StatusOK, session)
}

func (app *App) handleSessionHistory(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	history, err := app.conversations.GetHistory(request.Context(), user.ID, request.PathValue("friendlyId"))
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to load history")
		return
	}

	writeJSON(writer, http.StatusOK, history)
}

func (app *App) handleSendMessage(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload sendMessageRequest
	if err := decodeJSONWithLimit(writer, request, &payload, maxChatJSONRequestBytes); err != nil {
		writeJSONDecodeError(writer, err)
		return
	}

	result, err := app.runtime.StartRun(request.Context(), user.ID, SubmitTurnInput{
		ExpectedRevision:        payload.ExpectedRevision,
		UseConversationSettings: payload.UseConversationSettings,
		FriendlyID:              request.PathValue("friendlyId"),
		Message:                 payload.Message,
		Model:                   payload.Model,
		SystemPrompt:            payload.SystemPrompt,
		WebSearch:               payload.WebSearch,
		MathTools:               payload.MathTools,
		Advanced:                payload.Advanced,
		IdempotencyKey:          payload.IdempotencyKey,
		ClientID:                payload.ClientID,
		ClientTime:              payload.ClientTime,
		ClientTimeZone:          payload.ClientTimeZone,
		Attachments:             payload.Attachments,
	})
	if err != nil {
		switch {
		case errors.Is(err, errConversationConflict):
			writeError(writer, http.StatusConflict, err.Error())
		case errors.Is(err, errChatSessionNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		case errors.Is(err, errInvalidImageAttachment):
			writeError(writer, http.StatusBadRequest, err.Error())
		case errors.Is(err, errNoProviderAvailable),
			errors.Is(err, errNoModelAvailable),
			errors.Is(err, errModelNotAvailable):
			writeError(writer, http.StatusBadRequest, err.Error())
		default:
			writeError(writer, http.StatusBadGateway, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (app *App) handleEphemeralMessage(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload ephemeralMessageRequest
	if err := decodeJSONWithLimit(writer, request, &payload, maxEphemeralJSONRequestBytes); err != nil {
		writeJSONDecodeError(writer, err)
		return
	}
	if len(payload.History) > 200 {
		writeError(writer, http.StatusBadRequest, "ephemeral history is too long")
		return
	}

	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)
	flusher.Flush()

	err := app.runtime.StreamEphemeral(request.Context(), user.ID, payload.History, SubmitTurnInput{
		Message:        payload.Message,
		Model:          payload.Model,
		SystemPrompt:   payload.SystemPrompt,
		WebSearch:      payload.WebSearch,
		MathTools:      payload.MathTools,
		Advanced:       payload.Advanced,
		ClientID:       payload.ClientID,
		ClientTime:     payload.ClientTime,
		ClientTimeZone: payload.ClientTimeZone,
		Attachments:    payload.Attachments,
	}, func(event ConversationEvent) error {
		encoded, encodeErr := json.Marshal(event)
		if encodeErr != nil {
			return encodeErr
		}
		if _, writeErr := writer.Write([]byte("data: ")); writeErr != nil {
			return writeErr
		}
		if _, writeErr := writer.Write(encoded); writeErr != nil {
			return writeErr
		}
		if _, writeErr := writer.Write([]byte("\n\n")); writeErr != nil {
			return writeErr
		}
		flusher.Flush()
		return nil
	})
	if err != nil {
		return
	}
}

func (app *App) handleCloneSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload cloneSessionRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, err := app.conversations.CloneSession(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		payload.MessageID,
	)
	if err != nil {
		switch {
		case errors.Is(err, errConversationConflict):
			writeError(writer, http.StatusConflict, err.Error())
		case errors.Is(err, errChatSessionNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, newSessionMutationResponse(session))
}

func (app *App) handleEditUserMessage(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload sendMessageRequest
	if err := decodeJSONWithLimit(writer, request, &payload, maxChatJSONRequestBytes); err != nil {
		writeJSONDecodeError(writer, err)
		return
	}

	result, err := app.runtime.StartRun(request.Context(), user.ID, SubmitTurnInput{
		FriendlyID: request.PathValue("friendlyId"), EditMessageID: request.PathValue("messageId"), ExpectedRevision: payload.ExpectedRevision, UseConversationSettings: payload.UseConversationSettings,
		Message: payload.Message, Model: payload.Model, SystemPrompt: payload.SystemPrompt, WebSearch: payload.WebSearch, MathTools: payload.MathTools, Advanced: payload.Advanced, IdempotencyKey: payload.IdempotencyKey, ClientID: payload.ClientID, ClientTime: payload.ClientTime, ClientTimeZone: payload.ClientTimeZone,
	})
	if err != nil {
		switch {
		case errors.Is(err, errConversationConflict):
			writeError(writer, http.StatusConflict, err.Error())
		case errors.Is(err, errNoProviderAvailable),
			errors.Is(err, errNoModelAvailable),
			errors.Is(err, errModelNotAvailable):
			writeError(writer, http.StatusBadRequest, err.Error())
		default:
			writeError(writer, http.StatusBadGateway, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"revision": result.Revision, "userTurn": result.UserTurn, "invalidatedRunIds": result.InvalidatedRunIDs, "removedTurnIds": result.RemovedTurnIDs,
		"sessionKey":      result.SessionKey,
		"key":             result.SessionKey,
		"friendlyId":      request.PathValue("friendlyId"),
		"runId":           result.RunID,
		"userTurnId":      result.UserTurnID,
		"assistantTurnId": result.AssistantTurnID,
		"clientId":        result.ClientID,
	})
}

func (app *App) handleDeleteUserMessage(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var expectedRevision *int64
	if raw := request.URL.Query().Get("revision"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid revision")
			return
		}
		expectedRevision = &value
	}
	session, err := app.conversations.DeleteUserMessageAtRevision(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		request.PathValue("messageId"),
		expectedRevision,
	)
	if err != nil {
		switch {
		case errors.Is(err, errConversationConflict):
			writeError(writer, http.StatusConflict, err.Error())
		case errors.Is(err, errChatSessionNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, newSessionMutationResponse(session))
}

func (app *App) handleStopSessionRuns(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload struct {
		RunID string `json:"runId"`
	}
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.RunID) == "" {
		writeError(writer, http.StatusBadRequest, "runId is required")
		return
	}
	_, err := app.runtime.CancelRun(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"), payload.RunID,
	)
	if err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to stop run")
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}
