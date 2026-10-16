package server

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const developmentProviderEncryptionSecret = "kairos-dev-provider-secret"

type Config struct {
	AllowRemoteImport             bool
	AssetStorage                  string
	AssetLocalDir                 string
	S3Bucket                      string
	S3Region                      string
	S3Endpoint                    string
	S3Prefix                      string
	S3ForcePathStyle              bool
	AppEnv                        string
	HTTPAddr                      string
	DBPath                        string
	CookieName                    string
	CookieSecure                  bool
	SessionTTL                    time.Duration
	AuthEnabled                   bool
	AllowSignup                   bool
	BootstrapAdmin                bool
	AdminEmail                    string
	AdminPassword                 string
	AdminPasswordHash             string
	UserProvidersEnabled          bool
	AllowUserCustomProviderURL    bool
	AllowUserDisableSystem        bool
	AllowUserModelSync            bool
	DefaultChatModel              string
	LockChatModel                 bool
	SystemProviderID              string
	SystemProviderKind            string
	SystemProviderUseResponsesAPI bool
	SystemProviderLabel           string
	SystemProviderBaseURL         string
	SystemProviderAPIKey          string
	SystemProviderEnabled         bool
	SystemProviderAllowDisable    bool
	SystemProviderModelSync       bool
	SystemProviderStaticModels    []string
	ProviderEncryptionSecretKey   string
	MaxToolCalls                  int
}

func LoadConfig() (Config, error) {
	appEnv := strings.ToLower(getEnv("APP_ENV", "development"))
	production := strings.EqualFold(appEnv, "production")
	sessionTTLHours, err := getEnvInt("SESSION_TTL_HOURS", 24*30)
	if err != nil {
		return Config{}, err
	}
	maxToolCalls, err := getEnvInt("MAX_TOOL_CALLS", defaultMaxToolCalls)
	if err != nil {
		return Config{}, err
	}

	config := Config{
		AllowRemoteImport:             getEnvBool("ALLOW_REMOTE_IMPORT", false),
		AssetStorage:                  getEnv("ASSET_STORAGE", "inline"),
		AssetLocalDir:                 getEnv("ASSET_LOCAL_DIR", "./tmp/assets"),
		S3Bucket:                      strings.TrimSpace(os.Getenv("S3_BUCKET")),
		S3Region:                      getEnv("S3_REGION", getEnv("AWS_REGION", "us-east-1")),
		S3Endpoint:                    strings.TrimSpace(os.Getenv("S3_ENDPOINT")),
		S3Prefix:                      getEnv("S3_PREFIX", "kairos/assets"),
		S3ForcePathStyle:              getEnvBool("S3_FORCE_PATH_STYLE", false),
		AppEnv:                        appEnv,
		HTTPAddr:                      getEnv("HTTP_ADDR", ":8080"),
		DBPath:                        getEnv("KAIROS_DB_PATH", "./tmp/kairos.db"),
		CookieName:                    getEnv("SESSION_COOKIE_NAME", "kairos_session"),
		CookieSecure:                  getEnvBool("SESSION_COOKIE_SECURE", production),
		SessionTTL:                    time.Duration(sessionTTLHours) * time.Hour,
		AuthEnabled:                   getEnvBool("AUTH_ENABLED", true),
		AllowSignup:                   getEnvBool("ALLOW_SIGNUP", !production),
		BootstrapAdmin:                getEnvBool("BOOTSTRAP_ADMIN", false),
		AdminEmail:                    strings.TrimSpace(os.Getenv("ADMIN_EMAIL")),
		AdminPassword:                 os.Getenv("ADMIN_PASSWORD"),
		AdminPasswordHash:             strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH")),
		UserProvidersEnabled:          getEnvBool("ENABLE_USER_PROVIDERS", true),
		AllowUserCustomProviderURL:    getEnvBool("ALLOW_USER_CUSTOM_BASE_URL", !production),
		AllowUserDisableSystem:        getEnvBool("ALLOW_USER_DISABLE_SYSTEM_PROVIDER", true),
		AllowUserModelSync:            getEnvBool("ALLOW_USER_MODEL_SYNC", true),
		DefaultChatModel:              strings.TrimSpace(os.Getenv("DEFAULT_CHAT_MODEL")),
		LockChatModel:                 getEnvBool("LOCK_CHAT_MODEL", false),
		SystemProviderID:              getEnv("SYSTEM_PROVIDER_1_ID", "system-default"),
		SystemProviderKind:            strings.ToLower(getEnv("SYSTEM_PROVIDER_1_KIND", defaultProviderKind)),
		SystemProviderUseResponsesAPI: getEnvBool("SYSTEM_PROVIDER_1_USE_RESPONSES_API", false),
		SystemProviderLabel:           getEnv("SYSTEM_PROVIDER_1_LABEL", "Server Default"),
		SystemProviderBaseURL:         strings.TrimSpace(os.Getenv("SYSTEM_PROVIDER_1_BASE_URL")),
		SystemProviderAPIKey:          strings.TrimSpace(os.Getenv("SYSTEM_PROVIDER_1_API_KEY")),
		SystemProviderEnabled:         getEnvBool("SYSTEM_PROVIDER_1_ENABLED", false),
		SystemProviderAllowDisable:    getEnvBool("SYSTEM_PROVIDER_1_ALLOW_DISABLE", true),
		SystemProviderModelSync:       getEnvBool("SYSTEM_PROVIDER_1_MODEL_SYNC", true),
		SystemProviderStaticModels:    splitCSVEnv("SYSTEM_PROVIDER_1_MODELS"),
		ProviderEncryptionSecretKey:   strings.TrimSpace(os.Getenv("PROVIDER_SECRET_KEY")),
		MaxToolCalls:                  maxToolCalls,
	}

	if config.CookieName == "" {
		return Config{}, errors.New("SESSION_COOKIE_NAME must not be empty")
	}
	if config.SessionTTL <= 0 {
		return Config{}, errors.New("SESSION_TTL_HOURS must be greater than zero")
	}
	if config.MaxToolCalls < 1 || config.MaxToolCalls > maxToolCallLimit {
		return Config{}, fmt.Errorf("MAX_TOOL_CALLS must be between 1 and %d", maxToolCallLimit)
	}
	if !config.AuthEnabled && config.AllowSignup {
		return Config{}, errors.New("ALLOW_SIGNUP cannot be true when AUTH_ENABLED is false")
	}
	if config.BootstrapAdmin {
		if config.AdminEmail == "" {
			return Config{}, errors.New("ADMIN_EMAIL is required when BOOTSTRAP_ADMIN is true")
		}
		if config.AdminPassword == "" && config.AdminPasswordHash == "" {
			return Config{}, errors.New("ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is required when BOOTSTRAP_ADMIN is true")
		}
	}
	if config.SystemProviderKind == "openrouter" {
		config.SystemProviderKind = openAIProviderKind
		if config.SystemProviderBaseURL == "" {
			config.SystemProviderBaseURL = "https://openrouter.ai/api/v1"
		}
	}
	if config.SystemProviderKind != "" && config.SystemProviderKind != openAIResponsesProviderKind && config.SystemProviderKind != openAIProviderKind {
		return Config{}, errors.New("SYSTEM_PROVIDER_1_KIND must be openai or openai-responses")
	}
	if config.ProviderEncryptionSecretKey == "" {
		if strings.EqualFold(config.AppEnv, "production") {
			return Config{}, errors.New("PROVIDER_SECRET_KEY must be set to at least 32 characters in production")
		}
		config.ProviderEncryptionSecretKey = developmentProviderEncryptionSecret
	}
	if err := validateAssetConfig(config); err != nil {
		return Config{}, err
	}
	if err := validateConfig(config); err != nil {
		return Config{}, err
	}
	return config, nil
}

