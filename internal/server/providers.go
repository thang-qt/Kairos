package server

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"
)

var errProvidersDisabled = errors.New("user-managed providers are disabled by server policy")
var errProviderNotFound = errors.New("provider not found")
var errProviderOwnedBySystem = errors.New("system providers are managed by the server")
var errSystemProviderDisableLocked = errors.New("system provider usage is locked by server policy")
var errProviderKindUnsupported = errors.New("provider kind is not supported")
var errNoProviderAvailable = errors.New("no enabled provider is available for this account")
var errNoModelAvailable = errors.New("no chat model is available for the selected provider")
var errModelNotAvailable = errors.New("selected chat model is not available")
var errCustomModelNotFound = errors.New("custom model not found")

const providerModelCacheTTL = 15 * time.Minute

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
	UseSystemProviders     bool   `json:"useSystemProviders"`
	DefaultModelID         string `json:"defaultModelId,omitempty"`
	AutoGenerateTitle      bool   `json:"autoGenerateTitle"`
	UseSeparateTitleModel  bool   `json:"useSeparateTitleModel"`
	TitleGenerationModelID string `json:"titleGenerationModelId,omitempty"`
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
	ModelRef      string `json:"modelRef,omitempty"`
	Object        string `json:"object"`
	Created       int64  `json:"created"`
	OwnedBy       string `json:"owned_by"`
	Name          string `json:"name,omitempty"`
	Description   string `json:"description,omitempty"`
	ContextWindow int64  `json:"contextWindow,omitempty"`
	ProviderRef   string `json:"providerRef,omitempty"`
	ProviderLabel string `json:"providerLabel,omitempty"`
	IsCustom      bool   `json:"isCustom"`
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
	UseSystemProviders     *bool   `json:"useSystemProviders"`
	DefaultModelID         *string `json:"defaultModelId"`
	AutoGenerateTitle      *bool   `json:"autoGenerateTitle"`
	UseSeparateTitleModel  *bool   `json:"useSeparateTitleModel"`
	TitleGenerationModelID *string `json:"titleGenerationModelId"`
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

type providerModelCacheRow struct {
	UserID        string
	ProviderRef   string
	ModelID       string
	Object        string
	Created       int64
	OwnedBy       string
	Name          string
	Description   string
	ContextWindow int64
	FetchedAt     int64
	IsCustom      bool
}

type providerModelCacheStateRow struct {
	UserID       string
	ProviderRef  string
	LastSyncedAt int64
	ExpiresAt    int64
}

type ChatGenerationRequest struct {
	Model        string
	SystemPrompt string
	Messages     []ProviderMessage
	Tools        []ProviderTool
	ToolChoice   any
	WebSearch    *ProviderWebSearchOptions
	Plugins      []ProviderPlugin
	Advanced     *ChatAdvancedOptions
}

type ChatGenerationDelta struct {
	Text      string
	Thinking  string
	ToolCalls []ProviderToolCall
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
	ToolCalls        []ProviderToolCall
	Details          map[string]any
}

type ProviderMessage struct {
	Role       string
	Parts      []ProviderMessagePart
	ToolCallID string
}

type ProviderMessagePart struct {
	Type     string
	Text     string
	MimeType string
	Content  string
	ID       string
	Name     string
	ArgsJSON string
	Args     map[string]any
}

type ProviderTool struct {
	Type        string
	Name        string
	Description string
	Parameters  any
	Strict      bool
}

type ProviderToolCall struct {
	ID       string
	Name     string
	ArgsJSON string
	Args     map[string]any
}

type ProviderWebSearchOptions struct{}

type ProviderPlugin struct {
	ID         string
	PDFEngine  string
	MaxResults *int
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

type ProviderService struct {
	db                   *sql.DB
	config               Config
	encryptionKey        [32]byte
	drivers              map[string]ProviderDriver
	system               *systemProvider
	modelCacheTTL        time.Duration
	modelRefreshMu       sync.Mutex
	refreshingModelUsers map[string]struct{}
}

func NewProviderService(db *sql.DB, config Config) *ProviderService {
	service := &ProviderService{
		db:                   db,
		config:               config,
		encryptionKey:        config.ProviderEncryptionKey(),
		drivers:              defaultProviderDrivers(),
		modelCacheTTL:        providerModelCacheTTL,
		refreshingModelUsers: make(map[string]struct{}),
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
