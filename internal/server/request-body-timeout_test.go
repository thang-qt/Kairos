package server

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type readDeadlineRecorder struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func TestRequestBodyTimeoutInterruptsSlowSocketBody(t *testing.T) {
	handler := withRequestBodyTimeouts(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, err := io.ReadAll(request.Body)
		if err != nil {
			writer.WriteHeader(http.StatusRequestTimeout)
			return
		}
		writer.WriteHeader(http.StatusOK)
	}), 100*time.Millisecond, time.Second)
	server := httptest.NewServer(handler)
	defer server.Close()

	reader, writer := io.Pipe()
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/login", reader)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	done := make(chan *http.Response, 1)
	clientErr := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if requestErr != nil {
			clientErr <- requestErr
			return
		}
		done <- response
	}()
	if _, err := io.WriteString(writer, `{"email":"slow@example.invalid"`); err != nil {
		t.Fatal(err)
	}
	time.Sleep(250 * time.Millisecond)
	_ = writer.Close()

	select {
	case response := <-done:
		defer response.Body.Close()
		if response.StatusCode != http.StatusRequestTimeout {
			t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusRequestTimeout)
		}
	case err := <-clientErr:
		t.Fatal(fmt.Errorf("HTTP request failed: %w", err))
	case <-time.After(3 * time.Second):
		t.Fatal("request did not stop after the body read deadline")
	}
}

func TestRequestBodyTimeoutBoundsEarlyReturnDrain(t *testing.T) {
	handler := withRequestBodyTimeouts(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}), 100*time.Millisecond, time.Second)
	server := httptest.NewServer(handler)
	defer server.Close()

	connection, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatalf("dial test server: %v", err)
	}
	defer connection.Close()
	if _, err := io.WriteString(connection, "POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\nConnection: keep-alive\r\n\r\nx"); err != nil {
		t.Fatalf("write partial request: %v", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatalf("read early response: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var probe [1]byte
	if _, err := connection.Read(probe[:]); err == nil {
		t.Fatal("connection remained open after the unread request body deadline")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatalf("connection was not closed by the unread request body deadline: %v", err)
	}
}

func TestBodylessSSERequestHasNoBodyDeadline(t *testing.T) {
	server := httptest.NewServer(withRequestBodyTimeouts(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		time.Sleep(150 * time.Millisecond)
		writer.WriteHeader(http.StatusOK)
	}), 30*time.Millisecond, time.Second))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/sessions/test/events")
	if err != nil {
		t.Fatalf("GET SSE endpoint error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
}

func (recorder *readDeadlineRecorder) SetReadDeadline(deadline time.Time) error {
	recorder.deadlines = append(recorder.deadlines, deadline)
	return nil
}

func TestRequestBodyTimeoutUsesRouteSpecificDeadlines(t *testing.T) {
	for _, test := range []struct {
		path   string
		method string
		want   time.Duration
		body   bool
	}{
		{path: "/api/auth/login", method: http.MethodPost, want: requestBodyReadTimeout, body: true},
		{path: "/api/imports/chatgpt", method: http.MethodPost, want: importBodyReadTimeout, body: true},
		{path: "/api/imports", method: http.MethodPost, want: requestBodyReadTimeout, body: true},
		{path: "/api/sessions/test/events", method: http.MethodGet},
	} {
		t.Run(test.path, func(t *testing.T) {
			recorder := &readDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
			handler := withRequestBodyTimeout(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
			before := time.Now()
			var body io.Reader
			if test.body {
				body = strings.NewReader(`{}`)
			}
			handler.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, body))
			if test.body && (len(recorder.deadlines) != 2 || !recorder.deadlines[0].IsZero()) {
				t.Fatalf("deadlines = %v, want stale-deadline clearing and a body deadline", recorder.deadlines)
			}
			if !test.body && (len(recorder.deadlines) != 1 || !recorder.deadlines[0].IsZero()) {
				t.Fatalf("bodyless request deadlines = %v, want only stale-deadline clearing", recorder.deadlines)
			}
			if !test.body {
				return
			}
			wantMin := before.Add(test.want)
			if recorder.deadlines[1].Before(wantMin.Add(-time.Second)) {
				t.Fatalf("read deadline = %v, want approximately %v", recorder.deadlines[1], wantMin)
			}
			if recorder.deadlines[1].After(wantMin.Add(time.Second)) {
				t.Fatalf("read deadline = %v, want approximately %v", recorder.deadlines[1], wantMin)
			}
		})
	}
}
