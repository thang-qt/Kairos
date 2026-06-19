package server

import (
	"encoding/json"
	"errors"
	"net/http"
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
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, statusCode int, message string) {
	writeJSON(writer, statusCode, errorResponse{Error: message})
}
