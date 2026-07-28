package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	webSearchToolName          = "web_search"
	webFetchToolName           = "web_fetch"
	exaAPIKeyEnvVar            = "EXA_API_KEY"
	tinyFishAPIKeyEnvVar       = "TINYFISH_API_KEY"
	exaSearchURL               = "https://api.exa.ai/search"
	exaContentsURL             = "https://api.exa.ai/contents"
	tinyFishSearchURL          = "https://api.search.tinyfish.ai"
	tinyFishFetchURL           = "https://api.fetch.tinyfish.ai"
	exaMaxSnippetCharacters    = 300
	exaMaxFetchCharacters      = 10000
	tinyFishRequestTimeout     = 2 * time.Minute
	defaultWebSearchMaxResults = 5
)

type WebToolResult struct {
	Content string
	Details map[string]any
}
type webProvider interface {
	Name() string
	Search(context.Context, string, int) (WebToolResult, error)
	Fetch(context.Context, string, int) (WebToolResult, error)
}
type WebToolRuntime struct {
	httpClient         *http.Client
	providers          map[string]webProvider
	defaultProvider    string
	searchMaxResults   int
	fetchMaxCharacters int
}
type WebToolRuntimeConfig struct {
	ExaAPIKey          string
	TinyFishAPIKey     string
	DefaultProvider    string
	EnabledProviders   []string
	SearchMaxResults   int
	FetchMaxCharacters int
	HTTPClient         *http.Client
	Endpoints          map[string]string
}

