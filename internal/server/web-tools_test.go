package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTinyFishProviderUsesDocumentedSearchAndFetchContracts(t *testing.T) {
	var sawSearch, sawFetch bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-API-Key") != "tiny-key" {
			t.Errorf("X-API-Key = %q", request.Header.Get("X-API-Key"))
		}
		switch request.URL.Path {
		case "/search":
			sawSearch = true
			if request.Method != http.MethodGet || request.URL.Query().Get("query") != "Kairos" {
				t.Errorf("search request = %s %s", request.Method, request.URL)
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"results": []map[string]any{{"title": "Kairos", "url": "https://example.com", "snippet": "A result"}}})
		case "/fetch":
			sawFetch = true
			var payload map[string]any
			_ = json.NewDecoder(request.Body).Decode(&payload)
			if request.Method != http.MethodPost || payload["format"] != "markdown" {
				t.Errorf("fetch payload = %#v", payload)
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"results": []map[string]any{{"title": "Page", "text": "# Markdown"}}, "errors": []any{}})
		default:
			t.Errorf("unexpected path %s", request.URL.Path)
		}
	}))
	defer server.Close()
	runtime := NewWebToolRuntime(WebToolRuntimeConfig{TinyFishAPIKey: "tiny-key", DefaultProvider: "tinyfish", EnabledProviders: []string{"tinyfish"}, Endpoints: map[string]string{"tinyfish-search": server.URL + "/search", "tinyfish-fetch": server.URL + "/fetch"}})
	search, err := runtime.Execute(context.Background(), ProviderToolCall{Name: webSearchToolName, Args: map[string]any{"query": "Kairos"}})
	if err != nil || search.Details["query"] != "Kairos" {
		t.Fatalf("search = %#v, %v", search, err)
	}
	fetch, err := runtime.Execute(context.Background(), ProviderToolCall{Name: webFetchToolName, Args: map[string]any{"url": "https://example.com"}})
	if err != nil || fetch.Details["contentType"] != "text/markdown" {
		t.Fatalf("fetch = %#v, %v", fetch, err)
	}
	if !sawSearch || !sawFetch {
		t.Fatalf("search/fetch seen = %v/%v", sawSearch, sawFetch)
	}
}

func TestDisabledProviderCannotBeExplicitlySelected(t *testing.T) {
	runtime := NewWebToolRuntime(WebToolRuntimeConfig{ExaAPIKey: "key", DefaultProvider: "exa", EnabledProviders: []string{"exa"}})
	_, err := runtime.Execute(context.Background(), ProviderToolCall{Name: webSearchToolName, Args: map[string]any{"query": "Kairos", "provider": "tinyfish"}})
	if err == nil {
		t.Fatal("disabled provider override unexpectedly succeeded")
	}
}
