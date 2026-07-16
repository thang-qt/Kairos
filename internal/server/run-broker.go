package server

import (
	"sync"
	"time"
)

type ChatEvent struct {
	Cursor       int64           `json:"cursor,omitempty"`
	RunID        string          `json:"runId,omitempty"`
	SessionKey   string          `json:"sessionKey,omitempty"`
	FriendlyID   string          `json:"friendlyId,omitempty"`
	State        string          `json:"state,omitempty"`
	Error        string          `json:"error,omitempty"`
	ActiveRunIDs []string        `json:"activeRunIds,omitempty"`
	Message      map[string]any  `json:"message,omitempty"`
	Session      *SessionSummary `json:"session,omitempty"`
}

type RunBroker struct {
	mu           sync.Mutex
	subscribers  map[string]map[chan ChatEvent]struct{}
	recentEvents map[string][]bufferedChatEvent
	cursors      map[string]int64
}

type bufferedChatEvent struct {
	event       ChatEvent
	publishedAt time.Time
}

const maxBufferedChatEvents = 12

const bufferedChatEventTTL = 30 * time.Second

func NewRunBroker() *RunBroker {
	return &RunBroker{
		subscribers:  make(map[string]map[chan ChatEvent]struct{}),
		recentEvents: make(map[string][]bufferedChatEvent),
		cursors:      make(map[string]int64),
	}
}

func (broker *RunBroker) Publish(sessionID string, event ChatEvent) {
	broker.mu.Lock()
	broker.cursors[sessionID]++
	event.Cursor = broker.cursors[sessionID]
	broker.recentEvents[sessionID] = broker.appendRecentEvent(
		broker.recentEvents[sessionID],
		event,
	)
	for channel := range broker.subscribers[sessionID] {
		select {
		case channel <- event:
		default:
			delete(broker.subscribers[sessionID], channel)
			close(channel)
		}
	}
	if len(broker.subscribers[sessionID]) == 0 {
		delete(broker.subscribers, sessionID)
	}
	broker.mu.Unlock()
}

func (broker *RunBroker) Subscribe(
	sessionID string,
	afterCursor int64,
	reconcile ChatEvent,
) (chan ChatEvent, func()) {
	broker.mu.Lock()
	recentEvents := broker.pruneRecentEvents(broker.recentEvents[sessionID])
	if len(recentEvents) == 0 {
		delete(broker.recentEvents, sessionID)
	} else {
		broker.recentEvents[sessionID] = recentEvents
	}

	replay := make([]ChatEvent, 0, len(recentEvents)+1)
	if reconcile.State != "" {
		replay = append(replay, reconcile)
	}
	for _, recentEvent := range recentEvents {
		if afterCursor > 0 && recentEvent.event.Cursor <= afterCursor {
			continue
		}
		replay = append(replay, recentEvent.event)
	}

	bufferSize := max(16, len(replay)+16)
	channel := make(chan ChatEvent, bufferSize)
	for _, event := range replay {
		channel <- event
	}
	if broker.subscribers[sessionID] == nil {
		broker.subscribers[sessionID] = make(map[chan ChatEvent]struct{})
	}
	broker.subscribers[sessionID][channel] = struct{}{}
	broker.mu.Unlock()

	return channel, func() {
		broker.mu.Lock()
		if sessionSubscribers := broker.subscribers[sessionID]; sessionSubscribers != nil {
			if _, ok := sessionSubscribers[channel]; ok {
				delete(sessionSubscribers, channel)
				close(channel)
			}
			if len(sessionSubscribers) == 0 {
				delete(broker.subscribers, sessionID)
			}
		}
		broker.mu.Unlock()
	}
}

func (broker *RunBroker) appendRecentEvent(
	recentEvents []bufferedChatEvent,
	event ChatEvent,
) []bufferedChatEvent {
	pruned := broker.pruneRecentEvents(recentEvents)
	pruned = append(pruned, bufferedChatEvent{
		event:       event,
		publishedAt: time.Now(),
	})
	if len(pruned) > maxBufferedChatEvents {
		pruned = pruned[len(pruned)-maxBufferedChatEvents:]
	}
	return pruned
}

func (broker *RunBroker) pruneRecentEvents(
	recentEvents []bufferedChatEvent,
) []bufferedChatEvent {
	if len(recentEvents) == 0 {
		return nil
	}
	cutoff := time.Now().Add(-bufferedChatEventTTL)
	pruned := recentEvents[:0]
	for _, recentEvent := range recentEvents {
		if recentEvent.publishedAt.Before(cutoff) {
			continue
		}
		pruned = append(pruned, recentEvent)
	}
	return pruned
}
