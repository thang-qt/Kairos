package server

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	requestBodyReadTimeout = 30 * time.Second
	importBodyReadTimeout  = 10 * time.Minute
)

// withRequestBodyTimeout bounds how long a client can keep a connection open
// while sending a request body. Imports receive a longer window for large ZIPs.
func withRequestBodyTimeout(next http.Handler) http.Handler {
	return withRequestBodyTimeouts(next, requestBodyReadTimeout, importBodyReadTimeout)
}

func withRequestBodyTimeouts(next http.Handler, ordinaryTimeout time.Duration, importTimeout time.Duration) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		controller := http.NewResponseController(writer)
		// A prior early-return request may have left its deadline active while
		// net/http drained the body after the handler returned.
		_ = controller.SetReadDeadline(time.Time{})
		if requestBodyIsEmpty(request) {
			next.ServeHTTP(writer, request)
			return
		}

		timeout := ordinaryTimeout
		if strings.HasPrefix(request.URL.Path, "/api/imports/") && request.Method == http.MethodPost {
			timeout = importTimeout
		}
		if err := controller.SetReadDeadline(time.Now().Add(timeout)); err == nil {
			var clearOnce sync.Once
			clearDeadline := func() { clearOnce.Do(func() { _ = controller.SetReadDeadline(time.Time{}) }) }
			body := &deadlineRequestBody{ReadCloser: request.Body, clearDeadline: clearDeadline}
			request.Body = body
		}
		next.ServeHTTP(writer, request)
	})
}

func requestBodyIsEmpty(request *http.Request) bool {
	return request.Body == nil || request.Body == http.NoBody || (request.ContentLength == 0 && len(request.TransferEncoding) == 0)
}

type deadlineRequestBody struct {
	io.ReadCloser
	clearDeadline func()
	readEOF       bool
	closed        bool
}

func (body *deadlineRequestBody) Read(buffer []byte) (int, error) {
	n, err := body.ReadCloser.Read(buffer)
	if err == io.EOF {
		body.readEOF = true
		body.clearDeadline()
	}
	return n, err
}

func (body *deadlineRequestBody) Close() error {
	err := body.ReadCloser.Close()
	body.closed = true
	body.clearDeadline()
	return err
}

func (body *deadlineRequestBody) finished() bool { return body.readEOF || body.closed }
