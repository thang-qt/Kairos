package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
)

var errInvalidChatConfiguration = errors.New("invalid chat configuration")

// EffectiveChatConfiguration is frozen when a command is accepted. Clients can
// render it without reimplementing model selection or option normalization.
type EffectiveChatConfiguration struct {
	Model        string               `json:"model"`
	SystemPrompt string               `json:"systemPrompt"`
	WebSearch    bool                 `json:"webSearch"`
	MathTools    bool                 `json:"mathTools"`
	Advanced     *ChatAdvancedOptions `json:"advanced"`
}

// Keep existing request fields and distinguish omission from explicit zero values.
// The aliases retain DisallowUnknownFields, including inside nested objects.
func decodeChatConfigurationRequest(data []byte, target any) (map[string]bool, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return nil, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	fields := make(map[string]bool)
	for _, name := range []string{"model", "systemPrompt", "webSearch", "mathTools", "advanced"} {
		value, exists := raw[name]
		if exists && string(value) == "null" && name != "advanced" {
			return nil, fmt.Errorf("%w: %s must not be null; omit it to inherit", errInvalidChatConfiguration, name)
		}
		fields[name] = exists
	}
	return fields, nil
}

func (request *sendMessageRequest) UnmarshalJSON(data []byte) error {
	type wire sendMessageRequest
	fields, err := decodeChatConfigurationRequest(data, (*wire)(request))
	request.configurationFields = fields
	return err
}
func (request *createSessionRequest) UnmarshalJSON(data []byte) error {
	type wire createSessionRequest
	fields, err := decodeChatConfigurationRequest(data, (*wire)(request))
	request.configurationFields = fields
	return err
}
func (request *ephemeralMessageRequest) UnmarshalJSON(data []byte) error {
	type wire ephemeralMessageRequest
	fields, err := decodeChatConfigurationRequest(data, (*wire)(request))
	request.configurationFields = fields
	return err
}

// Partial settings objects are replacements over server defaults, not patches
// over previous settings. Persisted legacy JSON is decoded separately below.
func (settings *ConversationSettings) UnmarshalJSON(data []byte) error {
	type wire ConversationSettings
	defaults := wire(defaultConversationSettings())
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("%w: settings must be an object", errInvalidChatConfiguration)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&defaults); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for key, value := range fields {
		if string(value) == "null" {
			return fmt.Errorf("%w: settings.%s must not be null", errInvalidChatConfiguration, key)
		}
	}
	if raw, exists := fields["advanced"]; exists {
		var advanced map[string]json.RawMessage
		if err := json.Unmarshal(raw, &advanced); err != nil {
			return err
		}
		for key, value := range advanced {
			if string(value) == "null" {
				return fmt.Errorf("%w: settings.advanced.%s must not be null", errInvalidChatConfiguration, key)
			}
		}
	}
	*settings = ConversationSettings(defaults)
	return nil
}

func normalizeConversationSettings(settings ConversationSettings) ConversationSettings {
	settings.Model = strings.TrimSpace(settings.Model)
	settings.SystemPrompt = strings.TrimSpace(settings.SystemPrompt)
	a := &settings.Advanced
	a.ReasoningEffort = strings.ToLower(strings.TrimSpace(a.ReasoningEffort))
	if !slices.Contains(reasoningEffortValues, a.ReasoningEffort) {
		a.ReasoningEffort = "medium"
	}
	a.Temperature = clampChatNumber(a.Temperature, 0, 2)
	a.TopP = clampChatNumber(a.TopP, 0, 1)
	a.TopK = math.Floor(clampChatNumber(a.TopK, 0, 1000))
	a.FrequencyPenalty = clampChatNumber(a.FrequencyPenalty, -2, 2)
	a.PresencePenalty = clampChatNumber(a.PresencePenalty, -2, 2)
	a.MaxTokensValue = math.Floor(clampChatNumber(a.MaxTokensValue, 1, 200000))
	return settings
}

func clampChatNumber(value, minimum, maximum float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return minimum
	}
	return math.Max(minimum, math.Min(maximum, value))
}

var reasoningEffortValues = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}

