package server

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	openrouter "github.com/revrost/go-openrouter"
)

type countingProviderDriver struct {
	mu     sync.Mutex
	models []ProviderModel
	calls  int
}

func (driver *countingProviderDriver) Kind() string {
	return openRouterProviderKind
}

func (driver *countingProviderDriver) ListModels(
	_ context.Context,
	_ resolvedProvider,
) ([]ProviderModel, error) {
	driver.mu.Lock()
	defer driver.mu.Unlock()

	driver.calls++
	return append([]ProviderModel(nil), driver.models...), nil
}

func (driver *countingProviderDriver) GenerateChatStream(
	_ context.Context,
	_ resolvedProvider,
	_ ChatGenerationRequest,
	_ func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	return ChatGenerationResult{}, nil
}

func (driver *countingProviderDriver) setModels(models []ProviderModel) {
	driver.mu.Lock()
	defer driver.mu.Unlock()

	driver.models = append([]ProviderModel(nil), models...)
}

func (driver *countingProviderDriver) callCount() int {
	driver.mu.Lock()
	defer driver.mu.Unlock()

	return driver.calls
}

func TestBuildOpenRouterChatRequestUsesProviderNeutralTools(t *testing.T) {
	request := buildOpenRouterChatRequest(ChatGenerationRequest{
		Model:    "openai/gpt-5.2",
		Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "What happened today?"}}}},
		Tools:    buildRuntimeTools(true, true),
	})

	if len(request.Tools) != 3 {
		t.Fatalf("tools length = %d, want 3", len(request.Tools))
	}
	seen := make(map[string]bool)
	for index, tool := range request.Tools {
		if tool.Type != openrouter.ToolTypeFunction {
			t.Fatalf("tool %d type = %q, want function", index, tool.Type)
		}
		if tool.Function != nil {
			seen[tool.Function.Name] = true
		}
	}
	for _, name := range []string{mathEvalToolName, webSearchToolName, webFetchToolName} {
		if !seen[name] {
			t.Fatalf("missing function tool %q in %#v", name, seen)
		}
	}
	if len(request.Plugins) != 0 {
		t.Fatalf("plugins length = %d, want 0", len(request.Plugins))
	}
}

func TestBuildOpenRouterChatRequestOmitsAdvancedOptionsByDefault(t *testing.T) {
	request := buildOpenRouterChatRequest(ChatGenerationRequest{
		Model:    "openai/gpt-5.2",
		Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "Hello"}}}},
	})

	if request.Reasoning != nil {
		t.Fatal("reasoning = set, want nil")
	}
	if request.Temperature != 0 {
		t.Fatalf("temperature = %v, want zero", request.Temperature)
	}
	if request.TopP != 0 {
		t.Fatalf("top_p = %v, want zero", request.TopP)
	}
	if request.TopK != 0 {
		t.Fatalf("top_k = %v, want zero", request.TopK)
	}
	if request.MaxTokens != 0 {
		t.Fatalf("max_tokens = %v, want zero", request.MaxTokens)
	}
	if request.FrequencyPenalty != 0 {
		t.Fatalf("frequency_penalty = %v, want zero", request.FrequencyPenalty)
	}
	if request.PresencePenalty != 0 {
		t.Fatalf("presence_penalty = %v, want zero", request.PresencePenalty)
	}
}

func TestBuildOpenRouterChatRequestAppliesAdvancedOptions(t *testing.T) {
	temperature := float32(0.8)
	topP := float32(0.9)
	topK := 40
	frequencyPenalty := float32(0.2)
	presencePenalty := float32(0.3)
	maxTokens := 2048

	request := buildOpenRouterChatRequest(ChatGenerationRequest{
		Model:    "openai/gpt-5.2",
		Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "Hello"}}}},
		Advanced: &ChatAdvancedOptions{
			Reasoning: &ChatReasoningOptions{
				Effort: "high",
			},
			Sampling: &ChatSamplingOptions{
				Temperature: &temperature,
				TopP:        &topP,
				TopK:        &topK,
			},
			Penalties: &ChatPenaltyOptions{
				FrequencyPenalty: &frequencyPenalty,
				PresencePenalty:  &presencePenalty,
			},
			MaxTokens: &maxTokens,
		},
	})

	if request.Reasoning == nil || request.Reasoning.Effort == nil {
		t.Fatal("reasoning effort = nil, want high")
	}
	if *request.Reasoning.Effort != "high" {
		t.Fatalf("reasoning effort = %q, want high", *request.Reasoning.Effort)
	}
	if request.Temperature != temperature {
		t.Fatalf("temperature = %v, want %v", request.Temperature, temperature)
	}
	if request.TopP != topP {
		t.Fatalf("top_p = %v, want %v", request.TopP, topP)
	}
	if request.TopK != topK {
		t.Fatalf("top_k = %v, want %v", request.TopK, topK)
	}
	if request.FrequencyPenalty != frequencyPenalty {
		t.Fatalf("frequency_penalty = %v, want %v", request.FrequencyPenalty, frequencyPenalty)
	}
	if request.PresencePenalty != presencePenalty {
		t.Fatalf("presence_penalty = %v, want %v", request.PresencePenalty, presencePenalty)
	}
	if request.MaxTokens != maxTokens {
		t.Fatalf("max_tokens = %v, want %v", request.MaxTokens, maxTokens)
	}
}

