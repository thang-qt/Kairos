package server

import (
	"strings"
	"testing"
	"time"
)

func TestBuildEffectiveSystemPromptAppendsServerFallbackTime(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	prompt := buildEffectiveSystemPrompt("You are helpful.", nil, now, "", "")

	want := "You are helpful.\n\nRuntime context:\n- Current time: 2026-07-13 14:32:05 UTC (server fallback)."
	if prompt != want {
		t.Fatalf("effective prompt = %q, want %q", prompt, want)
	}
}

func TestBuildEffectiveSystemPromptPrefersBrowserTime(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	prompt := buildEffectiveSystemPrompt(
		"You are helpful.",
		nil,
		now,
		"2026-07-13T08:15:30.000Z",
		"America/New_York",
	)

	want := "You are helpful.\n\nRuntime context:\n- Current time: 2026-07-13 04:15:30 EDT (America/New_York, from the user's browser)."
	if prompt != want {
		t.Fatalf("effective prompt = %q, want %q", prompt, want)
	}
}

func TestBuildEffectiveSystemPromptAddsIdleGapAfterOneDay(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	history := []map[string]any{
		{"role": "assistant", "timestamp": int64(1710000000000)},
		{"role": "user", "timestamp": int64(1710000000000 + 49*60*60*1000)},
	}

	prompt := buildEffectiveSystemPrompt("", history, now, "", "")
	if !strings.Contains(prompt, "- The previous message in this chat was about 2 days ago.") {
		t.Fatalf("effective prompt = %q, want idle gap note", prompt)
	}
}

func TestBuildEffectiveSystemPromptOmitsShortIdleGap(t *testing.T) {
	now := time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC)
	history := []map[string]any{
		{"role": "assistant", "timestamp": int64(1710000000000)},
		{"role": "user", "timestamp": int64(1710000000000 + 23*60*60*1000)},
	}

	prompt := buildEffectiveSystemPrompt("", history, now, "", "")
	if strings.Contains(prompt, "previous message") {
		t.Fatalf("effective prompt = %q, want no idle gap note", prompt)
	}
}
