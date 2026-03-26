package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

type testApp struct {
	app     *App
	handler http.Handler
}

func TestPasswordHashRoundTrip(t *testing.T) {
	password := "tracepass123"

	hash, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hashPassword() error = %v", err)
	}

	if !verifyPassword(password, hash) {
		t.Fatal("verifyPassword() = false, want true for matching password")
	}

	if verifyPassword("wrong-password", hash) {
		t.Fatal("verifyPassword() = true, want false for mismatched password")
	}
}

func TestCapabilitiesReflectConfig(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.AllowSignup = false
	})

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/app/capabilities", nil, nil)
	assertStatusCode(t, response, http.StatusOK)

	var payload capabilitiesResponse
	decodeResponseJSON(t, response, &payload)

	if !payload.Capabilities.Auth.Enabled {
		t.Fatal("auth capability enabled = false, want true")
	}
	if payload.Capabilities.Auth.SignupEnabled {
		t.Fatal("signup capability enabled = true, want false")
	}
}

func TestAuthHTTPFlow(t *testing.T) {
	testServer := newTestApp(t, nil)

	signupResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    "FlowUser@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, signupResponse, http.StatusCreated)
	signupCookie := requireSessionCookie(t, signupResponse)

	var signupPayload authResponse
	decodeResponseJSON(t, signupResponse, &signupPayload)
	if signupPayload.User == nil {
		t.Fatal("signup user = nil, want populated user")
	}
	if signupPayload.User.Email != "flowuser@example.com" {
		t.Fatalf("signup email = %q, want lowercased email", signupPayload.User.Email)
	}

	meResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me", nil, []*http.Cookie{signupCookie})
	assertStatusCode(t, meResponse, http.StatusOK)

	var mePayload sessionResponse
	decodeResponseJSON(t, meResponse, &mePayload)
	if mePayload.User == nil {
		t.Fatal("/api/me user = nil, want authenticated user")
	}
	if mePayload.User.Email != signupPayload.User.Email {
		t.Fatalf("/api/me email = %q, want %q", mePayload.User.Email, signupPayload.User.Email)
	}

	logoutResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/logout", nil, []*http.Cookie{signupCookie})
	assertStatusCode(t, logoutResponse, http.StatusOK)
	clearedCookie := requireSessionCookie(t, logoutResponse)
	if clearedCookie.MaxAge != -1 {
		t.Fatalf("logout cookie MaxAge = %d, want -1", clearedCookie.MaxAge)
	}

	meAfterLogout := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me", nil, []*http.Cookie{signupCookie})
	assertStatusCode(t, meAfterLogout, http.StatusUnauthorized)

	loginResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "flowuser@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, loginResponse, http.StatusOK)
	loginCookie := requireSessionCookie(t, loginResponse)

	var loginPayload authResponse
	decodeResponseJSON(t, loginResponse, &loginPayload)
	if loginPayload.User == nil {
		t.Fatal("login user = nil, want populated user")
	}
	if loginPayload.User.ID != signupPayload.User.ID {
		t.Fatalf("login user id = %q, want %q", loginPayload.User.ID, signupPayload.User.ID)
	}

	meAfterLogin := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me", nil, []*http.Cookie{loginCookie})
	assertStatusCode(t, meAfterLogin, http.StatusOK)
}

func TestSignupRejectsDuplicateEmail(t *testing.T) {
	testServer := newTestApp(t, nil)

	firstResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    "duplicate@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, firstResponse, http.StatusCreated)

	secondResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    "DUPLICATE@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, secondResponse, http.StatusBadRequest)

	var payload errorResponse
	decodeResponseJSON(t, secondResponse, &payload)
	if payload.Error != "email is already in use" {
		t.Fatalf("duplicate signup error = %q, want %q", payload.Error, "email is already in use")
	}
}

func TestSignupDisabled(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.AllowSignup = false
	})

	response := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    "disabled@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, response, http.StatusForbidden)

	var payload errorResponse
	decodeResponseJSON(t, response, &payload)
	if payload.Error != errSignupDisabled.Error() {
		t.Fatalf("signup disabled error = %q, want %q", payload.Error, errSignupDisabled.Error())
	}
}

