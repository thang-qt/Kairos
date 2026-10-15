package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"math"
	"time"
)

// Each format adapter emits this provider-neutral representation. Source model
// names are historical metadata, never a model selection for future generation.
type importConversation struct {
	SourceID   string
	Title      string
	CreateTime float64
	UpdateTime float64
	Pinned     bool
	Messages   []importMessage
	Counts     conversationImportReport
}

type importMessage struct {
	SourceID   string
	Role       string
	Model      string
	ModelName  string
	CreateTime float64
	Content    []chatMessageContentPart
}

type conversationImporter interface {
	Source() string
	Walk(context.Context, importImageStore, func(importConversation) error) error
}

type conversationImportFactory func(io.ReaderAt, int64) (conversationImporter, error)

// Register future format adapters here; the HTTP and persistence paths stay shared.
var conversationImporters = map[string]conversationImportFactory{
	"chatgpt": func(reader io.ReaderAt, size int64) (conversationImporter, error) {
		return openChatGPTImport(reader, size)
	},
}

func (report *conversationImportReport) addCounts(counts conversationImportReport) {
	report.Messages += counts.Messages
	report.Images += counts.Images
	report.ImageBytes += counts.ImageBytes
	report.SkippedImages += counts.SkippedImages
	report.SkippedAttachments += counts.SkippedAttachments
	report.SkippedMessages += counts.SkippedMessages
	report.AlternateNodes += counts.AlternateNodes
}

const maxImportUpload = 512 << 20
const maxImportExpanded = 2 << 30
const maxImportJSON = 256 << 20
const maxImportImage = 20 << 20

// Only counts leave the importer: never return source text, filenames, or IDs.
type conversationImportReport struct {
	Conversations      int   `json:"conversations"`
	Messages           int   `json:"messages"`
	Images             int   `json:"images"`
	ImageBytes         int64 `json:"imageBytes"`
	SkippedImages      int   `json:"skippedImages"`
	SkippedAttachments int   `json:"skippedAttachments"`
	SkippedMessages    int   `json:"skippedMessages"`
	AlternateNodes     int   `json:"alternateNodes"`
	Duplicates         int   `json:"duplicates"`
	Imported           int   `json:"imported"`
	Failed             bool  `json:"failed"`
}

// The initial store uses Kairos's existing inline image representation. A future
// object store can replace this boundary without changing ChatGPT parsing.
type importImageStore interface {
	PutImage(context.Context, string, []byte) (chatMessageContentPart, error)
}
type inlineImportImageStore struct{}

func (inlineImportImageStore) PutImage(ctx context.Context, mime string, data []byte) (chatMessageContentPart, error) {
	if err := ctx.Err(); err != nil {
		return chatMessageContentPart{}, err
	}
	return newImageContentPart(mime, base64.StdEncoding.EncodeToString(data)), nil
}

func importMilliseconds(value float64, fallback int64) int64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > 253402300799 {
		return fallback
	}
	return int64(value * 1000)
}

