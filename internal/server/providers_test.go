package server

import (
	"net/http"
	"testing"
	"time"
)

func TestCreateListUpdateAndDeleteProvider(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "providers@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/providers", CreateProviderInput{
		Label:   "My OpenAI",
		BaseURL: "https://example.com/v1",
		APIKey:  "sk-test",
	}, []*http.Cookie{cookie})
	assertStatusCode(t, createResponse, http.StatusCreated)

	var created providerMutationResponse
	decodeResponseJSON(t, createResponse, &created)
	if created.Provider.ID == "" {
		t.Fatal("provider id = empty, want populated value")
	}
	if created.Provider.Owner != "user" {
		t.Fatalf("provider owner = %q, want user", created.Provider.Owner)
	}

	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/providers", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var providers providersResponse
	decodeResponseJSON(t, listResponse, &providers)
	if len(providers.Providers) != 1 {
		t.Fatalf("providers count = %d, want 1", len(providers.Providers))
	}

	enabled := false
	updateResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/providers/"+created.Provider.ID, UpdateProviderInput{
		Enabled: &enabled,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateResponse, http.StatusOK)

	var updated providerMutationResponse
	decodeResponseJSON(t, updateResponse, &updated)
	if updated.Provider.Enabled {
		t.Fatal("updated provider enabled = true, want false")
	}

	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/providers/"+created.Provider.ID, nil, []*http.Cookie{cookie})
	assertStatusCode(t, deleteResponse, http.StatusOK)
}

func TestSystemProviderCannotBeMutated(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"gpt-4.1-mini"}
	})
	cookie := signupAndRequireCookie(t, testServer, "system-provider@example.com")

	response := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/providers/system:system-default", UpdateProviderInput{
		Label: stringPointer("Nope"),
	}, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusForbidden)
}

func TestModelListUsesSystemProviderStaticModels(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"gpt-4.1-mini"}
	})
	cookie := signupAndRequireCookie(t, testServer, "models@example.com")

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)

	var payload modelsResponse
	decodeResponseJSON(t, response, &payload)
	if len(payload.Models) != 1 {
		t.Fatalf("models count = %d, want 1", len(payload.Models))
	}
	if payload.Models[0].ID != "gpt-4.1-mini" {
		t.Fatalf("model id = %q, want gpt-4.1-mini", payload.Models[0].ID)
	}
}

func TestModelListAppliesCatalogAndUserMetadata(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"gpt-4.1-mini"}
	})
	testServer.app.providers.modelCatalog = &modelCatalog{
		httpClient: nil,
		ttl:        time.Hour,
		entries: map[string]modelCatalogEntry{
			"gpt-4.1-mini": {
				Name:          "GPT-4.1 Mini",
				Description:   "Catalog description",
				ContextWindow: 1_000_000,
			},
		},
	}
	testServer.app.providers.modelCatalog.expiresAt = time.Now().Add(time.Hour)

	cookie := signupAndRequireCookie(t, testServer, "model-metadata@example.com")

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)

	var initial modelsResponse
	decodeResponseJSON(t, response, &initial)
	if initial.Models[0].Name != "GPT-4.1 Mini" {
		t.Fatalf("model name = %q, want catalog name", initial.Models[0].Name)
	}
	if initial.Models[0].ContextWindow != 1_000_000 {
		t.Fatalf("context window = %d, want 1000000", initial.Models[0].ContextWindow)
	}

	updatedName := "My GPT-4.1 Mini"
	updatedDescription := "Custom description"
	updatedContextWindow := int64(256_000)
	updateResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/models/metadata", UpdateModelMetadataInput{
		ModelID:       "gpt-4.1-mini",
		Name:          &updatedName,
		Description:   &updatedDescription,
		ContextWindow: &updatedContextWindow,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateResponse, http.StatusOK)

	var mutation modelMutationResponse
	decodeResponseJSON(t, updateResponse, &mutation)
	if mutation.Model.Name != updatedName {
		t.Fatalf("updated model name = %q, want %q", mutation.Model.Name, updatedName)
	}
	if mutation.Model.Description != updatedDescription {
		t.Fatalf("updated model description = %q, want %q", mutation.Model.Description, updatedDescription)
	}
	if mutation.Model.ContextWindow != updatedContextWindow {
		t.Fatalf("updated context window = %d, want %d", mutation.Model.ContextWindow, updatedContextWindow)
	}

	response = performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)

	var persisted modelsResponse
	decodeResponseJSON(t, response, &persisted)
	if persisted.Models[0].Name != updatedName {
		t.Fatalf("persisted model name = %q, want %q", persisted.Models[0].Name, updatedName)
	}
}

func stringPointer(value string) *string {
	return &value
}