func TestBuildOpenAIChatRequestOmitsAdvancedOptionsByDefault(t *testing.T) {
	request := buildOpenAIChatRequest(ChatGenerationRequest{
		Model:    "gpt-5.2",
		Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "Hello"}}}},
	})

	if request.ReasoningEffort != "" {
		t.Fatalf("reasoning_effort = %q, want empty", request.ReasoningEffort)
	}
	if request.Temperature != nil {
		t.Fatalf("temperature = %v, want nil", *request.Temperature)
	}
	if request.TopP != nil {
		t.Fatalf("top_p = %v, want nil", *request.TopP)
	}
	if request.MaxTokens != nil {
		t.Fatalf("max_tokens = %v, want nil", *request.MaxTokens)
	}
	if request.FrequencyPenalty != nil {
		t.Fatalf("frequency_penalty = %v, want nil", *request.FrequencyPenalty)
	}
	if request.PresencePenalty != nil {
		t.Fatalf("presence_penalty = %v, want nil", *request.PresencePenalty)
	}
}

func TestBuildOpenAIChatRequestAppliesSupportedAdvancedOptions(t *testing.T) {
	temperature := float32(0.8)
	topP := float32(0.9)
	topK := 40
	frequencyPenalty := float32(0.2)
	presencePenalty := float32(0.3)
	maxTokens := 2048

	request := buildOpenAIChatRequest(ChatGenerationRequest{
		Model:    "gpt-5.2",
		Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "Hello"}}}},
		Advanced: &ChatAdvancedOptions{
			Reasoning: &ChatReasoningOptions{
				Effort: "high",
			},
			Sampling: &ChatSamplingOptions{
				Temperature: &temperature,
				TopP:        &topP,
				TopK:        &topK,
			},
			Penalties: &ChatPenaltyOptions{
				FrequencyPenalty: &frequencyPenalty,
				PresencePenalty:  &presencePenalty,
			},
			MaxTokens: &maxTokens,
		},
	})

	if request.ReasoningEffort != "high" {
		t.Fatalf("reasoning_effort = %q, want high", request.ReasoningEffort)
	}
	if request.Temperature == nil || *request.Temperature != temperature {
		t.Fatalf("temperature = %v, want %v", request.Temperature, temperature)
	}
	if request.TopP == nil || *request.TopP != topP {
		t.Fatalf("top_p = %v, want %v", request.TopP, topP)
	}
	if request.FrequencyPenalty == nil || *request.FrequencyPenalty != frequencyPenalty {
		t.Fatalf("frequency_penalty = %v, want %v", request.FrequencyPenalty, frequencyPenalty)
	}
	if request.PresencePenalty == nil || *request.PresencePenalty != presencePenalty {
		t.Fatalf("presence_penalty = %v, want %v", request.PresencePenalty, presencePenalty)
	}
	if request.MaxTokens == nil || *request.MaxTokens != maxTokens {
		t.Fatalf("max_tokens = %v, want %v", request.MaxTokens, maxTokens)
	}
}

func TestCreateListUpdateAndDeleteProvider(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "providers@example.com")

	createResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/providers", CreateProviderInput{
		Label:   "My OpenRouter",
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

func TestModelListReturnsEmptyArrayWhenNoModelsAvailable(t *testing.T) {
	testServer := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, testServer, "empty-models@example.com")

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)

	var payload modelsResponse
	decodeResponseJSON(t, response, &payload)
	if payload.Models == nil {
		t.Fatal("models = nil, want empty array")
	}
	if len(payload.Models) != 0 {
		t.Fatalf("models count = %d, want 0", len(payload.Models))
	}
}

