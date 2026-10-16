package server

import (
	"context"
	"errors"
	"strings"
)

func (service *ProviderService) ResolveGenerationTarget(
	ctx context.Context,
	userID string,
	requestedModel string,
) (resolvedProvider, ProviderModel, UserPreferences, error) {
	requestedModel = strings.TrimSpace(requestedModel)
	if requestedModel == "" {
		return service.resolveDefaultGenerationTarget(ctx, userID)
	}
	if requestedModel != "" {
		visible, preferences, err := service.listVisibleResolvedProviders(ctx, userID)
		if err != nil {
			return resolvedProvider{}, ProviderModel{}, preferences, err
		}
		var chosen *resolvedProvider
		for index := range visible {
			if strings.HasPrefix(requestedModel, visible[index].Record.Ref+":") {
				chosen = &visible[index]
				break
			}
		}
		if chosen == nil && (strings.HasPrefix(requestedModel, "system:") || strings.HasPrefix(requestedModel, "user:")) {
			return resolvedProvider{}, ProviderModel{}, preferences, errModelNotAvailable
		}
		if chosen == nil && len(visible) == 1 {
			chosen = &visible[0]
		}
		if chosen != nil {
			if modelIDFromRequestedValue(requestedModel) == "" {
				return resolvedProvider{}, ProviderModel{}, preferences, errModelNotAvailable
			}
			models, _, _, err := service.loadCachedModels(ctx, userID, visible)
			if err != nil {
				return resolvedProvider{}, ProviderModel{}, preferences, err
			}
			for _, model := range models {
				if model.ProviderRef == chosen.Record.Ref && modelMatchesRequestedValue(model, requestedModel) {
					return *chosen, service.enrichModel(ctx, userID, model), preferences, nil
				}
			}
			return *chosen, service.enrichModel(ctx, userID, ProviderModel{ID: modelIDFromRequestedValue(requestedModel), Object: "model", ProviderRef: chosen.Record.Ref, ProviderLabel: chosen.Record.Label}), preferences, nil
		}
	}
	models, preferences, err := service.ListModels(ctx, userID)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, UserPreferences{}, err
	}

	effectiveModel := requestedModel

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

// Automatic selection shares explicit provider resolution, so configured custom
// targets work even before discovery and disabled provider references never win.
func (service *ProviderService) resolveDefaultGenerationTarget(ctx context.Context, user string) (resolvedProvider, ProviderModel, UserPreferences, error) {
	preferences, err := service.GetPreferences(ctx, user)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, preferences, err
	}
	for _, candidate := range []string{preferences.DefaultModelID, service.config.DefaultChatModel} {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		provider, model, _, err := service.ResolveGenerationTarget(ctx, user, candidate)
		if err == nil {
			return provider, model, preferences, nil
		}
		if !errors.Is(err, errModelNotAvailable) && !errors.Is(err, errNoModelAvailable) && !errors.Is(err, errNoProviderAvailable) {
			return provider, model, preferences, err
		}
	}
	models, preferences, err := service.ListModels(ctx, user)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, preferences, err
	}
	if len(models) == 0 {
		return resolvedProvider{}, ProviderModel{}, preferences, errNoModelAvailable
	}
	model := models[0]
	provider, err := service.resolveProvider(ctx, user, model.ProviderRef)
	return provider, model, preferences, err
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
				UseResponsesAPI:   service.system.UseResponsesAPI,
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
