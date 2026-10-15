package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestAssetStorageLifecycle(t *testing.T) {
	for _, backend := range []string{"local", "s3"} {
		t.Run(backend, func(t *testing.T) {
			directory := t.TempDir()
			var mutex sync.Mutex
			objects := make(map[string][]byte)
			endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
					t.Error("S3 request was not signed")
				}
				if !strings.HasPrefix(r.URL.Path, "/images/test-prefix/") {
					t.Errorf("unexpected object path: %s", r.URL.Path)
				}
				mutex.Lock()
				defer mutex.Unlock()
				switch r.Method {
				case http.MethodPut:
					body, err := io.ReadAll(r.Body)
					if err != nil {
						t.Error(err)
					}
					objects[r.URL.Path] = body
				case http.MethodGet:
					body, ok := objects[r.URL.Path]
					if !ok {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					w.Write(body)
				case http.MethodDelete:
					delete(objects, r.URL.Path)
					w.WriteHeader(http.StatusNoContent)
				default:
					t.Errorf("unexpected S3 method: %s", r.Method)
				}
			}))
			defer endpoint.Close()
			t.Setenv("AWS_ACCESS_KEY_ID", "synthetic-access-key")
			t.Setenv("AWS_SECRET_ACCESS_KEY", "synthetic-secret-key")
			t.Setenv("AWS_SESSION_TOKEN", "")
			app := newTestApp(t, func(config *Config) {
				config.AssetStorage = backend
				config.AssetLocalDir = directory
				if backend == "s3" {
					config.S3Bucket = "images"
					config.S3Endpoint = endpoint.URL
					config.S3Region = "us-east-1"
					config.S3Prefix = "test-prefix"
					config.S3ForcePathStyle = true
				}
			})
			app.app.runtime.Close() // Keep queued test turns deterministic.
			ownerCookie := signupAndRequireCookie(t, app, "asset-owner@example.invalid")
			strangerCookie := signupAndRequireCookie(t, app, "asset-stranger@example.invalid")
			archive := importFixtureArchive(t, importFixtureConversation("assets"))
			response, preview := performImportRequest(t, app, ownerCookie, archive, "preview")
			assertStatusCode(t, response, http.StatusOK)
			if preview.Images != 1 {
				t.Fatalf("preview images: %d", preview.Images)
			}
			var count int
			if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_assets`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("preview persisted assets: %d %v", count, err)
			}
			response, report := performImportRequest(t, app, ownerCookie, archive, "import")
			assertStatusCode(t, response, http.StatusOK)
			if report.Failed || report.Imported != 1 {
				t.Fatalf("import: %+v", report)
			}
			ctx := context.Background()
			var userID string
			if err := app.app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "asset-owner@example.invalid").Scan(&userID); err != nil {
				t.Fatal(err)
			}
			sessions, err := app.app.conversations.ListSessions(ctx, userID)
			if err != nil || len(sessions) != 1 {
				t.Fatalf("sessions: %v %v", sessions, err)
			}
			history, err := app.app.conversations.getTranscript(ctx, userID, sessions[0].FriendlyID)
			if err != nil {
				t.Fatal(err)
			}
			source := contentPartsFromAny(history.Messages[0]["content"])[1].Source
			if source == nil || source.Type != "asset" || source.AssetID == "" {
				t.Fatalf("missing asset reference: %+v", source)
			}
			assetURL := "/api/assets/" + source.AssetID
			response = performJSONRequest(t, app.handler, http.MethodGet, assetURL, nil, nil)
			assertStatusCode(t, response, http.StatusUnauthorized)
			response = performJSONRequest(t, app.handler, http.MethodGet, assetURL, nil, []*http.Cookie{strangerCookie})
			assertStatusCode(t, response, http.StatusNotFound)
			response = performJSONRequest(t, app.handler, http.MethodGet, assetURL, nil, []*http.Cookie{ownerCookie})
			assertStatusCode(t, response, http.StatusOK)
			original := append([]byte(nil), response.Body.Bytes()...)
			if http.DetectContentType(original) != "image/png" || response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("invalid asset response")
			}
			resolved, err := app.app.conversations.assets.resolveHistory(ctx, userID, history.Messages)
			if err != nil {
				t.Fatal(err)
			}
			providerParts := buildProviderMessages(resolved, "")[0].Parts
			foundImage := false
			for _, part := range providerParts {
				if part.Type == "image" {
					foundImage = true
					data, err := base64.StdEncoding.DecodeString(part.Content)
					if err != nil || !bytes.Equal(original, data) {
						t.Fatal("provider received incorrect image")
					}
				}
			}
			if !foundImage {
				t.Fatal("provider lost image")
			}
			if contentPartsFromAny(history.Messages[0]["content"])[1].Source.Type != "asset" {
				t.Fatal("resolution mutated persisted history")
			}
			if _, err := app.app.conversations.assets.resolveHistory(ctx, "another-user", history.Messages); err == nil {
				t.Fatal("resolved another user's asset")
			}
			// Duplicate import must not upload another object.
			_, report = performImportRequest(t, app, ownerCookie, archive, "import")
			if report.Imported != 0 {
				t.Fatalf("duplicate import: %+v", report)
			}
			if err := app.app.db.QueryRow(`SELECT count(*) FROM chat_assets`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("duplicate assets: %d %v", count, err)
			}
			clone, err := app.app.conversations.CloneSession(ctx, userID, sessions[0].FriendlyID, messageIDFromMap(history.Messages[0]))
			if err != nil {
				t.Fatal(err)
			}
			// Editing text retains stored images without downloading or duplicating them.
			result, err := app.app.runtime.StartRun(ctx, userID, SubmitTurnInput{FriendlyID: sessions[0].FriendlyID, EditMessageID: messageIDFromMap(history.Messages[0]), Message: "Edited question"})
			if err != nil {
				t.Fatal(err)
			}
			edited := contentPartsFromAny(result.UserTurn["content"])
			if len(edited) != 2 || edited[0].Source == nil || edited[0].Source.AssetID != source.AssetID {
				t.Fatalf("edit lost image: %+v", edited)
			}
			if err := app.app.conversations.DeleteSession(ctx, userID, sessions[0].FriendlyID); err != nil {
				t.Fatal(err)
			}
			response = performJSONRequest(t, app.handler, http.MethodGet, assetURL, nil, []*http.Cookie{ownerCookie})
			assertStatusCode(t, response, http.StatusOK)
			// Switching writes back to inline preserves both old readers and inline images.
			app.app.conversations.assets.active = "inline"
			resolved, err = app.app.conversations.assets.resolveHistory(ctx, userID, history.Messages)
			if err != nil || len(resolved) == 0 {
				t.Fatalf("old reader unavailable: %v", err)
			}
			if err := app.app.conversations.DeleteSession(ctx, userID, clone.FriendlyID); err != nil {
				t.Fatal(err)
			}
			response = performJSONRequest(t, app.handler, http.MethodGet, assetURL, nil, []*http.Cookie{ownerCookie})
			assertStatusCode(t, response, http.StatusNotFound)
			if backend == "local" {
				files, err := os.ReadDir(directory)
				if err != nil || len(files) != 0 {
					t.Fatalf("local objects remain: %v %v", files, err)
				}
			} else {
				mutex.Lock()
				remaining := len(objects)
				mutex.Unlock()
				if remaining != 0 {
					t.Fatalf("S3 objects remain: %d", remaining)
				}
			}
		})
	}
}

func TestAssetUploadFailureAndValidation(t *testing.T) {
	directory := t.TempDir()
	app := newTestApp(t, func(config *Config) { config.AssetStorage = "local"; config.AssetLocalDir = directory })
	app.app.runtime.Close()
	signupAndRequireCookie(t, app, "upload@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "upload@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==")
	result, err := app.app.runtime.StartRun(ctx, userID, SubmitTurnInput{NewConversation: &newConversationInput{Settings: defaultConversationSettings()}, Message: "Image", Attachments: []AttachmentPayload{{MimeType: "image/png", Content: base64.StdEncoding.EncodeToString(png)}}})
	if err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := app.app.db.QueryRow(`SELECT request_json FROM chat_runs WHERE id=?`, result.RunID).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(saved, base64.StdEncoding.EncodeToString(png)) {
		t.Fatal("job duplicates image bytes")
	}
	part := contentPartsFromAny(result.UserTurn["content"])[0]
	if part.Source == nil || part.Source.Type != "asset" {
		t.Fatal("send did not persist asset reference")
	}
	// First upload succeeds, second is invalid; cleanup removes the partial upload.
	_, err = app.app.runtime.StartRun(ctx, userID, SubmitTurnInput{NewConversation: &newConversationInput{Settings: defaultConversationSettings()}, Message: "Invalid", Attachments: []AttachmentPayload{{MimeType: "image/png", Content: base64.StdEncoding.EncodeToString(png)}, {MimeType: "image/png", Content: "invalid base64"}}})
	if err == nil {
		t.Fatal("accepted invalid image")
	}
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 1 {
		t.Fatalf("partial upload leaked: %v %v", files, err)
	}
	if _, err := app.app.conversations.DeleteUserMessage(ctx, userID, result.FriendlyID, result.UserTurnID); err != nil {
		t.Fatal(err)
	}
	files, err = os.ReadDir(directory)
	if err != nil || len(files) != 0 {
		t.Fatalf("deleted image remains: %v %v", files, err)
	}
	store := localAssetStorage{directory: directory}
	if _, err := store.Get(ctx, "../secret"); err == nil {
		t.Fatal("allowed traversal")
	}
	if err := store.Put(ctx, filepath.Join("..", "secret"), "image/png", png); err == nil {
		t.Fatal("allowed traversal write")
	}
}

func TestAssetConfigValidation(t *testing.T) {
	for _, config := range []Config{{AssetStorage: "unknown"}, {AssetStorage: "s3"}, {S3Endpoint: "file:///tmp/assets"}, {S3Endpoint: "https://user:secret@host"}} {
		if err := validateAssetConfig(config); err == nil {
			t.Fatalf("accepted invalid config: %+v", config)
		}
	}
}
