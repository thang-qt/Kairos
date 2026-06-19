package server

import (
	"errors"
	"net/http"
)

type modelsResponse struct {
	Models       []ProviderModel   `json:"models"`
	Preferences  UserPreferences   `json:"preferences"`
	Capabilities ModelCapabilities `json:"capabilities"`
}

type modelMutationResponse struct {
	Model ProviderModel `json:"model"`
}

type syncModelsResponse struct {
	OK bool `json:"ok"`
}

func (app *App) handleSyncModels(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	models, preferences, err := app.providers.SyncModels(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to load models")
		return
	}

	writeJSON(writer, http.StatusOK, modelsResponse{
		Models:       models,
		Preferences:  preferences,
		Capabilities: app.capability.Models,
	})
}

func (app *App) handleUpdateModelMetadata(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload UpdateModelMetadataInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	model, err := app.providers.UpdateModelMetadata(request.Context(), user.ID, payload)
	if err != nil {
		switch {
		case errors.Is(err, errModelNotAvailable):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, modelMutationResponse{Model: model})
}

func (app *App) handleListModels(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	models, preferences, err := app.providers.ListModels(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to load models")
		return
	}

	writeJSON(writer, http.StatusOK, modelsResponse{
		Models:       models,
		Preferences:  preferences,
		Capabilities: app.capability.Models,
	})
}

func (app *App) handleCreateCustomModel(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload CreateModelInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	model, err := app.providers.AddCustomModel(request.Context(), user.ID, payload)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusCreated, modelMutationResponse{Model: model})
}

func (app *App) handleDeleteCustomModel(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	providerRef := request.URL.Query().Get("providerRef")
	modelID := request.URL.Query().Get("modelId")

	if err := app.providers.DeleteCustomModel(request.Context(), user.ID, providerRef, modelID); err != nil {
		switch {
		case errors.Is(err, errCustomModelNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}
