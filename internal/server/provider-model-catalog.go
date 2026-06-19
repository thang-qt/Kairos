package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type modelCatalog struct {
	httpClient *http.Client
	ttl        time.Duration
	mu         sync.Mutex
	expiresAt  time.Time
	entries    map[string]modelCatalogEntry
}

func newModelCatalog() *modelCatalog {
	return &modelCatalog{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		ttl:        12 * time.Hour,
		entries:    make(map[string]modelCatalogEntry),
	}
}

func (catalog *modelCatalog) lookupMany(
	ctx context.Context,
	ids []string,
) map[string]modelCatalogEntry {
	result := make(map[string]modelCatalogEntry)
	if len(ids) == 0 {
		return result
	}

	entries, err := catalog.load(ctx, false)
	if err != nil {
		return result
	}

	for _, id := range ids {
		normalizedID := strings.TrimSpace(id)
		if normalizedID == "" {
			continue
		}
		if entry, ok := entries[normalizedID]; ok {
			result[normalizedID] = entry
		}
	}
	return result
}

func (catalog *modelCatalog) load(
	ctx context.Context,
	force bool,
) (map[string]modelCatalogEntry, error) {
	catalog.mu.Lock()
	defer catalog.mu.Unlock()

	if !force && time.Now().Before(catalog.expiresAt) && len(catalog.entries) > 0 {
		return cloneModelCatalogEntries(catalog.entries), nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://models.dev/api.json", nil)
	if err != nil {
		return nil, fmt.Errorf("build models.dev request: %w", err)
	}

	response, err := catalog.httpClient.Do(request)
	if err != nil {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("fetch models.dev catalog: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("fetch models.dev catalog: status %d", response.StatusCode)
	}

	var payload any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("decode models.dev catalog: %w", err)
	}

	entries := make(map[string]modelCatalogEntry)
	extractModelCatalogEntries(payload, entries)
	if len(entries) == 0 {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, errors.New("models.dev catalog was empty")
	}

	catalog.entries = entries
	catalog.expiresAt = time.Now().Add(catalog.ttl)
	return cloneModelCatalogEntries(entries), nil
}

func cloneModelCatalogEntries(
	source map[string]modelCatalogEntry,
) map[string]modelCatalogEntry {
	result := make(map[string]modelCatalogEntry, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func extractModelCatalogEntries(value any, result map[string]modelCatalogEntry) {
	switch typed := value.(type) {
	case map[string]any:
		if entryID, entry, ok := parseModelCatalogEntry(typed); ok {
			result[entryID] = mergeModelCatalogEntries(result[entryID], entry)
		}
		for _, nested := range typed {
			extractModelCatalogEntries(nested, result)
		}
	case []any:
		for _, nested := range typed {
			extractModelCatalogEntries(nested, result)
		}
	}
}

func parseModelCatalogEntry(
	value map[string]any,
) (string, modelCatalogEntry, bool) {
	id := strings.TrimSpace(stringValue(value["id"]))
	if id == "" {
		return "", modelCatalogEntry{}, false
	}

	entry := modelCatalogEntry{
		Name:          strings.TrimSpace(stringValue(value["name"])),
		Description:   strings.TrimSpace(stringValue(value["description"])),
		ContextWindow: catalogInt64Value(value["contextWindow"]),
	}
	if entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(value["context_window"])
	}
	if entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(value["context"])
	}
	if limits, ok := value["limit"].(map[string]any); ok && entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(limits["context"])
	}
	if entry.Name == "" && entry.Description == "" && entry.ContextWindow <= 0 {
		return "", modelCatalogEntry{}, false
	}
	return id, entry, true
}

func mergeModelCatalogEntries(
	current modelCatalogEntry,
	next modelCatalogEntry,
) modelCatalogEntry {
	if strings.TrimSpace(current.Name) == "" && strings.TrimSpace(next.Name) != "" {
		current.Name = strings.TrimSpace(next.Name)
	}
	if len(strings.TrimSpace(next.Description)) > len(strings.TrimSpace(current.Description)) {
		current.Description = strings.TrimSpace(next.Description)
	}
	if next.ContextWindow > current.ContextWindow {
		current.ContextWindow = next.ContextWindow
	}
	return current
}

func applyModelCatalogEntry(
	model ProviderModel,
	entry modelCatalogEntry,
) ProviderModel {
	if strings.TrimSpace(model.Name) == "" && strings.TrimSpace(entry.Name) != "" {
		model.Name = strings.TrimSpace(entry.Name)
	}
	if strings.TrimSpace(model.Description) == "" && strings.TrimSpace(entry.Description) != "" {
		model.Description = strings.TrimSpace(entry.Description)
	}
	if model.ContextWindow <= 0 && entry.ContextWindow > 0 {
		model.ContextWindow = entry.ContextWindow
	}
	return model
}

func catalogInt64Value(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float32:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return parsed
		}
	case string:
		parsed, err := json.Number(strings.TrimSpace(typed)).Int64()
		if err == nil {
			return parsed
		}
	}
	return 0
}
