package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

type WebToolSettings struct {
	Provider           string `json:"provider"`
	APIKeyConfigured   bool   `json:"apiKeyConfigured"`
	SearchMaxResults   int    `json:"searchMaxResults"`
	FetchMaxCharacters int    `json:"fetchMaxCharacters"`
	ToolCallLimit      int    `json:"toolCallLimit"`
}

type UpdateWebToolSettingsInput struct {
	Provider           *string `json:"provider"`
	APIKey             *string `json:"apiKey"`
	ClearAPIKey        *bool   `json:"clearApiKey"`
	SearchMaxResults   *int    `json:"searchMaxResults"`
	FetchMaxCharacters *int    `json:"fetchMaxCharacters"`
	ToolCallLimit      *int    `json:"toolCallLimit"`
}

type webToolSettingsRow struct {
	UserID             string
	Provider           string
	EncryptedAPIKey    string
	SearchMaxResults   int
	FetchMaxCharacters int
	ToolCallLimit      sql.NullInt64
	UpdatedAt          int64
}

type WebToolSettingsService struct {
	db            *sql.DB
	encryptionKey [32]byte
	maxToolCalls  int
}

func NewWebToolSettingsService(db *sql.DB, config Config) *WebToolSettingsService {
	maxToolCalls := config.MaxToolCalls
	if maxToolCalls <= 0 {
		maxToolCalls = defaultMaxToolCalls
	}
	return &WebToolSettingsService{
		db:            db,
		encryptionKey: config.ProviderEncryptionKey(),
		maxToolCalls:  maxToolCalls,
	}
}

func (service *WebToolSettingsService) GetSettings(ctx context.Context, userID string) (WebToolSettings, error) {
	row, found, err := service.findRow(ctx, userID)
	if err != nil {
		return WebToolSettings{}, err
	}
	if !found {
		return defaultWebToolSettings(service.maxToolCalls), nil
	}
	return row.toSettings(service.maxToolCalls), nil
}

