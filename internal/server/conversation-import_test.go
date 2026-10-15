package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// All fixtures are synthetic. Never use an actual exported conversation in tests.
func importFixtureConversation(id string) map[string]any {
	return map[string]any{
		"id": id, "title": "Synthetic import", "create_time": 1700000000, "update_time": 1700000010, "current_node": "answer", "pinned_time": 1700000001,
		"mapping": map[string]any{
			"root":      map[string]any{"parent": nil, "message": nil},
			"user":      map[string]any{"parent": "root", "message": map[string]any{"id": "source-user", "author": map[string]any{"role": "user"}, "create_time": 1700000001, "content": map[string]any{"content_type": "multimodal_text", "parts": []any{"Synthetic question", map[string]any{"content_type": "image_asset_pointer", "asset_pointer": "sediment://synthetic-image"}}}, "metadata": map[string]any{"attachments": []any{map[string]any{"id": "skipped-pdf"}}}}},
			"thought":   map[string]any{"parent": "user", "message": map[string]any{"id": "source-thought", "author": map[string]any{"role": "assistant"}, "create_time": 1700000001, "content": map[string]any{"content_type": "thoughts", "thoughts": []any{map[string]any{"content": "Synthetic reasoning", "summary": "Summary"}}}}},
			"answer":    map[string]any{"parent": "thought", "message": map[string]any{"id": "source-answer", "author": map[string]any{"role": "assistant"}, "create_time": 1700000000, "content": map[string]any{"content_type": "text", "parts": []any{"Synthetic answer"}}, "metadata": map[string]any{"model_slug": "historical-unconfigured-model"}}},
			"alternate": map[string]any{"parent": "user", "message": map[string]any{"author": map[string]any{"role": "assistant"}, "content": map[string]any{"content_type": "text", "parts": []any{"Excluded alternate"}}}},
		},
	}
}

func importFixtureZIP(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for name, data := range entries {
		stream, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = stream.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func importFixtureArchive(t *testing.T, conversations ...map[string]any) []byte {
	t.Helper()
	body, err := json.Marshal(conversations)
	if err != nil {
		t.Fatal(err)
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	return importFixtureZIP(t, map[string][]byte{"export/conversations-000.json": body, "export/synthetic-image.dat": png, "user.json": []byte(`{"email":"synthetic@example.invalid"}`), "unrelated.pdf": []byte("%PDF-1.7")})
}

func performImportRequest(t *testing.T, app *testApp, cookie *http.Cookie, archive []byte, mode string) (*httptest.ResponseRecorder, conversationImportReport) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "http://localhost/api/imports/chatgpt?mode="+mode, bytes.NewReader(archive))
	request.RemoteAddr = "127.0.0.1:12345"
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	app.handler.ServeHTTP(response, request)
	var report conversationImportReport
	if response.Code == http.StatusOK {
		if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
	}
	return response, report
}

func TestConversationImportPreviewCommitAndDeduplication(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "import@example.invalid")
	archive := importFixtureArchive(t, importFixtureConversation("source-conversation"))
	response, preview := performImportRequest(t, app, cookie, archive, "preview")
	assertStatusCode(t, response, http.StatusOK)
	if preview.Conversations != 1 || preview.Messages != 3 || preview.Images != 1 || preview.AlternateNodes != 1 || preview.SkippedAttachments != 1 {
		t.Fatalf("unexpected counts: %+v", preview)
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatal("preview wrote conversations", err)
	}
	if bytes.Contains(response.Body.Bytes(), []byte("Synthetic")) || bytes.Contains(response.Body.Bytes(), []byte("source-conversation")) {
		t.Fatal("preview returned source data")
	}
	response, report := performImportRequest(t, app, cookie, archive, "import")
	assertStatusCode(t, response, http.StatusOK)
	if report.Failed || report.Imported != 1 {
		t.Fatalf("import failed: %+v", report)
	}
	var userID, friendlyID string
	var created, updated int64
	if err := app.app.db.QueryRow(`SELECT user_id,friendly_id,created_at,updated_at FROM chat_sessions`).Scan(&userID, &friendlyID, &created, &updated); err != nil {
		t.Fatal(err)
	}
	if created != 1700000000000 || updated != 1700000010000 {
		t.Fatal("source session timestamps not retained")
	}
	history, err := app.app.conversations.GetHistory(context.Background(), userID, friendlyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Messages) != 2 {
		t.Fatalf("want user and grouped assistant, got %d", len(history.Messages))
	}
	if history.Messages[0]["role"] != "user" || history.Messages[1]["model"] != "historical-unconfigured-model" {
		t.Fatal("graph ordering or historical model lost")
	}
	encoded, _ := json.Marshal(history)
	for _, wanted := range []string{"Synthetic reasoning", "Synthetic answer", "image/png", "source-answer", "importSource", "sourceTimestamp"} {
		if !bytes.Contains(encoded, []byte(wanted)) {
			t.Fatalf("missing %s", wanted)
		}
	}
	if bytes.Contains(encoded, []byte("Excluded alternate")) || bytes.Contains(encoded, []byte("synthetic@example.invalid")) {
		t.Fatal("import included excluded data")
	}
	response, repeated := performImportRequest(t, app, cookie, archive, "import")
	assertStatusCode(t, response, http.StatusOK)
	if repeated.Imported != 0 || repeated.Duplicates != 1 {
		t.Fatalf("not idempotent: %+v", repeated)
	}
	other := signupAndRequireCookie(t, app, "other-import@example.invalid")
	_, otherReport := performImportRequest(t, app, other, archive, "import")
	if otherReport.Imported != 1 {
		t.Fatal("deduplication must be user scoped")
	}
}

