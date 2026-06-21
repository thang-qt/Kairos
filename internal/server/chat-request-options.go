package server

type ChatAdvancedOptions struct {
	Reasoning *ChatReasoningOptions `json:"reasoning"`
	Sampling  *ChatSamplingOptions  `json:"sampling"`
	Penalties *ChatPenaltyOptions   `json:"penalties"`
	MaxTokens *int                  `json:"maxTokens"`
}

type ChatReasoningOptions struct {
	Effort string `json:"effort"`
}

type ChatSamplingOptions struct {
	Temperature *float32 `json:"temperature"`
	TopP        *float32 `json:"topP"`
	TopK        *int     `json:"topK"`
}

type ChatPenaltyOptions struct {
	FrequencyPenalty *float32 `json:"frequencyPenalty"`
	PresencePenalty  *float32 `json:"presencePenalty"`
}
