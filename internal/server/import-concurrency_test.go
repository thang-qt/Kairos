package server

import (
	"context"
	"sync"
	"testing"
	"time"
)

type blockedImportStorage struct {
	cleanupTestStorage
	uploads int
	blocked chan struct{}
	release chan struct{}
}

func (store *blockedImportStorage) Put(ctx context.Context, _, _ string, _ []byte) error {
	store.uploads++
	if store.uploads == 2 {
		close(store.blocked)
		select {
		case <-store.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

type imageImportAdapter struct{}

func (imageImportAdapter) Source() string { return "concurrency-test" }
func (imageImportAdapter) Walk(ctx context.Context, _ importImageStore, visit func(importConversation) error) error {
	image := newImageContentPart("image/png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==")
	return visit(importConversation{SourceID: "same", Title: "Import", Messages: []importMessage{{Role: "user", Content: []chatMessageContentPart{image, image}}}})
}
func TestImportUploadsDoNotBlockChatCommandsOrLoseAssets(t *testing.T) {
	app := newTestApp(t, func(config *Config) { config.AssetStorage = "local"; config.AssetLocalDir = t.TempDir() })
	app.app.runtime.Close()
	app.app.conversations.assets.closeCleanup()
	signupAndRequireCookie(t, app, "import-concurrency@example.invalid")
	var user string
	if err := app.app.db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	store := &blockedImportStorage{blocked: make(chan struct{}), release: make(chan struct{})}
	app.app.conversations.assets.stores["local"] = store
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	report := make(chan conversationImportReport, 1)
	go func() {
		report <- app.app.conversations.commitConversationImport(ctx, user, imageImportAdapter{}, conversationImportReport{})
	}()
	select {
	case <-store.blocked:
	case <-ctx.Done():
		t.Fatal("import did not reach second upload")
	}
	service := app.app.conversations
	if !service.commandMu.TryLock() {
		t.Fatal("import holds global command lock")
	}
	service.commandMu.Unlock()
	var mutex sync.Mutex
	if err := service.assets.cleanupBatch(ctx, &mutex); err != nil {
		t.Fatal(err)
	}
	var assets int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_assets`).Scan(&assets); err != nil || assets != 1 {
		t.Fatalf("provisional import asset was collected: %d %v", assets, err)
	}
	if _, err := app.app.runtime.StartRun(ctx, user, SubmitTurnInput{Message: "Unrelated", NewConversation: &newConversationInput{Settings: defaultConversationSettings()}}); err != nil {
		t.Fatal(err)
	}
	close(store.release)
	if result := <-report; result.Failed || result.Imported != 1 {
		t.Fatalf("import failed: %+v", result)
	}
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_asset_references`).Scan(&assets); err != nil || assets != 2 {
		t.Fatalf("import asset references missing: %d %v", assets, err)
	}
}
func TestConcurrentImportsDeduplicateWithinTransaction(t *testing.T) {
	app := newTestApp(t, nil)
	app.app.runtime.Close()
	signupAndRequireCookie(t, app, "import-dedup@example.invalid")
	var user string
	if err := app.app.db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	results := make(chan conversationImportReport, 2)
	for range 2 {
		go func() {
			results <- app.app.conversations.commitConversationImport(context.Background(), user, syntheticConversationImporter{source: "same"}, conversationImportReport{})
		}()
	}
	first, second := <-results, <-results
	if first.Failed || second.Failed || first.Imported+second.Imported != 1 {
		t.Fatalf("concurrent deduplication failed: %+v %+v", first, second)
	}
}