func TestPreferencesPersistTitleGenerationSettings(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderStaticModels = []string{"chat-model", "title-model"}
	})
	cookie := signupAndRequireCookie(t, testServer, "preferences-title@example.com")

	updateResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodPatch,
		"/api/me/preferences",
		UpdateUserPreferencesInput{
			AutoGenerateTitle:      boolPointer(true),
			UseSeparateTitleModel:  boolPointer(true),
			TitleGenerationModelID: stringPointer("title-model"),
		},
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, updateResponse, http.StatusOK)

	var updated preferencesResponse
	decodeResponseJSON(t, updateResponse, &updated)
	if !updated.Preferences.AutoGenerateTitle {
		t.Fatal("autoGenerateTitle = false, want true")
	}
	if !updated.Preferences.UseSeparateTitleModel {
		t.Fatal("useSeparateTitleModel = false, want true")
	}
	if updated.Preferences.TitleGenerationModelID != "title-model" {
		t.Fatalf(
			"titleGenerationModelId = %q, want title-model",
			updated.Preferences.TitleGenerationModelID,
		)
	}

	getResponse := performJSONRequest(
		t,
		testServer.handler,
		http.MethodGet,
		"/api/me/preferences",
		nil,
		[]*http.Cookie{cookie},
	)
	assertStatusCode(t, getResponse, http.StatusOK)

	var loaded preferencesResponse
	decodeResponseJSON(t, getResponse, &loaded)
	if !loaded.Preferences.AutoGenerateTitle {
		t.Fatal("loaded autoGenerateTitle = false, want true")
	}
	if !loaded.Preferences.UseSeparateTitleModel {
		t.Fatal("loaded useSeparateTitleModel = false, want true")
	}
	if loaded.Preferences.TitleGenerationModelID != "title-model" {
		t.Fatalf(
			"loaded titleGenerationModelId = %q, want title-model",
			loaded.Preferences.TitleGenerationModelID,
		)
	}
}

func TestModelListAppliesProviderAndUserMetadata(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
	})
	testServer.app.providers.drivers[openRouterProviderKind] = &countingProviderDriver{
		models: []ProviderModel{
			{
				ID:            "gpt-4.1-mini",
				Object:        "model",
				OwnedBy:       "openai",
				Name:          "GPT-4.1 Mini",
				Description:   "Provider description",
				ContextWindow: 1_000_000,
				ProviderRef:   "system:system-default",
				ProviderLabel: "Server Default",
			},
		},
	}

	cookie := signupAndRequireCookie(t, testServer, "model-metadata@example.com")

	response := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, response, http.StatusOK)

	var initial modelsResponse
	decodeResponseJSON(t, response, &initial)
	if initial.Models[0].Name != "GPT-4.1 Mini" {
		t.Fatalf("model name = %q, want provider name", initial.Models[0].Name)
	}
	if initial.Models[0].Description != "Provider description" {
		t.Fatalf("model description = %q, want provider description", initial.Models[0].Description)
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

func TestModelListUsesPersistedProviderModelsCache(t *testing.T) {
	driver := &countingProviderDriver{
		models: []ProviderModel{
			{
				ID:      "gpt-4.1-mini",
				Object:  "model",
				OwnedBy: "Server Default",
			},
		},
	}
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
	})
	testServer.app.providers.drivers[openRouterProviderKind] = driver

	cookie := signupAndRequireCookie(t, testServer, "cached-models@example.com")

	firstResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, firstResponse, http.StatusOK)

	var firstPayload modelsResponse
	decodeResponseJSON(t, firstResponse, &firstPayload)
	if len(firstPayload.Models) != 1 || firstPayload.Models[0].ID != "gpt-4.1-mini" {
		t.Fatalf("first payload models = %#v, want cached system model", firstPayload.Models)
	}
	if driver.callCount() != 1 {
		t.Fatalf("driver calls after first load = %d, want 1", driver.callCount())
	}

	secondResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, secondResponse, http.StatusOK)

	var secondPayload modelsResponse
	decodeResponseJSON(t, secondResponse, &secondPayload)
	if len(secondPayload.Models) != 1 || secondPayload.Models[0].ID != "gpt-4.1-mini" {
		t.Fatalf("second payload models = %#v, want cached system model", secondPayload.Models)
	}
	if driver.callCount() != 1 {
		t.Fatalf("driver calls after cached load = %d, want 1", driver.callCount())
	}
}

