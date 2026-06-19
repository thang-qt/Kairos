package server

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type providerModelsSnapshot struct {
	Provider resolvedProvider
	Models   []ProviderModel
}

func (service *ProviderService) loadCachedModels(
	ctx context.Context,
	userID string,
	visibleProviders []resolvedProvider,
) ([]ProviderModel, bool, bool, error) {
	if len(visibleProviders) == 0 {
		return []ProviderModel{}, true, false, nil
	}

	now := time.Now().UnixMilli()
	states, err := service.loadProviderModelCacheStates(ctx, userID, visibleProviders)
	if err != nil {
		return nil, false, false, err
	}
	modelsByProvider, err := service.loadProviderModelRows(ctx, userID, visibleProviders)
	if err != nil {
		return nil, false, false, err
	}

	cacheComplete := true
	staleCache := false
	for _, provider := range visibleProviders {
		state, ok := states[provider.Record.Ref]
		if !ok {
			cacheComplete = false
			continue
		}
		if state.ExpiresAt <= now {
			staleCache = true
		}
	}

	return buildVisibleModels(visibleProviders, modelsByProvider), cacheComplete, staleCache, nil
}

func (service *ProviderService) loadProviderModelCacheStates(
	ctx context.Context,
	userID string,
	visibleProviders []resolvedProvider,
) (map[string]providerModelCacheStateRow, error) {
	states := make(map[string]providerModelCacheStateRow, len(visibleProviders))
	if len(visibleProviders) == 0 {
		return states, nil
	}

	placeholders, args := providerRefQueryArgs(userID, visibleProviders)
	rows, err := service.db.QueryContext(ctx, `
		SELECT
			user_id,
			provider_ref,
			last_synced_at,
			expires_at
		FROM provider_model_cache_state
		WHERE user_id = ? AND provider_ref IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("load provider model cache state: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var row providerModelCacheStateRow
		if scanErr := rows.Scan(
			&row.UserID,
			&row.ProviderRef,
			&row.LastSyncedAt,
			&row.ExpiresAt,
		); scanErr != nil {
			return nil, fmt.Errorf("scan provider model cache state: %w", scanErr)
		}
		states[row.ProviderRef] = row
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate provider model cache state: %w", err)
	}

	return states, nil
}

func (service *ProviderService) loadProviderModelRows(
	ctx context.Context,
	userID string,
	visibleProviders []resolvedProvider,
) (map[string][]ProviderModel, error) {
	modelsByProvider := make(map[string][]ProviderModel, len(visibleProviders))
	if len(visibleProviders) == 0 {
		return modelsByProvider, nil
	}

	placeholders, args := providerRefQueryArgs(userID, visibleProviders)
	rows, err := service.db.QueryContext(ctx, `
		SELECT
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
		FROM provider_models
		WHERE user_id = ? AND provider_ref IN (`+placeholders+`)
		ORDER BY provider_ref ASC, model_id ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("load provider models: %w", err)
	}
	defer rows.Close()

	providersByRef := make(map[string]resolvedProvider, len(visibleProviders))
	for _, provider := range visibleProviders {
		providersByRef[provider.Record.Ref] = provider
	}

	for rows.Next() {
		var row providerModelCacheRow
		if scanErr := rows.Scan(
			&row.UserID,
			&row.ProviderRef,
			&row.ModelID,
			&row.Object,
			&row.Created,
			&row.OwnedBy,
			&row.Name,
			&row.Description,
			&row.ContextWindow,
			&row.FetchedAt,
			&row.IsCustom,
		); scanErr != nil {
			return nil, fmt.Errorf("scan provider models: %w", scanErr)
		}
		provider, ok := providersByRef[row.ProviderRef]
		if !ok {
			continue
		}
		modelsByProvider[row.ProviderRef] = append(
			modelsByProvider[row.ProviderRef],
			ProviderModel{
				ID:            strings.TrimSpace(row.ModelID),
				Object:        defaultModelObject(row.Object),
				Created:       row.Created,
				OwnedBy:       strings.TrimSpace(row.OwnedBy),
				Name:          strings.TrimSpace(row.Name),
				Description:   strings.TrimSpace(row.Description),
				ContextWindow: maxInt64(row.ContextWindow, 0),
				ProviderRef:   provider.Record.Ref,
				ProviderLabel: provider.Record.Label,
				IsCustom:      row.IsCustom,
			},
		)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate provider models: %w", err)
	}

	return modelsByProvider, nil
}

func (service *ProviderService) refreshVisibleProviderModels(
	ctx context.Context,
	userID string,
	visibleProviders []resolvedProvider,
) error {
	snapshots, err := service.fetchProviderModelSnapshots(ctx, visibleProviders)
	if err != nil {
		return err
	}
	if len(snapshots) == 0 {
		return nil
	}
	return service.saveProviderModelSnapshots(ctx, userID, snapshots)
}

