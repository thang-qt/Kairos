package server

import (
	"testing"
	"time"
)

func TestBuildEffectiveSystemPromptAppendsServerFallbackTime(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	prompt := buildEffectiveSystemPrompt("You are helpful.", "GPT-5", now, "", "")

	want := "You are an AI assistant in Kairos, a lightweight AI chat client.\n\nYou are helpful.\n\nRuntime context:\n- Current time: 2026-07-13 14:32:05 UTC (server fallback).\n- Current model: GPT-5."
	if prompt != want {
		t.Fatalf("effective prompt = %q, want %q", prompt, want)
	}
}

func TestBuildEffectiveSystemPromptPrefersBrowserTime(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	prompt := buildEffectiveSystemPrompt(
		"You are helpful.",
		"GPT-5",
		now,
		"2026-07-13T08:15:30.000Z",
		"America/New_York",
	)

	want := "You are an AI assistant in Kairos, a lightweight AI chat client.\n\nYou are helpful.\n\nRuntime context:\n- Current time: 2026-07-13 04:15:30 EDT (America/New_York, from the user's browser).\n- Current model: GPT-5."
	if prompt != want {
		t.Fatalf("effective prompt = %q, want %q", prompt, want)
	}
}
