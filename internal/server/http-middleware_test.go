package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommonMiddlewareCachePolicies(t *testing.T) {
	app := &App{}
	handler := app.withCommonMiddleware(http.HandlerFunc(
		func(writer http.ResponseWriter, request *http.Request) {
			_, _ = writer.Write([]byte("ok"))
		},
	))

	testCases := []struct {
		name       string
		path       string
		wantPolicy string
	}{
		{name: "api", path: "/api/health", wantPolicy: noStorePolicy},
		{name: "hashed asset", path: "/assets/app-abc123.js", wantPolicy: immutableAssetPolicy},
		{name: "manifest", path: "/manifest.json", wantPolicy: staticAssetPolicy},
		{name: "service worker", path: "/sw.js", wantPolicy: noCachePolicy},
		{name: "application route", path: "/chat/example", wantPolicy: noCachePolicy},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, testCase.path, nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if got := recorder.Header().Get("Cache-Control"); got != testCase.wantPolicy {
				t.Fatalf("Cache-Control = %q, want %q", got, testCase.wantPolicy)
			}
		})
	}
}

func TestFrontendHandlerDoesNotFallbackForMissingAssets(t *testing.T) {
	app := &App{}
	request := httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil)
	recorder := httptest.NewRecorder()

	app.frontendHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf(
			"missing asset status = %d, want %d",
			recorder.Code,
			http.StatusNotFound,
		)
	}
}

func TestCommonMiddlewareCompressesTextResponses(t *testing.T) {
	app := &App{}
	responseBody := strings.Repeat("Kairos cached response. ", 100)
	handler := app.withCommonMiddleware(http.HandlerFunc(
		func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = writer.Write([]byte(responseBody))
		},
	))
	request := httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil)
	request.Header.Set("Accept-Encoding", "br, gzip")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := recorder.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
	reader, err := gzip.NewReader(recorder.Body)
	if err != nil {
		t.Fatalf("open gzip response: %v", err)
	}
	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read gzip response: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close gzip response: %v", err)
	}
	if got := string(decompressed); got != responseBody {
		t.Fatalf("decompressed body length = %d, want %d", len(got), len(responseBody))
	}
}

func TestCommonMiddlewareSkipsStreamingAndBinaryCompression(t *testing.T) {
	testCases := []string{
		"/api/sessions/example/events",
		"/assets/font.woff2",
		"/cover.jpg",
	}

	for _, pathname := range testCases {
		request := httptest.NewRequest(http.MethodGet, pathname, nil)
		request.Header.Set("Accept-Encoding", "gzip")
		if shouldCompressResponse(request) {
			t.Fatalf("shouldCompressResponse(%q) = true, want false", pathname)
		}
	}
}

func TestAcceptsEncodingHonorsDisabledGzip(t *testing.T) {
	if acceptsEncoding("br, gzip;q=0", "gzip") {
		t.Fatal("acceptsEncoding disabled gzip = true, want false")
	}
}
