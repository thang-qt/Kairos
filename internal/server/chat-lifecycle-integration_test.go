package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPChatLifecycleReconnectEditAndRetry(t *testing.T) {
	app := newTestApp(t, func(config *Config) {
		config.SystemProviderEnabled = true
		config.SystemProviderStaticModels = []string{"test-model"}
		config.SystemProviderLabel = "Fake"
	})
	enteredFirst, releaseFirst := make(chan struct{}), make(chan struct{})
	enteredRetry, releaseRetry := make(chan struct{}), make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(ctx context.Context, call int, _ ChatGenerationRequest, emit func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		switch call {
		case 1:
			close(enteredFirst)
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return ChatGenerationResult{}, ctx.Err()
			}
			if err := emit(ChatGenerationDelta{Text: "partial before edit"}); err != nil {
				return ChatGenerationResult{}, err
			}
			<-ctx.Done()
			return ChatGenerationResult{}, ctx.Err()
		case 2:
			return ChatGenerationResult{}, errors.New("first edited attempt failed")
		default:
			close(enteredRetry)
			select {
			case <-releaseRetry:
			case <-ctx.Done():
				return ChatGenerationResult{}, ctx.Err()
			}
			if err := emit(ChatGenerationDelta{Text: "retried answer"}); err != nil {
				return ChatGenerationResult{}, err
			}
			return ChatGenerationResult{OutputText: "retried answer"}, nil
		}
	}}

	httpServer := httptest.NewServer(app.handler)
	defer httpServer.Close()
	client := httpServer.Client()
	cookie := signupAndRequireCookie(t, app, "lifecycle-http@example.com")

	createdResponse := postJSONOverHTTP(t, client, httpServer.URL, "/api/sessions", createSessionRequest{Label: "Lifecycle"}, cookie)
	if createdResponse.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d", createdResponse.StatusCode)
	}
	var created sessionMutationResponse
	decodeHTTPJSON(t, createdResponse, &created)
	if created.Revision != 0 {
		t.Fatalf("created revision=%d, want 0", created.Revision)
	}

	sendResponse := postJSONOverHTTP(t, client, httpServer.URL, "/api/sessions/"+created.FriendlyID+"/messages", sendMessageRequest{Message: "original prompt", Model: "test-model", ExpectedRevision: int64Pointer(0), IdempotencyKey: "lifecycle-send"}, cookie)
	if sendResponse.StatusCode != http.StatusOK {
		t.Fatalf("send status=%d", sendResponse.StatusCode)
	}
	var first SubmitTurnResult
	decodeHTTPJSON(t, sendResponse, &first)
	if first.Revision != 1 || first.UserTurnID == "" || first.AssistantTurnID == "" {
		t.Fatalf("send ack=%+v", first)
	}
	requireSignal(t, enteredFirst)

	stream, cancelStream := openHTTPChatStream(t, client, httpServer.URL, created.FriendlyID, cookie, 0)
	firstFrame := readSSEConversationEvent(t, stream)
	if firstFrame.event.State != "reconcile" || firstFrame.event.Snapshot == nil || firstFrame.event.Snapshot.Revision != first.Revision {
		t.Fatalf("initial stream event=%+v, want revision %d snapshot", firstFrame.event, first.Revision)
	}
	close(releaseFirst)
	liveDelta := readSSEConversationEvent(t, stream)
	cancelStream()
	if liveDelta.event.State != "delta" || liveDelta.event.TurnID != first.AssistantTurnID {
		t.Fatalf("first live delta=%+v", liveDelta.event)
	}
	oldCursor := firstFrame.event.Snapshot.Cursor
	if oldCursor <= 0 {
		t.Fatalf("initial snapshot cursor=%d", oldCursor)
	}

	editResponse := postJSONOverHTTP(t, client, httpServer.URL, "/api/sessions/"+created.FriendlyID+"/messages/"+first.UserTurnID+"/edit", sendMessageRequest{Message: "edited prompt", Model: "test-model", ExpectedRevision: int64Pointer(first.Revision), IdempotencyKey: "lifecycle-edit"}, cookie)
	if editResponse.StatusCode != http.StatusOK {
		t.Fatalf("edit status=%d body=%s", editResponse.StatusCode, readBody(editResponse))
	}
	var edited SubmitTurnResult
	decodeHTTPJSON(t, editResponse, &edited)
	if edited.Revision != first.Revision+1 || edited.UserTurnID != first.UserTurnID || edited.AssistantTurnID == first.AssistantTurnID {
		t.Fatalf("edit ack=%+v, first=%+v", edited, first)
	}
	waitForRunStatus(t, app, edited.RunID, "error")

	// Revision advancement prunes the old journal. Reconnecting from its cursor
	// must begin with an authoritative current snapshot, never old turn patches.
	reconnected, cancelReconnect := openHTTPChatStream(t, client, httpServer.URL, created.FriendlyID, cookie, oldCursor)
	reconnectFrame := readSSEConversationEvent(t, reconnected)
	cancelReconnect()
	if reconnectFrame.event.State != "reconcile" || reconnectFrame.event.Snapshot == nil || reconnectFrame.event.Snapshot.Revision != edited.Revision {
		t.Fatalf("reconnect event=%+v, want authoritative revision %d snapshot", reconnectFrame.event, edited.Revision)
	}
	if findHistoryMessageByRole(reconnectFrame.event.Snapshot.Messages, "user")["content"].([]any)[0].(map[string]any)["text"] != "edited prompt" {
		t.Fatalf("reconnect snapshot did not retain edited prompt: %+v", reconnectFrame.event.Snapshot.Messages)
	}
	var staleJournalRows int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM chat_events WHERE session_id=? AND revision<?`, created.SessionKey, edited.Revision).Scan(&staleJournalRows); err != nil {
		t.Fatal(err)
	}
	if staleJournalRows != 0 {
		t.Fatalf("journal retained %d obsolete events below revision %d", staleJournalRows, edited.Revision)
	}
	journal, err := app.app.runtime.readEvents(context.Background(), created.SessionKey, oldCursor)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range journal {
		if event.Revision < edited.Revision {
			t.Fatalf("stale event survived retention: %+v", event)
		}
	}

	retryStream, cancelRetryStream := openHTTPChatStream(t, client, httpServer.URL, created.FriendlyID, cookie, oldCursor)
	retrySnapshot := readSSEConversationEvent(t, retryStream)
	if retrySnapshot.event.State != "reconcile" || retrySnapshot.event.Snapshot == nil || retrySnapshot.event.Snapshot.Revision != edited.Revision {
		cancelRetryStream()
		t.Fatalf("retry stream snapshot=%+v, want revision %d", retrySnapshot.event, edited.Revision)
	}
	retryResponse := postJSONOverHTTP(t, client, httpServer.URL, "/api/sessions/"+created.FriendlyID+"/runs/"+edited.RunID+"/retry", map[string]any{"idempotencyKey": "lifecycle-retry", "expectedRevision": edited.Revision}, cookie)
	if retryResponse.StatusCode != http.StatusOK {
		cancelRetryStream()
		t.Fatalf("retry status=%d body=%s", retryResponse.StatusCode, readBody(retryResponse))
	}
	var retried SubmitTurnResult
	decodeHTTPJSON(t, retryResponse, &retried)
	if retried.Revision != edited.Revision+1 || retried.RunID != edited.RunID || retried.AssistantTurnID != edited.AssistantTurnID {
		cancelRetryStream()
		t.Fatalf("retry changed visible assistant identity: edited=%+v retry=%+v", edited, retried)
	}
	requireSignal(t, enteredRetry)
	close(releaseRetry)
	retryDeltaCount := 0
	var finalFrame sseConversationFrame
	for {
		frame := readSSEConversationEvent(t, retryStream)
		if frame.event.TurnID != edited.AssistantTurnID {
			cancelRetryStream()
			t.Fatalf("retry event changed visible assistant identity: %+v", frame.event)
		}
		if frame.event.State == "delta" {
			retryDeltaCount++
		}
		if frame.event.State == "final" {
			finalFrame = frame
			break
		}
	}
	cancelRetryStream()
	if retryDeltaCount == 0 {
		t.Fatal("retry stream delivered no live delta")
	}
	if finalFrame.event.State != "final" || finalFrame.event.TurnID != edited.AssistantTurnID || finalFrame.event.Message["id"] != edited.AssistantTurnID || textContentFromMessage(finalFrame.event.Message) != "retried answer" {
		t.Fatalf("retry live final=%+v, want retained assistant id %s and retried answer", finalFrame.event, edited.AssistantTurnID)
	}
	waitForRunStatus(t, app, retried.RunID, "completed")

}

type sseConversationFrame struct {
	id    int64
	event ConversationEvent
}

func openHTTPChatStream(t *testing.T, client *http.Client, baseURL, friendlyID string, cookie *http.Cookie, after int64) (*closingSSEReader, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/sessions/"+friendlyID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	if after > 0 {
		request.Header.Set("Last-Event-ID", fmt.Sprint(after))
	}
	response, err := client.Do(request)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		cancel()
		body := readBody(response)
		t.Fatalf("SSE response status=%d content-type=%q body=%s", response.StatusCode, response.Header.Get("Content-Type"), body)
	}
	reader := bufio.NewReader(response.Body)
	return &closingSSEReader{Reader: reader, body: response.Body}, func() {
		cancel()
		_ = response.Body.Close()
	}
}

type closingSSEReader struct {
	*bufio.Reader
	body io.Closer
}

func readSSEConversationEvent(t *testing.T, reader interface{ ReadString(byte) (string, error) }) sseConversationFrame {
	t.Helper()
	var frame sseConversationFrame
	var data strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		lineResult := make(chan struct {
			line string
			err  error
		}, 1)
		go func() {
			line, err := reader.ReadString('\n')
			lineResult <- struct {
				line string
				err  error
			}{line, err}
		}()
		select {
		case result := <-lineResult:
			if result.err != nil {
				t.Fatalf("read SSE line: %v", result.err)
			}
			line := strings.TrimRight(result.line, "\r\n")
			if strings.HasPrefix(line, "id:") {
				_, _ = fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(line, "id:")), "%d", &frame.id)
			}
			if strings.HasPrefix(line, "data:") {
				data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
			if line == "" && data.Len() > 0 {
				if err := json.Unmarshal([]byte(data.String()), &frame.event); err != nil {
					t.Fatalf("decode SSE event: %v (%s)", err, data.String())
				}
				return frame
			}
		case <-deadline:
			t.Fatal("timed out reading SSE event")
		}
	}
}

func postJSONOverHTTP(t *testing.T, client *http.Client, baseURL, path string, payload any, cookie *http.Cookie) *http.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decodeHTTPJSON(t *testing.T, response *http.Response, destination any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(destination); err != nil {
		t.Fatal(err)
	}
}

func readBody(response *http.Response) string {
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	return string(body)
}

func int64Pointer(value int64) *int64 { return &value }