func normalizeSettingsForModel(settings ConversationSettings, model ProviderModel) ConversationSettings {
	settings = normalizeConversationSettings(settings)
	_, output := modelGenerationCapabilities(model)
	if output > 0 {
		settings.Advanced.MaxTokensValue = math.Min(settings.Advanced.MaxTokensValue, float64(output))
	}
	if model.CatalogMetadata == nil {
		return settings
	}
	var metadata struct {
		Reasoning *bool `json:"reasoning"`
		Options   []struct {
			Type   string   `json:"type"`
			Values []string `json:"values"`
		} `json:"reasoning_options"`
	}
	if json.Unmarshal(model.CatalogMetadata.Model, &metadata) != nil {
		return settings
	}
	options := []string{}
	if metadata.Reasoning == nil || *metadata.Reasoning {
		for _, option := range metadata.Options {
			if option.Type == "effort" {
				for _, value := range option.Values {
					if slices.Contains(reasoningEffortValues, value) {
						options = append(options, value)
					}
				}
			}
		}
	}
	if len(options) == 0 {
		settings.Advanced.Reasoning = false
		return settings
	}
	if !slices.Contains(options, settings.Advanced.ReasoningEffort) {
		settings.Advanced.ReasoningEffort = options[0]
		for _, preferred := range []string{"medium", "low"} {
			if slices.Contains(options, preferred) {
				settings.Advanced.ReasoningEffort = preferred
				break
			}
		}
	}
	return settings
}

func advancedOptionsFromSettings(settings ConversationAdvancedSettings) *ChatAdvancedOptions {
	options := &ChatAdvancedOptions{}
	if settings.Reasoning {
		options.Reasoning = &ChatReasoningOptions{Effort: settings.ReasoningEffort}
	}
	if settings.Sampling {
		temperature, topP := float32(settings.Temperature), float32(settings.TopP)
		options.Sampling = &ChatSamplingOptions{Temperature: &temperature, TopP: &topP}
		if settings.TopK > 0 {
			topK := int(settings.TopK)
			options.Sampling.TopK = &topK
		}
	}
	if settings.Penalties {
		frequency, presence := float32(settings.FrequencyPenalty), float32(settings.PresencePenalty)
		options.Penalties = &ChatPenaltyOptions{FrequencyPenalty: &frequency, PresencePenalty: &presence}
	}
	if settings.MaxTokens {
		maximum := int(settings.MaxTokensValue)
		options.MaxTokens = &maximum
	}
	if options.Reasoning == nil && options.Sampling == nil && options.Penalties == nil && options.MaxTokens == nil {
		return nil
	}
	return options
}

func validateChatAdvancedOptions(model ProviderModel, advanced *ChatAdvancedOptions) error {
	if advanced == nil {
		return nil
	}
	temperature, output := modelGenerationCapabilities(model)
	if advanced.Sampling != nil && advanced.Sampling.Temperature != nil && temperature != nil && !*temperature {
		return fmt.Errorf("%w: model %s does not support temperature", errInvalidChatConfiguration, model.ID)
	}
	if advanced.MaxTokens != nil && output > 0 && *advanced.MaxTokens > output {
		return fmt.Errorf("%w: model %s allows at most %d output tokens", errInvalidChatConfiguration, model.ID, output)
	}
	if err := validateReasoningOptions(model, advanced); err != nil {
		return fmt.Errorf("%w: %v", errInvalidChatConfiguration, err)
	}
	check := func(name string, value *float32, minimum, maximum float64) error {
		if value != nil && (math.IsNaN(float64(*value)) || math.IsInf(float64(*value), 0) || float64(*value) < minimum || float64(*value) > maximum) {
			return fmt.Errorf("%w: %s must be between %g and %g", errInvalidChatConfiguration, name, minimum, maximum)
		}
		return nil
	}
	if advanced.Sampling != nil {
		if err := check("temperature", advanced.Sampling.Temperature, 0, 2); err != nil {
			return err
		}
		if err := check("topP", advanced.Sampling.TopP, 0, 1); err != nil {
			return err
		}
		if advanced.Sampling.TopK != nil && (*advanced.Sampling.TopK < 0 || *advanced.Sampling.TopK > 1000) {
			return fmt.Errorf("%w: topK must be between 0 and 1000", errInvalidChatConfiguration)
		}
	}
	if advanced.Penalties != nil {
		if err := check("frequencyPenalty", advanced.Penalties.FrequencyPenalty, -2, 2); err != nil {
			return err
		}
		if err := check("presencePenalty", advanced.Penalties.PresencePenalty, -2, 2); err != nil {
			return err
		}
	}
	if advanced.MaxTokens != nil && (*advanced.MaxTokens < 1 || *advanced.MaxTokens > 200000) {
		return fmt.Errorf("%w: maxTokens must be between 1 and 200000", errInvalidChatConfiguration)
	}
	return nil
}

