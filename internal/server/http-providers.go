package server

import (
	"errors"
	"net/http"
)

type providersResponse struct {
	Providers   []ProviderRecord `json:"providers"`
	Preferences UserPreferences  `json:"preferences"`
}

type providerMutationResponse struct {
	Provider ProviderRecord `json:"provider"`
}

type preferencesResponse struct {
	Preferences UserPreferences `json:"preferences"`
}

type testConnectionRequest struct {
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

type testConnectionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

func (app *App) handleGetPreferences(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	preferences, err := app.providers.GetPreferences(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to load preferences")
		return
	}

	writeJSON(writer, http.StatusOK, preferencesResponse{Preferences: preferences})
}

func (app *App) handleUpdatePreferences(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload UpdateUserPreferencesInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	preferences, err := app.providers.UpdatePreferences(request.Context(), user.ID, payload)
	if err != nil {
		switch {
		case errors.Is(err, errSystemProviderDisableLocked):
			writeError(writer, http.StatusForbidden, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, preferencesResponse{Preferences: preferences})
}

func (app *App) handleListProviders(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	providers, preferences, err := app.providers.ListProviders(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "failed to load providers")
		return
	}

	writeJSON(writer, http.StatusOK, providersResponse{
		Providers:   providers,
		Preferences: preferences,
	})
}

func (app *App) handleCreateProvider(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload CreateProviderInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	provider, err := app.providers.CreateProvider(request.Context(), user.ID, payload)
	if err != nil {
		switch {
		case errors.Is(err, errProvidersDisabled):
			writeError(writer, http.StatusForbidden, err.Error())
		case errors.Is(err, errProviderKindUnsupported):
			writeError(writer, http.StatusBadRequest, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusCreated, providerMutationResponse{Provider: provider})
}

func (app *App) handleUpdateProvider(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload UpdateProviderInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	provider, err := app.providers.UpdateProvider(request.Context(), user.ID, request.PathValue("providerId"), payload)
	if err != nil {
		switch {
		case errors.Is(err, errProviderOwnedBySystem):
			writeError(writer, http.StatusForbidden, err.Error())
		case errors.Is(err, errProviderNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(writer, http.StatusOK, providerMutationResponse{Provider: provider})
}

func (app *App) handleDeleteProvider(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	err := app.providers.DeleteProvider(request.Context(), user.ID, request.PathValue("providerId"))
	if err != nil {
		switch {
		case errors.Is(err, errProviderOwnedBySystem):
			writeError(writer, http.StatusForbidden, err.Error())
		case errors.Is(err, errProviderNotFound):
			writeError(writer, http.StatusNotFound, err.Error())
		default:
			writeError(writer, http.StatusInternalServerError, "failed to delete provider")
		}
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}

func (app *App) handleTestConnection(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	var payload testConnectionRequest
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	err := app.providers.TestConnection(request.Context(), user.ID, payload.Kind, payload.BaseURL, payload.APIKey)
	if err != nil {
		writeJSON(writer, http.StatusOK, testConnectionResponse{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, testConnectionResponse{
		Success: true,
		Message: "Connection successful",
	})
}

func (app *App) handleTestProviderConnection(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}

	providerID := request.PathValue("providerId")
	err := app.providers.TestProviderConnection(request.Context(), user.ID, providerID)
	if err != nil {
		writeJSON(writer, http.StatusOK, testConnectionResponse{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, testConnectionResponse{
		Success: true,
		Message: "Connection successful",
	})
}
