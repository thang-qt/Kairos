package server

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv            string
	HTTPAddr          string
	DBPath            string
	CookieName        string
	CookieSecure      bool
	SessionTTL        time.Duration
	AuthEnabled       bool
	AllowSignup       bool
	BootstrapAdmin    bool
	AdminEmail        string
	AdminPassword     string
	AdminPasswordHash string
}

func LoadConfig() (Config, error) {
	sessionTTLHours, err := getEnvInt("SESSION_TTL_HOURS", 24*30)
	if err != nil {
		return Config{}, err
	}

	config := Config{
		AppEnv:            getEnv("APP_ENV", "development"),
		HTTPAddr:          getEnv("HTTP_ADDR", ":8080"),
		DBPath:            getEnv("KAIROS_DB_PATH", "./tmp/kairos.db"),
		CookieName:        getEnv("SESSION_COOKIE_NAME", "kairos_session"),
		CookieSecure:      getEnvBool("SESSION_COOKIE_SECURE", false),
		SessionTTL:        time.Duration(sessionTTLHours) * time.Hour,
		AuthEnabled:       getEnvBool("AUTH_ENABLED", true),
		AllowSignup:       getEnvBool("ALLOW_SIGNUP", true),
		BootstrapAdmin:    getEnvBool("BOOTSTRAP_ADMIN", false),
		AdminEmail:        strings.TrimSpace(os.Getenv("ADMIN_EMAIL")),
		AdminPassword:     os.Getenv("ADMIN_PASSWORD"),
		AdminPasswordHash: strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH")),
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
