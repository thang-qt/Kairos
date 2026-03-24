package server

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type App struct {
	config     Config
	db         *sql.DB
	auth       *AuthService
	chat       *ChatService
	runs       *ChatRunService
	providers  *ProviderService
	capability CapabilitySet
}

func NewApp(config Config) (*App, error) {
	if err := os.MkdirAll(filepath.Dir(config.DBPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	db, err := sql.Open("sqlite", config.DBPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable wal mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA synchronous = NORMAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set sqlite synchronous mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout = 5000;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	if err := applyMigrations(db); err != nil {
		db.Close()
		return nil, err
	}

	auth := NewAuthService(db, config)
	if err := auth.BootstrapAdmin(); err != nil {
		db.Close()
		return nil, err
	}
	chat := NewChatService(db)
	providers := NewProviderService(db, config)
	runBroker := NewRunBroker()
	runs := NewChatRunService(db, chat, providers, runBroker)

	app := &App{
		config:    config,
		db:        db,
		auth:      auth,
		chat:      chat,
		runs:      runs,
		providers: providers,
		capability: CapabilitySet{
			Auth: AuthCapabilities{
				Enabled:       config.AuthEnabled,
				SignupEnabled: config.AuthEnabled && config.AllowSignup,
			},
			Providers: ProviderCapabilities{
				SystemProvidersEnabled:   config.SystemProviderEnabled,
				UserProvidersEnabled:     config.UserProvidersEnabled,
				CanDisableSystemProvider: config.AllowUserDisableSystem && config.SystemProviderAllowDisable,
				CanAddCustomBaseURL:      config.AllowUserCustomProviderURL,
				CanSyncModels:            config.AllowUserModelSync || config.SystemProviderModelSync,
			},
			Models: ModelCapabilities{
				CanSelectModel:     true,
				DefaultModelLocked: config.LockChatModel,
			},
		},
	}

	return app, nil
}

func (app *App) Close() error {
	return app.db.Close()
}

func (app *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", app.handleHealth)
	mux.HandleFunc("GET /api/app/capabilities", app.handleCapabilities)
	mux.HandleFunc("POST /api/auth/signup", app.handleSignup)
	mux.HandleFunc("POST /api/auth/login", app.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", app.handleLogout)
	mux.HandleFunc("GET /api/me", app.handleMe)
	mux.HandleFunc("GET /api/me/preferences", app.handleGetPreferences)
	mux.HandleFunc("PATCH /api/me/preferences", app.handleUpdatePreferences)
	mux.HandleFunc("GET /api/providers", app.handleListProviders)
	mux.HandleFunc("POST /api/providers", app.handleCreateProvider)
	mux.HandleFunc("POST /api/providers/test-connection", app.handleTestConnection)
	mux.HandleFunc("POST /api/providers/{providerId}/test-connection", app.handleTestProviderConnection)
	mux.HandleFunc("PATCH /api/providers/{providerId}", app.handleUpdateProvider)
	mux.HandleFunc("DELETE /api/providers/{providerId}", app.handleDeleteProvider)
	mux.HandleFunc("GET /api/models", app.handleListModels)
	mux.HandleFunc("GET /api/sessions", app.handleListSessions)
	mux.HandleFunc("POST /api/sessions", app.handleCreateSession)
	mux.HandleFunc("PATCH /api/sessions/{friendlyId}", app.handleRenameSession)
	mux.HandleFunc("DELETE /api/sessions/{friendlyId}", app.handleDeleteSession)
	mux.HandleFunc("GET /api/sessions/{friendlyId}/history", app.handleSessionHistory)
	mux.HandleFunc("POST /api/sessions/{friendlyId}/messages", app.handleSendMessage)
	mux.HandleFunc("GET /api/sessions/{friendlyId}/events", app.handleSessionEvents)

	return app.withCommonMiddleware(mux)
}

func (app *App) withCommonMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")

		if strings.HasPrefix(request.URL.Path, "/api/") {
			writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		}

		next.ServeHTTP(writer, request)
	})
}