func NewWebToolRuntimeFromEnv() *WebToolRuntime {
	return NewWebToolRuntime(WebToolRuntimeConfig{ExaAPIKey: os.Getenv(exaAPIKeyEnvVar), TinyFishAPIKey: os.Getenv(tinyFishAPIKeyEnvVar), DefaultProvider: "exa", EnabledProviders: []string{"exa"}})
}
func NewWebToolRuntime(config WebToolRuntimeConfig) *WebToolRuntime {
	searchMax := clampInt(config.SearchMaxResults, 1, 10)
	if config.SearchMaxResults <= 0 {
		searchMax = defaultWebSearchMaxResults
	}
	fetchMax := clampInt(config.FetchMaxCharacters, 1000, 50000)
	if config.FetchMaxCharacters <= 0 {
		fetchMax = exaMaxFetchCharacters
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	endpoint := func(name, fallback string) string {
		if config.Endpoints != nil && config.Endpoints[name] != "" {
			return config.Endpoints[name]
		}
		return fallback
	}
	providers := map[string]webProvider{}
	tinyFishClient := *client
	tinyFishClient.Timeout = tinyFishRequestTimeout
	for _, name := range config.EnabledProviders {
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "exa":
			providers["exa"] = &exaWebProvider{client: client, apiKey: strings.TrimSpace(config.ExaAPIKey), searchURL: endpoint("exa-search", exaSearchURL), fetchURL: endpoint("exa-fetch", exaContentsURL)}
		case "tinyfish":
			providers["tinyfish"] = &tinyFishWebProvider{client: &tinyFishClient, apiKey: strings.TrimSpace(config.TinyFishAPIKey), searchURL: endpoint("tinyfish-search", tinyFishSearchURL), fetchURL: endpoint("tinyfish-fetch", tinyFishFetchURL)}
		}
	}
	defaultProvider := strings.ToLower(strings.TrimSpace(config.DefaultProvider))
	if _, ok := providers[defaultProvider]; !ok {
		for _, name := range []string{"exa", "tinyfish"} {
			if _, ok := providers[name]; ok {
				defaultProvider = name
				break
			}
		}
	}
	return &WebToolRuntime{httpClient: client, providers: providers, defaultProvider: defaultProvider, searchMaxResults: searchMax, fetchMaxCharacters: fetchMax}
}
func buildRuntimeTools(webSearchEnabled bool, mathToolsEnabled bool) []ProviderTool {
	tools := make([]ProviderTool, 0, 3)
	if mathToolsEnabled {
		tools = append(tools, buildMathTools()...)
	}
	if webSearchEnabled {
		tools = append(tools, buildWebTools()...)
	}
	return tools
}
func buildWebTools() []ProviderTool {
	return []ProviderTool{
		{Name: webSearchToolName, Description: "Search the web for current information. Returns concise results with title, URL, and snippet.", Parameters: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string", "description": "Search query."}, "max_results": map[string]any{"type": "integer", "description": "Maximum number of results to return.", "minimum": 1, "maximum": 10}, "provider": map[string]any{"type": "string", "enum": []string{"exa", "tinyfish"}, "description": "Optional enabled web provider override."}}, "required": []string{"query"}}},
		{Name: webFetchToolName, Description: "Fetch readable page content for a URL.", Parameters: map[string]any{"type": "object", "properties": map[string]any{"url": map[string]any{"type": "string", "description": "URL to fetch."}, "provider": map[string]any{"type": "string", "enum": []string{"exa", "tinyfish"}, "description": "Optional enabled web provider override."}}, "required": []string{"url"}}},
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
	if strings.TrimSpace(call.Name) == mathEvalToolName {
		return runtime.evalMathJS(ctx, strings.TrimSpace(stringFromAny(args["expr"])), intFromAny(args["precision"], 0))
	}
	provider, err := runtime.provider(stringFromAny(args["provider"]))
	if err != nil {
		return WebToolResult{}, err
	}
	switch strings.TrimSpace(call.Name) {
	case webSearchToolName:
		query := strings.TrimSpace(stringFromAny(args["query"]))
		if query == "" {
			return WebToolResult{}, errors.New("web_search query is required")
		}
		n := intFromAny(args["max_results"], runtime.searchMaxResults)
		if n < 1 || n > runtime.searchMaxResults {
			n = runtime.searchMaxResults
		}
		return provider.Search(ctx, query, n)
	case webFetchToolName:
		rawURL := strings.TrimSpace(stringFromAny(args["url"]))
		if rawURL == "" {
			return WebToolResult{}, errors.New("web_fetch url is required")
		}
		return provider.Fetch(ctx, rawURL, runtime.fetchMaxCharacters)
	default:
		return WebToolResult{}, fmt.Errorf("unknown tool: %s", call.Name)
	}
}
func (runtime *WebToolRuntime) provider(requested string) (webProvider, error) {
	name := strings.ToLower(strings.TrimSpace(requested))
	if name == "" {
		name = runtime.defaultProvider
	}
	provider := runtime.providers[name]
	if provider == nil {
		return nil, fmt.Errorf("web provider %q is unavailable, disabled, or not configured", name)
	}
	return provider, nil
}

type exaWebProvider struct {
	client                      *http.Client
	apiKey, searchURL, fetchURL string
}

func (p *exaWebProvider) Name() string { return "exa" }
func (p *exaWebProvider) Search(ctx context.Context, q string, n int) (WebToolResult, error) {
	var response exaResponse
	err := postJSON(ctx, p.client, p.searchURL, p.apiKey, "x-api-key", map[string]any{"query": q, "numResults": n, "contents": map[string]any{"text": map[string]any{"maxCharacters": exaMaxSnippetCharacters}}}, &response, "Exa")
	if err != nil {
		return WebToolResult{}, err
	}
	results := make([]map[string]any, 0, len(response.Results))
	for _, r := range response.Results {
		results = append(results, map[string]any{"title": strings.TrimSpace(r.Title), "url": strings.TrimSpace(r.URL), "snippet": strings.TrimSpace(r.Text)})
	}
	return normalizedSearch(q, results)
}
func (p *exaWebProvider) Fetch(ctx context.Context, rawURL string, n int) (WebToolResult, error) {
	var response exaResponse
	err := postJSON(ctx, p.client, p.fetchURL, p.apiKey, "x-api-key", map[string]any{"ids": []string{rawURL}, "text": map[string]any{"maxCharacters": n}}, &response, "Exa")
	if err != nil {
		return WebToolResult{}, err
	}
	if len(response.Results) == 0 || strings.TrimSpace(response.Results[0].Text) == "" {
		return WebToolResult{}, fmt.Errorf("Exa fetch returned no content for %s", rawURL)
	}
	return normalizedFetch(rawURL, response.Results[0].Title, response.Results[0].Text, "text/plain")
}

type tinyFishWebProvider struct {
	client                      *http.Client
	apiKey, searchURL, fetchURL string
}

func (p *tinyFishWebProvider) Name() string { return "tinyfish" }
func (p *tinyFishWebProvider) Search(ctx context.Context, q string, n int) (WebToolResult, error) {
	if strings.TrimSpace(p.apiKey) == "" {
		return WebToolResult{}, fmt.Errorf("%s is not set", tinyFishAPIKeyEnvVar)
	}
	u, err := url.Parse(p.searchURL)
	if err != nil {
		return WebToolResult{}, err
	}
	params := u.Query()
	params.Set("query", q)
	u.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return WebToolResult{}, err
	}
	req.Header.Set("X-API-Key", p.apiKey)
	var response tinyFishSearchResponse
	if err = requestJSON(p.client, req, &response, "TinyFish"); err != nil {
		return WebToolResult{}, err
	}
	results := make([]map[string]any, 0, n)
	for _, r := range response.Results {
		if len(results) == n {
			break
		}
		results = append(results, map[string]any{"title": strings.TrimSpace(r.Title), "url": strings.TrimSpace(r.URL), "snippet": strings.TrimSpace(r.Snippet)})
	}
	return normalizedSearch(q, results)
}
func (p *tinyFishWebProvider) Fetch(ctx context.Context, rawURL string, n int) (WebToolResult, error) {
	var response tinyFishFetchResponse
	err := postJSON(ctx, p.client, p.fetchURL, p.apiKey, "X-API-Key", map[string]any{"urls": []string{rawURL}, "format": "markdown"}, &response, "TinyFish")
	if err != nil {
		return WebToolResult{}, err
	}
	if len(response.Results) == 0 || strings.TrimSpace(response.Results[0].Text) == "" {
		if len(response.Errors) > 0 {
			return WebToolResult{}, fmt.Errorf("TinyFish fetch failed for %s: %s", rawURL, response.Errors[0].Error)
		}
		return WebToolResult{}, fmt.Errorf("TinyFish fetch returned no content for %s", rawURL)
	}
	text := response.Results[0].Text
	if len(text) > n {
		text = text[:n]
	}
	return normalizedFetch(rawURL, response.Results[0].Title, text, "text/markdown")
}
func normalizedSearch(q string, results []map[string]any) (WebToolResult, error) {
	output := map[string]any{"query": q, "results": results}
	data, _ := json.Marshal(output)
	return WebToolResult{Content: string(data), Details: output}, nil
}
func normalizedFetch(rawURL, title, text, contentType string) (WebToolResult, error) {
	output := map[string]any{"url": rawURL, "title": strings.TrimSpace(title), "contentType": contentType, "text": strings.TrimSpace(text)}
	data, _ := json.Marshal(output)
	return WebToolResult{Content: string(data), Details: output}, nil
}
func postJSON(ctx context.Context, client *http.Client, endpoint, key, header string, payload, target any, name string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("%s is not set", map[string]string{"x-api-key": exaAPIKeyEnvVar, "X-API-Key": tinyFishAPIKeyEnvVar}[header])
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(header, key)
	return requestJSON(client, req, target, name)
}
func requestJSON(client *http.Client, request *http.Request, target any, name string) error {
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		return fmt.Errorf("%s API error (%s): %s", name, response.Status, strings.TrimSpace(string(data)))
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode %s response: %w", name, err)
	}
	return nil
}

type exaResponse struct {
	Results []exaResult `json:"results"`
}
type exaResult struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Text  string `json:"text"`
}
type tinyFishSearchResponse struct {
	Results []tinyFishSearchResult `json:"results"`
}
type tinyFishSearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}
type tinyFishFetchResponse struct {
	Results []tinyFishFetchResult `json:"results"`
	Errors  []tinyFishFetchError  `json:"errors"`
}
type tinyFishFetchResult struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}
type tinyFishFetchError struct {
	Error string `json:"error"`
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
