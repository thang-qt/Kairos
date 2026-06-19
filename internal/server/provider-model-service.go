package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

type CreateModelInput struct {
	ProviderRef   string `json:"providerRef"`
	ModelID       string `json:"modelId"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	ContextWindow int64  `json:"contextWindow"`
}

func (service *ProviderService) ListModels(
	ctx context.Context,
	userID string,
) ([]ProviderModel, UserPreferences, error) {
	visibleProviders, preferences, err := service.listVisibleResolvedProviders(ctx, userID)
	if err != nil {
		return nil, UserPreferences{}, err
	}
	if len(visibleProviders) == 0 {
		return []ProviderModel{}, preferences, nil
	}

	visibleModels, cacheComplete, staleCache, err := service.loadCachedModels(
		ctx,
		userID,
		visibleProviders,
	)
	if err != nil {
		return nil, UserPreferences{}, err
	}

	if !cacheComplete {
		if refreshErr := service.refreshVisibleProviderModels(ctx, userID, visibleProviders); refreshErr == nil {
			visibleModels, cacheComplete, staleCache, err = service.loadCachedModels(
				ctx,
				userID,
				visibleProviders,
			)
			if err != nil {
				return nil, UserPreferences{}, err
			}
		}
	}

	if staleCache {
		service.refreshVisibleProviderModelsInBackground(userID)
	}

	if len(visibleModels) == 0 {
		return []ProviderModel{}, preferences, nil
	}
	visibleModels = service.enrichModels(ctx, userID, visibleModels)
	slices.SortFunc(visibleModels, func(left ProviderModel, right ProviderModel) int {
		return strings.Compare(left.ID, right.ID)
	})
	return visibleModels, preferences, nil
}

func (service *ProviderService) UpdateModelMetadata(
	ctx context.Context,
	userID string,
	input UpdateModelMetadataInput,
) (ProviderModel, error) {
	modelID := strings.TrimSpace(input.ModelID)
	if modelID == "" {
		return ProviderModel{}, errors.New("model id is required")
	}

	models, _, err := service.ListModels(ctx, userID)
	if err != nil {
		return ProviderModel{}, err
	}

	matchedIndex := -1
	for index, model := range models {
		if strings.TrimSpace(model.ID) == modelID {
			matchedIndex = index
			break
		}
	}
	if matchedIndex < 0 {
		return ProviderModel{}, errModelNotAvailable
	}

	override, err := service.findModelMetadataOverride(ctx, userID, modelID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ProviderModel{}, err
	}

	name := strings.TrimSpace(models[matchedIndex].Name)
	description := strings.TrimSpace(models[matchedIndex].Description)
	contextWindow := models[matchedIndex].ContextWindow
	if err == nil {
		if strings.TrimSpace(override.Name) != "" {
			name = strings.TrimSpace(override.Name)
		}
		if strings.TrimSpace(override.Description) != "" {
			description = strings.TrimSpace(override.Description)
		}
		if override.ContextWindow > 0 {
			contextWindow = override.ContextWindow
		}
	}

	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if input.Description != nil {
		description = strings.TrimSpace(*input.Description)
	}
	if input.ContextWindow != nil {
		if *input.ContextWindow > 0 {
			contextWindow = *input.ContextWindow
		} else {
			contextWindow = 0
		}
	}

	if name == "" && description == "" && contextWindow <= 0 {
		if _, deleteErr := service.db.ExecContext(ctx, `
			DELETE FROM user_model_metadata
			WHERE user_id = ? AND model_id = ?
		`, userID, modelID); deleteErr != nil {
			return ProviderModel{}, fmt.Errorf("delete model metadata override: %w", deleteErr)
		}
	} else {
		now := time.Now().UnixMilli()
		if _, upsertErr := service.db.ExecContext(ctx, `
			INSERT INTO user_model_metadata(
				user_id,
				model_id,
				name,
				description,
				context_window,
				created_at,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, model_id) DO UPDATE SET
				name = excluded.name,
				description = excluded.description,
				context_window = excluded.context_window,
				updated_at = excluded.updated_at
		`, userID, modelID, name, description, maxInt64(contextWindow, 0), now, now); upsertErr != nil {
			return ProviderModel{}, fmt.Errorf("upsert model metadata override: %w", upsertErr)
		}
	}

	models, _, err = service.ListModels(ctx, userID)
	if err != nil {
		return ProviderModel{}, err
	}
	for _, model := range models {
		if strings.TrimSpace(model.ID) == modelID {
			return model, nil
		}
	}

	return ProviderModel{}, errModelNotAvailable
}

func (service *ProviderService) SyncModelCatalog(ctx context.Context) error {
	if service.modelCatalog == nil {
		return nil
	}
	_, err := service.modelCatalog.load(ctx, true)
	return err
}

func (service *ProviderService) SyncModels(
	ctx context.Context,
	userID string,
) ([]ProviderModel, UserPreferences, error) {
	if err := service.SyncModelCatalog(ctx); err != nil && ctx.Err() == nil {
		// Keep serving cached metadata if models.dev is temporarily unavailable.
	}

	visibleProviders, preferences, err := service.listVisibleResolvedProviders(ctx, userID)
	if err != nil {
		return nil, UserPreferences{}, err
	}
	if len(visibleProviders) == 0 {
		return []ProviderModel{}, preferences, nil
	}
	if err := service.refreshVisibleProviderModels(ctx, userID, visibleProviders); err != nil {
		return nil, UserPreferences{}, err
	}
	visibleModels, _, _, err := service.loadCachedModels(ctx, userID, visibleProviders)
	if err != nil {
		return nil, UserPreferences{}, err
	}
	if len(visibleModels) == 0 {
		return []ProviderModel{}, preferences, nil
	}
	visibleModels = service.enrichModels(ctx, userID, visibleModels)
	slices.SortFunc(visibleModels, func(left ProviderModel, right ProviderModel) int {
		return strings.Compare(left.ID, right.ID)
	})
	return visibleModels, preferences, nil
}

func (service *ProviderService) AddCustomModel(
	ctx context.Context,
	userID string,
	input CreateModelInput,
) (ProviderModel, error) {
	providerRef := strings.TrimSpace(input.ProviderRef)
	modelID := strings.TrimSpace(input.ModelID)
	name := strings.TrimSpace(input.Name)
	description := strings.TrimSpace(input.Description)

	if providerRef == "" {
		return ProviderModel{}, errors.New("provider ref is required")
	}
	if modelID == "" {
		return ProviderModel{}, errors.New("model id is required")
	}
	if name == "" {
		return ProviderModel{}, errors.New("model name is required")
	}

	provider, err := service.resolveProvider(ctx, userID, providerRef)
	if err != nil {
		return ProviderModel{}, err
	}

	now := time.Now().UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO provider_models(
			user_id,
			provider_ref,
			model_id,
			object,
			created,
			owned_by,
			name,
			description,
			context_window,
			fetched_at,
			is_custom
		)
		VALUES (?, ?, ?, 'model', ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(user_id, provider_ref, model_id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			context_window = excluded.context_window,
			is_custom = 1
	`, userID, providerRef, modelID, now, provider.Record.Label, name, description, maxInt64(input.ContextWindow, 0), now); err != nil {
		return ProviderModel{}, fmt.Errorf("add custom model: %w", err)
	}

	models, _, err := service.ListModels(ctx, userID)
	if err != nil {
		return ProviderModel{}, err
	}
	for _, m := range models {
		if strings.TrimSpace(m.ID) == modelID && m.ProviderRef == providerRef {
			return m, nil
		}
	}

	return ProviderModel{
		ID:            modelID,
		ModelRef:      modelReference(providerRef, modelID),
		Object:        "model",
		Created:       now,
		OwnedBy:       provider.Record.Label,
		Name:          name,
		Description:   description,
		ContextWindow: maxInt64(input.ContextWindow, 0),
		ProviderRef:   providerRef,
		ProviderLabel: provider.Record.Label,
		IsCustom:      true,
	}, nil
}

