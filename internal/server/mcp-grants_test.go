package server

import (
	"context"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"sync/atomic"
	"testing"
	"time"
)

func TestMCPApprovalScopesAndRevocation(t *testing.T) {
	for _, scope := range []string{"once", "chat", "tool"} {
		t.Run(scope, func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			var executed atomic.Int32
			mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				executed.Add(1)
				return &mcp.CallToolResult{}, nil
			})
			server, tool := addMCPFixture(t, app, user, "")
			app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				if n%2 == 1 {
					return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: fmt.Sprintf("call-%d", n), Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
				}
				return ChatGenerationResult{OutputText: "done"}, nil
			}}
			first := startRuntimeTurn(t, app, user, session, "first")
			approval := waitMCPApproval(t, app.app.mcp, user)
			if err := app.app.mcp.Decide(context.Background(), "another-user", approval.ID, "approved", scope); err == nil {
				t.Fatal("cross-user grant allowed")
			}
			if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved", scope); err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, app, first.RunID, "completed")
			app.app.mcp.sessionsMu.Lock()
			pooled := app.app.mcp.sessions[server.ID]
			app.app.mcp.sessionsMu.Unlock()
			next := startRuntimeTurn(t, app, user, session, "next")
			if scope == "once" {
				pending := waitMCPApproval(t, app.app.mcp, user)
				if executed.Load() != 1 {
					t.Fatal("one-time approval leaked")
				}
				if err := app.app.mcp.Decide(context.Background(), user, pending.ID, "approved"); err != nil {
					t.Fatal(err)
				}
			}
			waitForRunStatus(t, app, next.RunID, "completed")
			app.app.mcp.sessionsMu.Lock()
			reused := app.app.mcp.sessions[server.ID]
			app.app.mcp.sessionsMu.Unlock()
			if pooled == nil || reused != pooled {
				t.Fatal("successful tool calls reinitialized the session")
			}
			if executed.Load() != 2 {
				t.Fatal("scope did not permit next exact execution")
			}
			other, err := app.app.conversations.CreateSession(context.Background(), user, "Other chat")
			if err != nil {
				t.Fatal(err)
			}
			run := startRuntimeTurn(t, app, user, other, "other")
			if scope != "tool" {
				pending := waitMCPApproval(t, app.app.mcp, user)
				if executed.Load() != 2 {
					t.Fatal("chat grant escaped conversation")
				}
				if err := app.app.mcp.Decide(context.Background(), user, pending.ID, "denied"); err != nil {
					t.Fatal(err)
				}
			}
			waitForRunStatus(t, app, run.RunID, "completed")
			if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, true, "always"); err != nil {
				t.Fatal(err)
			}
			reset := startRuntimeTurn(t, app, user, session, "reset")
			pending := waitMCPApproval(t, app.app.mcp, user)
			if err := app.app.mcp.Decide(context.Background(), user, pending.ID, "denied"); err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, app, reset.RunID, "completed")
			var count int
			if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM mcp_tool_grants WHERE user_id=?`, user).Scan(&count); err != nil || count != 0 {
				t.Fatal("reset left grants")
			}
		})
	}
}

func TestMCPAutomaticSetupAndSessionReuse(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	server, err := app.app.mcp.Save(context.Background(), user, "", MCPServerInput{Name: "Remote", Endpoint: "https://mcp.test.invalid/mcp", AuthMode: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.app.mcp.Refresh(context.Background(), user, server.ID); err != nil {
		t.Fatal(err)
	}
	app.app.mcp.sessionsMu.Lock()
	first := app.app.mcp.sessions[server.ID]
	app.app.mcp.sessionsMu.Unlock()
	if _, err := app.app.mcp.Refresh(context.Background(), user, server.ID); err != nil {
		t.Fatal(err)
	}
	app.app.mcp.sessionsMu.Lock()
	second := app.app.mcp.sessions[server.ID]
	app.app.mcp.sessionsMu.Unlock()
	if first != second || first == nil {
		t.Fatal("discovery reinitialized the MCP session")
	}
	if err := app.app.mcp.enableDiscovered(context.Background(), user, server.ID); err != nil {
		t.Fatal(err)
	}
	tools, err := app.app.mcp.Tools(context.Background(), user, server.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools {
		if !tool.Enabled || tool.ApprovalPolicy != "always" {
			t.Fatal("new tools not enabled with approval")
		}
	}
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tools[0].ID, true, "allow"); err != nil {
		t.Fatal(err)
	}
	tools, err = app.app.mcp.Tools(context.Background(), user, server.ID)
	if err != nil || tools[0].ApprovalPolicy != "allow" {
		t.Fatalf("policy=%#v error=%v", tools, err)
	}
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tools[0].ID, false, "allow"); err != nil {
		t.Fatal(err)
	}
	tools, err = app.app.mcp.Refresh(context.Background(), user, server.ID)
	if err != nil || tools[0].Enabled || tools[0].ApprovalPolicy != "always" {
		t.Fatal("refresh restored disabled tool or grants")
	}
}

func TestMCPSchemaAndConfigurationChangesRevokeGrants(t *testing.T) {
	app, user, session := runtimeFixture(t)
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	server, tool := addMCPFixture(t, app, user, "")
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, true, "allow"); err != nil {
		t.Fatal(err)
	}
	// Change the cached schema as if a different definition was received from the remote server.
	if _, err := app.app.db.Exec(`UPDATE user_mcp_tools SET schema_json=? WHERE id=?`, `{"type":"object","properties":{"different":{"type":"string"}}}`, tool.ID); err != nil {
		t.Fatal(err)
	}
	tools, err := app.app.mcp.Tools(context.Background(), user, server.ID)
	if err != nil || tools[0].ApprovalPolicy != "always" {
		t.Fatal("grant survived a changed schema")
	}
	if _, err := app.app.mcp.Refresh(context.Background(), user, server.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, true, "allow"); err != nil {
		t.Fatal(err)
	}
	off := false
	if _, err := app.app.mcp.Save(context.Background(), user, server.ID, MCPServerInput{Name: server.Name, Endpoint: server.Endpoint, AuthMode: "none", Enabled: &off}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM mcp_tool_grants WHERE tool_id=?`, tool.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("disabling connection retained grants")
	}
	app.app.mcp.sessionsMu.Lock()
	cached := app.app.mcp.sessions[server.ID]
	app.app.mcp.sessionsMu.Unlock()
	if cached != nil {
		t.Fatal("disabled connection retained pooled session")
	}
	if err := app.app.conversations.DeleteSession(context.Background(), user, session.FriendlyID); err != nil {
		t.Fatal(err)
	}
}

