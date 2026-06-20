package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (service *ProviderService) ListProviders(
	ctx context.Context,
	userID string,
) ([]ProviderRecord, UserPreferences, error) {
	preferences, err := service.GetPreferences(ctx, userID)
	if err != nil {
		return nil, UserPreferences{}, err
	}

	providers := make([]ProviderRecord, 0, 1)
	if service.system != nil {
		providers = append(providers, ProviderRecord{
			ID:                service.system.ID,
			Ref:               "system:" + service.system.ID,
			Owner:             "system",
			Kind:              service.system.Kind,
			Label:             service.system.Label,
			BaseURL:           service.system.BaseURL,
			Enabled:           service.system.Enabled && preferences.UseSystemProviders,
			SupportsModelSync: service.system.SupportsModelSync,
			SystemManaged:     true,
		})
	}

	rows, err := service.db.QueryContext(ctx, `
		SELECT
			id,
			user_id,
			kind,
			label,
			base_url,
			api_key_encrypted,
			is_enabled,
			supports_model_sync,
			created_at,
			updated_at
		FROM user_providers
		WHERE user_id = ?
		ORDER BY updated_at DESC, created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, UserPreferences{}, fmt.Errorf("list user providers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		row, err := scanProviderRow(rows)
		if err != nil {
			return nil, UserPreferences{}, err
		}
		providers = append(providers, providerRowToRecord(row))
	}
	if err := rows.Err(); err != nil {
		return nil, UserPreferences{}, fmt.Errorf("iterate user providers: %w", err)
	}

	return providers, preferences, nil
}

func (service *ProviderService) CreateProvider(
	ctx context.Context,
	userID string,
	input CreateProviderInput,
) (ProviderRecord, error) {
	if !service.config.UserProvidersEnabled {
		return ProviderRecord{}, errProvidersDisabled
	}
	kind := strings.ToLower(strings.TrimSpace(input.Kind))
	if kind == "" {
		kind = defaultProviderKind
	}
	if _, ok := service.drivers[kind]; !ok {
		return ProviderRecord{}, errProviderKindUnsupported
	}

	baseURL := strings.TrimSpace(input.BaseURL)
	if baseURL != "" && !service.config.AllowUserCustomProviderURL {
		return ProviderRecord{}, errors.New("custom provider base URLs are disabled by server policy")
	}

	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" {
		return ProviderRecord{}, errors.New("api key is required")
	}

	now := time.Now().UnixMilli()
	row := providerRow{
		ID:                newID(),
		UserID:            userID,
		Kind:              kind,
		Label:             normalizedProviderLabel(input.Label),
		BaseURL:           baseURL,
		EncryptedAPIKey:   service.encryptSecret(apiKey),
		IsEnabled:         boolOrDefault(input.Enabled, true),
		SupportsModelSync: boolOrDefault(input.SupportsModelSync, service.config.AllowUserModelSync),
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if row.Label == "" {
		row.Label = "Custom Provider"
	}
	if !service.config.AllowUserModelSync {
		row.SupportsModelSync = false
	}

	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO user_providers(
			id,
			user_id,
			kind,
			label,
			base_url,
			api_key_encrypted,
			is_enabled,
			supports_model_sync,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, row.ID, row.UserID, row.Kind, row.Label, row.BaseURL, row.EncryptedAPIKey, boolAsInt(row.IsEnabled), boolAsInt(row.SupportsModelSync), row.CreatedAt, row.UpdatedAt); err != nil {
		return ProviderRecord{}, fmt.Errorf("create user provider: %w", err)
	}

	if err := service.invalidateProviderModelCache(ctx, userID, "user:"+row.ID); err != nil {
		return ProviderRecord{}, err
	}

	return providerRowToRecord(row), nil
}

func (service *ProviderService) UpdateProvider(
	ctx context.Context,
	userID string,
	providerID string,
	input UpdateProviderInput,
) (ProviderRecord, error) {
	if strings.HasPrefix(strings.TrimSpace(providerID), "system:") {
		return ProviderRecord{}, errProviderOwnedBySystem
	}

	row, err := service.findUserProvider(ctx, userID, providerID)
	if err != nil {
		return ProviderRecord{}, err
	}

	if input.Label != nil {
		row.Label = normalizedProviderLabel(*input.Label)
	}
	if input.BaseURL != nil {
		if strings.TrimSpace(*input.BaseURL) != "" && !service.config.AllowUserCustomProviderURL {
			return ProviderRecord{}, errors.New("custom provider base URLs are disabled by server policy")
		}
		row.BaseURL = strings.TrimSpace(*input.BaseURL)
	}
	if input.APIKey != nil {
		apiKey := strings.TrimSpace(*input.APIKey)
		if apiKey == "" {
			return ProviderRecord{}, errors.New("api key must not be empty")
		}
		row.EncryptedAPIKey = service.encryptSecret(apiKey)
	}
	if input.Enabled != nil {
		row.IsEnabled = *input.Enabled
	}
	if input.SupportsModelSync != nil {
		row.SupportsModelSync = *input.SupportsModelSync && service.config.AllowUserModelSync
	}
	row.UpdatedAt = time.Now().UnixMilli()

	if _, err := service.db.ExecContext(ctx, `
		UPDATE user_providers
		SET label = ?, base_url = ?, api_key_encrypted = ?, is_enabled = ?, supports_model_sync = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, row.Label, row.BaseURL, row.EncryptedAPIKey, boolAsInt(row.IsEnabled), boolAsInt(row.SupportsModelSync), row.UpdatedAt, row.ID, userID); err != nil {
		return ProviderRecord{}, fmt.Errorf("update user provider: %w", err)
	}

	if err := service.invalidateProviderModelCache(ctx, userID, "user:"+row.ID); err != nil {
		return ProviderRecord{}, err
	}

	return providerRowToRecord(row), nil
}

