package server

import (
	"encoding/json"
	"errors"
	"net/http"
)

func (app *App) handleSessionEvents(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	friendlyID := request.PathValue("friendlyId")
	if _, err := app.runs.ResolveSession(request.Context(), user.ID, friendlyID); err != nil {
		if errors.Is(err, errChatSessionNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, "failed to open stream")
		return
	}

	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)
	flusher.Flush()

	_, _ = writer.Write([]byte(": connected\n\n"))
	flusher.Flush()

	streamErr := app.runs.StreamSession(request.Context(), user.ID, friendlyID, func(event ChatEvent) error {
		payload, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if _, err := writer.Write([]byte("data: ")); err != nil {
			return err
		}
		if _, err := writer.Write(payload); err != nil {
			return err
		}
		if _, err := writer.Write([]byte("\n\n")); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
	if streamErr != nil && !errors.Is(streamErr, errChatSessionNotFound) {
		return
	}
}
