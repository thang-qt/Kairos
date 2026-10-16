package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestChatConfigurationEquivalentClientsAndOverrides(t *testing.T) {
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
		config.SystemProviderLabel = "Fake"
	})
	cookie := signupAndRequireCookie(t, app, "config@example.com")
	user := userIDFromCookie(t, app, cookie)
	captured := make(chan ChatGenerationRequest, 4)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, _ int, request ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		captured <- request
		return ChatGenerationResult{OutputText: "done"}, nil
	}}
	settings := defaultConversationSettings()
	settings.Model, settings.SystemPrompt = "test-model", " Saved instructions "
	settings.WebSearch, settings.MathTools = false, false
	settings.Advanced.Sampling, settings.Advanced.Temperature, settings.Advanced.MaxTokens = true, 1.2, true
	sessions := make([]SessionSummary, 3)
	for i := range sessions {
		session, err := app.app.conversations.CreateSessionWithSettings(context.Background(), user, "Config", settings)
		if err != nil {
			t.Fatal(err)
		}
		sessions[i] = session
	}
	requests := []map[string]any{
		{"message": "same", "idempotencyKey": "minimal"},
		{"message": "same", "idempotencyKey": "web", "model": "test-model", "systemPrompt": "Saved instructions", "webSearch": false, "mathTools": false, "advanced": advancedOptionsFromSettings(settings.Advanced)},
		{"message": "same", "idempotencyKey": "explicit-empty", "systemPrompt": "", "advanced": map[string]any{}, "webSearch": false, "mathTools": false},
	}
	results := make([]SubmitTurnResult, len(requests))
	for i, request := range requests {
		response := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions/"+sessions[i].FriendlyID+"/messages", request, []*http.Cookie{cookie})
		assertStatusCode(t, response, http.StatusOK)
		decodeResponseJSON(t, response, &results[i])
		waitForRunStatus(t, app, results[i].RunID, "completed")
	}
	if !reflect.DeepEqual(results[0].EffectiveConfiguration, results[1].EffectiveConfiguration) {
		t.Fatalf("client drift: %+v versus %+v", results[0].EffectiveConfiguration, results[1].EffectiveConfiguration)
	}
	if results[2].EffectiveConfiguration.SystemPrompt != "" || results[2].EffectiveConfiguration.Advanced != nil {
		t.Fatal("explicit empty overrides inherited settings")
	}
	first, second, third := <-captured, <-captured, <-captured
	if first.Model != second.Model || !reflect.DeepEqual(first.Advanced, second.Advanced) || third.Advanced != nil {
		t.Fatal("provider requests differ from effective configuration")
	}
	history, err := app.app.conversations.GetHistory(context.Background(), user, sessions[0].FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(history.Messages[1]["effectiveConfiguration"])
	var restored EffectiveChatConfiguration
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(&restored, results[0].EffectiveConfiguration) {
		t.Fatal("snapshot configuration differs from acknowledgement")
	}
	// Settings changed after acceptance cannot alter idempotent replay.
	settings.SystemPrompt = "Changed afterwards"
	if _, err := app.app.conversations.UpdateConversationSettings(context.Background(), user, sessions[0].FriendlyID, settings); err != nil {
		t.Fatal(err)
	}
	replay := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions/"+sessions[0].FriendlyID+"/messages", requests[0], []*http.Cookie{cookie})
	assertStatusCode(t, replay, http.StatusOK)
	var repeated SubmitTurnResult
	decodeResponseJSON(t, replay, &repeated)
	if repeated.RunID != results[0].RunID || !reflect.DeepEqual(repeated.EffectiveConfiguration, results[0].EffectiveConfiguration) {
		t.Fatal("idempotent replay changed accepted configuration")
	}
}