func (service *ProviderService) DeleteProvider(
	ctx context.Context,
	userID string,
	providerID string,
) error {
	if strings.HasPrefix(strings.TrimSpace(providerID), "system:") {
		return errProviderOwnedBySystem
	}

	result, err := service.db.ExecContext(ctx, `
		DELETE FROM user_providers
		WHERE id = ? AND user_id = ?
	`, strings.TrimSpace(providerID), userID)
	if err != nil {
		return fmt.Errorf("delete user provider: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete provider rows: %w", err)
	}
	if rowsAffected == 0 {
		return errProviderNotFound
	}
	if err := service.invalidateProviderModelCache(ctx, userID, "user:"+strings.TrimSpace(providerID)); err != nil {
		return err
	}
	return nil
}

func (service *ProviderService) findUserProvider(
	ctx context.Context,
	userID string,
	providerID string,
) (providerRow, error) {
	var row providerRow
	err := service.db.QueryRowContext(ctx, `
		SELECT
			id,
			user_id,
			kind,
			label,
			base_url,
			api_key_encrypted,
			is_enabled,
			supports_model_sync,
			created_at,
			updated_at
		FROM user_providers
		WHERE id = ? AND user_id = ?
	`, strings.TrimSpace(providerID), userID).Scan(
		&row.ID,
		&row.UserID,
		&row.Kind,
		&row.Label,
		&row.BaseURL,
		&row.EncryptedAPIKey,
		&row.IsEnabled,
		&row.SupportsModelSync,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return providerRow{}, errProviderNotFound
		}
		return providerRow{}, fmt.Errorf("load provider: %w", err)
	}
	return row, nil
}

func scanProviderRow(scanner interface {
	Scan(dest ...any) error
}) (providerRow, error) {
	var row providerRow
	if err := scanner.Scan(
		&row.ID,
		&row.UserID,
		&row.Kind,
		&row.Label,
		&row.BaseURL,
		&row.EncryptedAPIKey,
		&row.IsEnabled,
		&row.SupportsModelSync,
		&row.CreatedAt,
		&row.UpdatedAt,
	); err != nil {
		return providerRow{}, fmt.Errorf("scan provider: %w", err)
	}
	return row, nil
}

func providerRowToRecord(row providerRow) ProviderRecord {
	return ProviderRecord{
		ID:                row.ID,
		Ref:               "user:" + row.ID,
		Owner:             "user",
		Kind:              row.Kind,
		Label:             row.Label,
		BaseURL:           row.BaseURL,
		Enabled:           row.IsEnabled,
		SupportsModelSync: row.SupportsModelSync,
		SystemManaged:     false,
	}
}
