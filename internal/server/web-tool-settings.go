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

var webProviderNames = []string{"exa", "tinyfish"}

type WebToolProviderSettings struct {
	Provider         string `json:"provider"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	Enabled          bool   `json:"enabled"`
}
type WebToolSettings struct {
	Provider           string                    `json:"provider"`
	Providers          []WebToolProviderSettings `json:"providers"`
	APIKeyConfigured   bool                      `json:"apiKeyConfigured"`
	SearchMaxResults   int                       `json:"searchMaxResults"`
	FetchMaxCharacters int                       `json:"fetchMaxCharacters"`
	ToolCallLimit      int                       `json:"toolCallLimit"`
}
type UpdateWebToolProviderInput struct {
	Provider    string  `json:"provider"`
	APIKey      *string `json:"apiKey"`
	ClearAPIKey *bool   `json:"clearApiKey"`
	Enabled     *bool   `json:"enabled"`
}
type UpdateWebToolSettingsInput struct {
	Provider           *string                      `json:"provider"`
	Providers          []UpdateWebToolProviderInput `json:"providers"`
	APIKey             *string                      `json:"apiKey"`
	ClearAPIKey        *bool                        `json:"clearApiKey"`
	SearchMaxResults   *int                         `json:"searchMaxResults"`
	FetchMaxCharacters *int                         `json:"fetchMaxCharacters"`
	ToolCallLimit      *int                         `json:"toolCallLimit"`
}
type webToolSettingsRow struct {
	UserID, Provider, EncryptedAPIKey    string
	SearchMaxResults, FetchMaxCharacters int
	ToolCallLimit                        sql.NullInt64
	UpdatedAt                            int64
}
type webProviderRow struct {
	Provider, EncryptedAPIKey string
	Enabled                   bool
}
type WebToolSettingsService struct {
	db            *sql.DB
	encryptionKey [32]byte
	maxToolCalls  int
}

func NewWebToolSettingsService(db *sql.DB, config Config) *WebToolSettingsService {
	max := config.MaxToolCalls
	if max <= 0 {
		max = defaultMaxToolCalls
	}
	return &WebToolSettingsService{db: db, encryptionKey: config.ProviderEncryptionKey(), maxToolCalls: max}
}
func (s *WebToolSettingsService) GetSettings(ctx context.Context, userID string) (WebToolSettings, error) {
	row, found, err := s.findRow(ctx, userID)
	if err != nil {
		return WebToolSettings{}, err
	}
	if !found {
		row = defaultWebToolSettingsRow(userID)
	}
	providers, err := s.providerSettings(ctx, userID, row)
	if err != nil {
		return WebToolSettings{}, err
	}
	return row.toSettings(s.maxToolCalls, providers), nil
}
func (s *WebToolSettingsService) ResolveToolCallLimit(ctx context.Context, userID string) (int, error) {
	row, found, err := s.findRow(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !found || !row.ToolCallLimit.Valid || row.ToolCallLimit.Int64 <= 0 {
		return s.maxToolCalls, nil
	}
	return clampInt(int(row.ToolCallLimit.Int64), 1, maxToolCallLimit), nil
}
func (s *WebToolSettingsService) ResolveRuntime(ctx context.Context, userID string) (*WebToolRuntime, error) {
	row, found, err := s.findRow(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !found {
		row = defaultWebToolSettingsRow(userID)
	}
	providers, err := s.providerRows(ctx, userID, row)
	if err != nil {
		return nil, err
	}
	keys := map[string]string{}
	enabled := []string{}
	for _, p := range providers {
		key, err := s.resolveKey(p)
		if err != nil {
			return nil, err
		}
		if p.Enabled && key != "" {
			keys[p.Provider] = key
			enabled = append(enabled, p.Provider)
		}
	}
	defaultProvider := normalizeWebProvider(row.Provider)
	if _, ok := keys[defaultProvider]; !ok {
		defaultProvider = ""
		for _, name := range webProviderNames {
			if _, ok := keys[name]; ok {
				defaultProvider = name
				break
			}
		}
	}
	if defaultProvider == "" {
		return NewWebToolRuntime(WebToolRuntimeConfig{
			SearchMaxResults:   row.SearchMaxResults,
			FetchMaxCharacters: row.FetchMaxCharacters,
		}), nil
	}
	return NewWebToolRuntime(WebToolRuntimeConfig{ExaAPIKey: keys["exa"], TinyFishAPIKey: keys["tinyfish"], DefaultProvider: defaultProvider, EnabledProviders: enabled, SearchMaxResults: row.SearchMaxResults, FetchMaxCharacters: row.FetchMaxCharacters}), nil
}
func (s *WebToolSettingsService) UpdateSettings(ctx context.Context, userID string, input UpdateWebToolSettingsInput) (WebToolSettings, error) {
	row, found, err := s.findRow(ctx, userID)
	if err != nil {
		return WebToolSettings{}, err
	}
	if !found {
		row = defaultWebToolSettingsRow(userID)
	}

	legacyRequest := input.APIKey != nil || input.ClearAPIKey != nil
	if input.Provider != nil {
		provider := normalizeWebProvider(*input.Provider)
		if legacyRequest {
			if provider == "" && strings.TrimSpace(*input.Provider) == "" {
				provider = "exa"
			}
			if provider != "exa" {
				return WebToolSettings{}, errors.New("only exa web tools are supported for legacy settings requests")
			}
		} else if provider == "" {
			return WebToolSettings{}, errors.New("default web provider must be Exa or TinyFish")
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

	providerRows, err := s.providerRows(ctx, userID, row)
	if err != nil {
		return WebToolSettings{}, err
	}
	stagedProviders := make(map[string]webProviderRow, len(providerRows))
	for _, providerRow := range providerRows {
		stagedProviders[providerRow.Provider] = providerRow
	}
	updates := append([]UpdateWebToolProviderInput(nil), input.Providers...)
	if legacyRequest {
		legacyExaEnabled := true
		updates = append(updates, UpdateWebToolProviderInput{Provider: "exa", APIKey: input.APIKey, ClearAPIKey: input.ClearAPIKey, Enabled: &legacyExaEnabled})
	}
	for _, update := range updates {
		provider := normalizeWebProvider(update.Provider)
		if provider == "" {
			return WebToolSettings{}, fmt.Errorf("unknown web provider %q", update.Provider)
		}
		current := stagedProviders[provider]
		current.Provider = provider
		if update.ClearAPIKey != nil && *update.ClearAPIKey {
			current.EncryptedAPIKey = ""
		}
		if update.APIKey != nil && strings.TrimSpace(*update.APIKey) != "" {
			current.EncryptedAPIKey = encryptSecretWithKey(s.encryptionKey, strings.TrimSpace(*update.APIKey))
		}
		if update.Enabled != nil {
			current.Enabled = *update.Enabled
		}
		stagedProviders[provider] = current
	}

	configuredEnabled := map[string]bool{}
	for _, name := range webProviderNames {
		providerRow := stagedProviders[name]
		key, err := s.resolveKey(providerRow)
		if err != nil {
			return WebToolSettings{}, err
		}
		configuredEnabled[name] = providerRow.Enabled && key != ""
	}
	if input.Provider != nil && !legacyRequest && !configuredEnabled[row.Provider] {
		return WebToolSettings{}, fmt.Errorf("default web provider %s must be enabled and configured", row.Provider)
	}
	if !configuredEnabled[row.Provider] {
		for _, name := range webProviderNames {
			if configuredEnabled[name] {
				row.Provider = name
				break
			}
		}
	}

	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WebToolSettings{}, fmt.Errorf("begin web tool settings transaction: %w", err)
	}
	defer transaction.Rollback()
	for _, name := range webProviderNames {
		if err := s.upsertProviderRow(ctx, transaction, userID, stagedProviders[name]); err != nil {
			return WebToolSettings{}, err
		}
	}
	row.UpdatedAt = time.Now().UnixMilli()
	if err := s.upsertRow(ctx, transaction, row); err != nil {
		return WebToolSettings{}, err
	}
	if err := transaction.Commit(); err != nil {
		return WebToolSettings{}, fmt.Errorf("commit web tool settings transaction: %w", err)
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return WebToolSettings{}, err
	}
	return settings, nil
}
func (s *WebToolSettingsService) resolveKey(row webProviderRow) (string, error) {
	if strings.TrimSpace(row.EncryptedAPIKey) != "" {
		key, err := decryptSecretWithKey(s.encryptionKey, row.EncryptedAPIKey)
		return strings.TrimSpace(key), err
	}
	if row.Provider == "exa" {
		return strings.TrimSpace(os.Getenv(exaAPIKeyEnvVar)), nil
	}
	return strings.TrimSpace(os.Getenv(tinyFishAPIKeyEnvVar)), nil
}
func (s *WebToolSettingsService) providerRows(ctx context.Context, userID string, legacy webToolSettingsRow) ([]webProviderRow, error) {
	rows := make([]webProviderRow, 0, len(webProviderNames))
	for _, name := range webProviderNames {
		row, found, err := s.findProviderRow(ctx, userID, name)
		if err != nil {
			return nil, err
		}
		if !found && name == "exa" {
			row = webProviderRow{Provider: "exa", EncryptedAPIKey: legacy.EncryptedAPIKey, Enabled: true}
		}
		if !found {
			row.Provider = name
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func (s *WebToolSettingsService) providerSettings(ctx context.Context, userID string, legacy webToolSettingsRow) ([]WebToolProviderSettings, error) {
	rows, err := s.providerRows(ctx, userID, legacy)
	if err != nil {
		return nil, err
	}
	out := make([]WebToolProviderSettings, 0, len(rows))
	for _, row := range rows {
		key, err := s.resolveKey(row)
		if err != nil {
			return nil, err
		}
		out = append(out, WebToolProviderSettings{Provider: row.Provider, APIKeyConfigured: key != "", Enabled: row.Enabled})
	}
	return out, nil
}
func (s *WebToolSettingsService) findRow(ctx context.Context, userID string) (webToolSettingsRow, bool, error) {
	var row webToolSettingsRow
	err := s.db.QueryRowContext(ctx, `SELECT user_id,provider,encrypted_api_key,search_max_results,fetch_max_characters,tool_call_limit,updated_at FROM user_web_tool_settings WHERE user_id=?`, userID).Scan(&row.UserID, &row.Provider, &row.EncryptedAPIKey, &row.SearchMaxResults, &row.FetchMaxCharacters, &row.ToolCallLimit, &row.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return webToolSettingsRow{}, false, nil
	}
	if err != nil {
		return webToolSettingsRow{}, false, fmt.Errorf("load web tool settings: %w", err)
	}
	return row, true, nil
}
func (s *WebToolSettingsService) findProviderRow(ctx context.Context, userID, provider string) (webProviderRow, bool, error) {
	var row webProviderRow
	var enabled int
	err := s.db.QueryRowContext(ctx, `SELECT provider,encrypted_api_key,enabled FROM user_web_tool_providers WHERE user_id=? AND provider=?`, userID, provider).Scan(&row.Provider, &row.EncryptedAPIKey, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return webProviderRow{}, false, nil
	}
	if err != nil {
		return webProviderRow{}, false, fmt.Errorf("load web provider: %w", err)
	}
	row.Enabled = enabled != 0
	return row, true, nil
}
func (s *WebToolSettingsService) upsertRow(ctx context.Context, executor sqlExecutor, row webToolSettingsRow) error {
	_, err := executor.ExecContext(ctx, `INSERT INTO user_web_tool_settings (user_id,provider,encrypted_api_key,search_max_results,fetch_max_characters,tool_call_limit,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,encrypted_api_key=excluded.encrypted_api_key,search_max_results=excluded.search_max_results,fetch_max_characters=excluded.fetch_max_characters,tool_call_limit=excluded.tool_call_limit,updated_at=excluded.updated_at`, row.UserID, row.Provider, row.EncryptedAPIKey, row.SearchMaxResults, row.FetchMaxCharacters, row.ToolCallLimit, row.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save web tool settings: %w", err)
	}
	return nil
}
func (s *WebToolSettingsService) upsertProviderRow(ctx context.Context, executor sqlExecutor, userID string, row webProviderRow) error {
	_, err := executor.ExecContext(ctx, `INSERT INTO user_web_tool_providers(user_id,provider,encrypted_api_key,enabled,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key,enabled=excluded.enabled,updated_at=excluded.updated_at`, userID, row.Provider, row.EncryptedAPIKey, boolToInt(row.Enabled), time.Now().UnixMilli())
	return err
}
func defaultWebToolSettingsRow(userID string) webToolSettingsRow {
	return webToolSettingsRow{UserID: userID, Provider: "exa", SearchMaxResults: defaultWebSearchMaxResults, FetchMaxCharacters: exaMaxFetchCharacters, UpdatedAt: time.Now().UnixMilli()}
}
func (row webToolSettingsRow) toSettings(defaultLimit int, providers []WebToolProviderSettings) WebToolSettings {
	search := row.SearchMaxResults
	if search <= 0 {
		search = defaultWebSearchMaxResults
	}
	fetch := row.FetchMaxCharacters
	if fetch <= 0 {
		fetch = exaMaxFetchCharacters
	}
	limit := defaultLimit
	if row.ToolCallLimit.Valid && row.ToolCallLimit.Int64 > 0 {
		limit = clampInt(int(row.ToolCallLimit.Int64), 1, maxToolCallLimit)
	}
	return WebToolSettings{Provider: normalizeWebProvider(row.Provider), Providers: providers, APIKeyConfigured: providerAPIKeyConfigured(providers, "exa"), SearchMaxResults: search, FetchMaxCharacters: fetch, ToolCallLimit: limit}
}
func providerAPIKeyConfigured(providers []WebToolProviderSettings, name string) bool {
	for _, provider := range providers {
		if provider.Provider == name {
			return provider.APIKeyConfigured
		}
	}
	return false
}
func normalizeWebProvider(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, name := range webProviderNames {
		if value == name {
			return value
		}
	}
	return ""
}
func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
