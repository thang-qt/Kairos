package server

import (
	"context"
	"strings"
)

func (service *ProviderService) ResolveGenerationTarget(
	ctx context.Context,
	userID string,
	requestedModel string,
) (resolvedProvider, ProviderModel, UserPreferences, error) {
	models, preferences, err := service.ListModels(ctx, userID)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, UserPreferences{}, err
	}

	effectiveModel := strings.TrimSpace(requestedModel)
	if effectiveModel == "" {
		effectiveModel = strings.TrimSpace(preferences.DefaultModelID)
	}
	if effectiveModel == "" {
		effectiveModel = strings.TrimSpace(service.config.DefaultChatModel)
	}
	if effectiveModel == "" && len(models) > 0 {
		effectiveModel = strings.TrimSpace(models[0].ID)
	}
	if effectiveModel == "" {
		return resolvedProvider{}, ProviderModel{}, preferences, errNoModelAvailable
	}

	for _, model := range models {
		if modelMatchesRequestedValue(model, effectiveModel) {
			resolved, err := service.resolveProvider(ctx, userID, model.ProviderRef)
			if err != nil {
				return resolvedProvider{}, ProviderModel{}, preferences, err
			}
			return resolved, model, preferences, nil
		}
	}

	providers, _, err := service.ListProviders(ctx, userID)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, preferences, err
	}

	candidates := make([]ProviderRecord, 0, len(providers))
	for _, record := range providers {
		if record.Owner == "system" && !preferences.UseSystemProviders {
			continue
		}
		if !record.Enabled {
			continue
		}
		candidates = append(candidates, record)
	}

	if len(candidates) == 1 {
		resolved, err := service.resolveProvider(ctx, userID, candidates[0].Ref)
		if err != nil {
			return resolvedProvider{}, ProviderModel{}, preferences, err
		}
		return resolved, service.enrichModel(ctx, userID, ProviderModel{
			ID:            modelIDFromRequestedValue(effectiveModel),
			Object:        "model",
			OwnedBy:       candidates[0].Label,
			ProviderRef:   candidates[0].Ref,
			ProviderLabel: candidates[0].Label,
		}), preferences, nil
	}

	return resolvedProvider{}, ProviderModel{}, preferences, errModelNotAvailable
}

func (service *ProviderService) listVisibleResolvedProviders(
	ctx context.Context,
	userID string,
) ([]resolvedProvider, UserPreferences, error) {
	providers, preferences, err := service.ListProviders(ctx, userID)
	if err != nil {
		return nil, UserPreferences{}, err
	}

	visibleProviders := make([]resolvedProvider, 0, len(providers))
	for _, record := range providers {
		if record.Owner == "system" && !preferences.UseSystemProviders {
			continue
		}
		if !record.Enabled {
			continue
		}
		resolved, resolveErr := service.resolveProvider(ctx, userID, record.Ref)
		if resolveErr != nil {
			continue
		}
		if service.drivers[resolved.Record.Kind] == nil {
			continue
		}
		visibleProviders = append(visibleProviders, resolved)
	}
	return visibleProviders, preferences, nil
}

func (service *ProviderService) resolveProvider(
	ctx context.Context,
	userID string,
	ref string,
) (resolvedProvider, error) {
	if strings.HasPrefix(ref, "system:") {
		if service.system == nil {
			return resolvedProvider{}, errProviderNotFound
		}
		return resolvedProvider{
			Record: ProviderRecord{
				ID:                service.system.ID,
				Ref:               "system:" + service.system.ID,
				Owner:             "system",
				Kind:              service.system.Kind,
				Label:             service.system.Label,
				BaseURL:           service.system.BaseURL,
				Enabled:           service.system.Enabled,
				SupportsModelSync: service.system.SupportsModelSync,
				SystemManaged:     true,
			},
			BaseURL:      service.system.BaseURL,
			APIKey:       service.system.APIKey,
			StaticModels: append([]string(nil), service.system.StaticModels...),
		}, nil
	}

	row, err := service.findUserProvider(ctx, userID, strings.TrimPrefix(ref, "user:"))
	if err != nil {
		return resolvedProvider{}, err
	}
	apiKey, err := service.decryptSecret(row.EncryptedAPIKey)
	if err != nil {
		return resolvedProvider{}, err
	}
	return resolvedProvider{
		Record:  providerRowToRecord(row),
		BaseURL: row.BaseURL,
		APIKey:  apiKey,
	}, nil
}
