package server

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/jsonschema-go/jsonschema"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const mcpMaxTools = 256
const mcpMaxServers = 16
const mcpMaxEnabledTools = 512

var mcpBearerToken = regexp.MustCompile(`^[A-Za-z0-9._~+/-]+=*$`)
var mcpToolName = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

type MCPServer struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Endpoint     string `json:"endpoint"`
	AuthMode     string `json:"authMode"`
	Enabled      bool   `json:"enabled"`
	HasToken     bool   `json:"hasToken"`
	Revision     int64  `json:"revision"`
	Health       string `json:"health"`
	LastError    string `json:"lastError"`
	DiscoveredAt int64  `json:"discoveredAt"`
}
type MCPServerInput struct {
	Name     string `json:"name"`
	Endpoint string `json:"endpoint"`
	AuthMode string `json:"authMode"`
	Token    string `json:"token"`
	Enabled  *bool  `json:"enabled"`
}
type MCPTool struct {
	ChatApprovalCount int             `json:"chatApprovalCount"`
	ID                string          `json:"id"`
	ServerID          string          `json:"serverId"`
	Name              string          `json:"name"`
	Alias             string          `json:"alias"`
	Description       string          `json:"description"`
	Schema            json.RawMessage `json:"schema"`
	Annotations       json.RawMessage `json:"annotations"`
	Enabled           bool            `json:"enabled"`
	Available         bool            `json:"available"`
	ApprovalPolicy    string          `json:"approvalPolicy"`
}
type MCPService struct {
	approvalChanges sessionListNotifications
	conversations   *ConversationService
	sessionsMu      sync.Mutex
	sessions        map[string]*mcpCachedSession
	sessionOptions  *mcp.ClientSessionOptions
	ctx             context.Context
	cancel          context.CancelFunc
	db              *sql.DB
	key             [32]byte
	secureStorage   bool
	mu              sync.Mutex
	active          map[string]map[string]context.CancelFunc
	clientFor       func(*urlMCPConfig) *http.Client
}
type urlMCPConfig struct{ Endpoint, Token string }

func NewMCPService(db *sql.DB, config Config) *MCPService {
	ctx, cancel := context.WithCancel(context.Background())
	return &MCPService{conversations: NewConversationService(db), ctx: ctx, cancel: cancel, db: db, key: config.ProviderEncryptionKey(), secureStorage: (config.AppEnv == "development" || config.AppEnv == "test") || (len(config.ProviderEncryptionSecretKey) >= 32 && config.ProviderEncryptionSecretKey != "kairos-dev-provider-secret"), sessions: map[string]*mcpCachedSession{}, active: map[string]map[string]context.CancelFunc{}}
}

