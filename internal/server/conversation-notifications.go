package server

import (
	"context"
	"database/sql"
	"sync"
)

// Notifications are hints; committed events and cursors remain authoritative.
type conversationNotifications struct {
	mu          sync.Mutex
	subscribers map[string]map[chan struct{}]struct{}
}

type sessionListNotifications struct {
	mu          sync.Mutex
	subscribers map[string]map[chan struct{}]struct{}
}

func (broker *conversationNotifications) subscribe(sessionID string) (<-chan struct{}, func()) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	if broker.subscribers == nil {
		broker.subscribers = make(map[string]map[chan struct{}]struct{})
	}
	if broker.subscribers[sessionID] == nil {
		broker.subscribers[sessionID] = make(map[chan struct{}]struct{})
	}
	channel := make(chan struct{}, 1)
	broker.subscribers[sessionID][channel] = struct{}{}
	return channel, func() {
		broker.mu.Lock()
		defer broker.mu.Unlock()
		delete(broker.subscribers[sessionID], channel)
		if len(broker.subscribers[sessionID]) == 0 {
			delete(broker.subscribers, sessionID)
		}
	}
}
func (broker *conversationNotifications) publish(sessionID string) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	for channel := range broker.subscribers[sessionID] {
		select {
		case channel <- struct{}{}:
		default:
		}
	}
}

func (broker *sessionListNotifications) subscribe(userID string) (<-chan struct{}, func()) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	if broker.subscribers == nil {
		broker.subscribers = make(map[string]map[chan struct{}]struct{})
	}
	if broker.subscribers[userID] == nil {
		broker.subscribers[userID] = make(map[chan struct{}]struct{})
	}
	channel := make(chan struct{}, 1)
	broker.subscribers[userID][channel] = struct{}{}
	return channel, func() {
		broker.mu.Lock()
		defer broker.mu.Unlock()
		delete(broker.subscribers[userID], channel)
		if len(broker.subscribers[userID]) == 0 {
			delete(broker.subscribers, userID)
		}
	}
}

func (broker *sessionListNotifications) publish(userID string) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	for channel := range broker.subscribers[userID] {
		select {
		case channel <- struct{}{}:
		default:
		}
	}
}

type conversationTransaction struct {
	*sql.Tx
	notifications    *conversationNotifications
	sessionLists     *sessionListNotifications
	sessions         map[string]struct{}
	sessionListUsers map[string]struct{}
}

func (tx *conversationTransaction) recordEvent(sessionID string) {
	if tx.sessions == nil {
		tx.sessions = make(map[string]struct{})
	}
	tx.sessions[sessionID] = struct{}{}
}

func (tx *conversationTransaction) recordSessionListChange(userID string) {
	if tx.sessionListUsers == nil {
		tx.sessionListUsers = make(map[string]struct{})
	}
	tx.sessionListUsers[userID] = struct{}{}
}

func (tx *conversationTransaction) Commit() error {
	if err := tx.Tx.Commit(); err != nil {
		return err
	}
	for sessionID := range tx.sessions {
		tx.notifications.publish(sessionID)
	}
	for userID := range tx.sessionListUsers {
		tx.sessionLists.publish(userID)
	}
	return nil
}
func (service *ConversationService) beginEventTx(ctx context.Context, options *sql.TxOptions) (*conversationTransaction, error) {
	tx, err := service.db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &conversationTransaction{
		Tx: tx, notifications: &service.notifications, sessionLists: &service.sessionLists,
	}, nil
}
func (service *AgentRuntime) beginEventTx(ctx context.Context, options *sql.TxOptions) (*conversationTransaction, error) {
	return service.conversations.beginEventTx(ctx, options)
}
