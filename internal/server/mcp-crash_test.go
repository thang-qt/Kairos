package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPRuntimeCrashChild(t *testing.T) {
	if os.Getenv("KAIROS_TEST_MCP_CHILD") != "1" {
		t.Skip("subprocess only")
	}
	var config Config
	if err := json.Unmarshal([]byte(os.Getenv("KAIROS_TEST_CONFIG")), &config); err != nil {
		t.Fatal(err)
	}
	app, err := NewApp(config)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	endpoint, err := url.Parse(os.Getenv("KAIROS_TEST_MCP_ENDPOINT"))
	if err != nil {
		t.Fatal(err)
	}
	cert, err := os.ReadFile(os.Getenv("KAIROS_TEST_MCP_CA"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(cert) {
		t.Fatal("invalid fixture CA")
	}
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	app.mcp.clientFor = func(c *urlMCPConfig) *http.Client {
		return &http.Client{Transport: mcpRewriteTransport{base: base, endpoint: endpoint, token: c.Token}, Timeout: 30 * time.Second}
	}
	app.mcp.sessionOptions = &mcp.ClientSessionOptions{ProtocolVersion: "2025-11-25"}
	app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: "crash-call", Name: os.Getenv("KAIROS_TEST_MCP_ALIAS"), ArgsJSON: `{"value":"external-effect"}`}}}, nil
	}}
	_, err = app.runtime.StartRun(context.Background(), os.Getenv("KAIROS_TEST_USER"), SubmitTurnInput{FriendlyID: os.Getenv("KAIROS_TEST_SESSION"), Message: "remote effect", Model: "test-model", IdempotencyKey: "mcp-crash"})
	if err != nil {
		t.Fatal(err)
	}
	<-make(chan struct{})
}

func TestMCPProcessCrashNeverReplaysUncertainEffect(t *testing.T) {
	app, user, session := runtimeFixture(t)
	app.app.runtime.Close()
	effect, release := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	fixture := mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		count.Add(1)
		close(effect)
		<-release
		return &mcp.CallToolResult{}, nil
	})
	defer close(release)
	_, tool := addMCPFixture(t, app, user, "")
	directory := t.TempDir()
	caPath := filepath.Join(directory, "fixture-ca.pem")
	if err := os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: fixture.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(app.app.config)
	command := exec.Command(os.Args[0], "-test.run=^TestMCPRuntimeCrashChild$", "-test.timeout=45s")
	command.Env = append(os.Environ(), "KAIROS_TEST_MCP_CHILD=1", "KAIROS_TEST_CONFIG="+string(config), "KAIROS_TEST_USER="+user, "KAIROS_TEST_SESSION="+session.FriendlyID, "KAIROS_TEST_MCP_ENDPOINT="+fixture.URL, "KAIROS_TEST_MCP_CA="+caPath, "KAIROS_TEST_MCP_ALIAS="+tool.Alias)
	log, err := os.Create(filepath.Join(directory, "child.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	command.Stdout = log
	command.Stderr = log
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer command.Process.Kill()
	approval := waitMCPApproval(t, app.app.mcp, user)
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err != nil {
		t.Fatal(err)
	}
	requireSignal(t, effect)
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	if _, err := app.app.db.Exec(`UPDATE chat_runs SET lease_until=0 WHERE id=?`, approval.RunID); err != nil {
		t.Fatal(err)
	}
	recovered := NewAgentRuntime(app.app.db, app.app.conversations, app.app.providers, app.app.webTools)
	recovered.mcp = app.app.mcp
	defer recovered.Close()
	recovered.StartWorkers()
	waitForRunStatus(t, app, approval.RunID, "interrupted")
	approvals, err := app.app.mcp.Approvals(context.Background(), user, session.FriendlyID)
	if err != nil || len(approvals) != 0 {
		t.Fatalf("stale approval survived recovery: %v %v", approvals, err)
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err == nil {
		t.Fatal("crashed execution approval reused")
	}
	time.Sleep(100 * time.Millisecond)
	if count.Load() != 1 {
		t.Fatalf("uncertain effect repeated %d times", count.Load())
	}
	history, err := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil || len(history.Messages) != 2 || len(history.Messages[1]["steps"].([]any)) != 1 {
		t.Fatalf("tool-start checkpoint lost: %v %v", history.Messages, err)
	}
}
