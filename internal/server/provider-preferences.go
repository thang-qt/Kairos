package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (service *ProviderService) GetPreferences(
	ctx context.Context,
	userID string,
) (UserPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return UserPreferences{}, err
	}

	var preferences UserPreferences
	var defaultModel sql.NullString
	var titleGenerationModelID sql.NullString
	err := service.db.QueryRowContext(ctx, `
		SELECT
			use_system_providers,
			default_model_id,
			auto_generate_title,
			use_separate_title_model,
			title_generation_model_id
		FROM user_preferences
		WHERE user_id = ?
	`, userID).Scan(
		&preferences.UseSystemProviders,
		&defaultModel,
		&preferences.AutoGenerateTitle,
		&preferences.UseSeparateTitleModel,
		&titleGenerationModelID,
	)
	if err != nil {
		return UserPreferences{}, fmt.Errorf("load user preferences: %w", err)
	}
	preferences.DefaultModelID = nullStringValue(defaultModel)
	preferences.TitleGenerationModelID = nullStringValue(titleGenerationModelID)
	if service.system == nil {
		preferences.UseSystemProviders = false
	}
	return preferences, nil
}

func (service *ProviderService) UpdatePreferences(
	ctx context.Context,
	userID string,
	input UpdateUserPreferencesInput,
) (UserPreferences, error) {
	preferences, err := service.GetPreferences(ctx, userID)
	if err != nil {
		return UserPreferences{}, err
	}

	if input.UseSystemProviders != nil {
		if service.system == nil {
			preferences.UseSystemProviders = false
		} else if !service.config.AllowUserDisableSystem || !service.system.AllowDisable {
			if !*input.UseSystemProviders {
				return UserPreferences{}, errSystemProviderDisableLocked
			}
			preferences.UseSystemProviders = true
		} else {
			preferences.UseSystemProviders = *input.UseSystemProviders
		}
	}
	if input.DefaultModelID != nil {
		if service.config.LockChatModel {
			return UserPreferences{}, errors.New("default model selection is locked by server policy")
		}
		preferences.DefaultModelID = strings.TrimSpace(*input.DefaultModelID)
	}
	if input.AutoGenerateTitle != nil {
		preferences.AutoGenerateTitle = *input.AutoGenerateTitle
	}
	if input.UseSeparateTitleModel != nil {
		preferences.UseSeparateTitleModel = *input.UseSeparateTitleModel
	}
	if input.TitleGenerationModelID != nil {
		preferences.TitleGenerationModelID = strings.TrimSpace(*input.TitleGenerationModelID)
	}

	now := time.Now().UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		UPDATE user_preferences
		SET
			use_system_providers = ?,
			default_model_id = ?,
			auto_generate_title = ?,
			use_separate_title_model = ?,
			title_generation_model_id = ?,
			updated_at = ?
		WHERE user_id = ?
	`,
		boolAsInt(preferences.UseSystemProviders),
		nullableString(preferences.DefaultModelID),
		boolAsInt(preferences.AutoGenerateTitle),
		boolAsInt(preferences.UseSeparateTitleModel),
		nullableString(preferences.TitleGenerationModelID),
		now,
		userID,
	); err != nil {
		return UserPreferences{}, fmt.Errorf("update user preferences: %w", err)
	}
	return preferences, nil
}

func (service *ProviderService) ensureUserPreferences(ctx context.Context, userID string) error {
	now := time.Now().UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO user_preferences(user_id, use_system_providers, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO NOTHING
	`, userID, boolAsInt(service.system != nil), now, now); err != nil {
		return fmt.Errorf("ensure user preferences: %w", err)
	}
	return nil
}
