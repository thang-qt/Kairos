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