func TestMCPApprovalStreamAndSnapshot(t *testing.T) {
	app, user, session := runtimeFixture(t)
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	_, tool := addMCPFixture(t, app, user, "")
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if n%2 == 1 {
			return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: fmt.Sprintf("call-%d", n), Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
		}
		return ChatGenerationResult{OutputText: "done"}, nil
	}}
	changed, unsubscribe := app.app.conversations.notifications.subscribe(session.Key)
	defer unsubscribe()
	first := startRuntimeTurn(t, app, user, session, "first")
	approval := waitMCPApproval(t, app.app.mcp, user)
	history, err := app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.PendingMCPApprovals) != 1 || history.PendingMCPApprovals[0].ID != approval.ID {
		t.Fatalf("snapshot lost pending approval: %+v", history.PendingMCPApprovals)
	}
	events, err := app.app.runtime.readEvents(context.Background(), session.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range events {
		if event.MCPApproval != nil && event.MCPApproval.ID == approval.ID && event.MCPApproval.State == "pending" {
			found = true
		}
	}
	if !found {
		t.Fatal("pending approval has no durable event")
	}
	// Drain prior run notifications, then verify the decision commits a stream wake.
	select {
	case <-changed:
	default:
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved", "tool"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	default:
		t.Fatal("decision did not notify conversation stream")
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err == nil {
		t.Fatal("duplicate decision accepted")
	}
	waitForRunStatus(t, app, first.RunID, "completed")
	events, err = app.app.runtime.readEvents(context.Background(), session.Key, history.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	resolved := false
	for _, event := range events {
		if event.MCPApproval == nil {
			continue
		}
		if event.MCPApproval.ID == approval.ID && event.MCPApproval.State == "approved" {
			resolved = true
		}
	}
	if !resolved {
		t.Fatal("approval decision has no durable event")
	}
	next := startRuntimeTurn(t, app, user, session, "next")
	waitForRunStatus(t, app, next.RunID, "completed")
	events, err = app.app.runtime.readEvents(context.Background(), session.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.RunID == next.RunID && event.MCPApproval != nil {
			t.Fatal("always-allowed call emitted approval event")
		}
	}
	history, err = app.app.conversations.GetHistory(context.Background(), user, session.FriendlyID)
	if err != nil || len(history.PendingMCPApprovals) != 0 {
		t.Fatalf("resolved approval survived snapshot: %+v %v", history.PendingMCPApprovals, err)
	}
}

func TestMCPGrantResolvesOtherPendingCalls(t *testing.T) {
	app, user, session := runtimeFixture(t)
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	_, tool := addMCPFixture(t, app, user, "")
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, request ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		for _, message := range request.Messages {
			if message.Role == "tool" {
				return ChatGenerationResult{OutputText: "done"}, nil
			}
		}
		return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: fmt.Sprintf("call-%d", n), Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
	}}
	other, err := app.app.conversations.CreateSession(context.Background(), user, "Other chat")
	if err != nil {
		t.Fatal(err)
	}
	first := startRuntimeTurn(t, app, user, session, "first")
	approval := waitMCPApproval(t, app.app.mcp, user)
	second := startRuntimeTurn(t, app, user, other, "second")
	// Wait for the second prompt before granting global permission to the first.
	deadline := time.Now().Add(5 * time.Second)
	for {
		pending, err := app.app.mcp.Approvals(context.Background(), user, other.FriendlyID)
		if err != nil {
			t.Fatal(err)
		}
		if len(pending) == 1 && pending[0].State == "pending" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("second call did not request approval")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved", "tool"); err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, first.RunID, "completed")
	waitForRunStatus(t, app, second.RunID, "completed")
	events, err := app.app.runtime.readEvents(context.Background(), other.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	resolved := false
	for _, event := range events {
		if event.MCPApproval != nil && event.MCPApproval.State == "approved" {
			resolved = true
		}
	}
	if !resolved {
		t.Fatal("grant did not stream resolution to other chat")
	}
}