func (service *ProviderService) DeleteCustomModel(
	ctx context.Context,
	userID string,
	providerRef string,
	modelID string,
) error {
	providerRef = strings.TrimSpace(providerRef)
	modelID = strings.TrimSpace(modelID)

	if providerRef == "" {
		return errors.New("provider ref is required")
	}
	if modelID == "" {
		return errors.New("model id is required")
	}

	result, err := service.db.ExecContext(ctx, `
		DELETE FROM provider_models
		WHERE user_id = ? AND provider_ref = ? AND model_id = ? AND is_custom = 1
	`, userID, providerRef, modelID)
	if err != nil {
		return fmt.Errorf("delete custom model: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errCustomModelNotFound
	}

	return nil
}

func (service *ProviderService) enrichModels(
	ctx context.Context,
	userID string,
	models []ProviderModel,
) []ProviderModel {
	if len(models) == 0 {
		return models
	}

	entries := map[string]modelCatalogEntry{}
	if service.modelCatalog != nil {
		ids := make([]string, 0, len(models))
		for _, model := range models {
			if strings.TrimSpace(model.ID) != "" {
				ids = append(ids, model.ID)
			}
		}
		entries = service.modelCatalog.lookupMany(ctx, ids)
	}
	overrides := service.loadModelMetadataOverrides(ctx, userID, models)

	enriched := make([]ProviderModel, 0, len(models))
	for _, model := range models {
		next := model
		if strings.TrimSpace(next.ModelRef) == "" {
			next.ModelRef = modelReference(next.ProviderRef, next.ID)
		}
		if entry, ok := entries[strings.TrimSpace(model.ID)]; ok {
			next = applyModelCatalogEntry(next, entry)
		}
		if override, ok := overrides[strings.TrimSpace(model.ID)]; ok {
			next = applyModelMetadataOverride(next, override)
		}
		enriched = append(enriched, next)
	}
	return enriched
}

func (service *ProviderService) enrichModel(
	ctx context.Context,
	userID string,
	model ProviderModel,
) ProviderModel {
	enriched := service.enrichModels(ctx, userID, []ProviderModel{model})
	if len(enriched) == 0 {
		return model
	}
	return enriched[0]
}

func (service *ProviderService) loadModelMetadataOverrides(
	ctx context.Context,
	userID string,
	models []ProviderModel,
) map[string]modelMetadataOverrideRow {
	if len(models) == 0 {
		return nil
	}

	result := make(map[string]modelMetadataOverrideRow)
	rows, err := service.db.QueryContext(ctx, `
		SELECT
			user_id,
			model_id,
			name,
			description,
			context_window,
			created_at,
			updated_at
		FROM user_model_metadata
		WHERE user_id = ?
	`, userID)
	if err != nil {
		return result
	}
	defer rows.Close()

	visible := make(map[string]struct{}, len(models))
	for _, model := range models {
		visible[strings.TrimSpace(model.ID)] = struct{}{}
	}

	for rows.Next() {
		var row modelMetadataOverrideRow
		if scanErr := rows.Scan(
			&row.UserID,
			&row.ModelID,
			&row.Name,
			&row.Description,
			&row.ContextWindow,
			&row.CreatedAt,
			&row.UpdatedAt,
		); scanErr != nil {
			continue
		}
		if _, ok := visible[strings.TrimSpace(row.ModelID)]; !ok {
			continue
		}
		result[strings.TrimSpace(row.ModelID)] = row
	}

	return result
}

func (service *ProviderService) findModelMetadataOverride(
	ctx context.Context,
	userID string,
	modelID string,
) (modelMetadataOverrideRow, error) {
	var row modelMetadataOverrideRow
	err := service.db.QueryRowContext(ctx, `
		SELECT
			user_id,
			model_id,
			name,
			description,
			context_window,
			created_at,
			updated_at
		FROM user_model_metadata
		WHERE user_id = ? AND model_id = ?
	`, userID, strings.TrimSpace(modelID)).Scan(
		&row.UserID,
		&row.ModelID,
		&row.Name,
		&row.Description,
		&row.ContextWindow,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	if err != nil {
		return modelMetadataOverrideRow{}, err
	}
	return row, nil
}