func TestChatConfigurationDefaultsLegacyAndCapabilities(t *testing.T) {
	var partial ConversationSettings
	if err := json.Unmarshal([]byte(`{"webSearch":false,"advanced":{"sampling":true,"temperature":8}}`), &partial); err != nil {
		t.Fatal(err)
	}
	partial = normalizeConversationSettings(partial)
	if partial.WebSearch || !partial.MathTools || partial.Advanced.Temperature != 2 || partial.Advanced.TopP != 1 || partial.Advanced.MaxTokensValue != 4096 {
		t.Fatalf("partial settings defaults: %+v", partial)
	}
	legacy, err := decodeConversationSettings(`{"unknownLegacyField":true,"advanced":{"reasoningEffort":"old","topK":1500.7,"maxTokensValue":-4}}`)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Advanced.ReasoningEffort != "medium" || legacy.Advanced.TopK != 1000 || legacy.Advanced.MaxTokensValue != 1 || !legacy.WebSearch {
		t.Fatalf("legacy normalization: %+v", legacy)
	}
	model := ProviderModel{ID: "test", CatalogMetadata: &ModelCatalogMetadata{Match: "provider", Model: json.RawMessage(`{"reasoning":true,"reasoning_options":[{"type":"effort","values":["low","high"]}]}`)}}
	settings := defaultConversationSettings()
	settings.Advanced.Reasoning = true
	normalized := normalizeSettingsForModel(settings, model)
	if normalized.Advanced.ReasoningEffort != "low" {
		t.Fatal("saved effort was not normalized to supported effort")
	}
	if err := validateChatAdvancedOptions(model, &ChatAdvancedOptions{Reasoning: &ChatReasoningOptions{Effort: "medium"}}); !errors.Is(err, errInvalidChatConfiguration) {
		t.Fatal("explicit unsupported effort accepted")
	}
	model.CatalogMetadata.Model = json.RawMessage(`{"reasoning":false}`)
	if normalizeSettingsForModel(settings, model).Advanced.Reasoning {
		t.Fatal("unsupported reasoning enabled")
	}
	for _, invalid := range []string{`{"sampling":{"temperature":3}}`, `{"sampling":{"topP":-1}}`, `{"sampling":{"topK":1001}}`, `{"penalties":{"frequencyPenalty":3}}`, `{"maxTokens":0}`, `{"reasoning":{"effort":"unknown"}}`} {
		var options ChatAdvancedOptions
		if err := json.Unmarshal([]byte(invalid), &options); err != nil {
			t.Fatal(err)
		}
		if !errors.Is(validateChatAdvancedOptions(ProviderModel{}, &options), errInvalidChatConfiguration) {
			t.Fatalf("invalid configuration bypassed validation: %s", invalid)
		}
	}
}

