package server

import (
	"sync"
	"time"
)

type ChatEvent struct {
	RunID      string          `json:"runId,omitempty"`
	SessionKey string          `json:"sessionKey,omitempty"`
	FriendlyID string          `json:"friendlyId,omitempty"`
	State      string          `json:"state,omitempty"`
	Error      string          `json:"error,omitempty"`
	Message    map[string]any  `json:"message,omitempty"`
	Session    *SessionSummary `json:"session,omitempty"`
}

type RunBroker struct {
	mu           sync.RWMutex
	subscribers  map[string]map[chan ChatEvent]struct{}
	recentEvents map[string][]bufferedChatEvent
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
	}
}

func (broker *RunBroker) Publish(sessionID string, event ChatEvent) {
	broker.mu.Lock()
	broker.recentEvents[sessionID] = broker.appendRecentEvent(
		broker.recentEvents[sessionID],
		event,
	)
	sessionSubscribers := broker.subscribers[sessionID]
	channels := make([]chan ChatEvent, 0, len(sessionSubscribers))
	for channel := range sessionSubscribers {
		channels = append(channels, channel)
	}
	broker.mu.Unlock()

	for _, channel := range channels {
		select {
		case channel <- event:
		default:
		}
	}
}

func (broker *RunBroker) Subscribe(sessionID string) (<-chan ChatEvent, func()) {
	channel := make(chan ChatEvent, 16)

	broker.mu.Lock()
	if broker.subscribers[sessionID] == nil {
		broker.subscribers[sessionID] = make(map[chan ChatEvent]struct{})
	}
	broker.subscribers[sessionID][channel] = struct{}{}
	recentEvents := broker.pruneRecentEvents(broker.recentEvents[sessionID])
	if len(recentEvents) == 0 {
		delete(broker.recentEvents, sessionID)
	} else {
		broker.recentEvents[sessionID] = recentEvents
	}
	broker.mu.Unlock()

	for _, recentEvent := range recentEvents {
		select {
		case channel <- recentEvent.event:
		default:
		}
	}

	return channel, func() {
		broker.mu.Lock()
		if sessionSubscribers := broker.subscribers[sessionID]; sessionSubscribers != nil {
			delete(sessionSubscribers, channel)
			if len(sessionSubscribers) == 0 {
				delete(broker.subscribers, sessionID)
			}
		}
		broker.mu.Unlock()
		close(channel)
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
