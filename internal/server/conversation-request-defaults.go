package server

import (
    "math"
    "strings"
)

// Effective generation options are resolved in Go for thin clients. The normal
// web request continues to send explicit per-turn overrides unchanged.
func applySavedConversationGenerationSettings(input *SubmitTurnInput, settings ConversationSettings) {
    input.Model = strings.TrimSpace(settings.Model)
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
