package server

import (
	"context"
	"log"
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
	ctx, cancel := service.requestContext(ctx)
	defer cancel()
	session, err := service.conversations.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return err
	}

	// Subscribe before the snapshot so commits during loading cannot be missed.
	changed, unsubscribe := service.conversations.notifications.subscribe(session.ID)
	defer unsubscribe()
	history, err := service.conversations.GetHistory(ctx, userID, friendlyID)
	if err != nil {
		return err
	}
	if err := onEvent(ConversationEvent{State: "reconcile", Snapshot: &history, SessionKey: session.ID, Revision: history.Revision, ActiveRunIDs: history.ActiveRunIDs}); err != nil {
		return err
	}
	afterCursor = maxInt64(afterCursor, history.Cursor)
	log.Printf("kairos: stage=snapshot_delivery conversation=%s cursor=%d", session.ID, history.Cursor)
	ticker := time.NewTicker(30 * time.Second)
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
			if event.State != "delta" {
				log.Printf("kairos: stage=event_delivery conversation=%s run=%s cursor=%d state=%s", session.ID, event.RunID, event.Cursor, event.State)
			}
			afterCursor = event.Cursor
		}
		// Drain a full page before sleeping; one coalesced wake may cover many events.
		if len(events) == 256 {
			continue
		}
		waiting := true
		for waiting {
			select {
			case <-ctx.Done():
				return nil
			case <-changed:
				waiting = false
			case <-ticker.C:
				waiting = false
			case <-heartbeat.C:
				if err := onEvent(ConversationEvent{State: "heartbeat"}); err != nil {
					return err
				}
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
