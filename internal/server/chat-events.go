package server

type ChatEvent struct {
	Revision     int64           `json:"revision"`
	TurnID       string          `json:"turnId,omitempty"`
	Cursor       int64           `json:"cursor,omitempty"`
	RunID        string          `json:"runId,omitempty"`
	SessionKey   string          `json:"sessionKey,omitempty"`
	FriendlyID   string          `json:"friendlyId,omitempty"`
	State        string          `json:"state,omitempty"`
	Error        string          `json:"error,omitempty"`
	ActiveRunIDs []string        `json:"activeRunIds,omitempty"`
	Message      map[string]any  `json:"message,omitempty"`
	Session      *SessionSummary `json:"session,omitempty"`
}
