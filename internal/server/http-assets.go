package server

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

func (app *App) handleGetAsset(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	record, err := app.conversations.assets.find(request.Context(), user.ID, request.PathValue("assetId"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "Asset not found.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Unable to load asset.")
		return
	}
	reader, err := app.conversations.assets.read(request.Context(), record)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "Asset storage is unavailable.")
		return
	}
	defer reader.Close()
	writer.Header().Set("Content-Type", record.MediaType)
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Content-Length", fmt.Sprint(record.Size))
	if _, err := io.Copy(writer, io.LimitReader(reader, record.Size)); err != nil {
		log.Printf("kairos: serve asset: %v", err)
	}
}