func TestChatConfigurationEditRetryAndEphemeral(t *testing.T) {
	app, user, session := runtimeFixture(t)
	captured := make(chan ChatGenerationRequest, 4)
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, request ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		captured <- request
		if n == 2 {
			return ChatGenerationResult{}, errors.New("edit failed")
		}
		return ChatGenerationResult{OutputText: "done"}, nil
	}}
	settings := defaultConversationSettings()
	settings.WebSearch, settings.MathTools, settings.SystemPrompt = false, false, "original"
	if _, err := app.app.conversations.UpdateConversationSettings(context.Background(), user, session.FriendlyID, settings); err != nil {
		t.Fatal(err)
	}
	first, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, Message: "first", ConfigurationFields: map[string]bool{}})
	if err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, first.RunID, "completed")
	settings.SystemPrompt = "edit settings"
	if _, err := app.app.conversations.UpdateConversationSettings(context.Background(), user, session.FriendlyID, settings); err != nil {
		t.Fatal(err)
	}
	edited, err := app.app.runtime.StartRun(context.Background(), user, SubmitTurnInput{FriendlyID: session.FriendlyID, EditMessageID: first.UserTurnID, Message: "edited", ConfigurationFields: map[string]bool{}})
	if err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, edited.RunID, "error")
	settings.SystemPrompt = "changed before retry"
	if _, err := app.app.conversations.UpdateConversationSettings(context.Background(), user, session.FriendlyID, settings); err != nil {
		t.Fatal(err)
	}
	retried, err := app.app.runtime.RetryRun(context.Background(), user, session.FriendlyID, edited.RunID, "retry-config", nil)
	if err != nil {
		t.Fatal(err)
	}
	if retried.EffectiveConfiguration.SystemPrompt != "edit settings" {
		t.Fatal("retry re-resolved current settings")
	}
	waitForRunStatus(t, app, edited.RunID, "completed")
	if err := app.app.runtime.StreamEphemeral(context.Background(), user, nil, SubmitTurnInput{Message: "throwaway", Settings: &settings, ConfigurationFields: map[string]bool{}}, func(event ConversationEvent) error {
		if event.Message != nil && event.Message["effectiveConfiguration"] == nil {
			t.Fatal("ephemeral event lacks effective configuration")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	firstRequest, editRequest, retryRequest := <-captured, <-captured, <-captured
	if !strings.Contains(firstRequest.SystemPrompt, "original") || !strings.Contains(editRequest.SystemPrompt, "edit settings") || !strings.Contains(retryRequest.SystemPrompt, "edit settings") {
		t.Fatal("edit/retry provider configuration drift")
	}
	<-captured
	history, err := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil || len(history.Messages) != 2 {
		t.Fatal("ephemeral generation changed persisted history")
	}
}

func TestChatConfigurationOmittedAndDisabledFields(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	settings := defaultConversationSettings()
	settings.SystemPrompt = "saved"
	settings.Advanced.MaxTokens = true
	for _, test := range []struct {
		body    string
		inherit bool
	}{
		{`{"message":"hello"}`, true},
		{`{"message":"hello","webSearch":false,"mathTools":false,"systemPrompt":"","advanced":{}}`, false},
		{`{"message":"hello","webSearch":false,"mathTools":false,"systemPrompt":"","advanced":null}`, false},
	} {
		var request sendMessageRequest
		if err := json.Unmarshal([]byte(test.body), &request); err != nil {
			t.Fatal(err)
		}
		input, err := app.app.runtime.resolveChatConfiguration(context.Background(), user, settings, SubmitTurnInput{ConfigurationFields: request.configurationFields, Model: request.Model, SystemPrompt: request.SystemPrompt, WebSearch: request.WebSearch, MathTools: request.MathTools, Advanced: request.Advanced})
		if err != nil {
			t.Fatal(err)
		}
		if input.WebSearch != test.inherit || input.MathTools != test.inherit || (input.SystemPrompt == "saved") != test.inherit {
			t.Fatalf("presence lost for %s: %+v", test.body, input)
		}
		enabled := input.Advanced != nil && input.Advanced.MaxTokens != nil
		if enabled != test.inherit {
			t.Fatal("advanced omission and disable are indistinguishable")
		}
	}
}

func TestChatConfigurationRejectsInvalidHTTPWithoutAcceptance(t *testing.T) {
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	cookie := signupAndRequireCookie(t, app, "invalid-config@example.com")
	created := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions", map[string]any{}, []*http.Cookie{cookie})
	assertStatusCode(t, created, http.StatusCreated)
	var session sessionMutationResponse
	decodeResponseJSON(t, created, &session)
	for _, invalid := range []any{
		map[string]any{"sampling": map[string]any{"temperature": 3}},
		map[string]any{"penalties": map[string]any{"presencePenalty": -3}},
		map[string]any{"maxTokens": 0},
		map[string]any{"reasoning": map[string]any{"effort": "unknown"}},
	} {
		response := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions/"+session.FriendlyID+"/messages", map[string]any{"message": "hello", "advanced": invalid}, []*http.Cookie{cookie})
		assertStatusCode(t, response, http.StatusBadRequest)
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_runs`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid command accepted: %d %v", count, err)
	}
	response := performJSONRequest(t, app.handler, http.MethodPatch, "/api/sessions/"+session.FriendlyID+"/settings", map[string]any{"settings": map[string]any{"advanced": map[string]any{"sampling": true, "temperature": 5, "topK": 2.9}}}, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)
	var normalized sessionMutationResponse
	decodeResponseJSON(t, response, &normalized)
	if normalized.Settings.Advanced.Temperature != 2 || normalized.Settings.Advanced.TopK != 2 || !normalized.Settings.MathTools {
		t.Fatal("settings endpoint did not return canonical settings with defaults")
	}
	stored, err := app.app.conversations.GetSessionSummary(context.Background(), userIDFromCookie(t, app, cookie), session.FriendlyID)
	if err != nil || stored.Settings != normalized.Settings {
		t.Fatal("stored settings differ from acknowledged settings")
	}
}

func TestChatConfigurationModelAndProtocolCapabilities(t *testing.T) {
	model := ProviderModel{ID: "limited", CatalogMetadata: &ModelCatalogMetadata{Match: "provider", Model: json.RawMessage(`{"temperature":false,"limit":{"output":1024}}`)}}
	settings := defaultConversationSettings()
	settings.Advanced.MaxTokens, settings.Advanced.MaxTokensValue = true, 8192
	if normalizeSettingsForModel(settings, model).Advanced.MaxTokensValue != 1024 {
		t.Fatal("saved output limit exceeds model capability")
	}
	temperature := float32(0.4)
	if !errors.Is(validateChatAdvancedOptions(model, &ChatAdvancedOptions{Sampling: &ChatSamplingOptions{Temperature: &temperature}}), errInvalidChatConfiguration) {
		t.Fatal("explicit unsupported temperature accepted")
	}
	maximum := 8192
	if !errors.Is(validateChatAdvancedOptions(model, &ChatAdvancedOptions{MaxTokens: &maximum}), errInvalidChatConfiguration) {
		t.Fatal("explicit output limit exceeds model capability")
	}
	topK := 20
	options := &ChatAdvancedOptions{Sampling: &ChatSamplingOptions{TopK: &topK}, Penalties: &ChatPenaltyOptions{}}
	effective := advancedOptionsForProvider(resolvedProvider{Record: ProviderRecord{Kind: openAIProviderKind, UseResponsesAPI: true}}, options)
	if effective != nil || options.Sampling.TopK == nil {
		t.Fatal("effective options do not match protocol capabilities or mutated preferences")
	}
}

func TestChatConfigurationNewConversationUsesAccountAndModelDefaults(t *testing.T) {
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
	})
	cookie := signupAndRequireCookie(t, app, "defaults-config@example.com")
	user := userIDFromCookie(t, app, cookie)
	settings := defaultConversationSettings()
	settings.SystemPrompt = "account default"
	if _, err := app.app.providers.UpdateDefaultChatSettings(context.Background(), user, settings); err != nil {
		t.Fatal(err)
	}
	preset := settings
	preset.SystemPrompt, preset.MathTools, preset.Advanced.Sampling, preset.Advanced.Temperature = "model preset", false, true, 1.1
	if _, err := app.app.providers.UpdateModelChatSettings(context.Background(), user, "test-model", preset); err != nil {
		t.Fatal(err)
	}
	response := performJSONRequest(t, app.handler, http.MethodPost, "/api/sessions", map[string]any{}, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusCreated)
	var session sessionMutationResponse
	decodeResponseJSON(t, response, &session)
	if session.Settings.SystemPrompt != "model preset" || session.Settings.MathTools || session.Settings.Advanced.Temperature != 1.1 || session.Settings.Model == "" {
		t.Fatalf("new session requires client default/model resolution: %+v", session.Settings)
	}
	initial, err := app.app.providers.InitialChatSettings(context.Background(), user, "")
	if err != nil || initial != session.Settings {
		t.Fatal("ephemeral and persisted initial defaults differ")
	}
}

func TestChatConfigurationBackendModelFallback(t *testing.T) {
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"a-model", "z-model"}
		config.DefaultChatModel = "z-model"
	})
	cookie := signupAndRequireCookie(t, app, "model-fallback@example.com")
	user := userIDFromCookie(t, app, cookie)
	// Simulate a formerly valid saved default from a provider that was removed.
	if _, err := app.app.db.Exec(`UPDATE user_preferences SET default_model_id=? WHERE user_id=?`, "user:removed:old-model", user); err != nil {
		t.Fatal(err)
	}
	_, selected, _, err := app.app.providers.ResolveGenerationTarget(context.Background(), user, "")
	if err != nil || selected.ID != "z-model" {
		t.Fatalf("automatic selection skipped server fallback: %s %v", selected.ID, err)
	}
	settings := defaultConversationSettings()
	settings.Model = "user:removed:old-model"
	input, err := app.app.runtime.resolveChatConfiguration(context.Background(), user, settings, SubmitTurnInput{ConfigurationFields: map[string]bool{}})
	if err != nil || !strings.HasSuffix(input.Model, ":z-model") {
		t.Fatalf("inherited unavailable model failed to fall back: %s %v", input.Model, err)
	}
	for _, invalid := range []string{"user:removed:old-model", "system::"} {
		if _, _, _, err := app.app.providers.ResolveGenerationTarget(context.Background(), user, invalid); !errors.Is(err, errModelNotAvailable) {
			t.Fatalf("invalid explicit target accepted: %s %v", invalid, err)
		}
	}
}
