package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrowserSecurityChecksMutatingAPIRequests(t *testing.T) {
	app := &App{config: Config{AppEnv: "production", CookieName: "session"}}
	called := false
	handler := app.withBrowserSecurity(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		called = true
		writer.WriteHeader(http.StatusNoContent)
	}))

	testCases := []struct {
		name        string
		method      string
		path        string
		contentType string
		origin      string
		fetchSite   string
		cookie      bool
		wantStatus  int
	}{
		{name: "matching browser origin", method: http.MethodPost, path: "/api/sessions", contentType: "application/json", origin: "http://kairos.test", fetchSite: "same-origin", cookie: true, wantStatus: http.StatusNoContent},
		{name: "bearer API client without browser origin", method: http.MethodPost, path: "/api/sessions", contentType: "application/json", wantStatus: http.StatusNoContent},
		{name: "same-site sibling origin", method: http.MethodPatch, path: "/api/me/email", contentType: "application/json", origin: "http://sibling.kairos.test", fetchSite: "same-site", cookie: true, wantStatus: http.StatusForbidden},
		{name: "cross-site fetch metadata", method: http.MethodPost, path: "/api/sessions", contentType: "application/json", fetchSite: "cross-site", wantStatus: http.StatusForbidden},
		{name: "cookie API client without browser metadata", method: http.MethodPost, path: "/api/sessions", contentType: "application/json", cookie: true, wantStatus: http.StatusNoContent},
		{name: "same-site browser metadata without origin", method: http.MethodPost, path: "/api/sessions", contentType: "application/json", fetchSite: "same-site", cookie: true, wantStatus: http.StatusForbidden},
		{name: "form request", method: http.MethodPost, path: "/api/sessions", contentType: "application/x-www-form-urlencoded", origin: "http://kairos.test", wantStatus: http.StatusUnsupportedMediaType},
		{name: "logout needs no body", method: http.MethodPost, path: "/api/auth/logout", origin: "http://kairos.test", wantStatus: http.StatusNoContent},
		{name: "archive upload keeps zip content type", method: http.MethodPost, path: "/api/imports/chatgpt", contentType: "application/zip", origin: "http://kairos.test", wantStatus: http.StatusNoContent},
		{name: "delete needs no body", method: http.MethodDelete, path: "/api/sessions/abc", origin: "http://kairos.test", wantStatus: http.StatusNoContent},
		{name: "options stays safe", method: http.MethodOptions, path: "/api/sessions", wantStatus: http.StatusNoContent},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			called = false
			request := httptest.NewRequest(testCase.method, testCase.path, nil)
			request.Host = "kairos.test"
			if testCase.contentType != "" {
				request.Header.Set("Content-Type", testCase.contentType)
			}
			if testCase.origin != "" {
				request.Header.Set("Origin", testCase.origin)
			}
			if testCase.fetchSite != "" {
				request.Header.Set("Sec-Fetch-Site", testCase.fetchSite)
			}
			if testCase.cookie {
				request.AddCookie(&http.Cookie{Name: "session", Value: "browser-session"})
			}
			request.Header.Set("X-Forwarded-Host", "attacker.test")
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, testCase.wantStatus, recorder.Body.String())
			}
			if called != (testCase.wantStatus == http.StatusNoContent) {
				t.Fatalf("handler called = %t, want %t", called, testCase.wantStatus == http.StatusNoContent)
			}
		})
	}
}

func TestBrowserSecurityCSPSupportsAppRendering(t *testing.T) {
	production := (&App{config: Config{AppEnv: "production"}}).contentSecurityPolicy()
	if !strings.Contains(production, "script-src 'self';") || strings.Contains(production, "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("production script policy is not strict: %q", production)
	}
	for _, source := range []string{"style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "worker-src 'self' blob:"} {
		if !strings.Contains(production, source) {
			t.Errorf("production policy missing %q: %q", source, production)
		}
	}
	development := (&App{config: Config{AppEnv: "development"}}).contentSecurityPolicy()
	if !strings.Contains(development, "script-src 'self' 'unsafe-inline'") || !strings.Contains(development, "connect-src 'self' ws: wss:") {
		t.Fatalf("development policy does not support Vite: %q", development)
	}
}

func TestAppHandlerAddsBrowserSecurityHeaders(t *testing.T) {
	app := &App{config: Config{AppEnv: "production", CookieName: "session"}}
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "kairos.test"
	recorder := httptest.NewRecorder()

	app.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if !strings.Contains(recorder.Header().Get("Content-Security-Policy"), "script-src 'self';") {
		t.Fatalf("Content-Security-Policy = %q, want strict same-origin scripts", recorder.Header().Get("Content-Security-Policy"))
	}
	if got := recorder.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", got)
	}
}

func TestBrowserSecurityRejectsAmbiguousOriginAndContentTypeHeaders(t *testing.T) {
	app := &App{config: Config{AppEnv: "production"}}
	handler := app.withBrowserSecurity(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	for _, header := range []string{"Origin", "Content-Type"} {
		t.Run(header, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/sessions", nil)
			request.Host = "kairos.test"
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "http://kairos.test")
			request.Header.Add(header, "http://other.test")
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden && recorder.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want a rejected request", recorder.Code)
			}
		})
	}
}
