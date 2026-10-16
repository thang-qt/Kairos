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
		timeout := ordinaryTimeout
		if strings.HasPrefix(request.URL.Path, "/api/imports/") && request.Method == http.MethodPost {
			timeout = importTimeout
		}
		controller := http.NewResponseController(writer)
		if err := controller.SetReadDeadline(time.Now().Add(timeout)); err == nil {
			var clearOnce sync.Once
			clearDeadline := func() { clearOnce.Do(func() { _ = controller.SetReadDeadline(time.Time{}) }) }
			request.Body = &deadlineRequestBody{ReadCloser: request.Body, clearDeadline: clearDeadline}
			defer clearDeadline()
		}
		next.ServeHTTP(writer, request)
	})
}

type deadlineRequestBody struct {
	io.ReadCloser
	clearDeadline func()
}

func (body *deadlineRequestBody) Read(buffer []byte) (int, error) {
	n, err := body.ReadCloser.Read(buffer)
	if err == io.EOF {
		body.clearDeadline()
	}
	return n, err
}
