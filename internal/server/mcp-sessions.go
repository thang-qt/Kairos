package server

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const mcpSessionIdleTimeout = 2 * time.Minute
const mcpMaxCachedSessions = 64

type mcpCachedSession struct {
	gate     chan struct{}
	mu       sync.Mutex
	session  *mcp.ClientSession
	revision int64
	timer    *time.Timer
	closed   bool
	progress func(*mcp.ProgressNotificationParams)
	inUse    bool
}

func (service *MCPService) dropSession(id string, entry *mcpCachedSession) {
	service.sessionsMu.Lock()
	if service.sessions[id] == entry {
		delete(service.sessions, id)
	}
	service.sessionsMu.Unlock()
	entry.mu.Lock()
	entry.closed = true
	if entry.timer != nil {
		entry.timer.Stop()
	}
	session := entry.session
	entry.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}

func (service *MCPService) invalidateSessions(id string) {
	service.sessionsMu.Lock()
	entry := service.sessions[id]
	delete(service.sessions, id)
	service.sessionsMu.Unlock()
	if entry != nil {
		entry.mu.Lock()
		entry.closed = true
		if entry.timer != nil {
			entry.timer.Stop()
		}
		entry.mu.Unlock()
		go service.dropSession(id, entry)
	}
}

func (service *MCPService) borrowSession(ctx context.Context, server MCPServer, token string, progress func(*mcp.ProgressNotificationParams)) (*mcp.ClientSession, func(bool), error) {
	service.sessionsMu.Lock()
	entry := service.sessions[server.ID]
	if entry != nil && entry.revision != server.Revision {
		delete(service.sessions, server.ID)
		go service.dropSession(server.ID, entry)
		entry = nil
	}
	if entry == nil {
		entry = &mcpCachedSession{gate: make(chan struct{}, 1), revision: server.Revision}
		entry.gate <- struct{}{}
		if len(service.sessions) < mcpMaxCachedSessions {
			service.sessions[server.ID] = entry
		}
	}
	service.sessionsMu.Unlock()
	select {
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	case <-entry.gate:
	}
	entry.mu.Lock()
	if entry.timer != nil {
		entry.timer.Stop()
		entry.timer = nil
	}
	if entry.closed {
		entry.mu.Unlock()
		entry.gate <- struct{}{}
		return nil, nil, errors.New("MCP session expired; try again")
	}
	entry.progress = progress
	entry.inUse = true
	session := entry.session
	entry.mu.Unlock()
	if session == nil {
		var err error
		session, err = service.connect(ctx, server, token, func(params *mcp.ProgressNotificationParams) {
			entry.mu.Lock()
			callback := entry.progress
			entry.mu.Unlock()
			if callback != nil {
				callback(params)
			}
		})
		if err != nil {
			entry.gate <- struct{}{}
			service.dropSession(server.ID, entry)
			return nil, nil, err
		}
		entry.mu.Lock()
		if entry.closed || ctx.Err() != nil {
			entry.mu.Unlock()
			_ = session.Close()
			entry.gate <- struct{}{}
			service.dropSession(server.ID, entry)
			return nil, nil, errors.New("MCP session was cancelled")
		}
		entry.session = session
		entry.mu.Unlock()
		go func() { _ = session.Wait(); service.dropSession(server.ID, entry) }()
	}
	release := func(healthy bool) {
		entry.mu.Lock()
		entry.progress = nil
		entry.inUse = false
		if healthy && !entry.closed {
			entry.timer = time.AfterFunc(mcpSessionIdleTimeout, func() {
				entry.mu.Lock()
				if entry.inUse || entry.closed {
					entry.mu.Unlock()
					return
				}
				entry.closed = true
				entry.mu.Unlock()
				service.dropSession(server.ID, entry)
			})
		}
		entry.mu.Unlock()
		service.sessionsMu.Lock()
		cached := service.sessions[server.ID] == entry
		service.sessionsMu.Unlock()
		if !healthy || !cached {
			service.dropSession(server.ID, entry)
		}
		entry.gate <- struct{}{}
	}
	return session, release, nil
}
