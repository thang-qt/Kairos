package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	webSearchToolName = "web_search"
	webFetchToolName  = "web_fetch"
	exaAPIKeyEnvVar   = "EXA_API_KEY"
	exaSearchURL      = "https://api.exa.ai/search"
	exaContentsURL    = "https://api.exa.ai/contents"
)

const exaMaxSnippetCharacters = 300
const exaMaxFetchCharacters = 10000
const defaultWebSearchMaxResults = 5

type WebToolRuntime struct {
	httpClient         *http.Client
	exaAPIKey          string
	searchMaxResults   int
	fetchMaxCharacters int
}

type WebToolRuntimeConfig struct {
	ExaAPIKey          string
	SearchMaxResults   int
	FetchMaxCharacters int
}

type WebToolResult struct {
	Content string
	Details map[string]any
}

func NewWebToolRuntimeFromEnv() *WebToolRuntime {
	return NewWebToolRuntime(WebToolRuntimeConfig{ExaAPIKey: strings.TrimSpace(os.Getenv(exaAPIKeyEnvVar))})
}

func NewWebToolRuntime(config WebToolRuntimeConfig) *WebToolRuntime {
	searchMaxResults := config.SearchMaxResults
	if searchMaxResults <= 0 {
		searchMaxResults = defaultWebSearchMaxResults
	}
	fetchMaxCharacters := config.FetchMaxCharacters
	if fetchMaxCharacters <= 0 {
		fetchMaxCharacters = exaMaxFetchCharacters
	}
	return &WebToolRuntime{
		httpClient:         &http.Client{Timeout: 30 * time.Second},
		exaAPIKey:          strings.TrimSpace(config.ExaAPIKey),
		searchMaxResults:   clampInt(searchMaxResults, 1, 10),
		fetchMaxCharacters: clampInt(fetchMaxCharacters, 1000, 50000),
	}
}

func buildWebTools(enabled bool) []ProviderTool {
	if !enabled {
		return nil
	}
	return []ProviderTool{
		{
			Name:        webSearchToolName,
			Description: "Search the web for current information. Returns concise Exa search results with title, URL, and snippet.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query":       map[string]any{"type": "string", "description": "Search query."},
					"max_results": map[string]any{"type": "integer", "description": "Maximum number of results to return.", "minimum": 1, "maximum": 10},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:        webFetchToolName,
			Description: "Fetch readable text content for a URL using Exa contents.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string", "description": "URL to fetch."},
				},
				"required": []string{"url"},
			},
		},
	}
}

func (runtime *WebToolRuntime) Execute(ctx context.Context, call ProviderToolCall) (WebToolResult, error) {
	if runtime == nil {
		return WebToolResult{}, errors.New("web tool runtime is not configured")
	}
	args := call.Args
	if len(args) == 0 && strings.TrimSpace(call.ArgsJSON) != "" {
		args = parseToolCallArguments(call.ArgsJSON)
	}
	switch strings.TrimSpace(call.Name) {
	case webSearchToolName:
		query := strings.TrimSpace(stringFromAny(args["query"]))
		if query == "" {
			return WebToolResult{}, errors.New("web_search query is required")
		}
		maxResults := intFromAny(args["max_results"], runtime.searchMaxResults)
		if maxResults < 1 {
			maxResults = runtime.searchMaxResults
		}
		if maxResults > runtime.searchMaxResults {
			maxResults = runtime.searchMaxResults
		}
		return runtime.searchExa(ctx, query, maxResults)
	case webFetchToolName:
		url := strings.TrimSpace(stringFromAny(args["url"]))
		if url == "" {
			return WebToolResult{}, errors.New("web_fetch url is required")
		}
		return runtime.fetchExa(ctx, url)
	default:
		return WebToolResult{}, fmt.Errorf("unknown tool: %s", call.Name)
	}
}

func (runtime *WebToolRuntime) searchExa(ctx context.Context, query string, maxResults int) (WebToolResult, error) {
	if strings.TrimSpace(runtime.exaAPIKey) == "" {
		return WebToolResult{}, fmt.Errorf("%s is not set", exaAPIKeyEnvVar)
	}
	payload := map[string]any{
		"query":      query,
		"numResults": maxResults,
		"contents":   map[string]any{"text": map[string]any{"maxCharacters": exaMaxSnippetCharacters}},
	}
	var response exaResponse
	if err := runtime.postExa(ctx, exaSearchURL, payload, &response); err != nil {
		return WebToolResult{}, err
	}
	results := make([]map[string]any, 0, len(response.Results))
	for _, result := range response.Results {
		results = append(results, map[string]any{
			"title":   strings.TrimSpace(result.Title),
			"url":     strings.TrimSpace(result.URL),
			"snippet": strings.TrimSpace(result.Text),
		})
	}
	output := map[string]any{"query": query, "results": results}
	content, _ := json.Marshal(output)
	return WebToolResult{Content: string(content), Details: output}, nil
}

func (runtime *WebToolRuntime) fetchExa(ctx context.Context, url string) (WebToolResult, error) {
	if strings.TrimSpace(runtime.exaAPIKey) == "" {
		return WebToolResult{}, fmt.Errorf("%s is not set", exaAPIKeyEnvVar)
	}
	payload := map[string]any{
		"ids":  []string{url},
		"text": map[string]any{"maxCharacters": runtime.fetchMaxCharacters},
	}
	var response exaResponse
	if err := runtime.postExa(ctx, exaContentsURL, payload, &response); err != nil {
		return WebToolResult{}, err
	}
	if len(response.Results) == 0 || strings.TrimSpace(response.Results[0].Text) == "" {
		return WebToolResult{}, fmt.Errorf("Exa fetch returned no content for %s", url)
	}
	result := response.Results[0]
	output := map[string]any{
		"url":         url,
		"title":       strings.TrimSpace(result.Title),
		"contentType": "text/plain",
		"text":        strings.TrimSpace(result.Text),
	}
	content, _ := json.Marshal(output)
	return WebToolResult{Content: string(content), Details: output}, nil
}

func (runtime *WebToolRuntime) postExa(ctx context.Context, url string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-api-key", strings.TrimSpace(runtime.exaAPIKey))
	response, err := runtime.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		return fmt.Errorf("Exa API error (%s): %s", response.Status, strings.TrimSpace(string(data)))
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode Exa response: %w", err)
	}
	return nil
}

type exaResponse struct {
	Results []exaResult `json:"results"`
	Error   string      `json:"error"`
}

type exaResult struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Text  string `json:"text"`
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func intFromAny(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed)
		}
	}
	return fallback
}
