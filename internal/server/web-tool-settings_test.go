package server

import (
	"context"
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
