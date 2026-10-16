package server

import "testing"

func TestLoadConfigRequiresStrongProviderEncryptionKeyInProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("PROVIDER_SECRET_KEY", "")

	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig() succeeded without a production provider encryption key")
	}

	t.Setenv("PROVIDER_SECRET_KEY", "too-short")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig() succeeded with a weak production provider encryption key")
	}

	t.Setenv("PROVIDER_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() with a 32-character key error = %v", err)
	}
	if config.ProviderEncryptionSecretKey != "0123456789abcdef0123456789abcdef" {
		t.Fatal("LoadConfig() did not retain the explicit production key")
	}
}

func TestLoadConfigUsesDevelopmentProviderEncryptionKeyFallback(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("PROVIDER_SECRET_KEY", "")

	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if config.ProviderEncryptionSecretKey != developmentProviderEncryptionSecret {
		t.Fatalf("provider encryption key = %q, want development fallback", config.ProviderEncryptionSecretKey)
	}
}

func TestLoadConfigUsesSafeProductionDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("PROVIDER_SECRET_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("SESSION_COOKIE_SECURE", "")
	t.Setenv("AUTH_ENABLED", "")
	t.Setenv("ALLOW_SIGNUP", "")
	t.Setenv("ALLOW_USER_CUSTOM_BASE_URL", "")

	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if !config.AuthEnabled {
		t.Fatal("production auth default = false, want true")
	}
	if !config.CookieSecure {
		t.Fatal("production secure-cookie default = false, want true")
	}
	if config.AllowSignup {
		t.Fatal("production signup default = true, want false")
	}
	if config.AllowUserCustomProviderURL {
		t.Fatal("production custom-provider-URL default = true, want false")
	}
}
