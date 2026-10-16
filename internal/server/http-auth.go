package server

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

type sessionResponse struct {
	User *User `json:"user"`
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type changeEmailRequest struct {
	NewEmail        string `json:"newEmail"`
	CurrentPassword string `json:"currentPassword"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type authResponse struct {
	User *User `json:"user"`
}

// tokenResponse is returned to native clients, which send the token back as
// `Authorization: Bearer <token>` instead of holding a cookie.
type tokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
	User      *User  `json:"user"`
}

func (app *App) handleSignup(writer http.ResponseWriter, request *http.Request) {
	var payload authRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if !app.config.AuthEnabled {
		writeError(writer, http.StatusForbidden, errAuthDisabled.Error())
		return
	}
	if !app.config.AllowSignup {
		writeError(writer, http.StatusForbidden, errSignupDisabled.Error())
		return
	}
	if !app.allowAuthAttempt(writer, request, payload.Email) {
		return
	}

	user, token, expiresAt, err := app.auth.Signup(request.Context(), payload.Email, payload.Password, requestMetaFromHTTP(request))
	if err != nil {
		switch {
		case errors.Is(err, errAuthBusy):
			writeError(writer, http.StatusServiceUnavailable, "Authentication is temporarily busy. Try again shortly.")
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
	if !app.allowAuthAttempt(writer, request, payload.Email) {
		return
	}

	user, token, expiresAt, err := app.auth.Login(request.Context(), payload.Email, payload.Password, requestMetaFromHTTP(request))
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errAuthBusy):
			status = http.StatusServiceUnavailable
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

// handleTokenLogin is the cookie-less login for native clients. The token is the
// same server-side session a browser login creates, so logout and expiry behave
// identically.
func (app *App) handleTokenLogin(writer http.ResponseWriter, request *http.Request) {
	var payload authRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if !app.allowAuthAttempt(writer, request, payload.Email) {
		return
	}

	user, token, expiresAt, err := app.auth.Login(request.Context(), payload.Email, payload.Password, requestMetaFromHTTP(request))
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errAuthBusy):
			status = http.StatusServiceUnavailable
		case errors.Is(err, errInvalidCredentials):
			status = http.StatusUnauthorized
		case errors.Is(err, errAuthDisabled):
			status = http.StatusForbidden
		}
		writeError(writer, status, err.Error())
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, tokenResponse{Token: token, ExpiresAt: expiresAt.Unix(), User: user})
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

func (app *App) handleChangeEmail(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload changeEmailRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if !app.allowAuthAttempt(writer, request, user.Email) {
		return
	}

	updatedUser, err := app.auth.ChangeEmail(
		request.Context(),
		user.ID,
		payload.CurrentPassword,
		payload.NewEmail,
	)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errAuthBusy):
			status = http.StatusServiceUnavailable
		case errors.Is(err, errInvalidCredentials):
			status = http.StatusUnauthorized
		case errors.Is(err, errSessionNotFound), errors.Is(err, errUserNotFound):
			status = http.StatusUnauthorized
		}
		writeError(writer, status, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, sessionResponse{User: updatedUser})
}

func (app *App) handleChangePassword(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload changePasswordRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if !app.allowAuthAttempt(writer, request, user.Email) {
		return
	}

	err := app.auth.ChangePassword(
		request.Context(),
		user.ID,
		payload.CurrentPassword,
		payload.NewPassword,
		app.sessionTokenFromRequest(request),
	)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errAuthBusy):
			status = http.StatusServiceUnavailable
		case errors.Is(err, errInvalidCredentials):
			status = http.StatusUnauthorized
		case errors.Is(err, errSessionNotFound), errors.Is(err, errUserNotFound):
			status = http.StatusUnauthorized
		}
		writeError(writer, status, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}

// sessionTokenFromRequest prefers an `Authorization: Bearer` token (native
// clients) and falls back to the session cookie (browsers). A bearer token is
// never sent implicitly by a browser, so it needs no CSRF protection.
func (app *App) sessionTokenFromRequest(request *http.Request) string {
	if token, ok := bearerToken(request); ok {
		return token
	}
	cookie, err := request.Cookie(app.config.CookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func bearerToken(request *http.Request) (string, bool) {
	header := strings.TrimSpace(request.Header.Get("Authorization"))
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != ""
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

func (app *App) allowAuthAttempt(writer http.ResponseWriter, request *http.Request, email string) bool {
	if app.auth.guard.allowAuthAttempt(peerIP(request), email) {
		return true
	}
	writer.Header().Set("Retry-After", "60")
	writeError(writer, http.StatusTooManyRequests, "Too many authentication attempts. Try again later.")
	return false
}

func peerIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(request.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(request.RemoteAddr)
	}
	return host
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