func TestConversationImportValidatesEntireArchiveBeforeWriting(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "invalid-import@example.invalid")
	invalid := importFixtureConversation("invalid")
	invalid["current_node"] = "missing"
	response, _ := performImportRequest(t, app, cookie, importFixtureArchive(t, importFixtureConversation("valid"), invalid), "import")
	assertStatusCode(t, response, http.StatusBadRequest)
	var count int
	if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatal("validation failure wrote chats", err)
	}
	cyclic := importFixtureConversation("cycle")
	cyclic["mapping"].(map[string]any)["root"].(map[string]any)["parent"] = "answer"
	response, _ = performImportRequest(t, app, cookie, importFixtureArchive(t, cyclic), "preview")
	assertStatusCode(t, response, http.StatusBadRequest)
}

func TestConversationImportStreamsCommittedProgress(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "progress@example.invalid")
	archive := importFixtureArchive(t, importFixtureConversation("progress-a"), importFixtureConversation("progress-b"))
	request := httptest.NewRequest(http.MethodPost, "http://localhost/api/imports/chatgpt?mode=import", bytes.NewReader(archive))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Accept", "text/event-stream")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	app.handler.ServeHTTP(response, request)
	assertStatusCode(t, response, http.StatusOK)
	if !strings.HasPrefix(response.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatal("progress was not streamed")
	}
	events := []conversationImportEvent{}
	for _, line := range strings.Split(response.Body.String(), "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event conversationImportEvent
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if len(events) != 5 || events[0].Stage != "validating" || events[1].Total != 2 || events[2].Imported != 1 || events[3].Imported != 2 || events[4].Report == nil || events[4].Report.Imported != 2 {
		t.Fatalf("unexpected progress: %+v", events)
	}
	if strings.Contains(response.Body.String(), "Synthetic") || strings.Contains(response.Body.String(), "progress-a") {
		t.Fatal("progress included source content")
	}
}

