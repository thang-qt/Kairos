package server

import (
	"context"
	"errors"
	"strings"
	"time"
)

// StreamEphemeral runs a complete chat turn through the shared generation
// engine without creating a session, run, or message row.
func (service *ChatRunService) StreamEphemeral(
	ctx context.Context,
	userID string,
	history []map[string]any,
	input SendMessageInput,
	emit func(ChatEvent) error,
) (runErr error) {
	runID := newID()
	sink := &ephemeralGenerationSink{
		runID: runID,
		emit:  emit,
	}
	defer func() {
		if runErr == nil {
			return
		}
		state := "error"
		if errors.Is(runErr, context.Canceled) ||
			errors.Is(runErr, errGenerationInactive) {
			state = "aborted"
		}
		_ = emit(ChatEvent{
			RunID: runID,
			State: state,
			Error: strings.TrimSpace(runErr.Error()),
		})
	}()

	userMessage, _, err := buildUserMessage(
		input.Message,
		input.Attachments,
		input.ClientID,
	)
	if err != nil {
		return err
	}
	userMessage["timestamp"] = time.Now().UnixMilli()
	requestHistory := append(
		append([]map[string]any(nil), history...),
		userMessage,
	)

	_, err = service.executeGeneration(
		ctx,
		generationExecutionInput{
			UserID:             userID,
			RunID:              runID,
			AssistantMessageID: newID(),
			History:            requestHistory,
			Request:            input,
		},
		sink,
	)
	return err
}

type ephemeralGenerationSink struct {
	runID string
	emit  func(ChatEvent) error
}

func (sink *ephemeralGenerationSink) ModelResolved(
	_ ProviderModel,
) error {
	return nil
}

func (sink *ephemeralGenerationSink) Delta(
	message map[string]any,
) error {
	return sink.emit(ChatEvent{
		RunID:   sink.runID,
		State:   "delta",
		Message: message,
	})
}

func (sink *ephemeralGenerationSink) ToolRound(
	messages []map[string]any,
	_ int64,
) error {
	for _, message := range messages {
		if err := sink.Delta(message); err != nil {
			return err
		}
	}
	return nil
}

func (sink *ephemeralGenerationSink) Final(
	message map[string]any,
	_ int64,
) error {
	return sink.emit(ChatEvent{
		RunID:   sink.runID,
		State:   "final",
		Message: message,
	})
}
