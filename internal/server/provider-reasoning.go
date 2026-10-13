package server

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

func validateReasoningOptions(model ProviderModel, advanced *ChatAdvancedOptions) error {
	if advanced == nil || advanced.Reasoning == nil {
		return nil
	}
	effort := strings.ToLower(strings.TrimSpace(advanced.Reasoning.Effort))
	if !slices.Contains([]string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}, effort) {
		return fmt.Errorf("unsupported reasoning effort: %s", effort)
	}
	// Exact endpoint matches describe this provider; fallback catalogs may differ.
	if model.CatalogMetadata == nil || model.CatalogMetadata.Match != "provider" {
		return nil
	}
	var metadata struct {
		Reasoning *bool `json:"reasoning"`
		Options   []struct {
			Type   string   `json:"type"`
			Values []string `json:"values"`
		} `json:"reasoning_options"`
	}
	if err := json.Unmarshal(model.CatalogMetadata.Model, &metadata); err != nil {
		return nil
	}
	if metadata.Reasoning != nil && !*metadata.Reasoning {
		return fmt.Errorf("model %s does not support reasoning effort control", model.ID)
	}
	for _, option := range metadata.Options {
		if option.Type == "effort" {
			if slices.Contains(option.Values, effort) {
				return nil
			}
			return fmt.Errorf("model %s supports reasoning effort %s, not %s", model.ID, strings.Join(option.Values, ", "), effort)
		}
	}
	if len(metadata.Options) > 0 {
		return fmt.Errorf("model %s does not advertise reasoning effort control", model.ID)
	}
	return nil
}
