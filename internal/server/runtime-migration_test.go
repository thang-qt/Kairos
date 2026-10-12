package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeMigrationPreservesLegacyTurnsAndProviderSecrets(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "002") {
			continue
		}
		data, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(data)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO schema_migrations VALUES(?,0)`, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES('user','legacy@example.com','hash',0,0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO chat_sessions(id,user_id,friendly_id,updated_at,created_at) VALUES('session','user','legacy',0,0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO user_providers(id,user_id,kind,label,api_key_encrypted,created_at,updated_at) VALUES('provider','user','openrouter','legacy','encrypted-secret',0,0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO chat_runs(id,user_id,session_id,status,model,assistant_message_id,started_at,created_at) VALUES('run','user','session','running','model','turn',1,1)`); err != nil {
		t.Fatal(err)
	}
	messages := []map[string]any{{"id": "user-turn", "role": "user", "timestamp": int64(1), "content": []map[string]any{{"type": "text", "text": "question"}}}, {"id": "turn", "runId": "run", "role": "assistant", "timestamp": int64(2), "content": []map[string]any{{"type": "text", "text": "checking"}, {"type": "toolCall", "id": "call", "name": "fake"}}}, {"id": "result", "runId": "run", "role": "toolResult", "toolCallId": "call", "timestamp": int64(3), "content": []map[string]any{{"type": "text", "text": "result"}}}}
	for _, message := range messages {
		encoded, _ := json.Marshal(message)
		content, _ := encodeMessageContent(message["content"])
		if _, err := db.Exec(`INSERT INTO chat_messages(id,session_id,role,content_json,timestamp,message_json,created_at,run_id) VALUES(?,'session',?,?,?,?,0,?)`, message["id"], message["role"], content, message["timestamp"], string(encoded), nullableString(stringValueFromMap(message, "runId"))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO chat_runs(id,user_id,session_id,status,model,assistant_message_id,started_at,created_at) VALUES('deleted-run','user','session','completed','model','deleted-turn',10,10)`); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(db); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(db); err != nil {
		t.Fatal("migration is not idempotent", err)
	}
	history, err := NewConversationService(db).GetHistory(context.Background(), "user", "legacy")
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Messages) != 2 || history.Messages[1]["id"] != "turn" || history.Messages[1]["status"] != "interrupted" {
		t.Fatalf("migrated history=%#v", history.Messages)
	}
	var kind, baseURL, secret string
	if err := db.QueryRow(`SELECT kind,base_url,api_key_encrypted FROM user_providers WHERE id='provider'`).Scan(&kind, &baseURL, &secret); err != nil {
		t.Fatal(err)
	}
	if kind != "openai" || baseURL != "https://openrouter.ai/api/v1" || secret != "encrypted-secret" {
		t.Fatalf("provider migration changed credentials: %s %s", kind, baseURL)
	}
	var runs int
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_runs`).Scan(&runs); err != nil || runs != 2 {
		t.Fatal("migration deleted run records")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_messages`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("lost historical transcript: %d %v", count, err)
	}
}