func (service *ProviderService) fetchProviderModelSnapshots(
	ctx context.Context,
	visibleProviders []resolvedProvider,
) ([]providerModelsSnapshot, error) {
	snapshots := make([]providerModelsSnapshot, 0, len(visibleProviders))
	for _, provider := range visibleProviders {
		if !provider.Record.SupportsModelSync {
			snapshots = append(snapshots, providerModelsSnapshot{
				Provider: provider,
				Models:   modelsFromStaticList(provider.StaticModels, provider.Record),
			})
			continue
		}

		driver := service.drivers[provider.Record.Kind]
		if driver == nil {
			continue
		}

		models, err := driver.ListModels(ctx, provider)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			continue
		}

		normalizedModels := make([]ProviderModel, 0, len(models))
		for _, model := range models {
			normalizedModel := normalizeProviderModel(model, provider.Record)
			if normalizedModel.ID == "" {
				continue
			}
			normalizedModels = append(normalizedModels, normalizedModel)
		}
		snapshots = append(snapshots, providerModelsSnapshot{
			Provider: provider,
			Models:   normalizedModels,
		})
	}
	return snapshots, nil
}

func (service *ProviderService) saveProviderModelSnapshots(
	ctx context.Context,
	userID string,
	snapshots []providerModelsSnapshot,
) error {
	now := time.Now().UnixMilli()
	expiresAt := now + service.modelCacheTTL.Milliseconds()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin provider model refresh: %w", err)
	}

	for _, snapshot := range snapshots {
		if _, execErr := tx.ExecContext(ctx, `
			DELETE FROM provider_models
			WHERE user_id = ? AND provider_ref = ? AND is_custom = 0
		`, userID, snapshot.Provider.Record.Ref); execErr != nil {
			tx.Rollback()
			return fmt.Errorf("clear provider models: %w", execErr)
		}

		for _, model := range snapshot.Models {
			if _, execErr := tx.ExecContext(ctx, `
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
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
					ON CONFLICT(user_id, provider_ref, model_id) DO UPDATE SET
						object = excluded.object,
						created = excluded.created,
						owned_by = excluded.owned_by,
						name = excluded.name,
						description = excluded.description,
						context_window = excluded.context_window,
						fetched_at = excluded.fetched_at
				`, userID, snapshot.Provider.Record.Ref, model.ID, defaultModelObject(model.Object), model.Created, strings.TrimSpace(model.OwnedBy), strings.TrimSpace(model.Name), strings.TrimSpace(model.Description), maxInt64(model.ContextWindow, 0), now); execErr != nil {
				tx.Rollback()
				return fmt.Errorf("insert provider model: %w", execErr)
			}
		}

		if _, execErr := tx.ExecContext(ctx, `
			INSERT INTO provider_model_cache_state(
				user_id,
				provider_ref,
				last_synced_at,
				expires_at
			)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(user_id, provider_ref) DO UPDATE SET
				last_synced_at = excluded.last_synced_at,
				expires_at = excluded.expires_at
		`, userID, snapshot.Provider.Record.Ref, now, expiresAt); execErr != nil {
			tx.Rollback()
			return fmt.Errorf("upsert provider model cache state: %w", execErr)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit provider model refresh: %w", err)
	}

	return nil
}

func (service *ProviderService) refreshVisibleProviderModelsInBackground(userID string) {
	service.modelRefreshMu.Lock()
	if _, alreadyRefreshing := service.refreshingModelUsers[userID]; alreadyRefreshing {
		service.modelRefreshMu.Unlock()
		return
	}
	service.refreshingModelUsers[userID] = struct{}{}
	service.modelRefreshMu.Unlock()

	go func() {
		defer func() {
			service.modelRefreshMu.Lock()
			delete(service.refreshingModelUsers, userID)
			service.modelRefreshMu.Unlock()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		visibleProviders, _, err := service.listVisibleResolvedProviders(ctx, userID)
		if err != nil || len(visibleProviders) == 0 {
			return
		}
		_ = service.refreshVisibleProviderModels(ctx, userID, visibleProviders)
	}()
}

func (service *ProviderService) invalidateProviderModelCache(
	ctx context.Context,
	userID string,
	providerRef string,
) error {
	if _, err := service.db.ExecContext(ctx, `
		DELETE FROM provider_models
		WHERE user_id = ? AND provider_ref = ?
	`, userID, strings.TrimSpace(providerRef)); err != nil {
		return fmt.Errorf("delete provider models: %w", err)
	}
	if _, err := service.db.ExecContext(ctx, `
		DELETE FROM provider_model_cache_state
		WHERE user_id = ? AND provider_ref = ?
	`, userID, strings.TrimSpace(providerRef)); err != nil {
		return fmt.Errorf("delete provider model cache state: %w", err)
	}
	return nil
}