func TestAuthDisabled(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.AuthEnabled = false
		config.AllowSignup = false
	})

	capabilitiesRequest := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/app/capabilities", nil, nil)
	assertStatusCode(t, capabilitiesRequest, http.StatusOK)

	var capabilitiesPayload capabilitiesResponse
	decodeResponseJSON(t, capabilitiesRequest, &capabilitiesPayload)
	if capabilitiesPayload.Capabilities.Auth.Enabled {
		t.Fatal("auth capability enabled = true, want false")
	}

	signupResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/signup", authRequest{
		Email:    "auth-disabled@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, signupResponse, http.StatusForbidden)

	loginResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "auth-disabled@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, loginResponse, http.StatusForbidden)
}

func TestMeRequiresAuthentication(t *testing.T) {
	testServer := newTestApp(t, nil)

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me", nil, nil)
	assertStatusCode(t, response, http.StatusUnauthorized)

	var payload errorResponse
	decodeResponseJSON(t, response, &payload)
	if payload.Error != "authentication required" {
		t.Fatalf("/api/me error = %q, want %q", payload.Error, "authentication required")
	}
}

func TestFrontendProtectedRouteRedirectsGuestToAuth(t *testing.T) {
	testServer := newTestApp(t, nil)

	request := httptest.NewRequest(http.MethodGet, "/chat/demo", nil)
	response := httptest.NewRecorder()

	testServer.handler.ServeHTTP(response, request)

	assertStatusCode(t, response, http.StatusFound)
	if location := response.Header().Get("Location"); location != "/auth" {
		t.Fatalf("redirect location = %q, want %q", location, "/auth")
	}
}

func TestFrontendGuestRouteRedirectsAuthenticatedUserToNew(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "frontend-redirect@example.com")

	request := httptest.NewRequest(http.MethodGet, "/auth", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()

	testServer.handler.ServeHTTP(response, request)

	assertStatusCode(t, response, http.StatusFound)
	if location := response.Header().Get("Location"); location != "/new" {
		t.Fatalf("redirect location = %q, want %q", location, "/new")
	}
}

func TestBootstrapAdminCanLogin(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.BootstrapAdmin = true
		config.AdminEmail = "admin@example.com"
		config.AdminPassword = "tracepass123"
	})

	loginResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "ADMIN@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, loginResponse, http.StatusOK)

	var payload authResponse
	decodeResponseJSON(t, loginResponse, &payload)
	if payload.User == nil {
		t.Fatal("bootstrap admin user = nil, want populated user")
	}
	if payload.User.Role != "admin" {
		t.Fatalf("bootstrap admin role = %q, want admin", payload.User.Role)
	}
}

func TestCurrentUserRejectsExpiredSession(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SessionTTL = time.Second
	})

	user, token, _, err := testServer.app.auth.Signup(context.Background(), "expired@example.com", "tracepass123", RequestMeta{})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}

	if _, err := testServer.app.db.Exec(`
		UPDATE auth_sessions
		SET expires_at = ?
		WHERE user_id = ?
	`, time.Now().Add(-time.Minute).Unix(), user.ID); err != nil {
		t.Fatalf("expire session update error = %v", err)
	}

	currentUser, err := testServer.app.auth.CurrentUser(context.Background(), token)
	if !errors.Is(err, errSessionNotFound) {
		t.Fatalf("CurrentUser() error = %v, want %v", err, errSessionNotFound)
	}
	if currentUser != nil {
		t.Fatal("CurrentUser() user != nil, want nil for expired session")
	}
}

func TestChangeEmailHTTPFlow(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "change-email@example.com")

	response := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/email",
		changeEmailRequest{
			NewEmail:        "updated-email@example.com",
			CurrentPassword: "tracepass123",
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, response, http.StatusOK)

	var payload sessionResponse
	decodeResponseJSON(t, response, &payload)
	if payload.User == nil {
		t.Fatal("updated user = nil, want populated user")
	}
	if payload.User.Email != "updated-email@example.com" {
		t.Fatalf("updated email = %q, want %q", payload.User.Email, "updated-email@example.com")
	}

	loginResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "updated-email@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, loginResponse, http.StatusOK)
}

