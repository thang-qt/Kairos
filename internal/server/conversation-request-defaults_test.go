package server

import "testing"

func TestCanonicalConversationSettingsForThinClients(t *testing.T) {
	input := ConversationSettings{
		Model:        "  provider:model  ",
		SystemPrompt: "Keep this instruction.",
		WebSearch:    false,
		MathTools:    true,
		Advanced: ConversationAdvancedSettings{
			Reasoning:        true,
			ReasoningEffort:  "INVALID",
			Sampling:         true,
			Temperature:      9,
			TopP:             -1,
			TopK:             1004.9,
			Penalties:        true,
			FrequencyPenalty: -3,
			PresencePenalty:  4,
			MaxTokens:        true,
			MaxTokensValue:   200005.9,
		},
	}
	canonical := canonicalConversationSettings(input)
	if canonical.Model != "provider:model" || canonical.Advanced.ReasoningEffort != "medium" {
		t.Fatalf("canonical model or reasoning effort: %+v", canonical)
	}
	if canonical.Advanced.Temperature != 2 || canonical.Advanced.TopP != 0 || canonical.Advanced.TopK != 1000 {
		t.Fatalf("sampling limits: %+v", canonical.Advanced)
	}
	if canonical.Advanced.FrequencyPenalty != -2 || canonical.Advanced.PresencePenalty != 2 || canonical.Advanced.MaxTokensValue != 200000 {
		t.Fatalf("penalty or output limits: %+v", canonical.Advanced)
	}
	request := SubmitTurnInput{Model: "ignored", WebSearch: true}
	applySavedConversationGenerationSettings(&request, input)
	if request.Model != canonical.Model || request.SystemPrompt != canonical.SystemPrompt || request.WebSearch || !request.MathTools {
		t.Fatalf("inherited request: %+v", request)
	}
	if request.Advanced == nil || request.Advanced.Reasoning == nil || request.Advanced.Reasoning.Effort != "medium" ||
		request.Advanced.Sampling == nil || *request.Advanced.Sampling.Temperature != 2 ||
		request.Advanced.Sampling.TopK == nil || *request.Advanced.Sampling.TopK != 1000 ||
		request.Advanced.MaxTokens == nil || *request.Advanced.MaxTokens != 200000 {
		t.Fatalf("inherited advanced options: %+v", request.Advanced)
	}
}

func TestDisabledAdvancedSettingsDoNotProduceOverrides(t *testing.T) {
	request := SubmitTurnInput{Advanced: &ChatAdvancedOptions{Reasoning: &ChatReasoningOptions{Effort: "high"}}}
	applySavedConversationGenerationSettings(&request, defaultConversationSettings())
	if request.Advanced != nil {
		t.Fatalf("disabled advanced settings must not force provider overrides: %+v", request.Advanced)
	}
}
