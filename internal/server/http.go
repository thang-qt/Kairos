package server

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

type CapabilitySet struct {
	Auth AuthCapabilities `json:"auth"`
}

type AuthCapabilities struct {
	Enabled       bool `json:"enabled"`
	SignupEnabled bool `json:"signupEnabled"`
}

type sessionResponse struct {
	User *User `json:"user"`
}

type capabilitiesResponse struct {
	Capabilities CapabilitySet `json:"capabilities"`
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	User *User `json:"user"`
}

type sessionsResponse struct {
	Sessions []SessionSummary `json:"sessions"`
}

type createSessionRequest struct {
	Label string `json:"label"`
}

type sessionMutationResponse struct {
	SessionKey string `json:"sessionKey"`
	FriendlyID string `json:"friendlyId"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func (app *App) handleHealth(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "kairos-backend",
	})
}

func (app *App) handleCapabilities(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, capabilitiesResponse{
		Capabilities: app.capability,
	})
}

func (app *App) handleSignup(writer http.ResponseWriter, request *http.Request) {
	var payload authRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	user, token, expiresAt, err := app.auth.Signup(request.Context(), payload.Email, payload.Password, requestMetaFromHTTP(request))
	if err != nil {
		switch {
		case errors.Is(err, errSignupDisabled):
			writeError(writer, http.StatusForbidden, err.Error())
		case errors.Is(err, errAuthDisabled):
			writeError(writer, http.StatusForbidden, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	app.writeSessionCookie(writer, token, expiresAt)
	writeJSON(writer, http.StatusCreated, authResponse{User: user})
}

func (app *App) handleLogin(writer http.ResponseWriter, request *http.Request) {
	var payload authRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	user, token, expiresAt, err := app.auth.Login(request.Context(), payload.Email, payload.Password, requestMetaFromHTTP(request))
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errInvalidCredentials):
			status = http.StatusUnauthorized
		case errors.Is(err, errAuthDisabled):
			status = http.StatusForbidden
		}
		writeError(writer, status, err.Error())
		return
	}

	app.writeSessionCookie(writer, token, expiresAt)
	writeJSON(writer, http.StatusOK, authResponse{User: user})
}

func (app *App) handleLogout(writer http.ResponseWriter, request *http.Request) {
	token := app.sessionTokenFromRequest(request)
	if err := app.auth.Logout(request.Context(), token); err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to logout")
		return
	}

	app.clearSessionCookie(writer)
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}

func (app *App) handleMe(writer http.ResponseWriter, request *http.Request) {
	user, err := app.auth.CurrentUser(request.Context(), app.sessionTokenFromRequest(request))
	if err != nil {
		if errors.Is(err, errSessionNotFound) {
			writeError(writer, http.StatusUnauthorized, "authentication required")
			return
		}
		writeError(writer, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, sessionResponse{User: user})
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

	writeJSON(writer, http.StatusCreated, sessionMutationResponse{
		SessionKey: session.Key,
		FriendlyID: session.FriendlyID,
	})
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

	writeJSON(writer, http.StatusOK, sessionMutationResponse{
		SessionKey: session.Key,
		FriendlyID: session.FriendlyID,
	})
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

func (app *App) sessionTokenFromRequest(request *http.Request) string {
	cookie, err := request.Cookie(app.config.CookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (app *App) writeSessionCookie(writer http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(writer, &http.Cookie{
		Name:     app.config.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   app.config.CookieSecure,
		Expires:  expiresAt,
	})
}

func (app *App) clearSessionCookie(writer http.ResponseWriter) {
	http.SetCookie(writer, &http.Cookie{
		Name:     app.config.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   app.config.CookieSecure,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

func (app *App) requireAuthenticatedUser(
	writer http.ResponseWriter,
	request *http.Request,
) (*User, bool) {
	user, err := app.auth.CurrentUser(request.Context(), app.sessionTokenFromRequest(request))
	if err != nil {
		if errors.Is(err, errSessionNotFound) {
			writeError(writer, http.StatusUnauthorized, "authentication required")
			return nil, false
		}
		writeError(writer, http.StatusUnauthorized, err.Error())
		return nil, false
	}
	return user, true
}

func requestMetaFromHTTP(request *http.Request) RequestMeta {
	return RequestMeta{
		IPAddress: clientIP(request),
		UserAgent: strings.TrimSpace(request.UserAgent()),
	}
}

func clientIP(request *http.Request) string {
	if forwardedFor := strings.TrimSpace(request.Header.Get("X-Forwarded-For")); forwardedFor != "" {
		parts := strings.Split(forwardedFor, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(request.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(request.RemoteAddr)
	}
	return host
}

func decodeJSON(request *http.Request, destination any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, statusCode int, message string) {
	writeJSON(writer, statusCode, errorResponse{Error: message})
}
