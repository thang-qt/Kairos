package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const modelsDevURL = "https://models.dev/api.json"
const modelsDevMaxBytes = 16 << 20

// Catalog pricing belongs to the catalog provider, not necessarily the configured endpoint.
type ModelCatalogMetadata struct {
	Source   string          `json:"source"`
	Provider string          `json:"provider"`
	Match    string          `json:"match"`
	Model    json.RawMessage `json:"model"`
}

type modelsDevEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CanonicalID string `json:"canonical_model_id"`
	Limit       struct {
		Context int64 `json:"context"`
	} `json:"limit"`
}
type modelsDevProvider struct {
	API    string                     `json:"api"`
	Models map[string]json.RawMessage `json:"models"`
}
type modelsDevMatch struct {
	provider string
	entry    modelsDevEntry
	raw      json.RawMessage
}
type modelsDevCatalog struct {
	providers map[string]modelsDevProvider
	hosts     map[string]string
	entries   []modelsDevMatch
}

type modelsDevCache struct {
	mu         sync.Mutex
	refreshMu  sync.Mutex
	loaded     bool
	catalog    *modelsDevCatalog
	fetchedAt  int64
	retryAfter time.Time
	url        string
	client     *http.Client
}

func newModelsDevCache() *modelsDevCache {
	return &modelsDevCache{url: modelsDevURL, client: &http.Client{Timeout: 5 * time.Second}}
}

func parseModelsDevCatalog(data []byte) (*modelsDevCatalog, error) {
	var providers map[string]modelsDevProvider
	if err := json.Unmarshal(data, &providers); err != nil {
		return nil, err
	}
	catalog := &modelsDevCatalog{providers: providers, hosts: make(map[string]string)}
	for provider, values := range providers {
		catalog.hosts[provider] = catalogHost(values.API)
		for id, raw := range values.Models {
			var entry modelsDevEntry
			if err := json.Unmarshal(raw, &entry); err != nil {
				return nil, err
			}
			if entry.ID == "" {
				entry.ID = id
			}
			catalog.entries = append(catalog.entries, modelsDevMatch{provider: provider, entry: entry, raw: raw})
		}
	}
	if len(catalog.entries) == 0 {
		return nil, fmt.Errorf("models.dev catalog contains no models")
	}
	sort.Slice(catalog.entries, func(i, j int) bool {
		a, b := catalog.entries[i], catalog.entries[j]
		if a.provider != b.provider {
			return a.provider < b.provider
		}
		return a.entry.ID < b.entry.ID
	})
	return catalog, nil
}

func (cache *modelsDevCache) load(ctx context.Context, db *sql.DB) *modelsDevCatalog {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if !cache.loaded {
		var data []byte
		var fetchedAt int64
		if err := db.QueryRowContext(ctx, `SELECT catalog_json,fetched_at FROM model_catalog WHERE id=1`).Scan(&data, &fetchedAt); err == nil {
			if catalog, err := parseModelsDevCatalog(data); err == nil {
				cache.catalog = catalog
				cache.fetchedAt = fetchedAt
			}
		} else if ctx.Err() != nil {
			return nil
		}
		cache.loaded = true
	}
	return cache.catalog
}

// Refresh only during model discovery; failures retain the last good catalog.
func (cache *modelsDevCache) refresh(ctx context.Context, db *sql.DB) {
	if cache.url == "" {
		return
	}
	cache.refreshMu.Lock()
	defer cache.refreshMu.Unlock()
	cache.load(ctx, db)
	cache.mu.Lock()
	fresh := cache.fetchedAt > time.Now().Add(-24*time.Hour).UnixMilli() || time.Now().Before(cache.retryAfter)
	cache.mu.Unlock()
	if fresh {
		return
	}
	data, err := cache.fetch(ctx)
	var catalog *modelsDevCatalog
	if err == nil {
		catalog, err = parseModelsDevCatalog(data)
	}
	fetchedAt := time.Now().UnixMilli()
	if err == nil {
		_, err = db.ExecContext(ctx, `INSERT INTO model_catalog(id,catalog_json,fetched_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET catalog_json=excluded.catalog_json,fetched_at=excluded.fetched_at`, string(data), fetchedAt)
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if err != nil {
		cache.retryAfter = time.Now().Add(10 * time.Minute)
		return
	}
	cache.catalog = catalog
	cache.fetchedAt = fetchedAt
	cache.retryAfter = time.Time{}
}

func (cache *modelsDevCache) fetch(ctx context.Context) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cache.url, nil)
	if err != nil {
		return nil, err
	}
	response, err := cache.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("models.dev returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, modelsDevMaxBytes+1))
	if len(data) > modelsDevMaxBytes {
		return nil, fmt.Errorf("models.dev catalog exceeds size limit")
	}
	return data, err
}

