package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

const validTestPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGLiEpEDBAAA//8AcAA/yHRfdwAAAABJRU5ErkJggg=="

func TestDecodeImagePayloadValidatesContentAndSize(t *testing.T) {
	data := testPNGBytes(t)
	encoded := base64.StdEncoding.EncodeToString(data)
	decoded, mimeType, err := decodeImagePayload(" IMAGE/PNG ", encoded)
	if err != nil {
		t.Fatal(err)
	}
	if mimeType != "image/png" || !bytes.Equal(decoded, data) {
		t.Fatalf("decoded MIME/data = %q / %d bytes", mimeType, len(decoded))
	}

	tests := []struct {
		name    string
		mime    string
		content string
	}{
		{name: "mismatched MIME", mime: "image/jpeg", content: encoded},
		{name: "malformed image", mime: "image/png", content: base64.StdEncoding.EncodeToString(data[:20])},
		{name: "oversized image", mime: "image/png", content: base64.StdEncoding.EncodeToString(make([]byte, maxImportImage+1))},
		{name: "oversized dimensions", mime: "image/png", content: base64.StdEncoding.EncodeToString(testPNGWithLargeDimensions(t, data))},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, _, err := decodeImagePayload(test.mime, test.content); err == nil {
				t.Fatal("accepted invalid image payload")
			}
		})
	}
}

func TestDecodeImagePayloadAcceptsSupportedFormats(t *testing.T) {
	imageData := image.NewRGBA(image.Rect(0, 0, 1, 1))
	imageData.Set(0, 0, color.RGBA{R: 10, G: 20, B: 30, A: 255})
	var jpegBuffer, gifBuffer bytes.Buffer
	if err := jpeg.Encode(&jpegBuffer, imageData, nil); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&gifBuffer, imageData, nil); err != nil {
		t.Fatal(err)
	}
	webpData, err := base64.StdEncoding.DecodeString("UklGRkgAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAQFZQOCAgAAAAcAEAnQEqAQABAAIANCWMAnQBQAAA/u0HKMJpJvaMAAA=")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		mime string
		data []byte
	}{
		{mime: "image/png", data: testPNGBytes(t)},
		{mime: "image/jpeg", data: jpegBuffer.Bytes()},
		{mime: "image/gif", data: gifBuffer.Bytes()},
		{mime: "image/webp", data: webpData},
	} {
		if _, _, err := decodeImagePayload(test.mime, base64.StdEncoding.EncodeToString(test.data)); err != nil {
			t.Errorf("decodeImagePayload(%q) error = %v", test.mime, err)
		}
	}
}

func TestBuildUserMessageRejectsInvalidInlineAttachment(t *testing.T) {
	if _, _, err := buildUserMessage("question", []AttachmentPayload{{MimeType: "image/png", Content: base64.StdEncoding.EncodeToString([]byte("not an image"))}}, ""); err == nil {
		t.Fatal("accepted malformed inline attachment")
	}
}

func TestEphemeralHistoryValidatesInlineImagesWithoutRevalidatingStoredHistory(t *testing.T) {
	invalid := map[string]any{
		"role": "user",
		"content": []map[string]any{{
			"type":   "image",
			"source": map[string]any{"type": "base64", "media_type": "image/png", "data": base64.StdEncoding.EncodeToString([]byte("not an image"))},
		}},
	}
	if err := validateEphemeralInlineImages([]map[string]any{invalid}); err == nil {
		t.Fatal("ephemeral history accepted malformed inline image data")
	}
	emptyImage := map[string]any{
		"content": []map[string]any{{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": ""}}},
	}
	if err := validateEphemeralInlineImages([]map[string]any{emptyImage}); err == nil {
		t.Fatal("ephemeral history accepted an empty inline image payload")
	}
	if _, err := (&assetService{}).resolveHistory(context.Background(), "user", []map[string]any{invalid}); err != nil {
		t.Fatalf("trusted stored inline history was revalidated: %v", err)
	}

	encoded := base64.StdEncoding.EncodeToString(testPNGBytes(t))
	history := []map[string]any{{
		"role": "user",
		"content": []map[string]any{{
			"type":   "image",
			"source": map[string]any{"type": "base64", "media_type": "image/png", "data": encoded},
		}},
	}}
	if err := validateEphemeralInlineImages(history); err != nil {
		t.Fatalf("valid ephemeral history image rejected: %v", err)
	}
}

func testPNGBytes(t *testing.T) []byte {
	t.Helper()
	imageData := image.NewRGBA(image.Rect(0, 0, 1, 1))
	imageData.Set(0, 0, color.RGBA{R: 10, G: 20, B: 30, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, imageData); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func testPNGWithLargeDimensions(t *testing.T, source []byte) []byte {
	t.Helper()
	data := append([]byte(nil), source...)
	binary.BigEndian.PutUint32(data[16:20], 5000)
	binary.BigEndian.PutUint32(data[20:24], 5000)
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	return data
}
