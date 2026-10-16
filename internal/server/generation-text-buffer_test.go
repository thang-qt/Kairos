package server

import (
	"reflect"
	"strings"
	"testing"
)

func TestGenerationTextBufferPreservesPhasesAndSnapshotIsolation(t *testing.T) {
	var buffer generationTextBuffer
	buffer.add(ChatGenerationDelta{Text: "first", Thinking: "think", Phase: "commentary"})
	first := buffer.snapshotSegments()
	buffer.add(ChatGenerationDelta{Text: " second", Thinking: " more", Phase: "commentary"})
	buffer.add(ChatGenerationDelta{Text: "answer", Phase: "final_answer"})
	segments := buffer.snapshotSegments()
	if first[0].Text != "first" || len(segments) != 2 || segments[0].Text != "first second" || segments[1].Phase != "final_answer" || buffer.thinking.String() != "think more" {
		t.Fatalf("incorrect buffering: %+v %+v", first, segments)
	}
	replacement := []ProviderTextSegment{{Text: "authoritative", Phase: "final_answer", PhaseSource: "provider", ItemID: "item"}}
	buffer.add(ChatGenerationDelta{TextSegments: replacement})
	if !reflect.DeepEqual(buffer.snapshotSegments(), replacement) {
		t.Fatal("authoritative segment replacement lost metadata")
	}
}
func BenchmarkGenerationTextBuffer(b *testing.B) {
	chunk := strings.Repeat("x", 120)
	b.ReportAllocs()
	for b.Loop() {
		var buffer generationTextBuffer
		for range 5000 {
			buffer.add(ChatGenerationDelta{Text: chunk})
		}
		_ = buffer.snapshotSegments()
	}
}
