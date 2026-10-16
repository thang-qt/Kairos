package server

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	_ "golang.org/x/image/webp"
)

const maxImagePixels = 16_000_000

var errInvalidImageAttachment = errors.New("invalid image attachment")

func decodeImagePayload(mimeType string, encoded string) ([]byte, string, error) {
	normalizedMimeType := strings.ToLower(strings.TrimSpace(mimeType))
	expectedFormat := ""
	switch normalizedMimeType {
	case "image/png":
		expectedFormat = "png"
	case "image/jpeg":
		expectedFormat = "jpeg"
	case "image/gif":
		expectedFormat = "gif"
	case "image/webp":
		expectedFormat = "webp"
	default:
		return nil, "", fmt.Errorf("unsupported image format")
	}

	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return nil, "", fmt.Errorf("invalid image encoding")
	}
	if len(encoded) > base64.StdEncoding.EncodedLen(maxImportImage) {
		return nil, "", fmt.Errorf("image exceeds the 20 MiB limit")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return nil, "", fmt.Errorf("invalid image encoding")
	}
	if len(data) > maxImportImage {
		return nil, "", fmt.Errorf("image exceeds the 20 MiB limit")
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != expectedFormat {
		return nil, "", fmt.Errorf("image content does not match its media type")
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width) > maxImagePixels/int64(config.Height) {
		return nil, "", fmt.Errorf("image dimensions exceed the limit")
	}
	if _, decodedFormat, err := image.Decode(bytes.NewReader(data)); err != nil || decodedFormat != expectedFormat {
		return nil, "", fmt.Errorf("invalid image data")
	}
	return data, normalizedMimeType, nil
}

func validateEphemeralInlineImages(history []map[string]any) error {
	for _, message := range history {
		if err := validateInlineImagePartFields(message["content"]); err != nil {
			return fmt.Errorf("invalid inline image in history: %w", err)
		}
		for _, part := range contentPartsFromAny(message["content"]) {
			if part.Type != "image" || part.Source == nil || part.Source.Type != "base64" {
				continue
			}
			if _, _, err := decodeImagePayload(part.Source.MediaType, part.Source.Data); err != nil {
				return fmt.Errorf("invalid inline image in history: %w", err)
			}
		}
	}
	return nil
}

func validateInlineImagePartFields(value any) error {
	var items []map[string]any
	switch typed := value.(type) {
	case []map[string]any:
		items = typed
	case []any:
		items = make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			part, ok := item.(map[string]any)
			if ok {
				items = append(items, part)
			}
		}
	default:
		return nil
	}
	for _, item := range items {
		if strings.TrimSpace(stringValueFromMap(item, "type")) != "image" {
			continue
		}
		source, ok := item["source"].(map[string]any)
		if !ok || strings.TrimSpace(stringValueFromMap(source, "type")) != "base64" {
			continue
		}
		if strings.TrimSpace(stringValueFromMap(source, "media_type")) == "" || strings.TrimSpace(stringValueFromMap(source, "data")) == "" {
			return errInvalidImageAttachment
		}
	}
	return nil
}
