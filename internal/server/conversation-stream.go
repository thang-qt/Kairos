package server

import (
	"context"
	"time"
)

func (service *AgentRuntime) StreamSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	onEvent func(ConversationEvent) error,
) error {
	return service.StreamSessionFromCursor(ctx, userID, friendlyID, 0, onEvent)
}

func (service *AgentRuntime) StreamSessionFromCursor(
	ctx context.Context,
	userID string,
	friendlyID string,
	afterCursor int64,
	onEvent func(ConversationEvent) error,
) error {
	session, err := service.conversations.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return err
	}

	history, err := service.conversations.GetHistory(ctx, userID, friendlyID)
	if err != nil {
		return err
	}
	if err := onEvent(ConversationEvent{State: "reconcile", Snapshot: &history, SessionKey: session.ID, Revision: history.Revision, ActiveRunIDs: history.ActiveRunIDs}); err != nil {
		return err
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		events, err := service.readEvents(ctx, session.ID, afterCursor)
		if err != nil {
			return err
		}
		for _, event := range events {
			if err := onEvent(event); err != nil {
				return err
			}
			afterCursor = event.Cursor
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		case <-heartbeat.C:
			if err := onEvent(ConversationEvent{State: "heartbeat"}); err != nil {
				return err
			}
		}
	}

}

func (service *AgentRuntime) ResolveSession(
	ctx context.Context,
	userID string,
	friendlyID string,
) (sessionRecord, error) {
	return service.conversations.findSessionByFriendlyID(ctx, userID, friendlyID)
}
