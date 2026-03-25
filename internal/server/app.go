package server

import (
	"bytes"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed static
var embeddedFrontendFiles embed.FS

var frontendFiles = func() fs.FS {
	subtree, err := fs.Sub(embeddedFrontendFiles, "static")
	if err != nil {
		panic(err)
	}

	return subtree
}()

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
	mux.HandleFunc("POST /api/models/sync", app.handleSyncModels)
	mux.HandleFunc("PATCH /api/models/metadata", app.handleUpdateModelMetadata)
	mux.HandleFunc("GET /api/sessions", app.handleListSessions)
	mux.HandleFunc("POST /api/sessions", app.handleCreateSession)
	mux.HandleFunc("PATCH /api/sessions/{friendlyId}", app.handleRenameSession)
	mux.HandleFunc("PATCH /api/sessions/{friendlyId}/pin", app.handlePinSession)
	mux.HandleFunc("DELETE /api/sessions/{friendlyId}", app.handleDeleteSession)
	mux.HandleFunc("GET /api/sessions/{friendlyId}/history", app.handleSessionHistory)
	mux.HandleFunc("POST /api/sessions/{friendlyId}/messages", app.handleSendMessage)
	mux.HandleFunc("POST /api/sessions/{friendlyId}/fork", app.handleForkSession)
	mux.HandleFunc("POST /api/sessions/{friendlyId}/messages/{messageId}/edit", app.handleEditUserMessage)
	mux.HandleFunc("DELETE /api/sessions/{friendlyId}/messages/{messageId}", app.handleDeleteUserMessage)
	mux.HandleFunc("POST /api/sessions/{friendlyId}/stop", app.handleStopSessionRuns)
	mux.HandleFunc("GET /api/sessions/{friendlyId}/events", app.handleSessionEvents)
	mux.Handle("/", app.frontendHandler())

	return app.withCommonMiddleware(mux)
}

func (app *App) frontendHandler() http.Handler {
	staticFiles := http.FileServer(http.FS(frontendFiles))

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.NotFound(writer, request)
			return
		}

		if target, ok := app.frontendRedirectTarget(request); ok {
			http.Redirect(writer, request, target, http.StatusFound)
			return
		}

		assetPath := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if assetPath == "." || assetPath == "" {
			serveFrontendIndex(writer, request)
			return
		}

		if frontendAssetExists(assetPath) {
			staticFiles.ServeHTTP(writer, request)
			return
		}

		serveFrontendIndex(writer, request)
	})
}

func (app *App) frontendRedirectTarget(request *http.Request) (string, bool) {
	if !app.config.AuthEnabled {
		return "", false
	}

	if strings.HasPrefix(request.URL.Path, "/api/") {
		return "", false
	}

	user, err := app.auth.CurrentUser(request.Context(), app.sessionTokenFromRequest(request))
	isAuthenticated := err == nil && user != nil

	switch {
	case isAuthenticated && isGuestOnlyFrontendRoute(request.URL.Path):
		return "/new", true
	case !isAuthenticated && isProtectedFrontendRoute(request.URL.Path):
		return "/auth", true
	default:
		return "", false
	}
}

func isProtectedFrontendRoute(pathname string) bool {
	return pathname == "/new" ||
		pathname == "/settings" ||
		strings.HasPrefix(pathname, "/chat/")
}

func isGuestOnlyFrontendRoute(pathname string) bool {
	return pathname == "/auth" || pathname == "/signup"
}

func frontendAssetExists(name string) bool {
	file, err := frontendFiles.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return false
	}

	return !info.IsDir()
}

func serveFrontendIndex(writer http.ResponseWriter, request *http.Request) {
	indexContent, err := fs.ReadFile(frontendFiles, "index.html")
	if err != nil {
		http.Error(
			writer,
			"frontend assets are not available; run `pnpm build` first",
			http.StatusServiceUnavailable,
		)
		return
	}
	http.ServeContent(
		writer,
		request,
		"index.html",
		time.Time{},
		bytes.NewReader(indexContent),
	)
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
