package server

import (
	"strings"
)

func applyModelMetadataOverride(
	model ProviderModel,
	override modelMetadataOverrideRow,
) ProviderModel {
	if strings.TrimSpace(override.Name) != "" {
		model.Name = strings.TrimSpace(override.Name)
	}
	if strings.TrimSpace(override.Description) != "" {
		model.Description = strings.TrimSpace(override.Description)
	}
	if override.ContextWindow > 0 {
		model.ContextWindow = override.ContextWindow
	}
	return model
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return typed
}

func providerRefQueryArgs(
	userID string,
	visibleProviders []resolvedProvider,
) (string, []any) {
	placeholders := make([]string, 0, len(visibleProviders))
	args := make([]any, 0, len(visibleProviders)+1)
	args = append(args, userID)
	for _, provider := range visibleProviders {
		placeholders = append(placeholders, "?")
		args = append(args, provider.Record.Ref)
	}
	return strings.Join(placeholders, ", "), args
}

func buildVisibleModels(
	visibleProviders []resolvedProvider,
	modelsByProvider map[string][]ProviderModel,
) []ProviderModel {
	visibleModels := make([]ProviderModel, 0)
	seen := make(map[string]struct{})
	for _, provider := range visibleProviders {
		models := modelsByProvider[provider.Record.Ref]
		for _, model := range models {
			normalizedID := strings.TrimSpace(model.ID)
			if normalizedID == "" {
				continue
			}
			identity := provider.Record.Ref + "\x00" + normalizedID
			if _, exists := seen[identity]; exists {
				continue
			}
			seen[identity] = struct{}{}
			visibleModels = append(visibleModels, normalizeProviderModel(model, provider.Record))
		}
	}
	return visibleModels
}

func normalizeProviderModel(model ProviderModel, provider ProviderRecord) ProviderModel {
	model.ID = strings.TrimSpace(model.ID)
	model.ModelRef = modelReference(provider.Ref, model.ID)
	model.Object = defaultModelObject(model.Object)
	model.OwnedBy = strings.TrimSpace(model.OwnedBy)
	model.Name = strings.TrimSpace(model.Name)
	model.Description = strings.TrimSpace(model.Description)
	model.ContextWindow = maxInt64(model.ContextWindow, 0)
	model.ProviderRef = provider.Ref
	model.ProviderLabel = provider.Label
	if model.OwnedBy == "" {
		model.OwnedBy = provider.Label
	}
	return model
}

func modelReference(providerRef string, modelID string) string {
	providerRef = strings.TrimSpace(providerRef)
	modelID = strings.TrimSpace(modelID)
	if providerRef == "" || modelID == "" {
		return modelID
	}
	return providerRef + ":" + modelID
}

func modelMatchesRequestedValue(model ProviderModel, requested string) bool {
	normalized := strings.TrimSpace(requested)
	if normalized == "" {
		return false
	}
	if strings.TrimSpace(model.ModelRef) == normalized {
		return true
	}
	if modelReference(model.ProviderRef, model.ID) == normalized {
		return true
	}
	return strings.TrimSpace(model.ID) == normalized
}

func modelIDFromRequestedValue(requested string) string {
	normalized := strings.TrimSpace(requested)
	if normalized == "" {
		return ""
	}
	for _, prefix := range []string{"system:", "user:"} {
		if !strings.HasPrefix(normalized, prefix) {
			continue
		}
		rest := strings.TrimPrefix(normalized, prefix)
		if separator := strings.Index(rest, ":"); separator >= 0 {
			return strings.TrimSpace(rest[separator+1:])
		}
	}
	return normalized
}

func defaultModelObject(value string) string {
	if strings.TrimSpace(value) == "" {
		return "model"
	}
	return strings.TrimSpace(value)
}

func modelsFromStaticList(modelIDs []string, provider ProviderRecord) []ProviderModel {
	if len(modelIDs) == 0 {
		return nil
	}
	models := make([]ProviderModel, 0, len(modelIDs))
	for _, modelID := range modelIDs {
		if strings.TrimSpace(modelID) == "" {
			continue
		}
		models = append(models, ProviderModel{
			ID:            strings.TrimSpace(modelID),
			Object:        "model",
			Created:       0,
			OwnedBy:       provider.Label,
			ProviderRef:   provider.Ref,
			ProviderLabel: provider.Label,
		})
	}
	return models
}

func collectProviderMessageText(parts []ProviderMessagePart) string {
	fragments := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part.Type) != "text" {
			continue
		}
		if text := strings.TrimSpace(part.Text); text != "" {
			fragments = append(fragments, text)
		}
	}
	return strings.Join(fragments, "\n\n")
}

func imageDataURL(mimeType string, content string) string {
	normalizedMimeType := strings.TrimSpace(mimeType)
	normalizedContent := strings.TrimSpace(content)
	if normalizedMimeType == "" || normalizedContent == "" {
		return ""
	}
	return "data:" + normalizedMimeType + ";base64," + normalizedContent
}

func normalizeProviderBaseURL(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	return strings.TrimRight(normalized, "/") + "/"
}

func fallbackString(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fallback)
}

func normalizedProviderLabel(value string) string {
	return strings.TrimSpace(value)
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}
