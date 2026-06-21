package server

import (
	"errors"
	"net/http"
	"strings"
)

type sessionsResponse struct {
	Sessions []SessionSummary `json:"sessions"`
}

type createSessionRequest struct {
	Label          string               `json:"label"`
	Message        string               `json:"message"`
	Model          string               `json:"model"`
	SystemPrompt   string               `json:"systemPrompt"`
	WebSearch      bool                 `json:"webSearch"`
	MathTools      bool                 `json:"mathTools"`
	Advanced       *ChatAdvancedOptions `json:"advanced"`
	IdempotencyKey string               `json:"idempotencyKey"`
	ClientID       string               `json:"clientId"`
	Attachments    []AttachmentPayload  `json:"attachments"`
}

type sendMessageRequest struct {
	Message        string               `json:"message"`
	Model          string               `json:"model"`
	SystemPrompt   string               `json:"systemPrompt"`
	WebSearch      bool                 `json:"webSearch"`
	MathTools      bool                 `json:"mathTools"`
	Advanced       *ChatAdvancedOptions `json:"advanced"`
	IdempotencyKey string               `json:"idempotencyKey"`
	ClientID       string               `json:"clientId"`
	Attachments    []AttachmentPayload  `json:"attachments"`
}

type cloneSessionRequest struct {
	MessageID string `json:"messageId"`
}

type pinSessionRequest struct {
	IsPinned bool `json:"isPinned"`
}

type sessionMutationResponse struct {
	SessionSummary
	SessionKey         string `json:"sessionKey"`
	RunID              string `json:"runId,omitempty"`
	UserMessageID      string `json:"userMessageId,omitempty"`
	AssistantMessageID string `json:"assistantMessageId,omitempty"`
	ClientID           string `json:"clientId,omitempty"`
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

	sessions, err := app.chat.ListSessions(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	writeJSON(writer, http.StatusOK, sessionsResponse{Sessions: sessions})
}

func (app *App) handleCreateSession(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload createSessionRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, err := app.chat.CreateSession(request.Context(), user.ID, payload.Label)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to create session")
		return
	}

	response := newSessionMutationResponse(session)
	if strings.TrimSpace(payload.Message) != "" || len(payload.Attachments) > 0 {
		result, err := app.runs.StartRun(request.Context(), user.ID, SendMessageInput{
			FriendlyID:     session.FriendlyID,
			Message:        payload.Message,
			Model:          payload.Model,
			SystemPrompt:   payload.SystemPrompt,
			WebSearch:      payload.WebSearch,
			MathTools:      payload.MathTools,
			Advanced:       payload.Advanced,
			IdempotencyKey: payload.IdempotencyKey,
			ClientID:       payload.ClientID,
			Attachments:    payload.Attachments,
		})
		if err != nil {
			switch {
			case errors.Is(err, errNoProviderAvailable),
				errors.Is(err, errNoModelAvailable),
				errors.Is(err, errModelNotAvailable):
				writeError(writer, http.StatusBadRequest, err.Error())
			default:
				writeError(writer, http.StatusBadGateway, err.Error())
			}
			return
		}
		if updatedSession, err := app.chat.GetSessionSummary(
			request.Context(),
			user.ID,
			session.FriendlyID,
		); err == nil {
			response = newSessionMutationResponse(updatedSession)
		}
		response.RunID = result.RunID
		response.UserMessageID = result.UserMessageID
		response.AssistantMessageID = result.AssistantMessageID
		response.ClientID = result.ClientID
	}

	writeJSON(writer, http.StatusCreated, response)
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

	session, err := app.chat.RenameSession(request.Context(), user.ID, request.PathValue("friendlyId"), payload.Label)
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

	if err := app.chat.DeleteSession(request.Context(), user.ID, request.PathValue("friendlyId")); err != nil {
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

	session, err := app.chat.PinSession(
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

	history, err := app.chat.GetHistory(request.Context(), user.ID, request.PathValue("friendlyId"))
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
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	result, err := app.runs.StartRun(request.Context(), user.ID, SendMessageInput{
		FriendlyID:     request.PathValue("friendlyId"),
		Message:        payload.Message,
		Model:          payload.Model,
		SystemPrompt:   payload.SystemPrompt,
		WebSearch:      payload.WebSearch,
		MathTools:      payload.MathTools,
		Advanced:       payload.Advanced,
		IdempotencyKey: payload.IdempotencyKey,
		ClientID:       payload.ClientID,
		Attachments:    payload.Attachments,
	})
	if err != nil {
		switch {
		case errors.Is(err, errChatSessionNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
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

	session, err := app.chat.CloneSession(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		payload.MessageID,
	)
	if err != nil {
		switch {
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
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	session, attachments, err := app.chat.EditUserMessage(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		request.PathValue("messageId"),
		payload.Message,
	)
	if err != nil {
		switch {
		case errors.Is(err, errChatSessionNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	result, err := app.runs.StartRun(request.Context(), user.ID, SendMessageInput{
		FriendlyID:   session.FriendlyID,
		Message:      payload.Message,
		Model:        payload.Model,
		SystemPrompt: payload.SystemPrompt,
		WebSearch:    payload.WebSearch,
		MathTools:    payload.MathTools,
		Advanced:     payload.Advanced,
		ClientID:     payload.ClientID,
		Attachments:  attachments,
	})
	if err != nil {
		switch {
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
		"sessionKey":         session.Key,
		"key":                session.Key,
		"friendlyId":         session.FriendlyID,
		"runId":              result.RunID,
		"userMessageId":      result.UserMessageID,
		"assistantMessageId": result.AssistantMessageID,
		"clientId":           result.ClientID,
	})
}

func (app *App) handleDeleteUserMessage(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	session, err := app.chat.DeleteUserMessage(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
		request.PathValue("messageId"),
	)
	if err != nil {
		switch {
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

	_, err := app.runs.CancelSessionRuns(
		request.Context(),
		user.ID,
		request.PathValue("friendlyId"),
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
