package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const catalogFixture = `{
 "hyper":{"api":"https://hyper.charm.land/v1","models":{"flash":{"id":"flash","name":"Hyper Flash","description":"Catalog description","canonical_model_id":"maker/flash","reasoning":true,"tool_call":true,"modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":1000,"output":200},"cost":{"input":0.33,"output":1.31}}}},
 "maker":{"api":"https://maker.example/v1","models":{"flash":{"id":"flash","name":"Maker Flash","canonical_model_id":"maker/flash","limit":{"context":2000},"cost":{"input":0.1}}}},
 "other":{"api":"https://other.example/v1","models":{"collision":{"id":"collision","name":"Other Collision"}}},
 "third":{"api":"https://third.example/v1","models":{"collision":{"id":"collision","name":"Third Collision"}}}
}`

func TestModelsDevMatching(t *testing.T) {
	catalog, err := parseModelsDevCatalog([]byte(catalogFixture))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ id, base, provider, kind string }{
		{"flash", "https://hyper.charm.land/v1/", "hyper", "provider"},
		{"flash", "https://maker.example/v1", "maker", "provider"},
		{"flash", "https://custom.example/v1", "maker", "canonical"},
		{"maker/flash", "https://custom.example/v1", "maker", "canonical"},
		{"collision", "https://custom.example/v1", "", ""},
		{"flash-2026-01-01", "https://hyper.charm.land/v1", "", ""},
		{"flash:32k", "https://hyper.charm.land/v1", "", ""},
		{"flash", "https://hyper.charm.land.evil.example/v1", "maker", "canonical"},
		{"collision", "https://other.example/v1", "other", "provider"},
	}
	for _, c := range cases {
		t.Run(c.id+c.base, func(t *testing.T) {
			match, kind, ok := catalog.match(c.id, c.base)
			if ok != (c.provider != "") || match.provider != c.provider || kind != c.kind {
				t.Fatalf("got %q %q %v, want %q %q", match.provider, kind, ok, c.provider, c.kind)
			}
		})
	}
}

func TestModelsDevSyncPersistenceOverridesAndOutage(t *testing.T) {
	var calls atomic.Int32
	var offline atomic.Bool
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if offline.Load() {
			http.Error(w, "offline", 503)
			return
		}
		w.Write([]byte(catalogFixture))
	}))
	defer endpoint.Close()
	app := newTestApp(t, func(c *Config) {
		c.SystemProviderEnabled = true
		c.SystemProviderBaseURL = "https://hyper.charm.land/v1"
	})
	service := app.app.providers
	service.catalog.url = endpoint.URL
	service.drivers[openAIProviderKind] = &countingProviderDriver{models: []ProviderModel{{ID: "flash", Name: "flash"}, {ID: "collision", Name: "collision"}}}
	cookie := signupAndRequireCookie(t, app, "catalog@example.com")
	syncModels := func() modelsResponse {
		t.Helper()
		r := performJSONRequest(t, app.handler, http.MethodPost, "/api/models/sync", nil, []*http.Cookie{cookie})
		assertStatusCode(t, r, 200)
		var p modelsResponse
		decodeResponseJSON(t, r, &p)
		return p
	}
	payload := syncModels()
	model := payload.Models[1]
	if model.ID != "flash" || model.Name != "Hyper Flash" || model.Description != "Catalog description" || model.ContextWindow != 1000 || model.CatalogMetadata == nil || model.CatalogMetadata.Provider != "hyper" {
		t.Fatalf("bad enrichment: %#v", model)
	}
	if payload.Models[0].CatalogMetadata != nil {
		t.Fatal("ambiguous model enriched")
	}
	var raw map[string]any
	if err := json.Unmarshal(model.CatalogMetadata.Model, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["reasoning"] != true || raw["cost"].(map[string]any)["input"] != 0.33 {
		t.Fatalf("missing capabilities/pricing: %v", raw)
	}
	syncModels()
	if calls.Load() != 1 {
		t.Fatalf("fresh catalog fetched %d times", calls.Load())
	}
	// Recreate the catalog cache to exercise SQLite recovery without network access.
	service.catalog = newModelsDevCache()
	service.catalog.url = ""
	r := performJSONRequest(t, app.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, r, 200)
	var restored modelsResponse
	decodeResponseJSON(t, r, &restored)
	if restored.Models[1].CatalogMetadata == nil || restored.Models[1].Name != "Hyper Flash" {
		t.Fatal("catalog did not survive cache restart")
	}
	name, description, limit := "My Flash", "My description", int64(9000)
	r = performJSONRequest(t, app.handler, http.MethodPatch, "/api/models/metadata", UpdateModelMetadataInput{ModelID: "flash", Name: &name, Description: &description, ContextWindow: &limit}, []*http.Cookie{cookie})
	assertStatusCode(t, r, 200)
	var updated struct {
		Model ProviderModel `json:"model"`
	}
	decodeResponseJSON(t, r, &updated)
	if updated.Model.Name != name || updated.Model.Description != description || updated.Model.ContextWindow != limit || updated.Model.CatalogMetadata == nil {
		t.Fatalf("override lost: %#v", updated.Model)
	}
	// Failed refresh keeps persisted and in-memory good metadata, with bounded retry pressure.
	offline.Store(true)
	service.catalog.url = endpoint.URL
	service.catalog.fetchedAt = time.Now().Add(-25 * time.Hour).UnixMilli()
	payload = syncModels()
	syncModels()
	if calls.Load() != 2 || payload.Models[1].Name != name || payload.Models[1].CatalogMetadata.Provider != "hyper" {
		t.Fatal("outage dropped metadata or retried without backoff")
	}
}

func TestModelsDevPreservesProviderAndCustomMetadata(t *testing.T) {
	app := newTestApp(t, nil)
	service := app.app.providers
	catalog, err := parseModelsDevCatalog([]byte(catalogFixture))
	if err != nil {
		t.Fatal(err)
	}
	service.catalog.loaded = true
	service.catalog.catalog = catalog
	models := service.enrichFromCatalog(context.Background(), "unused", []ProviderModel{{ID: "flash", Name: "Provider name", Description: "Provider description", ContextWindow: 8000}, {ID: "flash", Name: "Custom name", IsCustom: true}})
	if models[0].Name != "Provider name" || models[0].Description != "Provider description" || models[0].ContextWindow != 8000 || models[1].Name != "Custom name" {
		t.Fatalf("provider/custom metadata overwritten: %#v", models)
	}
}

func TestModelsDevInvalidCatalogNeverReplacesGoodData(t *testing.T) {
	for _, body := range []string{`{}`, `not json`, `{"provider":{"models":{"bad":false}}}`} {
		if _, err := parseModelsDevCatalog([]byte(body)); err == nil {
			t.Fatalf("accepted invalid catalog %s", body)
		}
	}
}