func (service *WebToolSettingsService) ResolveToolCallLimit(ctx context.Context, userID string) (int, error) {
	row, found, err := service.findRow(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !found || !row.ToolCallLimit.Valid || row.ToolCallLimit.Int64 <= 0 {
		return service.maxToolCalls, nil
	}
	return clampInt(int(row.ToolCallLimit.Int64), 1, maxToolCallLimit), nil
}

func (service *WebToolSettingsService) ResolveRuntime(ctx context.Context, userID string) (*WebToolRuntime, error) {
	row, found, err := service.findRow(ctx, userID)
	if err != nil {
		return nil, err
	}
	settings := defaultWebToolSettingsRow(userID)
	if found {
		settings = row
	}
	apiKey := ""
	if strings.TrimSpace(settings.EncryptedAPIKey) != "" {
		apiKey, err = decryptSecretWithKey(service.encryptionKey, settings.EncryptedAPIKey)
		if err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(apiKey) == "" {
		apiKey = strings.TrimSpace(os.Getenv(exaAPIKeyEnvVar))
	}
	return NewWebToolRuntime(WebToolRuntimeConfig{
		ExaAPIKey:          apiKey,
		SearchMaxResults:   settings.SearchMaxResults,
		FetchMaxCharacters: settings.FetchMaxCharacters,
	}), nil
}

func (service *WebToolSettingsService) UpdateSettings(ctx context.Context, userID string, input UpdateWebToolSettingsInput) (WebToolSettings, error) {
	row, found, err := service.findRow(ctx, userID)
	if err != nil {
		return WebToolSettings{}, err
	}
	if !found {
		row = defaultWebToolSettingsRow(userID)
	}
	if input.Provider != nil {
		provider := strings.ToLower(strings.TrimSpace(*input.Provider))
		if provider == "" {
			provider = "exa"
		}
		if provider != "exa" {
			return WebToolSettings{}, errors.New("only exa web tools are supported right now")
		}
		row.Provider = provider
	}
	if input.SearchMaxResults != nil {
		row.SearchMaxResults = clampInt(*input.SearchMaxResults, 1, 10)
	}
	if input.FetchMaxCharacters != nil {
		row.FetchMaxCharacters = clampInt(*input.FetchMaxCharacters, 1000, 50000)
	}
	if input.ToolCallLimit != nil {
		row.ToolCallLimit = sql.NullInt64{Int64: int64(clampInt(*input.ToolCallLimit, 1, maxToolCallLimit)), Valid: true}
	}
	if input.ClearAPIKey != nil && *input.ClearAPIKey {
		row.EncryptedAPIKey = ""
	}
	if input.APIKey != nil && strings.TrimSpace(*input.APIKey) != "" {
		row.EncryptedAPIKey = encryptSecretWithKey(service.encryptionKey, strings.TrimSpace(*input.APIKey))
	}
	row.UpdatedAt = time.Now().UnixMilli()
	if err := service.upsertRow(ctx, row); err != nil {
		return WebToolSettings{}, err
	}
	return row.toSettings(service.maxToolCalls), nil
}

func (service *WebToolSettingsService) findRow(ctx context.Context, userID string) (webToolSettingsRow, bool, error) {
	var row webToolSettingsRow
	err := service.db.QueryRowContext(ctx, `
		SELECT user_id, provider, encrypted_api_key, search_max_results, fetch_max_characters, tool_call_limit, updated_at
		FROM user_web_tool_settings
		WHERE user_id = ?
	`, userID).Scan(&row.UserID, &row.Provider, &row.EncryptedAPIKey, &row.SearchMaxResults, &row.FetchMaxCharacters, &row.ToolCallLimit, &row.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return webToolSettingsRow{}, false, nil
	}
	if err != nil {
		return webToolSettingsRow{}, false, fmt.Errorf("load web tool settings: %w", err)
	}
	return row, true, nil
}

func (service *WebToolSettingsService) upsertRow(ctx context.Context, row webToolSettingsRow) error {
	_, err := service.db.ExecContext(ctx, `
		INSERT INTO user_web_tool_settings (user_id, provider, encrypted_api_key, search_max_results, fetch_max_characters, tool_call_limit, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			provider = excluded.provider,
			encrypted_api_key = excluded.encrypted_api_key,
			search_max_results = excluded.search_max_results,
			fetch_max_characters = excluded.fetch_max_characters,
			tool_call_limit = excluded.tool_call_limit,
			updated_at = excluded.updated_at
	`, row.UserID, row.Provider, row.EncryptedAPIKey, row.SearchMaxResults, row.FetchMaxCharacters, row.ToolCallLimit, row.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save web tool settings: %w", err)
	}
	return nil
}

func defaultWebToolSettings(maxToolCalls int) WebToolSettings {
	return WebToolSettings{Provider: "exa", SearchMaxResults: defaultWebSearchMaxResults, FetchMaxCharacters: exaMaxFetchCharacters, ToolCallLimit: maxToolCalls}
}

func defaultWebToolSettingsRow(userID string) webToolSettingsRow {
	return webToolSettingsRow{UserID: userID, Provider: "exa", SearchMaxResults: defaultWebSearchMaxResults, FetchMaxCharacters: exaMaxFetchCharacters, UpdatedAt: time.Now().UnixMilli()}
}

func (row webToolSettingsRow) toSettings(defaultToolCallLimit int) WebToolSettings {
	provider := strings.TrimSpace(row.Provider)
	if provider == "" {
		provider = "exa"
	}
	searchMaxResults := row.SearchMaxResults
	if searchMaxResults <= 0 {
		searchMaxResults = defaultWebSearchMaxResults
	}
	fetchMaxCharacters := row.FetchMaxCharacters
	if fetchMaxCharacters <= 0 {
		fetchMaxCharacters = exaMaxFetchCharacters
	}
	toolCallLimit := defaultToolCallLimit
	if row.ToolCallLimit.Valid && row.ToolCallLimit.Int64 > 0 {
		toolCallLimit = clampInt(int(row.ToolCallLimit.Int64), 1, maxToolCallLimit)
	}
	return WebToolSettings{
		Provider:           provider,
		APIKeyConfigured:   strings.TrimSpace(row.EncryptedAPIKey) != "",
		SearchMaxResults:   searchMaxResults,
		FetchMaxCharacters: fetchMaxCharacters,
		ToolCallLimit:      toolCallLimit,
	}
}
