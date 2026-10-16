package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSessionListNotificationsAreUserScopedAndCoalesced(t *testing.T) {
	var broker sessionListNotifications
	first, unsubscribeFirst := broker.subscribe("user-a")
	defer unsubscribeFirst()
	second, unsubscribeSecond := broker.subscribe("user-a")
	defer unsubscribeSecond()
	other, unsubscribeOther := broker.subscribe("user-b")
	defer unsubscribeOther()

	broker.publish("user-a")
	broker.publish("user-a")

	for name, channel := range map[string]<-chan struct{}{"first": first, "second": second} {
		select {
		case <-channel:
		default:
			t.Fatalf("%s subscriber missed user-a notification", name)
		}
		select {
		case <-channel:
			t.Fatalf("%s subscriber received a duplicate buffered notification", name)
		default:
		}
	}
	select {
	case <-other:
		t.Fatal("user-b subscriber received user-a notification")
	default:
	}
}

func TestSessionListTransactionPublishesOnlyAfterCommit(t *testing.T) {
	app := newTestApp(t, nil)
	changed, unsubscribe := app.app.conversations.sessionLists.subscribe("user-a")
	defer unsubscribe()

	rolledBack, err := app.app.conversations.beginEventTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	rolledBack.recordSessionListChange("user-a")
	if err = rolledBack.Rollback(); err != nil {
		t.Fatal(err)
	}
	assertNoSessionListNotification(t, changed)

	committed, err := app.app.conversations.beginEventTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	committed.recordSessionListChange("user-a")
	if err = committed.Commit(); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)
}

func TestSessionListNotificationsCoverConversationMutations(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "session-list@example.invalid")
	userResponse := performJSONRequest(t, app.handler, http.MethodGet, "/api/me", nil, []*http.Cookie{cookie})
	assertStatusCode(t, userResponse, http.StatusOK)
	var userPayload sessionResponse
	decodeResponseJSON(t, userResponse, &userPayload)
	userID := userPayload.User.ID

	changed, unsubscribe := app.app.conversations.sessionLists.subscribe(userID)
	defer unsubscribe()
	ctx := context.Background()

	session, err := app.app.conversations.CreateSession(ctx, userID, "Original")
	if err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)

	if _, err = app.app.conversations.RenameSession(ctx, userID, session.FriendlyID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)
	if _, err = app.app.conversations.PinSession(ctx, userID, session.FriendlyID, true); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)

	source, err := app.app.conversations.findSessionByFriendlyID(ctx, userID, session.FriendlyID)
	if err != nil {
		t.Fatal(err)
	}
	userMessage := newUserTextMessage("A persisted user turn")
	if _, err = app.app.conversations.appendMessagesWithOptions(ctx, source, []map[string]any{userMessage}, appendMessageOptions{}); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)

	if _, err = app.app.conversations.CloneSession(ctx, userID, session.FriendlyID, messageIDFromMap(userMessage)); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)
	if _, err = app.app.conversations.DeleteUserMessageAtRevision(ctx, userID, session.FriendlyID, messageIDFromMap(userMessage), nil); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)

	emptySession, err := app.app.conversations.CreateSession(ctx, userID, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)
	updated, err := app.app.conversations.UpdateSessionTitleIfEmptyAtRevision(ctx, emptySession.Key, userID, "Generated title", 0)
	if err != nil || !updated {
		t.Fatalf("UpdateSessionTitleIfEmptyAtRevision() = %v, %v; want true, nil", updated, err)
	}
	assertSessionListNotification(t, changed)

	if err = app.app.conversations.DeleteSession(ctx, userID, session.FriendlyID); err != nil {
		t.Fatal(err)
	}
	assertSessionListNotification(t, changed)

	started, err := app.app.runtime.StartRun(ctx, userID, SubmitTurnInput{
		NewConversation: &newConversationInput{Settings: defaultConversationSettings()},
		Message:         "A committed run boundary",
		Model:           "missing-provider-model",
	})
	if err != nil {
		t.Fatal(err)
	}
	if started.RunID == "" {
		t.Fatal("StartRun() returned an empty run id")
	}
	assertSessionListNotification(t, changed)
}