func (service *MCPService) List(ctx context.Context, user string) ([]MCPServer, error) {
	rows, err := service.db.QueryContext(ctx, `SELECT id,name,endpoint,auth_mode,enabled,token_encrypted!='',revision,health,last_error,discovered_at FROM user_mcp_servers WHERE user_id=? ORDER BY created_at,id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MCPServer{}
	for rows.Next() {
		var s MCPServer
		if err := rows.Scan(&s.ID, &s.Name, &s.Endpoint, &s.AuthMode, &s.Enabled, &s.HasToken, &s.Revision, &s.Health, &s.LastError, &s.DiscoveredAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (service *MCPService) get(ctx context.Context, user, id string) (MCPServer, string, error) {
	var s MCPServer
	var encrypted string
	err := service.db.QueryRowContext(ctx, `SELECT id,name,endpoint,auth_mode,enabled,token_encrypted,revision,health,last_error,discovered_at FROM user_mcp_servers WHERE user_id=? AND id=?`, user, id).Scan(&s.ID, &s.Name, &s.Endpoint, &s.AuthMode, &s.Enabled, &encrypted, &s.Revision, &s.Health, &s.LastError, &s.DiscoveredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return s, "", errMCPNotFound
	}
	s.HasToken = encrypted != ""
	return s, encrypted, err
}
func (service *MCPService) Save(ctx context.Context, user, id string, input MCPServerInput) (MCPServer, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	var previous MCPServer
	var encrypted string
	var err error
	if id != "" {
		previous, encrypted, err = service.get(ctx, user, id)
		if err != nil {
			return previous, err
		}
	} else {
		var count int
		if err := service.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_mcp_servers WHERE user_id=?`, user).Scan(&count); err != nil {
			return previous, err
		}
		if count >= mcpMaxServers {
			return previous, errors.New("at most 16 MCP servers are supported")
		}
	}
	if strings.TrimSpace(input.Name) == "" || len(input.Name) > 100 {
		return previous, errors.New("MCP name must contain 1–100 characters")
	}
	endpoint, err := validateMCPEndpoint(input.Endpoint)
	if err != nil {
		return previous, err
	}
	if len(input.Endpoint) > 4096 {
		return previous, errors.New("MCP endpoint exceeds URL size limit")
	}
	if id != "" && input.AuthMode == "bearer" && input.Token == "" {
		old, _ := validateMCPEndpoint(previous.Endpoint)
		if old != nil && !strings.EqualFold(old.Host, endpoint.Host) {
			return previous, errors.New("changing a credentialed MCP origin requires a replacement token or anonymous authentication")
		}
	}
	if input.AuthMode != "none" && input.AuthMode != "bearer" {
		return previous, errors.New("authentication must be none or bearer")
	}
	if input.AuthMode == "none" {
		if input.Token != "" {
			return previous, errors.New("anonymous servers cannot store a token")
		}
		encrypted = ""
	} else {
		if !service.secureStorage {
			return previous, errors.New("configure a secure PROVIDER_SECRET_KEY of at least 32 characters for production MCP bearer storage")
		}
		if input.Token != "" {
			if len(input.Token) > 8192 || !mcpBearerToken.MatchString(input.Token) {
				return previous, errors.New("invalid bearer token")
			}
			encrypted = encryptSecretWithKey(service.key, input.Token)
		}
		if encrypted == "" {
			return previous, errors.New("bearer token is required")
		}
	}
	if encrypted != "" {
		secret, err := decryptSecretWithKey(service.key, encrypted)
		if err != nil {
			return previous, errMCPRemote
		}
		if redactMCP(input.Name, secret) != input.Name || redactMCP(endpoint.String(), secret) != endpoint.String() {
			return previous, errors.New("server name or endpoint contains a protected credential")
		}
	}
	now := time.Now().UnixMilli()
	enabled := boolOrDefault(input.Enabled, true)
	if id == "" {
		id = newID()
		_, err = service.db.ExecContext(ctx, `INSERT INTO user_mcp_servers(id,user_id,name,endpoint,auth_mode,token_encrypted,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, id, user, strings.TrimSpace(input.Name), endpoint.String(), input.AuthMode, encrypted, enabled, now, now)
	} else {
		_, err = service.db.ExecContext(ctx, `UPDATE user_mcp_servers SET name=?,endpoint=?,auth_mode=?,token_encrypted=?,enabled=?,revision=revision+1,health='untested',last_error='',updated_at=? WHERE user_id=? AND id=?`, strings.TrimSpace(input.Name), endpoint.String(), input.AuthMode, encrypted, enabled, now, user, id)
		if err != nil {
			return previous, err
		}
		service.cancelServer(id)
		_, err = service.db.ExecContext(ctx, `DELETE FROM mcp_tool_grants WHERE server_id=? AND user_id=?`, id, user)
		if err != nil {
			return previous, err
		}
		if previous.Endpoint != endpoint.String() {
			_, err = service.db.ExecContext(ctx, `UPDATE user_mcp_tools SET available=0,enabled=0 WHERE server_id=?`, id)
		}
	}
	if err != nil {
		return previous, err
	}
	s, _, err := service.get(ctx, user, id)
	return s, err
}
func (service *MCPService) cancelServer(id string) {
	service.invalidateSessions(id)
	for _, cancel := range service.active[id] {
		cancel()
	}
}
func (service *MCPService) Delete(ctx context.Context, user, id string) error {
	service.mu.Lock()
	defer service.mu.Unlock()
	if _, _, err := service.get(ctx, user, id); err != nil {
		return err
	}
	service.cancelServer(id)
	_, err := service.db.ExecContext(ctx, `DELETE FROM user_mcp_servers WHERE user_id=? AND id=?`, user, id)
	return err
}
func (service *MCPService) Tools(ctx context.Context, user, id string) ([]MCPTool, error) {
	if _, _, err := service.get(ctx, user, id); err != nil {
		return nil, err
	}
	rows, err := service.db.QueryContext(ctx, `SELECT t.id,t.server_id,t.name,t.alias,t.description,t.schema_json,t.annotations_json,t.enabled,t.available,CASE WHEN EXISTS(SELECT 1 FROM mcp_tool_grants g JOIN user_mcp_servers s ON s.id=g.server_id WHERE g.user_id=s.user_id AND g.tool_id=t.id AND g.session_id IS NULL AND g.server_revision=s.revision AND g.tool_schema=t.schema_json) THEN 'allow' ELSE 'always' END,(SELECT COUNT(*) FROM mcp_tool_grants g JOIN user_mcp_servers s ON s.id=g.server_id WHERE g.tool_id=t.id AND g.session_id IS NOT NULL AND g.server_revision=s.revision AND g.tool_schema=t.schema_json) FROM user_mcp_tools t WHERE server_id=? ORDER BY name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tools := []MCPTool{}
	for rows.Next() {
		var t MCPTool
		var schema, annotations string
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Name, &t.Alias, &t.Description, &schema, &annotations, &t.Enabled, &t.Available, &t.ApprovalPolicy, &t.ChatApprovalCount); err != nil {
			return nil, err
		}
		t.Schema = json.RawMessage(schema)
		t.Annotations = json.RawMessage(annotations)
		tools = append(tools, t)
	}
	return tools, rows.Err()
}
func (service *MCPService) SetTool(ctx context.Context, user, server, id string, enabled bool, policy string) error {
	service.mu.Lock()
	defer service.mu.Unlock()
	if policy != "always" && policy != "allow" {
		return errors.New("approval policy must be always or allow")
	}
	owner, _, err := service.get(ctx, user, server)
	if err != nil {
		return err
	}

	if enabled {
		var count int
		if err := service.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_mcp_tools t JOIN user_mcp_servers s ON s.id=t.server_id WHERE s.user_id=? AND t.enabled=1 AND t.id!=?`, user, id).Scan(&count); err != nil {
			return err
		}
		if count >= mcpMaxEnabledTools {
			return errors.New("enable at most 512 remote tools across your servers")
		}
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE user_mcp_tools SET enabled=? WHERE id=? AND server_id=? AND (?=0 OR available=1)`, enabled, id, server, enabled)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return errMCPNotFound
	}
	// Asking again revokes both persistent and conversation-scoped grants.
	if policy == "always" || !enabled {
		if _, err := tx.ExecContext(ctx, `DELETE FROM mcp_tool_grants WHERE user_id=? AND tool_id=?`, user, id); err != nil {
			return err
		}
	} else {
		var schema string
		if err := tx.QueryRowContext(ctx, `SELECT schema_json FROM user_mcp_tools WHERE id=? AND server_id=?`, id, server).Scan(&schema); err != nil {
			return err
		}
		if err := writeMCPGrant(ctx, tx, user, server, id, nil, owner.Revision, schema); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	service.approvalChanges.publish(user)
	if !enabled || policy == "always" {
		service.cancelServer(server)
	}

	return nil
}
func (service *MCPService) connect(ctx context.Context, s MCPServer, token string, progress ...func(*mcp.ProgressNotificationParams)) (*mcp.ClientSession, error) {
	endpoint, err := validateMCPEndpoint(s.Endpoint)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 45 * time.Second, Transport: &mcpSafeTransport{endpoint: endpoint, token: token}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("MCP redirects are blocked") }}
	if service.clientFor != nil {
		client = service.clientFor(&urlMCPConfig{Endpoint: s.Endpoint, Token: token})
	}
	opts := &mcp.ClientOptions{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if len(progress) > 0 {
		opts.ProgressNotificationHandler = func(_ context.Context, request *mcp.ProgressNotificationClientRequest) { progress[0](request.Params) }
	}
	c := mcp.NewClient(&mcp.Implementation{Name: "Kairos", Version: "1"}, opts)
	session, err := c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: s.Endpoint, HTTPClient: client, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: mcpResponseLimit}, service.sessionOptions)
	if err != nil {
		if errors.Is(err, errMCPAuth) {
			return nil, errMCPAuth
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errMCPRemote
	}
	if transport, ok := client.Transport.(*mcpSafeTransport); ok {
		go func() { _ = session.Wait(); transport.CloseIdleConnections() }()
	}
	// The database discovery cache survives session expiry, but the SDK's tool
	// schemas do not. Load every page on each new modern session so CallTool can
	// mirror x-mcp-header parameters without changing stored tool permissions.
	if initialized := session.InitializeResult(); initialized != nil && initialized.ProtocolVersion >= "2026-07-28" {
		if _, err := listMCPSessionTools(ctx, session); err != nil {
			_ = session.Close()
			return nil, err
		}
	}
	return session, nil
}
func mcpAlias(server, name string) string {
	hash := sha256.Sum256([]byte(server + "\x00" + name))
	return "mcp_" + hex.EncodeToString(hash[:])[:60]
}
func validateMCPSchema(value any, depth int) bool {
	if depth > 32 {
		return false
	}
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if key == "$ref" || key == "$dynamicRef" {
				text, ok := child.(string)
				if !ok || !strings.HasPrefix(text, "#") {
					return false
				}
			}
			if !validateMCPSchema(child, depth+1) {
				return false
			}
		}
	case []any:
		for _, child := range v {
			if !validateMCPSchema(child, depth+1) {
				return false
			}
		}
	}
	return true
}

