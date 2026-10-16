package server

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONEnforcesLimitAndSingleDocument(t *testing.T) {
	for _, test := range []struct {
		name       string
		body       string
		limit      int64
		wantStatus int
	}{
		{name: "valid at limit", body: `{"message":"hello"}`, limit: 19, wantStatus: http.StatusOK},
		{name: "oversized value", body: `{"message":"hello"}`, limit: 18, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "valid trailing whitespace", body: "{\"message\":\"hello\"}\n ", limit: 21, wantStatus: http.StatusOK},
		{name: "oversized trailing whitespace", body: "{\"message\":\"hello\"}" + strings.Repeat(" ", 20), limit: 20, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "second document", body: `{"message":"hello"} {}`, limit: 100, wantStatus: http.StatusBadRequest},
		{name: "trailing garbage", body: `{"message":"hello"} bad`, limit: 100, wantStatus: http.StatusBadRequest},
		{name: "unknown field", body: `{"unexpected":true}`, limit: 100, wantStatus: http.StatusBadRequest},
		{name: "malformed JSON", body: `{"message":`, limit: 100, wantStatus: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(test.body))
			// Chunked requests must obey the same limit as known-length bodies.
			request.ContentLength = -1
			response := httptest.NewRecorder()
			var payload struct {
				Message string `json:"message"`
			}
			err := decodeJSONWithLimit(response, request, &payload, test.limit)
			if err != nil {
				writeJSONDecodeError(response, err)
			}
			assertStatusCode(t, response, test.wantStatus)
			if test.wantStatus == http.StatusOK && payload.Message != "hello" {
				t.Fatalf("decoded message = %q, want hello", payload.Message)
			}
		})
	}
}

func TestDefaultJSONRequestLimit(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", io.MultiReader(
		strings.NewReader(`{"message":"`),
		strings.NewReader(strings.Repeat("a", maxJSONRequestBytes)),
		strings.NewReader(`"}`),
	))
	var payload struct {
		Message string `json:"message"`
	}
	var sizeError *http.MaxBytesError
	if err := decodeJSON(request, &payload); !errors.As(err, &sizeError) {
		t.Fatalf("decodeJSON error = %v, want MaxBytesError", err)
	}
}

func TestChatEndpointsRejectOversizedBodiesBeforeSideEffects(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "limits@example.com")
	for _, test := range []struct {
		path  string
		limit int
	}{
		{path: "/api/sessions", limit: maxChatJSONRequestBytes},
		{path: "/api/sessions/missing/messages", limit: maxChatJSONRequestBytes},
		{path: "/api/sessions/missing/messages/missing/edit", limit: maxChatJSONRequestBytes},
		{path: "/api/ephemeral/messages", limit: maxEphemeralJSONRequestBytes},
	} {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, io.MultiReader(
				strings.NewReader(`{"message":"`),
				io.LimitReader(repeatingRequestByteReader{}, int64(test.limit)),
				strings.NewReader(`"}`),
			))
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			app.handler.ServeHTTP(response, request)
			assertStatusCode(t, response, http.StatusRequestEntityTooLarge)
			if strings.Contains(response.Header().Get("Content-Type"), "text/event-stream") {
				t.Fatal("oversized request started a generation stream")
			}
		})
	}
	for _, table := range []string{"chat_sessions", "chat_messages", "chat_runs"} {
		var count int
		if err := app.app.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s rows = %d after oversized requests, want 0", table, count)
		}
	}
}

type repeatingRequestByteReader struct{}

func (repeatingRequestByteReader) Read(data []byte) (int, error) {
	for index := range data {
		data[index] = 'a'
	}
	return len(data), nil
}
