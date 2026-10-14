package server

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
)

var conversationImportName = regexp.MustCompile(`^conversations(?:[-_]\d+)?\.json$`)
var errInvalidImport = errors.New("invalid or unsupported ChatGPT archive")

type chatGPTConversation struct {
	ID             string                 `json:"id"`
	ConversationID string                 `json:"conversation_id"`
	Title          string                 `json:"title"`
	CreateTime     float64                `json:"create_time"`
	UpdateTime     float64                `json:"update_time"`
	CurrentNode    string                 `json:"current_node"`
	PinnedTime     *float64               `json:"pinned_time"`
	Mapping        map[string]chatGPTNode `json:"mapping"`
}

type chatGPTNode struct {
	Parent  *string         `json:"parent"`
	Message *chatGPTMessage `json:"message"`
}

type chatGPTMessage struct {
	ID     string `json:"id"`
	Author struct {
		Role string `json:"role"`
	} `json:"author"`
	CreateTime float64 `json:"create_time"`
	Content    struct {
		Type     string            `json:"content_type"`
		Parts    []json.RawMessage `json:"parts"`
		Content  string            `json:"content"`
		Thoughts []struct {
			Summary string `json:"summary"`
			Content string `json:"content"`
		} `json:"thoughts"`
	} `json:"content"`
	Metadata struct {
		ModelSlug   string            `json:"model_slug"`
		Attachments []json.RawMessage `json:"attachments"`
	} `json:"metadata"`
}

type chatGPTImportArchive struct {
	Conversations []*zip.File
	Assets        map[string]*zip.File
}

func openChatGPTImport(reader io.ReaderAt, size int64) (*chatGPTImportArchive, error) {
	archive, err := zip.NewReader(reader, size)
	if err != nil || len(archive.File) > 20000 {
		return nil, errInvalidImport
	}
	result := &chatGPTImportArchive{Assets: make(map[string]*zip.File)}
	var expanded uint64
	for _, file := range archive.File {
		if file.UncompressedSize64 > maxImportExpanded || expanded > maxImportExpanded-file.UncompressedSize64 {
			return nil, errInvalidImport
		}
		expanded += file.UncompressedSize64
		if file.FileInfo().IsDir() {
			continue
		}
		name := path.Base(file.Name)
		if conversationImportName.MatchString(name) {
			if file.UncompressedSize64 > maxImportJSON {
				return nil, errInvalidImport
			}
			result.Conversations = append(result.Conversations, file)
		}
		// Ambiguous basenames must never silently resolve to the wrong asset.
		if _, exists := result.Assets[name]; exists {
			result.Assets[name] = nil
		} else {
			result.Assets[name] = file
		}
	}
	if len(result.Conversations) == 0 {
		return nil, errInvalidImport
	}
	return result, nil
}