func TestConversationImportRequiresAuthenticationAndLocalhost(t *testing.T) {
	app := newTestApp(t, nil)
	archive := importFixtureArchive(t, importFixtureConversation("source"))
	response, _ := performImportRequest(t, app, nil, archive, "preview")
	assertStatusCode(t, response, http.StatusUnauthorized)
	cookie := signupAndRequireCookie(t, app, "local-import@example.invalid")
	for _, target := range []struct{ host, peer string }{{"https://remote.example.invalid", "127.0.0.1:1234"}, {"http://localhost", "192.0.2.1:1234"}} {
		request := httptest.NewRequest(http.MethodPost, target.host+"/api/imports/chatgpt?mode=preview", bytes.NewReader(archive))
		request.RemoteAddr = target.peer
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		app.handler.ServeHTTP(response, request)
		assertStatusCode(t, response, http.StatusForbidden)
	}
	response, _ = performImportRequest(t, app, cookie, archive, "invalid")
	assertStatusCode(t, response, http.StatusBadRequest)
	request := httptest.NewRequest(http.MethodPost, "http://localhost/api/imports/chatgpt?mode=preview", bytes.NewReader(archive))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Origin", "https://remote.example.invalid")
	request.AddCookie(cookie)
	response = httptest.NewRecorder()
	app.handler.ServeHTTP(response, request)
	assertStatusCode(t, response, http.StatusForbidden)
}

type syntheticConversationImporter struct{ source string }

func (adapter syntheticConversationImporter) Source() string { return adapter.source }

func (adapter syntheticConversationImporter) Walk(ctx context.Context, store importImageStore, visit func(importConversation) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return visit(importConversation{
		SourceID: "same-source-id", Title: "Another synthetic format",
		Messages: []importMessage{{SourceID: "message", Role: "user", Content: []chatMessageContentPart{newTextContentPart("Synthetic content")}}},
		Counts:   conversationImportReport{Messages: 1},
	})
}

func TestConversationImportPipelineSupportsOtherAdaptersAndScopesSourceIDs(t *testing.T) {
	app := newTestApp(t, nil)
	signupAndRequireCookie(t, app, "generic-import@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"synthetic-format-a", "synthetic-format-b"} {
		adapter := syntheticConversationImporter{source: source}
		report, err := app.app.conversations.previewConversationImport(context.Background(), userID, adapter)
		if err != nil || report.Conversations != 1 || report.Messages != 1 {
			t.Fatalf("generic preview failed: %+v %v", report, err)
		}
		report = app.app.conversations.commitConversationImport(context.Background(), userID, adapter, report)
		if report.Failed || report.Imported != 1 {
			t.Fatalf("generic commit failed: %+v", report)
		}
		repeated, err := app.app.conversations.previewConversationImport(context.Background(), userID, adapter)
		if err != nil || repeated.Duplicates != 1 {
			t.Fatal("generic deduplication failed", err)
		}
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_sessions`).Scan(&count); err != nil || count != 2 {
		t.Fatal("source IDs collided across formats", err)
	}
}

func TestConversationImportRollbackAndRetry(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "rollback-import@example.invalid")
	if _, err := app.app.db.Exec(`CREATE TRIGGER fail_import BEFORE INSERT ON chat_messages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	archive := importFixtureArchive(t, importFixtureConversation("rollback"))
	response, report := performImportRequest(t, app, cookie, archive, "import")
	assertStatusCode(t, response, http.StatusOK)
	if !report.Failed || report.Imported != 0 {
		t.Fatal("failure not reported")
	}
	var count int
	if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial conversation persisted", err)
	}
	if _, err := app.app.db.Exec(`DROP TRIGGER fail_import`); err != nil {
		t.Fatal(err)
	}
	_, report = performImportRequest(t, app, cookie, archive, "import")
	if report.Failed || report.Imported != 1 {
		t.Fatal("retry failed")
	}
}

func TestChatGPTImportMissingImagesSplitFilesAndDuplicates(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "split-import@example.invalid")
	body, _ := json.Marshal([]any{importFixtureConversation("split")})
	archive := importFixtureZIP(t, map[string][]byte{"conversations.json": body, "conversations_1.json": body})
	response, report := performImportRequest(t, app, cookie, archive, "preview")
	assertStatusCode(t, response, http.StatusOK)
	if report.Conversations != 1 || report.Duplicates != 1 || report.SkippedImages != 1 {
		t.Fatalf("unexpected split counts: %+v", report)
	}
	response, report = performImportRequest(t, app, cookie, archive, "import")
	assertStatusCode(t, response, http.StatusOK)
	if report.Imported != 1 || report.Failed {
		t.Fatal("split import failed")
	}
}