// listMCPSessionTools also populates the SDK's session-local schema cache.
// Modern MCP transports need it to generate schema-defined parameter headers.
func listMCPSessionTools(ctx context.Context, session *mcp.ClientSession) ([]*mcp.Tool, error) {
	tools := []*mcp.Tool{}

	cursor := ""
	seenCursors := map[string]bool{}
	seenNames := map[string]bool{}
	for page := 0; ; page++ {
		if page >= 16 {
			return nil, errors.New("MCP discovery exceeded pagination limits")
		}
		list, err := session.ListTools(ctx, &mcp.ListToolsParams{Cursor: cursor})
		if err != nil || list == nil {
			return nil, errMCPRemote
		}
		for _, tool := range list.Tools {
			if tool == nil || seenNames[tool.Name] {
				return nil, errors.New("MCP discovery returned duplicate or invalid tools")
			}
			seenNames[tool.Name] = true
			tools = append(tools, tool)
		}
		if len(tools) > mcpMaxTools {
			return nil, errors.New("MCP discovery exceeded 256 tools")
		}
		if list.NextCursor == "" {
			break
		}
		if seenCursors[list.NextCursor] {
			return nil, errors.New("MCP discovery repeated a cursor")
		}
		seenCursors[list.NextCursor] = true
		cursor = list.NextCursor
	}
	return tools, nil
}

