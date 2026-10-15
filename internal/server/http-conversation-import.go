package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type conversationImportEvent struct {
	Stage    string                    `json:"stage"`
	Imported int                       `json:"imported"`
	Total    int                       `json:"total"`
	Report   *conversationImportReport `json:"report,omitempty"`
	Error    string                    `json:"error,omitempty"`
}

// Bound concurrent disk spooling and parsing as well as individual archive size.
var conversationImportSlot = make(chan struct{}, 1)

func localImportHost(host string) bool {
	if hostname, _, err := net.SplitHostPort(host); err == nil {
		host = hostname
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (app *App) handleConversationImport(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	if !app.conversationImportAllowed(request) {
		writeError(writer, http.StatusForbidden, "Conversation import is available only on localhost. Set ALLOW_REMOTE_IMPORT=true on the server to enable remote imports.")
		return
	}
	factory, exists := conversationImporters[request.PathValue("source")]
	if !exists {
		writeError(writer, http.StatusBadRequest, "Unsupported import format.")
		return
	}
	mode := request.URL.Query().Get("mode")
	if mode != "preview" && mode != "import" {
		writeError(writer, http.StatusBadRequest, "Choose preview or import.")
		return
	}
	select {
	case conversationImportSlot <- struct{}{}:
		defer func() { <-conversationImportSlot }()
	default:
		writeError(writer, http.StatusTooManyRequests, "Another import is in progress. Try again when it finishes.")
		return
	}
	if request.ContentLength > maxImportUpload {
		writeError(writer, http.StatusRequestEntityTooLarge, "Archive exceeds the 512 MiB upload limit.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, maxImportUpload)
	defer request.Body.Close()
	// ZIP needs ReaderAt. Spool to a private temporary file instead of buffering
	// the upload in memory; never extract member paths onto the filesystem.
	file, err := os.CreateTemp("", "kairos-import-*.zip")
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Unable to prepare import.")
		return
	}
	defer os.Remove(file.Name())
	defer file.Close()
	size, err := io.Copy(file, request.Body)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Unable to read export. Upload a file no larger than 512 MiB.")
		return
	}
	archive, err := factory(file, size)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Invalid export or import limits exceeded. For ChatGPT: 2 GiB expanded, 256 MiB per JSON file, 64 MiB retained per conversation, 20,000 entries.")
		return
	}
	if mode == "import" && strings.Contains(request.Header.Get("Accept"), "text/event-stream") {
		flusher, ok := writer.(http.Flusher)
		if !ok {
			writeError(writer, http.StatusInternalServerError, "Import progress unavailable.")
			return
		}
		writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Accel-Buffering", "no")
		send := func(event conversationImportEvent) {
			data, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(writer, "data: %s\n\n", data)
			flusher.Flush()
		}
		send(conversationImportEvent{Stage: "validating"})
		report, err := app.conversations.previewConversationImport(request.Context(), user.ID, archive)
		if err != nil {
			send(conversationImportEvent{Stage: "error", Error: "Unable to validate conversations. Nothing was imported."})
			return
		}
		send(conversationImportEvent{Stage: "importing", Total: report.Conversations})
		report = app.conversations.commitConversationImportWithProgress(request.Context(), user.ID, archive, report, func(current conversationImportReport) {
			send(conversationImportEvent{Stage: "importing", Imported: current.Imported, Total: current.Conversations})
		})
		send(conversationImportEvent{Stage: "complete", Imported: report.Imported, Total: report.Conversations, Report: &report})
		return
	}
	report, err := app.conversations.previewConversationImport(request.Context(), user.ID, archive)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Unable to validate conversations. Nothing was imported.")
		return
	}
	if mode == "import" {
		report = app.conversations.commitConversationImport(request.Context(), user.ID, archive, report)
	}
	writeJSON(writer, http.StatusOK, report)
}

func (app *App) conversationImportAllowed(request *http.Request) bool {
	if app.config.AllowRemoteImport {
		return true
	}
	if !localImportHost(request.Host) || !localImportHost(request.RemoteAddr) {
		return false
	}
	if origin := request.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && localImportHost(parsed.Host)
	}
	return true
}

func (app *App) handleConversationImportSettings(writer http.ResponseWriter, request *http.Request) {
	if _, ok := app.requireAuthenticatedUser(writer, request); !ok {
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"enabled": app.conversationImportAllowed(request)})
}