func catalogHost(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Host)
}

func (catalog *modelsDevCatalog) match(modelID, baseURL string) (modelsDevMatch, string, bool) {
	// The endpoint's host selects provider-specific limits and prices. Do not infer providers from labels.
	host := catalogHost(baseURL)
	local := []modelsDevMatch{}
	for _, candidate := range catalog.entries {
		if host != "" && catalog.hosts[candidate.provider] == host && (candidate.entry.ID == modelID || candidate.entry.CanonicalID == modelID) {
			local = append(local, candidate)
		}
	}
	if len(local) == 1 {
		return local[0], "provider", true
	}
	if len(local) > 1 {
		return modelsDevMatch{}, "", false
	}
	// Qualified IDs must match exactly; never strip version, quantization or context suffixes.
	matches := []modelsDevMatch{}
	for _, candidate := range catalog.entries {
		if candidate.entry.ID == modelID || candidate.provider+"/"+candidate.entry.ID == modelID || candidate.entry.CanonicalID == modelID {
			matches = append(matches, candidate)
		}
	}
	if len(matches) == 1 {
		return matches[0], "exact", true
	}
	// Duplicate listings can resolve to their explicit canonical owner. Otherwise abstain.
	canonical := ""
	for _, candidate := range matches {
		if candidate.entry.CanonicalID == "" {
			return modelsDevMatch{}, "", false
		}
		if canonical != "" && canonical != candidate.entry.CanonicalID {
			return modelsDevMatch{}, "", false
		}
		canonical = candidate.entry.CanonicalID
	}
	if canonical != "" {
		for _, candidate := range catalog.entries {
			if candidate.provider+"/"+candidate.entry.ID == canonical {
				return candidate, "canonical", true
			}
		}
	}
	return modelsDevMatch{}, "", false
}

func (service *ProviderService) enrichFromCatalog(ctx context.Context, userID string, models []ProviderModel) []ProviderModel {
	catalog := service.catalog.load(ctx, service.db)
	if catalog == nil {
		return models
	}
	// Resolve endpoint identity without fetching models or contacting any provider.
	baseURLs := map[string]string{}
	for _, model := range models {
		if _, ok := baseURLs[model.ProviderRef]; ok {
			continue
		}
		if service.system != nil && model.ProviderRef == "system:"+service.system.ID {
			baseURLs[model.ProviderRef] = service.system.BaseURL
			continue
		}
		var baseURL string
		_ = service.db.QueryRowContext(ctx, `SELECT base_url FROM user_providers WHERE id=? AND user_id=?`, strings.TrimPrefix(model.ProviderRef, "user:"), userID).Scan(&baseURL)
		baseURLs[model.ProviderRef] = baseURL
	}
	result := append([]ProviderModel(nil), models...)
	for i, model := range result {
		match, kind, ok := catalog.match(model.ID, baseURLs[model.ProviderRef])
		if !ok {
			continue
		}
		model.CatalogMetadata = &ModelCatalogMetadata{Source: "https://models.dev", Provider: match.provider, Match: kind, Model: match.raw}
		if strings.TrimSpace(model.Name) == "" || (!model.IsCustom && model.Name == model.ID) {
			model.Name = match.entry.Name
		}
		if model.Description == "" {
			model.Description = match.entry.Description
		}
		if model.ContextWindow <= 0 {
			model.ContextWindow = maxInt64(match.entry.Limit.Context, 0)
		}
		result[i] = model
	}
	return result
}