func TestChangeEmailRejectsDuplicateEmail(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "primary@example.com")
	_ = signupAndRequireCookie(t, testServer, "secondary@example.com")

	response := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/email",
		changeEmailRequest{
			NewEmail:        "SECONDARY@example.com",
			CurrentPassword: "tracepass123",
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, response, http.StatusBadRequest)

	var payload errorResponse
	decodeResponseJSON(t, response, &payload)
	if payload.Error != "email is already in use" {
		t.Fatalf("change email error = %q, want %q", payload.Error, "email is already in use")
	}
}

func TestChangePasswordInvalidatesOtherSessions(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "change-password@example.com")

	secondLogin := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "change-password@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, secondLogin, http.StatusOK)
	secondCookie := requireSessionCookie(t, secondLogin)

	changeResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/password",
		changePasswordRequest{
			CurrentPassword: "tracepass123",
			NewPassword:     "tracepass456",
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, changeResponse, http.StatusOK)

	currentSessionResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodGet,
		"/api/me",
		nil,
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, currentSessionResponse, http.StatusOK)

	otherSessionResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodGet,
		"/api/me",
		nil,
		[]*http.Cookie{secondCookie},
	)
	assertStatusCode(t, otherSessionResponse, http.StatusUnauthorized)

	oldPasswordLogin := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "change-password@example.com",
		Password: "tracepass123",
	}, nil)
	assertStatusCode(t, oldPasswordLogin, http.StatusUnauthorized)

	newPasswordLogin := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/auth/login", authRequest{
		Email:    "change-password@example.com",
		Password: "tracepass456",
	}, nil)
	assertStatusCode(t, newPasswordLogin, http.StatusOK)
}

func newTestApp(t *testing.T, override func(config *Config)) *testApp {
	t.Helper()

	config := Config{
		AppEnv:                     "test",
		HTTPAddr:                   ":0",
		DBPath:                     filepath.Join(t.TempDir(), "test.db"),
		CookieName:                 "kairos_session",
		CookieSecure:               false,
		SessionTTL:                 24 * time.Hour,
		AuthEnabled:                true,
		AllowSignup:                true,
		BootstrapAdmin:             false,
		UserProvidersEnabled:       true,
		AllowUserCustomProviderURL: true,
		AllowUserDisableSystem:     true,
		AllowUserModelSync:         true,
		SystemProviderKind:         "openai_compatible",
	}
	if override != nil {
		override(&config)
	}

	app, err := NewApp(config)
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	t.Cleanup(func() {
		if closeErr := app.Close(); closeErr != nil {
			t.Fatalf("Close() error = %v", closeErr)
		}
	})

	return &testApp{
		app:     app,
		handler: app.Handler(),
	}
}

func performJSONRequest(
	t *testing.T,
	handler http.Handler,
	method string,
	target string,
	body any,
	cookies []*http.Cookie,
) *httptest.ResponseRecorder {
	t.Helper()

	var bodyReader *bytes.Reader
	if body == nil {
		bodyReader = bytes.NewReader(nil)
	} else {
		jsonBytes, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		bodyReader = bytes.NewReader(jsonBytes)
	}

	request := httptest.NewRequest(method, target, bodyReader)
	request.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeResponseJSON(t *testing.T, response *httptest.ResponseRecorder, destination any) {
	t.Helper()

	if err := json.Unmarshal(response.Body.Bytes(), destination); err != nil {
		t.Fatalf("json.Unmarshal() error = %v; body = %s", err, response.Body.String())
	}
}

func requireSessionCookie(t *testing.T, response *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	result := response.Result()
	for _, cookie := range result.Cookies() {
		if cookie.Name == "kairos_session" {
			return cookie
		}
	}

	t.Fatal("session cookie not found in response")
	return nil
}

func assertStatusCode(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()

	if response.Code != want {
		t.Fatalf("status code = %d, want %d; body = %s", response.Code, want, response.Body.String())
	}
}
