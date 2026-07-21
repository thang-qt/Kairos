package server

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type ChatSettingsPreferences struct {
	DefaultSettings ConversationSettings            `json:"defaultSettings"`
	ModelOverrides  map[string]ConversationSettings `json:"modelOverrides"`
}

func (service *ProviderService) GetChatSettingsPreferences(
	ctx context.Context,
	userID string,
) (ChatSettingsPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return ChatSettingsPreferences{}, err
	}

	var raw string
	if err := service.db.QueryRowContext(ctx, `
		SELECT default_chat_settings_json
		FROM user_preferences
		WHERE user_id = ?
	`, userID).Scan(&raw); err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("load default chat settings: %w", err)
	}
	defaults, err := decodeConversationSettings(raw)
	if err != nil {
		return ChatSettingsPreferences{}, err
	}

	rows, err := service.db.QueryContext(ctx, `
		SELECT model_id, settings_json
		FROM user_model_chat_settings
		WHERE user_id = ?
	`, userID)
	if err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("list model chat settings: %w", err)
	}
	defer rows.Close()

	overrides := make(map[string]ConversationSettings)
	for rows.Next() {
		var modelID, settingsJSON string
		if err := rows.Scan(&modelID, &settingsJSON); err != nil {
			return ChatSettingsPreferences{}, fmt.Errorf("scan model chat settings: %w", err)
		}
		settings, err := decodeConversationSettings(settingsJSON)
		if err != nil {
			return ChatSettingsPreferences{}, err
		}
		overrides[modelID] = settings
	}
	if err := rows.Err(); err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("iterate model chat settings: %w", err)
	}

	return ChatSettingsPreferences{
		DefaultSettings: defaults,
		ModelOverrides:  overrides,
	}, nil
}

func (service *ProviderService) UpdateDefaultChatSettings(
	ctx context.Context,
	userID string,
	settings ConversationSettings,
) (ChatSettingsPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return ChatSettingsPreferences{}, err
	}
	settingsJSON, err := encodeConversationSettings(settings)
	if err != nil {
		return ChatSettingsPreferences{}, err
	}
	if _, err := service.db.ExecContext(ctx, `
		UPDATE user_preferences
		SET default_chat_settings_json = ?, updated_at = ?
		WHERE user_id = ?
	`, settingsJSON, time.Now().UnixMilli(), userID); err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("update default chat settings: %w", err)
	}
	return service.GetChatSettingsPreferences(ctx, userID)
}

func (service *ProviderService) UpdateModelChatSettings(
	ctx context.Context,
	userID string,
	modelID string,
	settings ConversationSettings,
) (ChatSettingsPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return ChatSettingsPreferences{}, err
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return ChatSettingsPreferences{}, fmt.Errorf("model id is required")
	}
	settingsJSON, err := encodeConversationSettings(settings)
	if err != nil {
		return ChatSettingsPreferences{}, err
	}
	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO user_model_chat_settings(user_id, model_id, settings_json, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, model_id) DO UPDATE SET
			settings_json = excluded.settings_json,
			updated_at = excluded.updated_at
	`, userID, modelID, settingsJSON, time.Now().UnixMilli()); err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("update model chat settings: %w", err)
	}
	return service.GetChatSettingsPreferences(ctx, userID)
}

func (service *ProviderService) DeleteModelChatSettings(
	ctx context.Context,
	userID string,
	modelID string,
) (ChatSettingsPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return ChatSettingsPreferences{}, err
	}
	if _, err := service.db.ExecContext(ctx, `
		DELETE FROM user_model_chat_settings
		WHERE user_id = ? AND model_id = ?
	`, userID, strings.TrimSpace(modelID)); err != nil {
		return ChatSettingsPreferences{}, fmt.Errorf("delete model chat settings: %w", err)
	}
	return service.GetChatSettingsPreferences(ctx, userID)
}
