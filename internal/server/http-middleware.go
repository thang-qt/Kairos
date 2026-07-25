package server

import (
	"compress/gzip"
	"net/http"
	"strconv"
	"strings"
)

const (
	noCachePolicy        = "no-cache"
	noStorePolicy        = "no-store"
	staticAssetPolicy    = "public, max-age=86400"
	immutableAssetPolicy = "public, max-age=31536000, immutable"
)

type gzipResponseWriter struct {
	http.ResponseWriter
	writer *gzip.Writer
}

func (writer *gzipResponseWriter) WriteHeader(statusCode int) {
	writer.Header().Del("Content-Length")
	writer.ResponseWriter.WriteHeader(statusCode)
}

func (writer *gzipResponseWriter) Write(payload []byte) (int, error) {
	writer.Header().Del("Content-Length")
	return writer.writer.Write(payload)
}

func (writer *gzipResponseWriter) Flush() {
	_ = writer.writer.Flush()
	if flusher, ok := writer.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func cacheControlPolicy(request *http.Request) string {
	pathname := request.URL.Path
	if strings.HasPrefix(pathname, "/api/") {
		return noStorePolicy
	}
	if strings.HasPrefix(pathname, "/assets/") {
		return immutableAssetPolicy
	}
	switch pathname {
	case "/manifest.json",
		"/favicon.svg",
		"/icon-maskable.svg",
		"/apple-touch-icon.png",
		"/pwa-192x192.png",
		"/pwa-512x512.png",
		"/pwa-maskable-512x512.png",
		"/cover.jpg",
		"/robots.txt":
		return staticAssetPolicy
	default:
		return noCachePolicy
	}
}

func shouldCompressResponse(request *http.Request) bool {
	return canCompressResponse(request) &&
		acceptsEncoding(request.Header.Get("Accept-Encoding"), "gzip")
}

func canCompressResponse(request *http.Request) bool {
	if request.Method != http.MethodGet || request.Header.Get("Range") != "" {
		return false
	}
	pathname := strings.ToLower(request.URL.Path)
	if strings.HasSuffix(pathname, "/events") {
		return false
	}
	for _, extension := range []string{
		".jpg",
		".jpeg",
		".png",
		".woff",
		".woff2",
		".ttf",
	} {
		if strings.HasSuffix(pathname, extension) {
			return false
		}
	}
	return true
}

func acceptsEncoding(header string, target string) bool {
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(item, ";")
		if !strings.EqualFold(strings.TrimSpace(parts[0]), target) {
			continue
		}
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, found := strings.Cut(parameter, "=")
			if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				return false
			}
			quality = parsed
		}
		return quality > 0
	}
	return false
}

func addVaryHeader(header http.Header, value string) {
	for _, existingHeader := range header.Values("Vary") {
		for _, existingValue := range strings.Split(existingHeader, ",") {
			if strings.EqualFold(strings.TrimSpace(existingValue), value) {
				return
			}
		}
	}
	header.Add("Vary", value)
}