func (service *ConversationService) importExists(ctx context.Context, userID, source, sourceID string) (bool, error) {
	var exists bool
	err := service.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_imports WHERE user_id=? AND source=? AND source_id=?)`, userID, source, sourceID).Scan(&exists)
	return exists, err
}

func (service *ConversationService) previewConversationImport(ctx context.Context, userID string, adapter conversationImporter) (conversationImportReport, error) {
	report := conversationImportReport{}
	seen := make(map[string]bool)
	err := adapter.Walk(ctx, nil, func(conversation importConversation) error {
		sourceID := conversation.SourceID
		exists, err := service.importExists(ctx, userID, adapter.Source(), sourceID)
		if err != nil {
			return err
		}
		if exists || seen[sourceID] {
			report.Duplicates++
			return nil
		}
		seen[sourceID] = true
		report.Conversations++
		report.addCounts(conversation.Counts)
		return nil
	})
	return report, err
}

func (service *ConversationService) commitConversationImport(ctx context.Context, userID string, adapter conversationImporter, report conversationImportReport) conversationImportReport {
	return service.commitConversationImportWithProgress(ctx, userID, adapter, report, nil)
}

func (service *ConversationService) commitConversationImportWithProgress(ctx context.Context, userID string, adapter conversationImporter, report conversationImportReport, progress func(conversationImportReport)) conversationImportReport {
	// Serializes concurrent imports and existing conversation commands. Each
	// conversation and its deduplication marker commit together, making retry safe.
	service.commandMu.Lock()
	defer service.commandMu.Unlock()
	err := adapter.Walk(ctx, inlineImportImageStore{}, func(conversation importConversation) error {
		sourceID := conversation.SourceID
		exists, err := service.importExists(ctx, userID, adapter.Source(), sourceID)
		if err != nil || exists {
			return err
		}
		// Write objects before opening SQLite's single-connection transaction.
		for index := range conversation.Messages {
			message := &conversation.Messages[index]
			mapped := map[string]any{"content": contentPartsToMaps(message.Content)}
			if err := service.assets.storeMessage(ctx, userID, mapped); err != nil {
				return err
			}
			message.Content = contentPartsFromAny(mapped["content"])
		}
		tx, err := service.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		sessionID := newID()
		friendlyID := newFriendlyID()
		now := time.Now().UnixMilli()
		created := importMilliseconds(conversation.CreateTime, now)
		updated := importMilliseconds(conversation.UpdateTime, created)
		settings, err := encodeConversationSettings(defaultConversationSettings())
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO chat_sessions(id,user_id,friendly_id,title,derived_title,created_at,updated_at,is_pinned,context_tokens,conversation_settings_json) VALUES(?,?,?,?,?,?,?,?,?,?)`, sessionID, userID, friendlyID, nullableString(conversation.Title), nullableString(conversation.Title), created, updated, boolAsInt(conversation.Pinned), defaultContextTokens, settings)
		if err != nil {
			return err
		}
		var last any
		var tokens int64
		previous := int64(0)
		assistantGroup := ""
		for index, message := range conversation.Messages {
			content := message.Content
			timestamp := importMilliseconds(message.CreateTime, maxInt64(previous, created))
			// Storage ordering follows the graph, including missing/equal timestamps.
			orderTime := timestamp
			if orderTime <= previous {
				orderTime = previous + 1
			}
			previous = orderTime
			model := message.Model
			modelName := firstNonEmpty(message.ModelName, model)
			if message.Role == "assistant" {
				if assistantGroup == "" {
					assistantGroup = newID()
				}
			} else {
				assistantGroup = ""
			}
			mapped := (chatMessage{ID: newID(), Role: message.Role, RunID: assistantGroup, Timestamp: orderTime, Model: model, ModelName: modelName, Content: content, Details: map[string]any{"importSource": adapter.Source(), "sourceMessageId": message.SourceID, "sourceTimestamp": timestamp}}).toMap()
			body, err := json.Marshal(mapped)
			if err != nil {
				return err
			}
			encoded, err := encodeMessageContent(mapped["content"])
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO chat_messages(id,session_id,role,model,model_name,content_json,message_json,timestamp,created_at,run_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, messageIDFromMap(mapped), sessionID, message.Role, model, modelName, encoded, string(body), orderTime, int64(index), nullableString(assistantGroup))
			if err != nil {
				return err
			}
			last = string(body)
			tokens += approximateMessageTokens(mapped)
		}
		if _, err = tx.ExecContext(ctx, `UPDATE chat_sessions SET last_message_json=?,total_tokens=? WHERE id=?`, last, tokens, sessionID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO chat_imports(user_id,source,source_id,session_id) VALUES(?,?,?,?)`, userID, adapter.Source(), sourceID, sessionID); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		report.Imported++
		if progress != nil {
			progress(report)
		}
		return nil
	})
	report.Failed = err != nil
	return report
}
