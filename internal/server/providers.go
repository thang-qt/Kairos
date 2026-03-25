package server

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

var errProvidersDisabled = errors.New("user-managed providers are disabled by server policy")
var errProviderNotFound = errors.New("provider not found")
var errProviderOwnedBySystem = errors.New("system providers are managed by the server")
var errSystemProviderDisableLocked = errors.New("system provider usage is locked by server policy")
var errProviderKindUnsupported = errors.New("provider kind is not supported")
var errNoProviderAvailable = errors.New("no enabled provider is available for this account")
var errNoModelAvailable = errors.New("no chat model is available for the selected provider")
var errModelNotAvailable = errors.New("selected chat model is not available")

type ProviderCapabilities struct {
	SystemProvidersEnabled   bool `json:"systemProvidersEnabled"`
	UserProvidersEnabled     bool `json:"userProvidersEnabled"`
	CanDisableSystemProvider bool `json:"canDisableSystemProvider"`
	CanAddCustomBaseURL      bool `json:"canAddCustomBaseUrl"`
	CanSyncModels            bool `json:"canSyncModels"`
}

type ModelCapabilities struct {
	CanSelectModel     bool `json:"canSelectModel"`
	DefaultModelLocked bool `json:"defaultModelLocked"`
}

type UserPreferences struct {
	UseSystemProviders bool   `json:"useSystemProviders"`
	DefaultModelID     string `json:"defaultModelId,omitempty"`
}

type ProviderRecord struct {
	ID                string `json:"id"`
	Ref               string `json:"ref"`
	Owner             string `json:"owner"`
	Kind              string `json:"kind"`
	Label             string `json:"label"`
	BaseURL           string `json:"baseUrl,omitempty"`
	Enabled           bool   `json:"enabled"`
	SupportsModelSync bool   `json:"supportsModelSync"`
	SystemManaged     bool   `json:"systemManaged"`
}

type ProviderModel struct {
	ID            string `json:"id"`
	Object        string `json:"object"`
	Created       int64  `json:"created"`
	OwnedBy       string `json:"owned_by"`
	Name          string `json:"name,omitempty"`
	Description   string `json:"description,omitempty"`
	ContextWindow int64  `json:"contextWindow,omitempty"`
	ProviderRef   string `json:"providerRef,omitempty"`
	ProviderLabel string `json:"providerLabel,omitempty"`
}

type CreateProviderInput struct {
	Kind              string `json:"kind"`
	Label             string `json:"label"`
	BaseURL           string `json:"baseUrl"`
	APIKey            string `json:"apiKey"`
	Enabled           *bool  `json:"enabled"`
	SupportsModelSync *bool  `json:"supportsModelSync"`
}

type UpdateProviderInput struct {
	Label             *string `json:"label"`
	BaseURL           *string `json:"baseUrl"`
	APIKey            *string `json:"apiKey"`
	Enabled           *bool   `json:"enabled"`
	SupportsModelSync *bool   `json:"supportsModelSync"`
}

type UpdateUserPreferencesInput struct {
	UseSystemProviders *bool   `json:"useSystemProviders"`
	DefaultModelID     *string `json:"defaultModelId"`
}

type UpdateModelMetadataInput struct {
	ModelID       string  `json:"modelId"`
	Name          *string `json:"name"`
	Description   *string `json:"description"`
	ContextWindow *int64  `json:"contextWindow"`
}

type providerRow struct {
	ID                string
	UserID            string
	Kind              string
	Label             string
	BaseURL           string
	EncryptedAPIKey   string
	IsEnabled         bool
	SupportsModelSync bool
	CreatedAt         int64
	UpdatedAt         int64
}

type systemProvider struct {
	ID                string
	Kind              string
	Label             string
	BaseURL           string
	APIKey            string
	Enabled           bool
	AllowDisable      bool
	SupportsModelSync bool
	StaticModels      []string
}

type resolvedProvider struct {
	Record       ProviderRecord
	BaseURL      string
	APIKey       string
	StaticModels []string
}

type modelMetadataOverrideRow struct {
	UserID        string
	ModelID       string
	Name          string
	Description   string
	ContextWindow int64
	CreatedAt     int64
	UpdatedAt     int64
}

type modelCatalogEntry struct {
	Name          string
	Description   string
	ContextWindow int64
}

type ChatGenerationRequest struct {
	Model    string
	Messages []ProviderMessage
}

type ChatGenerationDelta struct {
	Text     string
	Thinking string
}