func (archive *chatGPTImportArchive) walk(ctx context.Context, visit func(chatGPTConversation) error) error {
	total := 0
	for _, file := range archive.Conversations {
		if err := ctx.Err(); err != nil {
			return err
		}
		stream, err := file.Open()
		if err != nil {
			return errInvalidImport
		}
		err = func() error {
			defer stream.Close()
			decoder := json.NewDecoder(io.LimitReader(stream, maxImportJSON+1))
			token, err := decoder.Token()
			if err != nil || token != json.Delim('[') {
				return errInvalidImport
			}
			for decoder.More() {
				if err := ctx.Err(); err != nil {
					return err
				}
				total++
				if total > 100000 {
					return errInvalidImport
				}
				var conversation chatGPTConversation
				if err := decoder.Decode(&conversation); err != nil {
					return errInvalidImport
				}
				if err := visit(conversation); err != nil {
					return err
				}
			}
			token, err = decoder.Token()
			if err != nil || token != json.Delim(']') {
				return errInvalidImport
			}
			if _, err = decoder.Token(); err != io.EOF {
				return errInvalidImport
			}
			return nil
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func chatImportPath(conversation chatGPTConversation) ([]chatGPTMessage, int, error) {
	if conversation.ID == "" {
		conversation.ID = conversation.ConversationID
	}
	if conversation.ID == "" || len(conversation.Mapping) == 0 {
		return nil, 0, errInvalidImport
	}
	seen := make(map[string]bool)
	key := conversation.CurrentNode
	if key == "" {
		return nil, 0, errInvalidImport
	}
	messages := []chatGPTMessage{}
	for key != "" {
		node, exists := conversation.Mapping[key]
		if !exists || seen[key] {
			return nil, 0, errInvalidImport
		}
		seen[key] = true
		if node.Message != nil {
			messages = append(messages, *node.Message)
		}
		key = ""
		if node.Parent != nil {
			key = *node.Parent
		}
	}
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
	return messages, len(conversation.Mapping) - len(seen), nil
}

func (archive *chatGPTImportArchive) image(pointer string) (string, []byte) {
	_, key, found := strings.Cut(pointer, "://")
	if !found {
		key = pointer
	}
	// Resolve archive members only. Never interpret references as URLs or paths on disk.
	name := path.Base(key)
	file, exists := archive.Assets[name]
	if !exists {
		file = archive.Assets[name+".dat"]
	}
	if file == nil || file.UncompressedSize64 > maxImportImage {
		return "", nil
	}
	stream, err := file.Open()
	if err != nil {
		return "", nil
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, maxImportImage+1))
	if err != nil || len(data) > maxImportImage {
		return "", nil
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return mime, data
	}
	return "", nil
}

func (archive *chatGPTImportArchive) content(ctx context.Context, message chatGPTMessage, report *conversationImportReport, store importImageStore) ([]chatMessageContentPart, error) {
	parts := []chatMessageContentPart{}
	report.SkippedAttachments += len(message.Metadata.Attachments)
	if message.Author.Role != "user" && message.Author.Role != "assistant" {
		report.SkippedMessages++
		return parts, nil
	}
	switch message.Content.Type {
	case "text", "multimodal_text":
		for _, raw := range message.Content.Parts {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			var text string
			if json.Unmarshal(raw, &text) == nil {
				if strings.TrimSpace(text) != "" {
					if message.Author.Role == "assistant" {
						text = normalizeChatGPTMarkup(text)
					}
					parts = append(parts, newTextContentPart(text))
				}
				continue
			}
			var object struct {
				Type    string `json:"content_type"`
				Pointer string `json:"asset_pointer"`
				Text    string `json:"text"`
			}
			if json.Unmarshal(raw, &object) != nil {
				report.SkippedAttachments++
				continue
			}
			if object.Type == "image_asset_pointer" {
				mime, data := archive.image(object.Pointer)
				if data == nil {
					report.SkippedImages++
					continue
				}
				report.Images++
				report.ImageBytes += int64(len(data))
				if report.ImageBytes > 64<<20 {
					return nil, errInvalidImport
				}
				if store != nil {
					part, err := store.PutImage(ctx, mime, data)
					if err != nil {
						return nil, err
					}
					parts = append(parts, part)
				} else {
					parts = append(parts, chatMessageContentPart{Type: "image"})
				}
			} else if object.Text != "" {
				// Audio transcription text can survive even though audio is skipped.
				parts = append(parts, newTextContentPart(object.Text))
				report.SkippedAttachments++
			} else {
				report.SkippedAttachments++
			}
		}
	case "thoughts":
		for _, thought := range message.Content.Thoughts {
			if text := firstNonEmpty(thought.Content, thought.Summary); strings.TrimSpace(text) != "" {
				parts = append(parts, newThinkingContentPart(text))
			}
		}
	case "reasoning_recap":
		if strings.TrimSpace(message.Content.Content) != "" {
			parts = append(parts, newThinkingContentPart(message.Content.Content))
		}
	}
	if len(parts) == 0 {
		report.SkippedMessages++
	} else {
		report.Messages++
	}
	return parts, nil
}

func (archive *chatGPTImportArchive) Source() string { return "chatgpt" }

func (archive *chatGPTImportArchive) Walk(ctx context.Context, store importImageStore, visit func(importConversation) error) error {
	return archive.walk(ctx, func(raw chatGPTConversation) error {
		messages, alternate, err := chatImportPath(raw)
		if err != nil {
			return err
		}
		normalized := importConversation{SourceID: firstNonEmpty(raw.ID, raw.ConversationID), Title: raw.Title, CreateTime: raw.CreateTime, UpdateTime: raw.UpdateTime, Pinned: raw.PinnedTime != nil && *raw.PinnedTime > 0}
		normalized.Counts.AlternateNodes = alternate
		retainedText := int64(0)
		for _, message := range messages {
			if err := ctx.Err(); err != nil {
				return err
			}
			content, err := archive.content(ctx, message, &normalized.Counts, store)
			if err != nil {
				return err
			}
			if len(content) == 0 {
				continue
			}
			for _, part := range content {
				retainedText += int64(len(part.Text) + len(part.Thinking))
			}
			if retainedText+normalized.Counts.ImageBytes > 64<<20 {
				return errInvalidImport
			}
			normalized.Messages = append(normalized.Messages, importMessage{SourceID: message.ID, Role: message.Author.Role, Model: message.Metadata.ModelSlug, ModelName: importedModelDisplayName(message.Metadata.ModelSlug), CreateTime: message.CreateTime, Content: content})
		}
		return visit(normalized)
	})
}