func TestSessionListImportNotificationFollowsCommit(t *testing.T) {
	app := newTestApp(t, nil)
	signupAndRequireCookie(t, app, "session-list-import@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	changed, unsubscribe := app.app.conversations.sessionLists.subscribe(userID)
	defer unsubscribe()
	adapter := syntheticConversationImporter{source: "session-list-import"}

	report, err := app.app.conversations.previewConversationImport(context.Background(), userID, adapter)
	if err != nil {
		t.Fatal(err)
	}
	assertNoSessionListNotification(t, changed)
	report = app.app.conversations.commitConversationImport(context.Background(), userID, adapter, report)
	if report.Failed || report.Imported != 1 {
		t.Fatalf("conversation import = %+v, want one committed conversation", report)
	}
	assertSessionListNotification(t, changed)

	report, err = app.app.conversations.previewConversationImport(context.Background(), userID, adapter)
	if err != nil || report.Duplicates != 1 {
		t.Fatalf("duplicate import preview = %+v, %v", report, err)
	}
	report = app.app.conversations.commitConversationImport(context.Background(), userID, adapter, report)
	if report.Failed {
		t.Fatalf("duplicate import failed: %+v", report)
	}
	assertNoSessionListNotification(t, changed)
}

type sessionListEventTestWriter struct {
	*httptest.ResponseRecorder
	eventWritten chan struct{}
}

func (writer *sessionListEventTestWriter) Write(payload []byte) (int, error) {
	count, err := writer.ResponseRecorder.Write(payload)
	if strings.Contains(string(payload), "data: {}\n\n") {
		select {
		case writer.eventWritten <- struct{}{}:
		default:
		}
	}
	return count, err
}

func (writer *sessionListEventTestWriter) Flush() {
	writer.ResponseRecorder.Flush()
}

func TestSessionListEventsRequireAuthenticationAndStopWithRuntime(t *testing.T) {
	app := newTestApp(t, nil)
	unauthenticated := performJSONRequest(t, app.handler, http.MethodGet, "/api/me/sessions/events", nil, nil)
	assertStatusCode(t, unauthenticated, http.StatusUnauthorized)

	cookie := signupAndRequireCookie(t, app, "session-list-stream@example.invalid")
	var userID string
	if err := app.app.db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "http://localhost/api/me/sessions/events", nil)
	request.AddCookie(cookie)
	response := &sessionListEventTestWriter{
		ResponseRecorder: httptest.NewRecorder(),
		eventWritten:     make(chan struct{}, 1),
	}
	done := make(chan struct{})
	go func() {
		app.handler.ServeHTTP(response, request)
		close(done)
	}()

	waitForSessionListSubscriber(t, &app.app.conversations.sessionLists, userID)
	app.app.conversations.sessionLists.publish(userID)
	select {
	case <-response.eventWritten:
	case <-time.After(time.Second):
		t.Fatal("session-list SSE stream did not write a change hint")
	}

	app.app.Stop()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("session-list SSE stream did not stop with the runtime")
	}
	if got := response.Header().Get("Content-Type"); got != "text/event-stream; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want event stream", got)
	}
	if !strings.Contains(response.Body.String(), "data: {}\n\n") {
		t.Fatalf("session-list SSE body = %q, want a change hint", response.Body.String())
	}
	if count := sessionListSubscriberCount(&app.app.conversations.sessionLists, userID); count != 0 {
		t.Fatalf("subscriber count after shutdown = %d, want 0", count)
	}
}

func assertSessionListNotification(t *testing.T, changed <-chan struct{}) {
	t.Helper()
	select {
	case <-changed:
	case <-time.After(time.Second):
		t.Fatal("expected a committed session-list notification")
	}
}

func assertNoSessionListNotification(t *testing.T, changed <-chan struct{}) {
	t.Helper()
	select {
	case <-changed:
		t.Fatal("received a session-list notification without a committed change")
	default:
	}
}

func waitForSessionListSubscriber(t *testing.T, broker *sessionListNotifications, userID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if sessionListSubscriberCount(broker, userID) > 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("session-list SSE handler did not subscribe")
}

func sessionListSubscriberCount(broker *sessionListNotifications, userID string) int {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	return len(broker.subscribers[userID])
}
