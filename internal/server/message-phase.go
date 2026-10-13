package server

func normalizeMessagePhase(phase string) string {
	switch phase {
	case "commentary", "final_answer":
		return phase
	}
	return ""
}

func appendTextSegment(segments []ProviderTextSegment, text, phase, itemID string) []ProviderTextSegment {
	phase = normalizeMessagePhase(phase)
	source := ""
	if phase != "" {
		source = "provider"
	}
	if len(segments) > 0 {
		last := &segments[len(segments)-1]
		if last.Phase == phase && last.ItemID == itemID {
			last.Text += text
			return segments
		}
	}
	return append(segments, ProviderTextSegment{Text: text, Phase: phase, PhaseSource: source, ItemID: itemID})
}

func resultTextSegments(result ChatGenerationResult) []ProviderTextSegment {
	if len(result.TextSegments) > 0 {
		return result.TextSegments
	}
	if result.OutputText != "" {
		return []ProviderTextSegment{{Text: result.OutputText}}
	}
	return nil
}

func deriveResultPhases(result *ChatGenerationResult) {
	result.TextSegments = append([]ProviderTextSegment(nil), resultTextSegments(*result)...)
	phase := "final_answer"
	if len(result.ToolCalls) > 0 {
		phase = "commentary"
	}
	for i := range result.TextSegments {
		segment := &result.TextSegments[i]
		if segment.Phase == "" {
			segment.Phase = phase
			segment.PhaseSource = "derived"
		}
	}
}
