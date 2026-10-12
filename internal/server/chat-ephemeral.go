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
	turnID := newID()
	sink := &ephemeralGenerationSink{
		runID:  runID,
		turnID: turnID,
		steps:  []map[string]any{},
		emit:   emit,
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
		_ = sink.publish(state, strings.TrimSpace(runErr.Error()))
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
		append([]map[string]any(nil), flattenTurnHistory(history)...),
		userMessage,
	)

	_, err = service.executeGeneration(
		ctx,
		generationExecutionInput{
			UserID:             userID,
			RunID:              runID,
			AssistantMessageID: turnID,
			History:            requestHistory,
			Request:            input,
		},
		sink,
	)
	return err
}

type ephemeralGenerationSink struct {
	runID  string
	turnID string
	steps  []map[string]any
	emit   func(ChatEvent) error
}

func (sink *ephemeralGenerationSink) ModelResolved(_ ProviderModel) error {
	return sink.publish("delta", "")
}
func (sink *ephemeralGenerationSink) Delta(message map[string]any) error {
	id := messageIDFromMap(message)
	found := false
	for index, step := range sink.steps {
		if messageIDFromMap(step) == id {
			sink.steps[index] = message
			found = true
			break
		}
	}
	if !found {
		sink.steps = append(sink.steps, message)
	}
	return sink.publish("delta", "")
}
func (sink *ephemeralGenerationSink) ToolRound(messages []map[string]any, _ int64) error {
	for _, message := range messages {
		if err := sink.Delta(message); err != nil {
			return err
		}
	}
	return nil
}
func (sink *ephemeralGenerationSink) Final(message map[string]any, _ int64) error {
	if err := sink.Delta(message); err != nil {
		return err
	}
	return sink.publish("final", "")
}
func (sink *ephemeralGenerationSink) publish(state, errorMessage string) error {
	content := []map[string]any{}
	turn := map[string]any{"id": sink.turnID, "role": "assistant", "runId": sink.runID, "steps": sink.steps, "status": map[string]string{"delta": "running", "final": "completed", "error": "error", "aborted": "aborted"}[state]}
	for _, step := range sink.steps {
		if stringValueFromMap(step, "role") == "assistant" {
			content = append(content, contentPartsToMaps(contentPartsFromAny(step["content"]))...)
			for _, key := range []string{"model", "modelName", "modelDescription", "details", "timestamp"} {
				if value, ok := step[key]; ok {
					turn[key] = value
				}
			}
		}
	}
	turn["content"] = content
	return sink.emit(ChatEvent{RunID: sink.runID, TurnID: sink.turnID, State: state, Error: errorMessage, Message: turn})
}
func flattenTurnHistory(turns []map[string]any) []map[string]any {
	messages := []map[string]any{}
	for _, turn := range turns {
		switch steps := turn["steps"].(type) {
		case []any:
			for _, step := range steps {
				if message, ok := step.(map[string]any); ok {
					messages = append(messages, message)
				}
			}
		case []map[string]any:
			messages = append(messages, steps...)
		default:
			messages = append(messages, turn)
		}
	}
	return messages
}