type ChatGenerationResult struct {
	Model            string
	ModelName        string
	ModelDescription string
	OutputText       string
	ThinkingText     string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

type ProviderMessage struct {
	Role  string
	Parts []ProviderMessagePart
}

type ProviderMessagePart struct {
	Type     string
	Text     string
	MimeType string
	Content  string
}

type ProviderDriver interface {
	Kind() string
	ListModels(ctx context.Context, provider resolvedProvider) ([]ProviderModel, error)
	GenerateChatStream(
		ctx context.Context,
		provider resolvedProvider,
		request ChatGenerationRequest,
		onDelta func(delta ChatGenerationDelta) error,
	) (ChatGenerationResult, error)
}

type OpenAICompatibleDriver struct {
	httpClient *http.Client
}

func (driver *OpenAICompatibleDriver) Kind() string {
	return "openai_compatible"
}

func (driver *OpenAICompatibleDriver) ListModels(
	ctx context.Context,
	provider resolvedProvider,
) ([]ProviderModel, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
	if baseURL == "" || strings.TrimSpace(provider.APIKey) == "" {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build model request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)

	response, err := driver.httpClient.Do(request)
	if err != nil {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	var payload struct {
		Data []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	models := make([]ProviderModel, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		models = append(models, ProviderModel{
			ID:            item.ID,
			Object:        "model",
			Created:       item.Created,
			OwnedBy:       fallbackString(item.OwnedBy, provider.Record.Label),
			ProviderRef:   provider.Record.Ref,
			ProviderLabel: provider.Record.Label,
		})
	}
	if len(models) == 0 {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	slices.SortFunc(models, func(left ProviderModel, right ProviderModel) int {
		return strings.Compare(left.ID, right.ID)
	})
	return models, nil
}

func (driver *OpenAICompatibleDriver) GenerateChatStream(
	ctx context.Context,
	provider resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	client := openai.NewClient(driver.requestOptions(provider)...)
	params := openai.ChatCompletionNewParams{
		Messages: buildOpenAIChatMessages(request.Messages),
		Model:    openai.ChatModel(strings.TrimSpace(request.Model)),
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: openai.Bool(true),
		},
	}

	stream := client.Chat.Completions.NewStreaming(ctx, params)
	defer stream.Close()

	accumulator := openai.ChatCompletionAccumulator{}
	for stream.Next() {
		chunk := stream.Current()
		accumulator.AddChunk(chunk)
		if len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		if err := onDelta(ChatGenerationDelta{Text: delta}); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := stream.Err(); err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream chat completion: %w", err)
	}

	outputText := ""
	if len(accumulator.Choices) > 0 {
		outputText = accumulator.Choices[0].Message.Content
	}
	modelID := strings.TrimSpace(accumulator.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(request.Model)
	}

	return ChatGenerationResult{
		Model:            modelID,
		ModelName:        fallbackString(modelID, provider.Record.Label),
		ModelDescription: provider.Record.Label,
		OutputText:       outputText,
		PromptTokens:     accumulator.Usage.PromptTokens,
		CompletionTokens: accumulator.Usage.CompletionTokens,
		TotalTokens:      accumulator.Usage.TotalTokens,
	}, nil
}

type ProviderService struct {
	db            *sql.DB
	config        Config
	encryptionKey [32]byte
	drivers       map[string]ProviderDriver
	system        *systemProvider
	modelCatalog  *modelCatalog
}

type modelCatalog struct {
	httpClient *http.Client
	ttl        time.Duration
	mu         sync.Mutex
	expiresAt  time.Time
	entries    map[string]modelCatalogEntry
}

func NewProviderService(db *sql.DB, config Config) *ProviderService {
	service := &ProviderService{
		db:            db,
		config:        config,
		encryptionKey: config.ProviderEncryptionKey(),
		drivers: map[string]ProviderDriver{
			"openai_compatible": &OpenAICompatibleDriver{
				httpClient: &http.Client{Timeout: 10 * time.Second},
			},
		},
		modelCatalog: newModelCatalog(),
	}
	if config.SystemProviderEnabled {
		service.system = &systemProvider{
			ID:                config.SystemProviderID,
			Kind:              config.SystemProviderKind,
			Label:             config.SystemProviderLabel,
			BaseURL:           config.SystemProviderBaseURL,
			APIKey:            config.SystemProviderAPIKey,
			Enabled:           config.SystemProviderEnabled,
			AllowDisable:      config.AllowUserDisableSystem && config.SystemProviderAllowDisable,
			SupportsModelSync: config.SystemProviderModelSync,
			StaticModels:      append([]string(nil), config.SystemProviderStaticModels...),
		}
	}
	return service
}

func newModelCatalog() *modelCatalog {
	return &modelCatalog{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		ttl:        12 * time.Hour,
		entries:    make(map[string]modelCatalogEntry),
	}
}

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
	if strings.TrimSpace(input.Kind) == "" {
		input.Kind = "openai_compatible"
	}
	if input.Kind != "openai_compatible" {
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
		Kind:              "openai_compatible",
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
	return nil
}

func (service *ProviderService) GetPreferences(
	ctx context.Context,
	userID string,
) (UserPreferences, error) {
	if err := service.ensureUserPreferences(ctx, userID); err != nil {
		return UserPreferences{}, err
	}

	var preferences UserPreferences
	var defaultModel sql.NullString
	err := service.db.QueryRowContext(ctx, `
		SELECT use_system_providers, default_model_id
		FROM user_preferences
		WHERE user_id = ?
	`, userID).Scan(&preferences.UseSystemProviders, &defaultModel)
	if err != nil {
		return UserPreferences{}, fmt.Errorf("load user preferences: %w", err)
	}
	preferences.DefaultModelID = nullStringValue(defaultModel)
	if service.system == nil {
		preferences.UseSystemProviders = false
	}
	return preferences, nil
}

func (service *ProviderService) TestConnection(
	ctx context.Context,
	userID string,
	kind string,
	baseURL string,
	apiKey string,
) error {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" || kind != "openai_compatible" {
		return errProviderKindUnsupported
	}

	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)

	if baseURL == "" {
		return errors.New("base URL is required")
	}
	if apiKey == "" {
		return errors.New("API key is required")
	}

	driver, ok := service.drivers[kind]
	if !ok {
		return errProviderKindUnsupported
	}

	testProvider := resolvedProvider{
		Record: ProviderRecord{
			Kind:  kind,
			Label: "Test Connection",
		},
		BaseURL: baseURL,
		APIKey:  apiKey,
	}

	testCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	_, err := driver.ListModels(testCtx, testProvider)
	if err != nil {
		return fmt.Errorf("connection test failed: %w", err)
	}

	return nil
}

func (service *ProviderService) TestProviderConnection(
	ctx context.Context,
	userID string,
	providerID string,
) error {
	provider, err := service.resolveProvider(ctx, userID, providerID)
	if err != nil {
		return err
	}

	driver, ok := service.drivers[provider.Record.Kind]
	if !ok {
		return errProviderKindUnsupported
	}

	testCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	_, err = driver.ListModels(testCtx, provider)
	if err != nil {
		return fmt.Errorf("connection test failed: %w", err)
	}

	return nil
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

	now := time.Now().UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		UPDATE user_preferences
		SET use_system_providers = ?, default_model_id = ?, updated_at = ?
		WHERE user_id = ?
	`, boolAsInt(preferences.UseSystemProviders), nullableString(preferences.DefaultModelID), now, userID); err != nil {
		return UserPreferences{}, fmt.Errorf("update user preferences: %w", err)
	}
	return preferences, nil
}

func (service *ProviderService) ListModels(
	ctx context.Context,
	userID string,
) ([]ProviderModel, UserPreferences, error) {
	providers, preferences, err := service.ListProviders(ctx, userID)
	if err != nil {
		return nil, UserPreferences{}, err
	}

	visibleModels := make([]ProviderModel, 0)
	seen := make(map[string]struct{})
	for _, record := range providers {
		if record.Owner == "system" && !preferences.UseSystemProviders {
			continue
		}
		if !record.Enabled {
			continue
		}
		resolved, err := service.resolveProvider(ctx, userID, record.Ref)
		if err != nil {
			continue
		}
		driver := service.drivers[resolved.Record.Kind]
		if driver == nil {
			continue
		}
		models, err := driver.ListModels(ctx, resolved)
		if err != nil {
			continue
		}
		for _, model := range models {
			if strings.TrimSpace(model.ID) == "" {
				continue
			}
			if _, exists := seen[model.ID]; exists {
				continue
			}
			seen[model.ID] = struct{}{}
			visibleModels = append(visibleModels, model)
		}
	}

	if len(visibleModels) == 0 {
		return nil, preferences, nil
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

func (service *ProviderService) ResolveGenerationTarget(
	ctx context.Context,
	userID string,
	requestedModel string,
) (resolvedProvider, ProviderModel, UserPreferences, error) {
	providers, preferences, err := service.ListProviders(ctx, userID)
	if err != nil {
		return resolvedProvider{}, ProviderModel{}, UserPreferences{}, err
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
	if len(candidates) == 0 {
		return resolvedProvider{}, ProviderModel{}, preferences, errNoProviderAvailable
	}

	type candidateModel struct {
		Provider resolvedProvider
		Model    ProviderModel
	}

	models := make([]candidateModel, 0)
	for _, record := range candidates {
		resolved, err := service.resolveProvider(ctx, userID, record.Ref)
		if err != nil {
			continue
		}
		driver := service.drivers[resolved.Record.Kind]
		if driver == nil {
			continue
		}
		visibleModels, err := driver.ListModels(ctx, resolved)
		if err != nil {
			continue
		}
		for _, model := range visibleModels {
			models = append(models, candidateModel{
				Provider: resolved,
				Model:    model,
			})
		}
	}

	effectiveModel := strings.TrimSpace(requestedModel)
	if effectiveModel == "" {
		effectiveModel = strings.TrimSpace(preferences.DefaultModelID)
	}
	if effectiveModel == "" {
		effectiveModel = strings.TrimSpace(service.config.DefaultChatModel)
	}
	if effectiveModel == "" && len(models) > 0 {
		effectiveModel = strings.TrimSpace(models[0].Model.ID)
	}
	if effectiveModel == "" {
		return resolvedProvider{}, ProviderModel{}, preferences, errNoModelAvailable
	}

	for _, candidate := range models {
		if strings.TrimSpace(candidate.Model.ID) != effectiveModel {
			continue
		}
		return candidate.Provider, service.enrichModel(ctx, userID, candidate.Model), preferences, nil
	}

	if len(candidates) == 1 {
		resolved, err := service.resolveProvider(ctx, userID, candidates[0].Ref)
		if err != nil {
			return resolvedProvider{}, ProviderModel{}, preferences, err
		}
		return resolved, service.enrichModel(ctx, userID, ProviderModel{
			ID:            effectiveModel,
			Object:        "model",
			OwnedBy:       candidates[0].Label,
			ProviderRef:   candidates[0].Ref,
			ProviderLabel: candidates[0].Label,
		}), preferences, nil
	}

	return resolvedProvider{}, ProviderModel{}, preferences, errModelNotAvailable
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

func (service *ProviderService) encryptSecret(plaintext string) string {
	block, err := aes.NewCipher(service.encryptionKey[:])
	if err != nil {
		panic(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		panic(err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(append(nonce, sealed...))
}

func (service *ProviderService) decryptSecret(ciphertext string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode encrypted secret: %w", err)
	}
	block, err := aes.NewCipher(service.encryptionKey[:])
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	if len(decoded) < gcm.NonceSize() {
		return "", errors.New("encrypted secret is truncated")
	}
	nonce := decoded[:gcm.NonceSize()]
	payload := decoded[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(plaintext), nil
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

func (catalog *modelCatalog) lookupMany(
	ctx context.Context,
	ids []string,
) map[string]modelCatalogEntry {
	result := make(map[string]modelCatalogEntry)
	if len(ids) == 0 {
		return result
	}

	entries, err := catalog.load(ctx, false)
	if err != nil {
		return result
	}

	for _, id := range ids {
		normalizedID := strings.TrimSpace(id)
		if normalizedID == "" {
			continue
		}
		if entry, ok := entries[normalizedID]; ok {
			result[normalizedID] = entry
		}
	}
	return result
}

func (catalog *modelCatalog) load(
	ctx context.Context,
	force bool,
) (map[string]modelCatalogEntry, error) {
	catalog.mu.Lock()
	defer catalog.mu.Unlock()

	if !force && time.Now().Before(catalog.expiresAt) && len(catalog.entries) > 0 {
		return cloneModelCatalogEntries(catalog.entries), nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://models.dev/api.json", nil)
	if err != nil {
		return nil, fmt.Errorf("build models.dev request: %w", err)
	}

	response, err := catalog.httpClient.Do(request)
	if err != nil {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("fetch models.dev catalog: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("fetch models.dev catalog: status %d", response.StatusCode)
	}

	var payload any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, fmt.Errorf("decode models.dev catalog: %w", err)
	}

	entries := make(map[string]modelCatalogEntry)
	extractModelCatalogEntries(payload, entries)
	if len(entries) == 0 {
		if len(catalog.entries) > 0 {
			return cloneModelCatalogEntries(catalog.entries), nil
		}
		return nil, errors.New("models.dev catalog was empty")
	}

	catalog.entries = entries
	catalog.expiresAt = time.Now().Add(catalog.ttl)
	return cloneModelCatalogEntries(entries), nil
}

func cloneModelCatalogEntries(
	source map[string]modelCatalogEntry,
) map[string]modelCatalogEntry {
	result := make(map[string]modelCatalogEntry, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func extractModelCatalogEntries(value any, result map[string]modelCatalogEntry) {
	switch typed := value.(type) {
	case map[string]any:
		if entryID, entry, ok := parseModelCatalogEntry(typed); ok {
			result[entryID] = mergeModelCatalogEntries(result[entryID], entry)
		}
		for _, nested := range typed {
			extractModelCatalogEntries(nested, result)
		}
	case []any:
		for _, nested := range typed {
			extractModelCatalogEntries(nested, result)
		}
	}
}

func parseModelCatalogEntry(
	value map[string]any,
) (string, modelCatalogEntry, bool) {
	id := strings.TrimSpace(stringValue(value["id"]))
	if id == "" {
		return "", modelCatalogEntry{}, false
	}

	entry := modelCatalogEntry{
		Name:          strings.TrimSpace(stringValue(value["name"])),
		Description:   strings.TrimSpace(stringValue(value["description"])),
		ContextWindow: catalogInt64Value(value["contextWindow"]),
	}
	if entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(value["context_window"])
	}
	if entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(value["context"])
	}
	if limits, ok := value["limit"].(map[string]any); ok && entry.ContextWindow <= 0 {
		entry.ContextWindow = catalogInt64Value(limits["context"])
	}
	if entry.Name == "" && entry.Description == "" && entry.ContextWindow <= 0 {
		return "", modelCatalogEntry{}, false
	}
	return id, entry, true
}

func mergeModelCatalogEntries(
	current modelCatalogEntry,
	next modelCatalogEntry,
) modelCatalogEntry {
	if strings.TrimSpace(current.Name) == "" && strings.TrimSpace(next.Name) != "" {
		current.Name = strings.TrimSpace(next.Name)
	}
	if len(strings.TrimSpace(next.Description)) > len(strings.TrimSpace(current.Description)) {
		current.Description = strings.TrimSpace(next.Description)
	}
	if next.ContextWindow > current.ContextWindow {
		current.ContextWindow = next.ContextWindow
	}
	return current
}

func applyModelCatalogEntry(
	model ProviderModel,
	entry modelCatalogEntry,
) ProviderModel {
	if strings.TrimSpace(model.Name) == "" && strings.TrimSpace(entry.Name) != "" {
		model.Name = strings.TrimSpace(entry.Name)
	}
	if strings.TrimSpace(model.Description) == "" && strings.TrimSpace(entry.Description) != "" {
		model.Description = strings.TrimSpace(entry.Description)
	}
	if model.ContextWindow <= 0 && entry.ContextWindow > 0 {
		model.ContextWindow = entry.ContextWindow
	}
	return model
}

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

func catalogInt64Value(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float32:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return parsed
		}
	case string:
		parsed, err := json.Number(strings.TrimSpace(typed)).Int64()
		if err == nil {
			return parsed
		}
	}
	return 0
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

func (driver *OpenAICompatibleDriver) requestOptions(provider resolvedProvider) []option.RequestOption {
	options := []option.RequestOption{
		option.WithAPIKey(strings.TrimSpace(provider.APIKey)),
	}
	if baseURL := normalizeProviderBaseURL(provider.BaseURL); baseURL != "" {
		options = append(options, option.WithBaseURL(baseURL))
	}
	return options
}

func buildOpenAIChatMessages(messages []ProviderMessage) []openai.ChatCompletionMessageParamUnion {
	params := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages))
	for _, message := range messages {
		switch strings.TrimSpace(message.Role) {
		case "assistant":
			text := collectProviderMessageText(message.Parts)
			if text == "" {
				continue
			}
			params = append(params, openai.AssistantMessage(text))
		case "system":
			text := collectProviderMessageText(message.Parts)
			if text == "" {
				continue
			}
			params = append(params, openai.SystemMessage(text))
		default:
			parts := buildOpenAIMessageParts(message.Parts)
			if len(parts) == 0 {
				continue
			}
			params = append(params, openai.UserMessage(parts))
		}
	}
	return params
}

func buildOpenAIMessageParts(parts []ProviderMessagePart) []openai.ChatCompletionContentPartUnionParam {
	result := make([]openai.ChatCompletionContentPartUnionParam, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "image":
			if dataURL := imageDataURL(part.MimeType, part.Content); dataURL != "" {
				result = append(result, openai.ImageContentPart(
					openai.ChatCompletionContentPartImageImageURLParam{
						URL: dataURL,
					},
				))
			}
		default:
			if text := strings.TrimSpace(part.Text); text != "" {
				result = append(result, openai.TextContentPart(text))
			}
		}
	}
	return result
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