func TestManualModelSyncRefreshesPersistedProviderModels(t *testing.T) {
	driver := &countingProviderDriver{
		models: []ProviderModel{
			{
				ID:      "gpt-4.1-mini",
				Object:  "model",
				OwnedBy: "Server Default",
			},
		},
	}
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
	})
	testServer.app.providers.drivers[openRouterProviderKind] = driver

	cookie := signupAndRequireCookie(t, testServer, "manual-model-sync@example.com")

	initialResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, initialResponse, http.StatusOK)
	if driver.callCount() != 1 {
		t.Fatalf("driver calls after initial load = %d, want 1", driver.callCount())
	}

	driver.setModels([]ProviderModel{
		{
			ID:      "gpt-5-thinking",
			Object:  "model",
			OwnedBy: "Server Default",
		},
	})

	syncResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/models/sync", nil, []*http.Cookie{cookie})
	assertStatusCode(t, syncResponse, http.StatusOK)

	var syncPayload modelsResponse
	decodeResponseJSON(t, syncResponse, &syncPayload)
	if len(syncPayload.Models) != 1 || syncPayload.Models[0].ID != "gpt-5-thinking" {
		t.Fatalf("sync payload models = %#v, want refreshed model", syncPayload.Models)
	}
	if driver.callCount() != 2 {
		t.Fatalf("driver calls after manual sync = %d, want 2", driver.callCount())
	}

	cachedResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, cachedResponse, http.StatusOK)

	var cachedPayload modelsResponse
	decodeResponseJSON(t, cachedResponse, &cachedPayload)
	if len(cachedPayload.Models) != 1 || cachedPayload.Models[0].ID != "gpt-5-thinking" {
		t.Fatalf("cached payload models = %#v, want refreshed cached model", cachedPayload.Models)
	}
	if driver.callCount() != 2 {
		t.Fatalf("driver calls after cached reload = %d, want 2", driver.callCount())
	}
}

func stringPointer(value string) *string {
	return &value
}

func boolPointer(value bool) *bool {
	return &value
}

func TestCustomModelAddAndDelete(t *testing.T) {
	testServer := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderLabel = "Server Default"
		config.SystemProviderID = "default"
	})

	cookie := signupAndRequireCookie(t, testServer, "custom-models@example.com")

	// 1. Add a custom model to the system provider (system:default)
	addPayload := CreateModelInput{
		ProviderRef:   "system:default",
		ModelID:       "custom-llama-3",
		Name:          "My Custom Llama",
		Description:   "A custom model description",
		ContextWindow: 4096,
	}

	addResponse := performJSONRequest(t, testServer.handler, http.MethodPost, "/api/models", addPayload, []*http.Cookie{cookie})
	assertStatusCode(t, addResponse, http.StatusCreated)

	var addResult modelMutationResponse
	decodeResponseJSON(t, addResponse, &addResult)
	if addResult.Model.ID != "custom-llama-3" || !addResult.Model.IsCustom || addResult.Model.Name != "My Custom Llama" {
		t.Fatalf("unexpected added model metadata: %#v", addResult.Model)
	}
	if addResult.Model.Created <= 0 || addResult.Model.Created > time.Now().Unix()+1 {
		t.Fatalf("custom model created timestamp = %d, want unix seconds", addResult.Model.Created)
	}

	if _, err := testServer.app.db.Exec(`
		UPDATE provider_models
		SET created = created * 1000
		WHERE provider_ref = ? AND model_id = ?
	`, "system:default", "custom-llama-3"); err != nil {
		t.Fatalf("seed legacy custom model created timestamp error = %v", err)
	}

	// 2. List models and verify it exists
	listResponse := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse, http.StatusOK)

	var listPayload modelsResponse
	decodeResponseJSON(t, listResponse, &listPayload)
	found := false
	for _, m := range listPayload.Models {
		if m.ID == "custom-llama-3" {
			found = true
			if !m.IsCustom || m.ContextWindow != 4096 {
				t.Fatalf("custom model loaded incorrectly: %#v", m)
			}
			if m.Created <= 0 || m.Created > time.Now().Unix()+1 {
				t.Fatalf("custom model created timestamp = %d, want normalized unix seconds", m.Created)
			}
			break
		}
	}
	if !found {
		t.Fatal("custom model not found in models list")
	}

	// 3. Delete the custom model
	deleteResponse := performJSONRequest(t, testServer.handler, http.MethodDelete, "/api/models?providerRef=system:default&modelId=custom-llama-3", nil, []*http.Cookie{cookie})
	assertStatusCode(t, deleteResponse, http.StatusOK)

	// 4. List models again and verify it is gone
	listResponse2 := performJSONRequest(t, testServer.handler, http.MethodGet, "/api/models", nil, []*http.Cookie{cookie})
	assertStatusCode(t, listResponse2, http.StatusOK)

	decodeResponseJSON(t, listResponse2, &listPayload)
	for _, m := range listPayload.Models {
		if m.ID == "custom-llama-3" {
			t.Fatal("custom model was not deleted")
		}
	}
}
