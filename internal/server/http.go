package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const (
	maxJSONRequestBytes = 1 << 20
	// A chat request can carry a 20 MiB image encoded as base64 plus metadata.
	maxChatJSONRequestBytes = 32 << 20
	// Throwaway requests also carry prior conversation content and images.
	maxEphemeralJSONRequestBytes = 64 << 20
)

type CapabilitySet struct {
	Auth      AuthCapabilities     `json:"auth"`
	Providers ProviderCapabilities `json:"providers"`
	Models    ModelCapabilities    `json:"models"`
}

type AuthCapabilities struct {
	Enabled       bool `json:"enabled"`
	SignupEnabled bool `json:"signupEnabled"`
}

type capabilitiesResponse struct {
	Capabilities CapabilitySet `json:"capabilities"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func (app *App) handleHealth(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "kairos-backend",
	})
}

func (app *App) handleCapabilities(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, capabilitiesResponse{
		Capabilities: app.capability,
	})
}

func decodeJSON(request *http.Request, destination any) error {
	return decodeJSONWithLimit(nil, request, destination, maxJSONRequestBytes)
}

func decodeJSONWithLimit(writer http.ResponseWriter, request *http.Request, destination any, limit int64) error {
	request.Body = http.MaxBytesReader(writer, request.Body, limit)
	if request.ContentLength > limit {
		return &http.MaxBytesError{Limit: limit}
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return jsonRequestDecodeError(err)
	}
	// Consume the entire body so trailing values, garbage, and oversized
	// whitespace cannot bypass either validation or the byte limit.
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return jsonRequestDecodeError(err)
	}
	return nil
}

func jsonRequestDecodeError(err error) error {
	var sizeError *http.MaxBytesError
	if errors.As(err, &sizeError) {
		return sizeError
	}
	return errors.New("invalid request body")
}

func writeJSONDecodeError(writer http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	var sizeError *http.MaxBytesError
	if errors.As(err, &sizeError) {
		status = http.StatusRequestEntityTooLarge
		writeError(writer, status, fmt.Sprintf("Request exceeds the %d MiB limit. Remove images or shorten the conversation.", sizeError.Limit/(1<<20)))
		return
	}
	writeError(writer, status, err.Error())
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, statusCode int, message string) {
	writeJSON(writer, statusCode, errorResponse{Error: message})
}
