package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

type chatContractFixture struct {
	SendRequest json.RawMessage `json:"sendRequest"`
	CommandAck  json.RawMessage `json:"commandAck"`
	SSEFrame    string          `json:"sseFrame"`
}

func TestSharedChatContractFixtureMatchesGoWireTypes(t *testing.T) {
	fixtureBytes, err := os.ReadFile("testdata/chat-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture chatContractFixture
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/sessions/friendly-contract-1/messages", bytes.NewReader(fixture.SendRequest))
	response := httptest.NewRecorder()
	var decoded sendMessageRequest
	if err := decodeJSONWithLimit(response, request, &decoded, maxChatJSONRequestBytes); err != nil {
		t.Fatalf("decode actual send request type: %v", err)
	}
	if decoded.ExpectedRevision == nil || *decoded.ExpectedRevision != 6 || decoded.Message != "Continue the conversation" || decoded.Advanced == nil || decoded.Advanced.Reasoning == nil || decoded.Advanced.Reasoning.Effort != "medium" || len(decoded.Attachments) != 1 || decoded.ClientTimeZone != "Asia/Ho_Chi_Minh" {
		t.Fatalf("decoded request differs from fixture contract: %+v", decoded)
	}

	var ack SubmitTurnResult
	if err := json.Unmarshal(fixture.CommandAck, &ack); err != nil {
		t.Fatalf("decode command acknowledgement: %v", err)
	}
	if ack.Revision != 7 || ack.RunID != "run-contract-1" || ack.UserTurnID != "user-contract-1" || len(ack.InvalidatedRunIDs) != 1 || ack.InvalidatedRunIDs[0] != "run-old-1" || len(ack.RemovedTurnIDs) != 1 {
		t.Fatalf("decoded command acknowledgement differs from fixture contract: %+v", ack)
	}
	encodedAck, err := json.Marshal(ack)
	if err != nil {
		t.Fatal(err)
	}
	var expectedAck, actualAck any
	if err := json.Unmarshal(fixture.CommandAck, &expectedAck); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encodedAck, &actualAck); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actualAck, expectedAck) {
		t.Fatalf("Go command acknowledgement wire shape = %s, fixture = %s", encodedAck, fixture.CommandAck)
	}

	var event ConversationEvent
	if err := json.Unmarshal([]byte(extractSSEData(fixture.SSEFrame)), &event); err != nil {
		t.Fatalf("decode SSE event: %v", err)
	}
	if event.State != "delta" || event.Cursor != 19 || len(event.TurnPatch) != 1 || event.TurnPatch[0].Op != "append" || event.TurnPatch[0].Path[1] != "0" || event.TurnPatch[0].Value != " there" {
		t.Fatalf("decoded patch differs from fixture contract: %+v", event)
	}
	generatedPatch := diffTurn(
		map[string]any{"id": "assistant-contract-1", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "Hello"}}},
		map[string]any{"id": "assistant-contract-1", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "Hello there"}}},
	)
	patchJSON, err := json.Marshal(generatedPatch)
	if err != nil {
		t.Fatal(err)
	}
	fixturePatchJSON, err := json.Marshal(event.TurnPatch)
	if err != nil {
		t.Fatal(err)
	}
	if string(patchJSON) != string(fixturePatchJSON) {
		t.Fatalf("Go generated patch = %s, fixture patch = %s", patchJSON, fixturePatchJSON)
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip map[string]any
	if err := json.Unmarshal(encoded, &roundTrip); err != nil || roundTrip["revision"] != float64(7) || roundTrip["turnPatch"] == nil {
		t.Fatalf("SSE event round trip = %s (%v)", encoded, err)
	}
}

func extractSSEData(frame string) string {
	for _, line := range strings.Split(frame, "\n") {
		if strings.HasPrefix(line, "data:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
	return ""
}
