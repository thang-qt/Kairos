package server

import (
	"crypto/sha256"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv                      string
	HTTPAddr                    string
	DBPath                      string
	CookieName                  string
	CookieSecure                bool
	SessionTTL                  time.Duration
	AuthEnabled                 bool
	AllowSignup                 bool
	BootstrapAdmin              bool
	AdminEmail                  string
	AdminPassword               string
	AdminPasswordHash           string
	UserProvidersEnabled        bool
	AllowUserCustomProviderURL  bool
	AllowUserDisableSystem      bool
	AllowUserModelSync          bool
	DefaultChatModel            string
	LockChatModel               bool
	SystemProviderID            string
	SystemProviderKind          string
	SystemProviderLabel         string
	SystemProviderBaseURL       string
	SystemProviderAPIKey        string
	SystemProviderEnabled       bool
	SystemProviderAllowDisable  bool
	SystemProviderModelSync     bool
	SystemProviderStaticModels  []string
	ProviderEncryptionSecretKey string
}

func LoadConfig() (Config, error) {
	sessionTTLHours, err := getEnvInt("SESSION_TTL_HOURS", 24*30)
	if err != nil {
		return Config{}, err
	}

	config := Config{
		AppEnv:                      getEnv("APP_ENV", "development"),
		HTTPAddr:                    getEnv("HTTP_ADDR", ":8080"),
		DBPath:                      getEnv("KAIROS_DB_PATH", "./tmp/kairos.db"),
		CookieName:                  getEnv("SESSION_COOKIE_NAME", "kairos_session"),
		CookieSecure:                getEnvBool("SESSION_COOKIE_SECURE", false),
		SessionTTL:                  time.Duration(sessionTTLHours) * time.Hour,
		AuthEnabled:                 getEnvBool("AUTH_ENABLED", true),
		AllowSignup:                 getEnvBool("ALLOW_SIGNUP", true),
		BootstrapAdmin:              getEnvBool("BOOTSTRAP_ADMIN", false),
		AdminEmail:                  strings.TrimSpace(os.Getenv("ADMIN_EMAIL")),
		AdminPassword:               os.Getenv("ADMIN_PASSWORD"),
		AdminPasswordHash:           strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH")),
		UserProvidersEnabled:        getEnvBool("ENABLE_USER_PROVIDERS", true),
		AllowUserCustomProviderURL:  getEnvBool("ALLOW_USER_CUSTOM_BASE_URL", true),
		AllowUserDisableSystem:      getEnvBool("ALLOW_USER_DISABLE_SYSTEM_PROVIDER", true),
		AllowUserModelSync:          getEnvBool("ALLOW_USER_MODEL_SYNC", true),
		DefaultChatModel:            strings.TrimSpace(os.Getenv("DEFAULT_CHAT_MODEL")),
		LockChatModel:               getEnvBool("LOCK_CHAT_MODEL", false),
		SystemProviderID:            getEnv("SYSTEM_PROVIDER_1_ID", "system-default"),
		SystemProviderKind:          getEnv("SYSTEM_PROVIDER_1_KIND", "openai_compatible"),
		SystemProviderLabel:         getEnv("SYSTEM_PROVIDER_1_LABEL", "Server Default"),
		SystemProviderBaseURL:       strings.TrimSpace(os.Getenv("SYSTEM_PROVIDER_1_BASE_URL")),
		SystemProviderAPIKey:        strings.TrimSpace(os.Getenv("SYSTEM_PROVIDER_1_API_KEY")),
		SystemProviderEnabled:       getEnvBool("SYSTEM_PROVIDER_1_ENABLED", false),
		SystemProviderAllowDisable:  getEnvBool("SYSTEM_PROVIDER_1_ALLOW_DISABLE", true),
		SystemProviderModelSync:     getEnvBool("SYSTEM_PROVIDER_1_MODEL_SYNC", true),
		SystemProviderStaticModels:  splitCSVEnv("SYSTEM_PROVIDER_1_MODELS"),
		ProviderEncryptionSecretKey: strings.TrimSpace(os.Getenv("PROVIDER_SECRET_KEY")),
	}

	if config.CookieName == "" {
		return Config{}, errors.New("SESSION_COOKIE_NAME must not be empty")
	}
	if config.SessionTTL <= 0 {
		return Config{}, errors.New("SESSION_TTL_HOURS must be greater than zero")
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
	if config.SystemProviderKind != "" && config.SystemProviderKind != "openai_compatible" {
		return Config{}, errors.New("SYSTEM_PROVIDER_1_KIND must be openai_compatible")
	}
	if config.ProviderEncryptionSecretKey == "" {
		// Development and tests get a deterministic fallback. Production should
		// provide an explicit secret before enabling BYOK provider storage.
		config.ProviderEncryptionSecretKey = "kairos-dev-provider-secret"
	}

	return config, nil
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
