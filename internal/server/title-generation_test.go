package server

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeGeneratedSessionTitleTruncatesAtUTF8Boundary(t *testing.T) {
	input := strings.Repeat("a", 79) + "é" + "tail"
	got := normalizeGeneratedSessionTitle(input)
	if got != strings.Repeat("a", 79) {
		t.Fatalf("normalized title = %q, want 79 ASCII characters", got)
	}
	if !utf8.ValidString(got) {
		t.Fatalf("normalized title is invalid UTF-8: %q", got)
	}
}
