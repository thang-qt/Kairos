package server

import (
	"context"
	"net/http"
	"testing"
)

func TestWebToolSettingsUseConfiguredDefaultAndUserToolCallLimit(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.MaxToolCalls = 48
	})
	user, _, _, err := testServer.app.auth.Signup(
		context.Background(),
		"tool-settings@example.com",
		"tracepass123",
		RequestMeta{},
	)
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}

	settings, err := testServer.app.webTools.GetSettings(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("GetSettings() error = %v", err)
	}
	if settings.ToolCallLimit != 48 {
		t.Fatalf("default tool call limit = %d, want 48", settings.ToolCallLimit)
	}

	limit := 12
	settings, err = testServer.app.webTools.UpdateSettings(context.Background(), user.ID, UpdateWebToolSettingsInput{
		ToolCallLimit: &limit,
	})
	if err != nil {
		t.Fatalf("UpdateSettings() error = %v", err)
	}
	if settings.ToolCallLimit != limit {
		t.Fatalf("saved tool call limit = %d, want %d", settings.ToolCallLimit, limit)
	}

	resolvedLimit, err := testServer.app.webTools.ResolveToolCallLimit(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("ResolveToolCallLimit() error = %v", err)
	}
	if resolvedLimit != limit {
		t.Fatalf("resolved tool call limit = %d, want %d", resolvedLimit, limit)
	}
}

func TestLoadConfigToolCallLimit(t *testing.T) {
	t.Setenv("MAX_TOOL_CALLS", "")
	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if config.MaxToolCalls != defaultMaxToolCalls {
		t.Fatalf("default max tool calls = %d, want %d", config.MaxToolCalls, defaultMaxToolCalls)
	}

	t.Setenv("MAX_TOOL_CALLS", "48")
	config, err = LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if config.MaxToolCalls != 48 {
		t.Fatalf("configured max tool calls = %d, want 48", config.MaxToolCalls)
	}
}

func TestWebToolSettingsSelectsOnlyEnabledConfiguredProviders(t *testing.T) {
	testServer := newTestApp(t, nil)
	user, _, _, err := testServer.app.auth.Signup(context.Background(), "providers@example.com", "tracepass123", RequestMeta{})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}
	tinyKey, exaKey := "tiny-key", "exa-key"
	tinyEnabled, exaEnabled := true, false
	defaultTiny := "tinyfish"
	settings, err := testServer.app.webTools.UpdateSettings(context.Background(), user.ID, UpdateWebToolSettingsInput{
		Provider: &defaultTiny,
		Providers: []UpdateWebToolProviderInput{
			{Provider: "tinyfish", APIKey: &tinyKey, Enabled: &tinyEnabled},
			{Provider: "exa", APIKey: &exaKey, Enabled: &exaEnabled},
		},
	})
	if err != nil {
		t.Fatalf("UpdateSettings() error = %v", err)
	}
	if settings.Provider != "tinyfish" {
		t.Fatalf("default provider = %q, want tinyfish", settings.Provider)
	}
	runtime, err := testServer.app.webTools.ResolveRuntime(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("ResolveRuntime() error = %v", err)
	}
	if _, err := runtime.provider("exa"); err == nil {
		t.Fatal("disabled Exa provider was selectable")
	}
	if _, err := runtime.provider("tinyfish"); err != nil {
		t.Fatalf("enabled TinyFish provider unavailable: %v", err)
	}
}

func TestLegacyWebToolSettingsEndpointsExposeAndUpdateExaSettings(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "legacy-web-tools@example.com")

	updateResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/me/web-tools", map[string]any{
		"provider":    " ",
		"apiKey":      "legacy-exa-key",
		"clearApiKey": false,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, updateResponse, http.StatusOK)

	getResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/me/web-tools", nil, []*http.Cookie{cookie})
	assertStatusCode(t, getResponse, http.StatusOK)
	var response map[string]map[string]any
	decodeResponseJSON(t, getResponse, &response)
	settings := response["settings"]
	if settings["provider"] != "exa" {
		t.Fatalf("legacy provider = %#v, want exa", settings["provider"])
	}
	if settings["apiKeyConfigured"] != true {
		t.Fatalf("legacy apiKeyConfigured = %#v, want true", settings["apiKeyConfigured"])
	}

	clearResponse := performJSONRequest(t, testServer.handler, http.MethodPatch, "/api/me/web-tools", map[string]any{
		"provider":    "exa",
		"clearApiKey": true,
	}, []*http.Cookie{cookie})
	assertStatusCode(t, clearResponse, http.StatusOK)
	var cleared map[string]map[string]any
	decodeResponseJSON(t, clearResponse, &cleared)
	if cleared["settings"]["apiKeyConfigured"] != false {
		t.Fatalf("legacy cleared apiKeyConfigured = %#v, want false", cleared["settings"]["apiKeyConfigured"])
	}
}

func TestWebToolSettingsRejectsInvalidPatchWithoutPersistingProviderChanges(t *testing.T) {
	testServer := newTestApp(t, nil)
	user, _, _, err := testServer.app.auth.Signup(context.Background(), "atomic-web-tools@example.com", "tracepass123", RequestMeta{})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}
	exaKey, tinyKey := "exa-key", "tiny-key"
	exaEnabled, tinyEnabled := true, true
	defaultExa := "exa"
	_, err = testServer.app.webTools.UpdateSettings(context.Background(), user.ID, UpdateWebToolSettingsInput{
		Provider: &defaultExa,
		Providers: []UpdateWebToolProviderInput{
			{Provider: "exa", APIKey: &exaKey, Enabled: &exaEnabled},
			{Provider: "tinyfish", APIKey: &tinyKey, Enabled: &tinyEnabled},
		},
	})
	if err != nil {
		t.Fatalf("initial UpdateSettings() error = %v", err)
	}

	defaultTiny := "tinyfish"
	disabled := false
	updatedExaKey, updatedTinyKey := "updated-exa-key", "updated-tiny-key"
	_, err = testServer.app.webTools.UpdateSettings(context.Background(), user.ID, UpdateWebToolSettingsInput{
		Provider: &defaultTiny,
		Providers: []UpdateWebToolProviderInput{
			{Provider: "exa", APIKey: &updatedExaKey, Enabled: &disabled},
			{Provider: "tinyfish", APIKey: &updatedTinyKey, Enabled: &disabled},
		},
	})
	if err == nil {
		t.Fatal("UpdateSettings() succeeded for an unconfigured default provider")
	}

	settings, err := testServer.app.webTools.GetSettings(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("GetSettings() error = %v", err)
	}
	if settings.Provider != "exa" {
		t.Fatalf("default provider after rejected update = %q, want exa", settings.Provider)
	}
	for _, provider := range settings.Providers {
		if !provider.Enabled || !provider.APIKeyConfigured {
			t.Fatalf("provider %#v changed after rejected update", provider)
		}
	}
}