func (service *MCPService) Refresh(ctx context.Context, user, id string) (result []MCPTool, returnErr error) {
	ctx, cancel := service.scope(ctx, 30*time.Second)
	defer cancel()
	s, encrypted, err := service.get(ctx, user, id)
	if err != nil {
		return nil, err
	}
	defer func() {
		if returnErr != nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			message := errMCPRemote.Error()
			if errors.Is(returnErr, errMCPAuth) {
				message = errMCPAuth.Error()
			}
			_, _ = service.db.ExecContext(cleanup, `UPDATE user_mcp_servers SET health='error',last_error=? WHERE id=? AND user_id=? AND revision=?`, message, id, user, s.Revision)
		}
	}()
	if !s.Enabled {
		return nil, errors.New("enable the server before testing its connection")
	}
	token := ""
	if encrypted != "" {
		token, err = decryptSecretWithKey(service.key, encrypted)
		if err != nil {
			return nil, errMCPRemote
		}
	}
	session, release, err := service.borrowSession(ctx, s, token, nil)
	if err != nil {
		_, _ = service.db.ExecContext(context.Background(), `UPDATE user_mcp_servers SET health='error',last_error=? WHERE id=? AND user_id=? AND revision=?`, errMCPRemote.Error(), id, user, s.Revision)
		return nil, err
	}
	defer func() { release(returnErr == nil && ctx.Err() == nil) }()
	tools, err := listMCPSessionTools(ctx, session)
	if err != nil {
		return nil, err
	}
	type cached struct{ name, description, schema, annotations string }
	normalized := []cached{}
	for _, tool := range tools {
		if redactMCP(tool.Name, token) != tool.Name || !mcpToolName.MatchString(tool.Name) || len(tool.Description) > 4096 {
			return nil, errors.New("MCP tool name or description exceeds limits")
		}
		schema, err := json.Marshal(tool.InputSchema)
		if err != nil || len(schema) > 64<<10 {
			return nil, errors.New("invalid or oversized MCP tool schema")
		}
		schema = []byte(redactMCP(string(schema), token))
		var object map[string]any
		if json.Unmarshal(schema, &object) != nil || object["type"] != "object" || !validateMCPSchema(object, 0) {
			return nil, errors.New("MCP tools require an object schema with only local references")
		}
		var parsed jsonschema.Schema
		if json.Unmarshal(schema, &parsed) != nil {
			return nil, errors.New("MCP schema is invalid")
		}
		if _, err := parsed.Resolve(nil); err != nil {
			return nil, errors.New("MCP schema cannot be resolved locally")
		}
		annotations, _ := json.Marshal(tool.Annotations)
		if len(annotations) > 4096 {
			return nil, errors.New("MCP tool annotations exceed limits")
		}
		normalized = append(normalized, cached{tool.Name, redactMCP(tool.Description, token), string(schema), redactMCP(string(annotations), token)})
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	current, _, err := service.get(ctx, user, id)
	if err != nil {
		return nil, err
	}
	if current.Revision != s.Revision || !current.Enabled {
		return nil, errors.New("MCP server changed during discovery; refresh again")
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE user_mcp_tools SET available=0 WHERE server_id=?`, id); err != nil {
		return nil, err
	}
	for _, tool := range normalized {
		_, err := tx.ExecContext(ctx, `INSERT INTO user_mcp_tools(id,server_id,name,alias,description,schema_json,annotations_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(server_id,name) DO UPDATE SET description=excluded.description,schema_json=excluded.schema_json,annotations_json=excluded.annotations_json,available=1`, newID(), id, tool.name, mcpAlias(id, tool.name), tool.description, tool.schema, tool.annotations)
		if err != nil {
			return nil, fmt.Errorf("MCP discovery contained duplicate or colliding tools")
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM mcp_tool_grants WHERE server_id=? AND NOT EXISTS(SELECT 1 FROM user_mcp_tools t WHERE t.id=mcp_tool_grants.tool_id AND t.available=1 AND t.schema_json=mcp_tool_grants.tool_schema)`, id); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE user_mcp_servers SET health='connected',last_error='',discovered_at=? WHERE user_id=? AND id=?`, time.Now().UnixMilli(), user, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return service.Tools(ctx, user, id)
}

func (service *MCPService) scope(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	scoped, cancel := context.WithTimeout(ctx, timeout)
	stop := context.AfterFunc(service.ctx, cancel)
	return scoped, func() { stop(); cancel() }
}
func (service *MCPService) Close() {
	service.cancel()
	service.sessionsMu.Lock()
	entries := map[string]*mcpCachedSession{}
	for id, entry := range service.sessions {
		entries[id] = entry
	}
	service.sessionsMu.Unlock()
	for id, entry := range entries {
		service.dropSession(id, entry)
	}
}
func mcpValueDepth(value any, depth int) bool {
	if depth > 32 {
		return false
	}
	switch v := value.(type) {
	case map[string]any:
		for _, child := range v {
			if !mcpValueDepth(child, depth+1) {
				return false
			}
		}
	case []any:
		for _, child := range v {
			if !mcpValueDepth(child, depth+1) {
				return false
			}
		}
	}
	return true
}