type zeroImportReader struct{}

func (zeroImportReader) Read(buffer []byte) (int, error) { clear(buffer); return len(buffer), nil }

func TestChatGPTImportAccepts200MiBZIPWithoutWholeArchiveBuffer(t *testing.T) {
	if testing.Short() {
		t.Skip("large archive smoke test")
	}
	file, err := os.CreateTemp(t.TempDir(), "large-*.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	padding, err := writer.CreateHeader(&zip.FileHeader{Name: "unused.dat", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.CopyN(padding, zeroImportReader{}, 200<<20); err != nil {
		t.Fatal(err)
	}
	conversations, err := writer.Create("conversations.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.NewEncoder(conversations).Encode([]any{importFixtureConversation("large")}); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	archive, err := openChatGPTImport(file, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	visited := 0
	err = archive.Walk(context.Background(), nil, func(conversation importConversation) error { visited++; return nil })
	if err != nil || visited != 1 {
		t.Fatal("large archive failed", err)
	}
}

func TestChatGPTImportRejectsExpansionLimits(t *testing.T) {
	archive := importFixtureZIP(t, map[string][]byte{"conversations.json": []byte("[]")})
	// Patch the central directory's declared uncompressed size. Validation must
	// reject this before opening or allocating the oversized member.
	offset := bytes.Index(archive, []byte{'P', 'K', 1, 2})
	if offset < 0 {
		t.Fatal("missing directory")
	}
	for i := 24; i < 28; i++ {
		archive[offset+i] = 255
	}
	if _, err := openChatGPTImport(bytes.NewReader(archive), int64(len(archive))); err == nil {
		t.Fatal("accepted oversized expanded entry")
	}
}

func TestChatGPTImportDoesNotFallbackFromAmbiguousImageName(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	data := importFixtureZIP(t, map[string][]byte{
		"conversations.json": []byte("[]"),
		"first/image":        png,
		"second/image":       png,
		"image.dat":          png,
	})
	archive, err := openChatGPTImport(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if _, image := archive.image("sediment://image"); image != nil {
		t.Fatal("ambiguous image resolved to a different asset")
	}
	if _, image := archive.image("sediment://image.dat"); image == nil {
		t.Fatal("unambiguous image was skipped")
	}
}

func TestConversationImportRemoteOptIn(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		app := newTestApp(t, func(config *Config) { config.AllowRemoteImport = enabled })
		cookie := signupAndRequireCookie(t, app, "remote-import@example.invalid")
		archive := importFixtureArchive(t, importFixtureConversation("remote-source"))
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			path := "/api/imports"
			if method == http.MethodPost {
				path += "/chatgpt?mode=import"
			}
			request := httptest.NewRequest(method, "https://remote.example.invalid"+path, bytes.NewReader(archive))
			request.RemoteAddr = "192.0.2.1:1234"
			request.Header.Set("Origin", "https://remote.example.invalid")
			response := httptest.NewRecorder()
			app.handler.ServeHTTP(response, request)
			assertStatusCode(t, response, http.StatusUnauthorized)
			request.AddCookie(cookie)
			response = httptest.NewRecorder()
			app.handler.ServeHTTP(response, request)
			if method == http.MethodGet {
				assertStatusCode(t, response, http.StatusOK)
				var settings struct {
					Enabled bool `json:"enabled"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &settings); err != nil {
					t.Fatal(err)
				}
				if settings.Enabled != enabled {
					t.Fatalf("enabled = %v, want %v", settings.Enabled, enabled)
				}
			} else if enabled {
				assertStatusCode(t, response, http.StatusOK)
			} else {
				assertStatusCode(t, response, http.StatusForbidden)
			}
		}
	}
}
