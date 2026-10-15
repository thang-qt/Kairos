package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

type assetService struct {
	db     *sql.DB
	active string
	stores map[string]assetStorage
}

type assetRecord struct {
	ID        string
	Backend   string
	Key       string
	MediaType string
	Size      int64
}

func newAssetService(config Config, db *sql.DB) (*assetService, error) {
	if err := validateAssetConfig(config); err != nil {
		return nil, err
	}
	active := config.AssetStorage
	if active == "" {
		active = "inline"
	}
	directory := config.AssetLocalDir
	if directory == "" {
		directory = "./tmp/assets"
	}
	service := &assetService{db: db, active: active, stores: map[string]assetStorage{"local": localAssetStorage{directory: directory}}}
	// Keep both readers available when switching the active write backend.
	if config.S3Bucket != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		store, err := newS3AssetStorage(ctx, config)
		if err != nil {
			return nil, err
		}
		service.stores["s3"] = store
	}
	return service, nil
}

func newAssetContentPart(mime, id string) chatMessageContentPart {
	return chatMessageContentPart{Type: "image", Source: &chatMessageContentSource{Type: "asset", MediaType: mime, AssetID: id}}
}

func (service *assetService) storeMessage(ctx context.Context, userID string, message map[string]any) error {
	if service == nil || service.active == "inline" {
		return nil
	}
	parts := contentPartsFromAny(message["content"])
	for index, part := range parts {
		if part.Type != "image" || part.Source == nil || part.Source.Type != "base64" {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(part.Source.Data)
		if err != nil {
			return fmt.Errorf("invalid image encoding")
		}
		if len(data) == 0 || len(data) > maxImportImage {
			return fmt.Errorf("image exceeds the 20 MiB limit")
		}
		mime := http.DetectContentType(data)
		switch mime {
		case "image/png", "image/jpeg", "image/gif", "image/webp":
		default:
			return fmt.Errorf("unsupported image format")
		}
		id := newID()
		store := service.stores[service.active]
		if err := store.Put(ctx, id, mime, data); err != nil {
			return fmt.Errorf("store image: %w", err)
		}
		_, err = service.db.ExecContext(ctx, `INSERT INTO chat_assets(id,user_id,backend,object_key,media_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?)`, id, userID, service.active, id, mime, len(data), time.Now().UnixMilli())
		if err != nil {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if cleanupErr := store.Delete(cleanupCtx, id); cleanupErr != nil {
				log.Printf("kairos: remove failed asset upload: %v", cleanupErr)
			}
			return err
		}
		parts[index] = newAssetContentPart(mime, id)
	}
	message["content"] = contentPartsToMaps(parts)
	return nil
}

func (service *assetService) find(ctx context.Context, userID, id string) (assetRecord, error) {
	var record assetRecord
	err := service.db.QueryRowContext(ctx, `SELECT id,backend,object_key,media_type,size_bytes FROM chat_assets WHERE user_id=? AND id=?`, userID, id).Scan(&record.ID, &record.Backend, &record.Key, &record.MediaType, &record.Size)
	return record, err
}

func (service *assetService) read(ctx context.Context, record assetRecord) (io.ReadCloser, error) {
	store := service.stores[record.Backend]
	if store == nil {
		return nil, fmt.Errorf("asset storage %s is not configured", record.Backend)
	}
	return store.Get(ctx, record.Key)
}

// Resolve only owned references, never arbitrary URLs from client-supplied history.
func (service *assetService) resolveHistory(ctx context.Context, userID string, history []map[string]any) ([]map[string]any, error) {
	resolved := make([]map[string]any, 0, len(history))
	cache := make(map[string]chatMessageContentPart)
	for _, message := range history {
		parts := contentPartsFromAny(message["content"])
		for index, part := range parts {
			if part.Type != "image" || part.Source == nil || part.Source.Type != "asset" {
				continue
			}
			if service == nil {
				return nil, fmt.Errorf("asset storage is unavailable")
			}
			id := part.Source.AssetID
			image, ok := cache[id]
			if !ok {
				record, err := service.find(ctx, userID, id)
				if err != nil {
					return nil, fmt.Errorf("image asset is unavailable: %w", err)
				}
				reader, err := service.read(ctx, record)
				if err != nil {
					return nil, fmt.Errorf("read image asset: %w", err)
				}
				data, readErr := io.ReadAll(io.LimitReader(reader, maxImportImage+1))
				closeErr := reader.Close()
				if readErr != nil {
					return nil, readErr
				}
				if closeErr != nil {
					return nil, closeErr
				}
				if int64(len(data)) != record.Size || len(data) > maxImportImage {
					return nil, fmt.Errorf("invalid image asset size")
				}
				image = newImageContentPart(record.MediaType, base64.StdEncoding.EncodeToString(data))
				cache[id] = image
			}
			parts[index] = image
		}
		copy := make(map[string]any, len(message))
		for key, value := range message {
			copy[key] = value
		}
		copy["content"] = contentPartsToMaps(parts)
		resolved = append(resolved, copy)
	}
	return resolved, nil
}

// Call while holding ConversationService.commandMu, after transactions finish.
// Shared assets survive clones; failed writes and truncated turns are collected.
func (service *assetService) cleanupUser(userID string) {
	if service == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := service.db.QueryContext(ctx, `SELECT a.id,a.backend,a.object_key FROM chat_assets a WHERE a.user_id=? AND NOT EXISTS (
 SELECT 1 FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id, json_each(m.content_json) p
 WHERE s.user_id=a.user_id AND json_extract(p.value,'$.source.assetId')=a.id)`, userID)
	if err != nil {
		log.Printf("kairos: list unused assets: %v", err)
		return
	}
	var unused []assetRecord
	for rows.Next() {
		var record assetRecord
		if err = rows.Scan(&record.ID, &record.Backend, &record.Key); err != nil {
			break
		}
		unused = append(unused, record)
	}
	iterationErr := rows.Err()
	rows.Close()
	if err != nil || iterationErr != nil {
		log.Printf("kairos: scan unused assets: %v %v", err, iterationErr)
		return
	}
	for _, record := range unused {
		store := service.stores[record.Backend]
		if store == nil {
			continue
		}
		if err := store.Delete(ctx, record.Key); err != nil {
			log.Printf("kairos: delete unused asset: %v", err)
			continue
		}
		if _, err := service.db.ExecContext(ctx, `DELETE FROM chat_assets WHERE id=?`, record.ID); err != nil {
			log.Printf("kairos: delete unused asset metadata: %v", err)
		}
	}
}
