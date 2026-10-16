package server

import "strings"

// Builders retain incoming chunks without copying the growing response for each
// token. Only checkpoints materialize the segment list used by the UI snapshot.
type generationTextBuffer struct {
	text     strings.Builder
	thinking strings.Builder
	segments []generationTextSegment
}
type generationTextSegment struct {
	metadata ProviderTextSegment
	suffix   *strings.Builder
}

func (buffer *generationTextBuffer) add(delta ChatGenerationDelta) {
	buffer.text.WriteString(delta.Text)
	buffer.thinking.WriteString(delta.Thinking)
	if delta.TextSegments != nil {
		buffer.segments = make([]generationTextSegment, len(delta.TextSegments))
		for i, segment := range delta.TextSegments {
			buffer.segments[i] = generationTextSegment{metadata: segment, suffix: &strings.Builder{}}
		}
	} else if delta.Text != "" {
		phase := normalizeMessagePhase(delta.Phase)
		if len(buffer.segments) == 0 || buffer.segments[len(buffer.segments)-1].metadata.Phase != phase || buffer.segments[len(buffer.segments)-1].metadata.ItemID != "" {
			source := ""
			if phase != "" {
				source = "provider"
			}
			buffer.segments = append(buffer.segments, generationTextSegment{metadata: ProviderTextSegment{Phase: phase, PhaseSource: source}, suffix: &strings.Builder{}})
		}
		buffer.segments[len(buffer.segments)-1].suffix.WriteString(delta.Text)
	}
}
func (buffer *generationTextBuffer) snapshotSegments() []ProviderTextSegment {
	result := make([]ProviderTextSegment, len(buffer.segments))
	for i, segment := range buffer.segments {
		result[i] = segment.metadata
		result[i].Text += segment.suffix.String()
	}
	return result
}
