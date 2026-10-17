package server

import (
	"math"
	"strings"
)

// Canonicalize settings at the persistence boundary. Web and Android receive the
// same persisted numeric limits and reasoning-effort value after a server mutation.
func canonicalConversationSettings(settings ConversationSettings) ConversationSettings {
	settings.Model = strings.TrimSpace(settings.Model)
	settings.Advanced.ReasoningEffort = strings.ToLower(strings.TrimSpace(settings.Advanced.ReasoningEffort))
	switch settings.Advanced.ReasoningEffort {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max":
	default:
		settings.Advanced.ReasoningEffort = "medium"
	}
	settings.Advanced.Temperature = clampConversationNumber(settings.Advanced.Temperature, 0, 2)
	settings.Advanced.TopP = clampConversationNumber(settings.Advanced.TopP, 0, 1)
	settings.Advanced.TopK = math.Floor(clampConversationNumber(settings.Advanced.TopK, 0, 1000))
	settings.Advanced.FrequencyPenalty = clampConversationNumber(settings.Advanced.FrequencyPenalty, -2, 2)
	settings.Advanced.PresencePenalty = clampConversationNumber(settings.Advanced.PresencePenalty, -2, 2)
	settings.Advanced.MaxTokensValue = math.Floor(clampConversationNumber(settings.Advanced.MaxTokensValue, 1, 200000))
	return settings
}

// Effective generation options are resolved in Go for thin clients. The normal
// web request continues to send explicit per-turn overrides unchanged.
func applySavedConversationGenerationSettings(input *SubmitTurnInput, settings ConversationSettings) {
	settings = canonicalConversationSettings(settings)
	input.Model = settings.Model
	input.SystemPrompt = settings.SystemPrompt
	input.WebSearch = settings.WebSearch
	input.MathTools = settings.MathTools
	input.Advanced = savedConversationAdvancedOptions(settings.Advanced)
}

func savedConversationAdvancedOptions(settings ConversationAdvancedSettings) *ChatAdvancedOptions {
	result := &ChatAdvancedOptions{}
	if settings.Reasoning {
		effort := strings.ToLower(strings.TrimSpace(settings.ReasoningEffort))
		if effort == "" {
			effort = "medium"
		}
		result.Reasoning = &ChatReasoningOptions{Effort: effort}
	}
	if settings.Sampling {
		temperature := float32(clampConversationNumber(settings.Temperature, 0, 2))
		topP := float32(clampConversationNumber(settings.TopP, 0, 1))
		result.Sampling = &ChatSamplingOptions{Temperature: &temperature, TopP: &topP}
		if settings.TopK > 0 {
			topK := int(math.Floor(clampConversationNumber(settings.TopK, 0, 1000)))
			result.Sampling.TopK = &topK
		}
	}
	if settings.Penalties {
		frequency := float32(clampConversationNumber(settings.FrequencyPenalty, -2, 2))
		presence := float32(clampConversationNumber(settings.PresencePenalty, -2, 2))
		result.Penalties = &ChatPenaltyOptions{FrequencyPenalty: &frequency, PresencePenalty: &presence}
	}
	if settings.MaxTokens {
		maxTokens := int(math.Floor(clampConversationNumber(settings.MaxTokensValue, 1, 200000)))
		result.MaxTokens = &maxTokens
	}
	if result.Reasoning == nil && result.Sampling == nil && result.Penalties == nil && result.MaxTokens == nil {
		return nil
	}
	return result
}

func clampConversationNumber(value, minimum, maximum float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return minimum
	}
	return math.Min(math.Max(value, minimum), maximum)
}