func (service *ProviderService) NormalizeChatSettings(ctx context.Context, user string, settings ConversationSettings) (ConversationSettings, error) {
	settings = normalizeConversationSettings(settings)
	if settings.Model == "" {
		return settings, nil
	}
	provider, model, _, err := service.ResolveGenerationTarget(ctx, user, settings.Model)
	if err != nil {
		// Presets can be saved before a provider is configured. Generation still
		// resolves and validates the target before any provider call.
		visible, _, lookupErr := service.listVisibleResolvedProviders(ctx, user)
		if lookupErr == nil && len(visible) == 0 {
			return settings, nil
		}
		return settings, fmt.Errorf("%w: %v", errInvalidChatConfiguration, err)
	}
	settings.Model = modelReference(provider.Record.Ref, model.ID)
	return normalizeSettingsForModel(settings, model), nil
}

// New/ephemeral conversations inherit user defaults and the selected model's
// saved preset. Existing conversations retain their own settings.
func (service *ProviderService) InitialChatSettings(ctx context.Context, user, requestedModel string) (ConversationSettings, error) {
	preferences, err := service.GetChatSettingsPreferences(ctx, user)
	if err != nil {
		return ConversationSettings{}, err
	}
	settings := preferences.DefaultSettings
	selected := firstNonEmpty(requestedModel, settings.Model)
	_, model, _, err := service.ResolveGenerationTarget(ctx, user, selected)
	if err != nil && requestedModel == "" && errors.Is(err, errModelNotAvailable) {
		_, model, _, err = service.ResolveGenerationTarget(ctx, user, "")
	}
	if err != nil {
		// Creating an empty conversation needs no provider.
		return settings, nil
	}
	for _, key := range []string{model.ModelRef, modelReference(model.ProviderRef, model.ID), model.ID} {
		if preset, exists := preferences.ModelOverrides[key]; exists {
			settings = preset
			break
		}
	}
	settings.Model = modelReference(model.ProviderRef, model.ID)
	return normalizeSettingsForModel(settings, model), nil
}

