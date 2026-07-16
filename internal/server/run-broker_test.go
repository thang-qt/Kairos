package server

import "testing"

func TestRunBrokerReplaysAfterCursor(t *testing.T) {
	broker := NewRunBroker()
	broker.Publish("session-1", ChatEvent{State: "delta", Message: map[string]any{"id": "m1"}})
	broker.Publish("session-1", ChatEvent{State: "final", Message: map[string]any{"id": "m2"}})

	channel, unsubscribe := broker.Subscribe("session-1", 1, ChatEvent{})
	defer unsubscribe()

	first := <-channel
	if first.State != "final" || first.Cursor != 2 {
		t.Fatalf("first replay = %#v, want final cursor 2", first)
	}
}

func TestRunBrokerQueuesReconcileBeforeRetainedTerminalReplay(t *testing.T) {
	broker := NewRunBroker()
	broker.Publish("session-1", ChatEvent{State: "final", RunID: "run-1"})
	channel, unsubscribe := broker.Subscribe("session-1", 0, ChatEvent{State: "reconcile", ActiveRunIDs: []string{"run-1"}})
	defer unsubscribe()

	if event := <-channel; event.State != "reconcile" || len(event.ActiveRunIDs) != 1 || event.ActiveRunIDs[0] != "run-1" {
		t.Fatalf("first event = %#v, want active reconcile before retained terminal", event)
	}
	if event := <-channel; event.State != "final" || event.RunID != "run-1" {
		t.Fatalf("second event = %#v, want retained terminal after reconcile", event)
	}
}

func TestRunBrokerDisconnectsSlowSubscriberInsteadOfDroppingEvent(t *testing.T) {
	broker := NewRunBroker()
	channel, _ := broker.Subscribe("session-1", 0, ChatEvent{})

	// Fill the subscriber buffer.
	for index := 0; index < cap(channel); index++ {
		broker.Publish("session-1", ChatEvent{State: "delta"})
	}
	broker.Publish("session-1", ChatEvent{State: "final"})

	for range channel {
	}
}