func validateConfig(config Config) error {
	switch strings.ToLower(strings.TrimSpace(config.AppEnv)) {
	case "", "development", "test", "production":
	default:
		return errors.New("APP_ENV must be development, test, or production")
	}
	if !config.AuthEnabled && config.AllowSignup {
		return errors.New("ALLOW_SIGNUP cannot be true when AUTH_ENABLED is false")
	}
	if !strings.EqualFold(config.AppEnv, "production") {
		return nil
	}
	if !config.AuthEnabled {
		return errors.New("AUTH_ENABLED must be true in production")
	}
	if !config.CookieSecure {
		return errors.New("SESSION_COOKIE_SECURE must be true in production")
	}
	if len(config.ProviderEncryptionSecretKey) < 32 || config.ProviderEncryptionSecretKey == developmentProviderEncryptionSecret {
		return errors.New("PROVIDER_SECRET_KEY must be set to at least 32 characters in production")
	}
	return nil
}

func getEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getEnvBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func getEnvInt(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, errors.New(key + " must be an integer")
	}

	return parsed, nil
}

func splitCSVEnv(key string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		items = append(items, trimmed)
	}
	return items
}

func (config Config) ProviderEncryptionKey() [32]byte {
	return sha256.Sum256([]byte(config.ProviderEncryptionSecretKey))
}

func validateAssetConfig(config Config) error {
	switch config.AssetStorage {
	case "", "inline", "local", "s3":
	default:
		return errors.New("ASSET_STORAGE must be inline, local, or s3")
	}
	if config.AssetStorage == "s3" && strings.TrimSpace(config.S3Bucket) == "" {
		return errors.New("S3_BUCKET is required when ASSET_STORAGE is s3")
	}
	if config.S3Endpoint != "" {
		endpoint, err := url.Parse(config.S3Endpoint)
		if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
			return errors.New("S3_ENDPOINT must be an HTTP or HTTPS URL without credentials, query, or fragment")
		}
	}
	return nil
}
