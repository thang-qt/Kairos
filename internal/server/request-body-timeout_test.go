package server

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

func (recorder *readDeadlineRecorder) SetReadDeadline(deadline time.Time) error {
	recorder.deadlines = append(recorder.deadlines, deadline)
	return nil
}

func TestRequestBodyTimeoutUsesRouteSpecificDeadlines(t *testing.T) {
	for _, test := range []struct {
		path   string
		method string
		want   time.Duration
	}{
		{path: "/api/auth/login", method: http.MethodPost, want: requestBodyReadTimeout},
		{path: "/api/imports/chatgpt", method: http.MethodPost, want: importBodyReadTimeout},
		{path: "/api/imports", method: http.MethodPost, want: requestBodyReadTimeout},
	} {
		t.Run(test.path, func(t *testing.T) {
			recorder := &readDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
			handler := withRequestBodyTimeout(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
			before := time.Now()
			handler.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if len(recorder.deadlines) != 2 || !recorder.deadlines[1].IsZero() {
				t.Fatalf("deadlines = %v, want one deadline followed by a cleared deadline", recorder.deadlines)
			}
			wantMin := before.Add(test.want)
			if recorder.deadlines[0].Before(wantMin.Add(-time.Second)) {
				t.Fatalf("read deadline = %v, want approximately %v", recorder.deadlines[0], wantMin)
			}
			if recorder.deadlines[0].After(wantMin.Add(time.Second)) {
				t.Fatalf("read deadline = %v, want approximately %v", recorder.deadlines[0], wantMin)
			}
		})
	}
}