func (service *AgentRuntime) resolveChatConfiguration(ctx context.Context, user string, settings ConversationSettings, input SubmitTurnInput) (SubmitTurnInput, error) {
	if input.Settings != nil {
		settings = *input.Settings
	}
	settings = normalizeConversationSettings(settings)
	supplied := func(field string) bool { return input.ConfigurationFields == nil || input.ConfigurationFields[field] }
	requested := settings.Model
	if supplied("model") {
		requested = normalizeModel(input.Model)
	}
	provider, model, _, err := service.providers.ResolveGenerationTarget(ctx, user, requested)
	// A saved model may have been removed. Explicit request overrides still fail.
	if err != nil && !supplied("model") && errors.Is(err, errModelNotAvailable) {
		provider, model, _, err = service.providers.ResolveGenerationTarget(ctx, user, "")
	}
	if err != nil {
		// Internal callers and legacy jobs historically accept work before a
		// provider exists. Preserve their queued/error lifecycle; HTTP commands
		// use presence metadata and require a resolvable target at acceptance.
		if input.ConfigurationFields == nil && input.Settings == nil {
			if validationErr := validateChatAdvancedOptions(ProviderModel{}, input.Advanced); validationErr != nil {
				return input, validationErr
			}
			return input, nil
		}
		return input, err
	}
	settings = normalizeSettingsForModel(settings, model)
	effective := &EffectiveChatConfiguration{Model: modelReference(provider.Record.Ref, model.ID), SystemPrompt: settings.SystemPrompt, WebSearch: settings.WebSearch, MathTools: settings.MathTools, Advanced: advancedOptionsFromSettings(settings.Advanced)}
	if supplied("systemPrompt") {
		effective.SystemPrompt = strings.TrimSpace(input.SystemPrompt)
	}
	if supplied("webSearch") {
		effective.WebSearch = input.WebSearch
	}
	if supplied("mathTools") {
		effective.MathTools = input.MathTools
	}
	if supplied("advanced") {
		effective.Advanced = input.Advanced
	} else {
		temperature, _ := modelGenerationCapabilities(model)
		if effective.Advanced != nil && effective.Advanced.Sampling != nil && temperature != nil && !*temperature {
			effective.Advanced.Sampling.Temperature = nil
		}
	}
	if effective.Advanced != nil && effective.Advanced.Reasoning != nil {
		copy := *effective.Advanced
		reasoning := *copy.Reasoning
		reasoning.Effort = strings.ToLower(strings.TrimSpace(reasoning.Effort))
		copy.Reasoning = &reasoning
		effective.Advanced = &copy
	}
	if err := validateChatAdvancedOptions(model, effective.Advanced); err != nil {
		return input, err
	}
	effective.Advanced = advancedOptionsForProvider(provider, effective.Advanced)
	input.Model, input.SystemPrompt, input.WebSearch, input.MathTools, input.Advanced = effective.Model, effective.SystemPrompt, effective.WebSearch, effective.MathTools, effective.Advanced
	input.EffectiveConfiguration = effective
	input.Settings, input.ConfigurationFields = nil, nil
	return input, nil
}

func (service *ConversationService) normalizeSettings(ctx context.Context, user string, settings ConversationSettings) (ConversationSettings, error) {
	if service.providers != nil {
		return service.providers.NormalizeChatSettings(ctx, user, settings)
	}
	return normalizeConversationSettings(settings), nil
}

func (service *AgentRuntime) runConfiguration(ctx context.Context, run string) *EffectiveChatConfiguration {
	var raw string
	if service.db.QueryRowContext(ctx, `SELECT COALESCE(request_json,'') FROM chat_runs WHERE id=?`, run).Scan(&raw) != nil {
		return nil
	}
	var input SubmitTurnInput
	if json.Unmarshal([]byte(raw), &input) != nil {
		return nil
	}
	return input.EffectiveConfiguration
}

// Only metadata matched to this endpoint is authoritative for hard limits.
func modelGenerationCapabilities(model ProviderModel) (*bool, int) {
	if model.CatalogMetadata == nil || model.CatalogMetadata.Match != "provider" {
		return nil, 0
	}
	var metadata struct {
		Temperature *bool `json:"temperature"`
		Limit       struct {
			Output int `json:"output"`
		} `json:"limit"`
	}
	if json.Unmarshal(model.CatalogMetadata.Model, &metadata) != nil {
		return nil, 0
	}
	return metadata.Temperature, metadata.Limit.Output
}

func advancedOptionsForProvider(provider resolvedProvider, options *ChatAdvancedOptions) *ChatAdvancedOptions {
	if options == nil {
		return nil
	}
	copy := *options
	if provider.Record.Kind == openAIProviderKind || provider.Record.Kind == openAIResponsesProviderKind {
		// Neither supported OpenAI protocol transmits topK. Responses also has
		// no penalty fields. Preserve saved preferences, expose only sent options.
		if copy.Sampling != nil {
			sampling := *copy.Sampling
			sampling.TopK = nil
			copy.Sampling = &sampling
		}
		if provider.Record.UseResponsesAPI || provider.Record.Kind == openAIResponsesProviderKind {
			copy.Penalties = nil
		}
	}
	if copy.Sampling != nil && copy.Sampling.Temperature == nil && copy.Sampling.TopP == nil && copy.Sampling.TopK == nil {
		copy.Sampling = nil
	}
	if copy.Penalties != nil && copy.Penalties.FrequencyPenalty == nil && copy.Penalties.PresencePenalty == nil {
		copy.Penalties = nil
	}
	if copy.Reasoning == nil && copy.Sampling == nil && copy.Penalties == nil && copy.MaxTokens == nil {
		return nil
	}
	return &copy
}
