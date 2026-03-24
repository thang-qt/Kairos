package server

import (
	"net/http"
	"testing"
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

func stringPointer(value string) *string {
	return &value
}
