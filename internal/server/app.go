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

	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
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

	app := &App{
		config: config,
		db:     db,
		auth:   auth,
		chat:   chat,
		capability: CapabilitySet{
			Auth: AuthCapabilities{
				Enabled:       config.AuthEnabled,
				SignupEnabled: config.AuthEnabled && config.AllowSignup,
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
	mux.HandleFunc("GET /api/sessions", app.handleListSessions)
	mux.HandleFunc("POST /api/sessions", app.handleCreateSession)
	mux.HandleFunc("PATCH /api/sessions/{friendlyId}", app.handleRenameSession)
	mux.HandleFunc("DELETE /api/sessions/{friendlyId}", app.handleDeleteSession)
	mux.HandleFunc("GET /api/sessions/{friendlyId}/history", app.handleSessionHistory)

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
