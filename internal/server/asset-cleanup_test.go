package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

type cleanupTestStorage struct {
	started chan struct{}
	release chan struct{}
	failure bool
}

func (store *cleanupTestStorage) Put(context.Context, string, string, []byte) error { return nil }
func (store *cleanupTestStorage) Get(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("unused")
}
func (store *cleanupTestStorage) Delete(ctx context.Context, _ string) error {
	if store.started != nil {
		close(store.started)
		select {
		case <-store.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if store.failure {
		return errors.New("storage unavailable")
	}
	return nil
}

func cleanupFixture(t *testing.T, store assetStorage) (*App, string, SubmitTurnResult) {
	t.Helper()
	fixture := newTestApp(t, func(config *Config) { config.AssetStorage = "local"; config.AssetLocalDir = t.TempDir() })
	app := fixture.app
	app.runtime.Close()
	app.conversations.assets.closeCleanup()
	app.conversations.assets.stores["local"] = store
	signupAndRequireCookie(t, fixture, "cleanup@example.invalid")
	var userID string
	if err := app.db.QueryRow(`SELECT id FROM users WHERE email=?`, "cleanup@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	image := base64.StdEncoding.EncodeToString(testPNGBytes(t))
	result, err := app.runtime.StartRun(context.Background(), userID, SubmitTurnInput{NewConversation: &newConversationInput{Settings: defaultConversationSettings()}, Message: "image", Attachments: []AttachmentPayload{{MimeType: "image/png", Content: image}}})
	if err != nil {
		t.Fatal(err)
	}
	return app, userID, result
}

func TestAssetCleanupDoesNotBlockCommands(t *testing.T) {
	store := &cleanupTestStorage{started: make(chan struct{}), release: make(chan struct{})}
	defer close(store.release)
	app, userID, result := cleanupFixture(t, store)
	if err := app.conversations.DeleteSession(context.Background(), userID, result.FriendlyID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- app.conversations.assets.cleanupBatch(ctx, &app.conversations.commandMu) }()
	select {
	case <-store.started:
	case <-ctx.Done():
		t.Fatal("cleanup did not start")
	}
	if !app.conversations.commandMu.TryLock() {
		t.Fatal("object deletion holds the command lock")
	}
	app.conversations.commandMu.Unlock()
	// The network delete is still blocked; both database work and sending must proceed.
	_, err := app.runtime.StartRun(ctx, userID, SubmitTurnInput{NewConversation: &newConversationInput{Settings: defaultConversationSettings()}, Message: "unrelated text"})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	<-done
}

func TestAssetCleanupRetriesAcrossServiceRestart(t *testing.T) {
	store := &cleanupTestStorage{failure: true}
	app, userID, result := cleanupFixture(t, store)
	if err := app.conversations.DeleteSession(context.Background(), userID, result.FriendlyID); err != nil {
		t.Fatal(err)
	}
	if err := app.conversations.assets.cleanupBatch(context.Background(), &app.conversations.commandMu); err != nil {
		t.Fatal(err)
	}
	var claimed int
	if err := app.db.QueryRow(`SELECT claimed FROM asset_cleanup_jobs`).Scan(&claimed); err != nil || claimed != 1 {
		t.Fatalf("durable retry missing: %d %v", claimed, err)
	}
	var count int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM chat_assets`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("asset not claimed: %d %v", count, err)
	}
	restarted, err := newAssetService(Config{AssetStorage: "local", AssetLocalDir: t.TempDir()}, app.db)
	if err != nil {
		t.Fatal(err)
	}
	restarted.stores["local"] = &cleanupTestStorage{}
	if _, err := app.db.Exec(`UPDATE asset_cleanup_jobs SET available_at=0`); err != nil {
		t.Fatal(err)
	}
	if err := restarted.cleanupBatch(context.Background(), &app.conversations.commandMu); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM asset_cleanup_jobs`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("retry not completed: %d %v", count, err)
	}
}

func TestAssetCleanupProtectsUncommittedUploads(t *testing.T) {
	store := &cleanupTestStorage{}
	app, userID, _ := cleanupFixture(t, store)
	assets := app.conversations.assets
	image := testPNGBytes(t)
	message := map[string]any{"content": contentPartsToMaps([]chatMessageContentPart{newImageContentPart("image/png", base64.StdEncoding.EncodeToString(image))})}
	app.conversations.commandMu.Lock()
	err := assets.storeMessage(context.Background(), userID, message)
	if err == nil {
		err = assets.cleanupBatch(context.Background(), &app.conversations.commandMu)
	}
	app.conversations.commandMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM chat_assets`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("in-flight upload collected: %d %v", count, err)
	}
	var mutex sync.Mutex
	// Once the failed command has released its lock, its orphan is collectible.
	if err := assets.cleanupBatch(context.Background(), &mutex); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM chat_assets`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("orphan not collected: %d %v", count, err)
	}
}

func TestAssetReferenceMigrationBackfillsAndTracksChanges(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE chat_messages(id TEXT PRIMARY KEY,content_json TEXT NOT NULL);
 CREATE TABLE chat_assets(id TEXT PRIMARY KEY,backend TEXT NOT NULL,object_key TEXT NOT NULL);
 INSERT INTO chat_assets VALUES('shared','local','shared'),('orphan','local','orphan');
 INSERT INTO chat_messages VALUES('one','[{"type":"image","source":{"type":"asset","assetId":"shared"}}]'),('two','[{"type":"image","source":{"type":"asset","assetId":"shared"}}]');`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := migrationFiles.ReadFile("migrations/0030_asset_cleanup_jobs.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	var refs, jobs int
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_asset_references`).Scan(&refs); err != nil || refs != 2 {
		t.Fatalf("backfill references: %d %v", refs, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM asset_cleanup_jobs WHERE asset_id='orphan'`).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("backfill orphan: %d %v", jobs, err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE chat_messages SET content_json='[]' WHERE id='one'`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_asset_references`).Scan(&refs); err != nil || refs != 2 {
		t.Fatalf("rollback references: %d %v", refs, err)
	}
	if _, err := db.Exec(`DELETE FROM chat_messages WHERE id='one'`); err != nil {
		t.Fatal(err)
	}
	service := &assetService{db: db}
	var mutex sync.Mutex
	// Only inspect the shared candidate; the remaining clone must protect it.
	if _, err := db.Exec(`DELETE FROM asset_cleanup_jobs WHERE asset_id='orphan'`); err != nil {
		t.Fatal(err)
	}
	job, err := service.claimCleanup(context.Background(), &mutex)
	if err != nil || job != nil {
		t.Fatalf("shared asset claimed: %+v %v", job, err)
	}
	if _, err := db.Exec(`DELETE FROM chat_messages WHERE id='two'`); err != nil {
		t.Fatal(err)
	}
	job, err = service.claimCleanup(context.Background(), &mutex)
	if err != nil || job == nil || job.ID != "shared" {
		t.Fatalf("last reference did not enqueue deletion: %+v %v", job, err)
	}
}
