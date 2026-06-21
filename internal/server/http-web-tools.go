package server

import "net/http"

type webToolSettingsResponse struct {
	Settings WebToolSettings `json:"settings"`
}

func (app *App) handleGetWebToolSettings(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	settings, err := app.webTools.GetSettings(request.Context(), user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, webToolSettingsResponse{Settings: settings})
}

func (app *App) handleUpdateWebToolSettings(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	var payload UpdateWebToolSettingsInput
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	settings, err := app.webTools.UpdateSettings(request.Context(), user.ID, payload)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, webToolSettingsResponse{Settings: settings})
}
