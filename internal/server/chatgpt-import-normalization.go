package server

import (
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

var importedGPTSlug = regexp.MustCompile(`(?i)^(chatgpt|gpt)-([0-9][a-z0-9.]*)($|[-_])`)
var importedOSlug = regexp.MustCompile(`^o[0-9]+(?:[-_]|$)`)

func importedModelDisplayName(slug string) string {
	slug = strings.TrimSpace(slug)
	if importedGPTSlug.MatchString(slug) {
		parts := strings.FieldsFunc(slug, func(r rune) bool { return r == '-' || r == '_' })
		family := "GPT"
		if strings.EqualFold(parts[0], "chatgpt") {
			family = "ChatGPT"
		}
		result := family + "-" + parts[1]
		for _, part := range parts[2:] {
			result += " " + displayModelWord(part)
		}
		return result
	}
	if importedOSlug.MatchString(slug) {
		parts := strings.FieldsFunc(slug, func(r rune) bool { return r == '-' || r == '_' })
		for i := 1; i < len(parts); i++ {
			parts[i] = displayModelWord(parts[i])
		}
		return strings.Join(parts, " ")
	}
	// Unknown IDs may contain meaningful punctuation or proper names. Preserve them.
	return slug
}

func displayModelWord(word string) string {
	switch strings.ToLower(word) {
	case "gpt":
		return "GPT"
	case "api":
		return "API"
	case "codex":
		return "Codex"
	}
	runes := []rune(word)
	if len(runes) > 0 {
		runes[0] = unicode.ToUpper(runes[0])
	}
	return string(runes)
}

type exportedUITag struct {
	name        string
	attrs       string
	end         int
	closing     bool
	selfClosing bool
}

// JSX attribute expressions can contain >, quotes, and nested braces. Parse the
// token boundary without executing or evaluating any expression.
func readExportedUITag(text string, start int) (exportedUITag, bool) {
	if start >= len(text) || text[start] != '<' {
		return exportedUITag{}, false
	}
	i := start + 1
	tag := exportedUITag{}
	if i < len(text) && text[i] == '/' {
		tag.closing = true
		i++
	}
	nameStart := i
	for i < len(text) && ((text[i] >= 'a' && text[i] <= 'z') || (text[i] >= 'A' && text[i] <= 'Z') || (i > nameStart && ((text[i] >= '0' && text[i] <= '9') || text[i] == '-' || text[i] == '_' || text[i] == ':'))) {
		i++
	}
	if i == nameStart {
		return tag, false
	}
	tag.name = text[nameStart:i]
	attrStart := i
	depth := 0
	var quote byte
	for ; i < len(text); i++ {
		ch := text[i]
		if quote != 0 {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '"' || ch == '\'' || ch == '`' {
			quote = ch
			continue
		}
		if ch == '{' {
			depth++
		}
		if ch == '}' && depth > 0 {
			depth--
		}
		if ch == '>' && depth == 0 {
			tag.attrs = strings.TrimSpace(text[attrStart:i])
			tag.selfClosing = strings.HasSuffix(tag.attrs, "/")
			tag.end = i + 1
			return tag, true
		}
	}
	return tag, false
}

var exportedURLAttribute = regexp.MustCompile(`\b(?:url|href)\s*=\s*"([^"]*)"`)
var exportedTitleAttribute = regexp.MustCompile(`\btitle\s*=\s*"([^"]*)"`)
var exportedOpenURL = regexp.MustCompile(`GenUI\.openUrl\(\s*["']([^"']+)["']\s*\)`)

func safeExportedURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return ""
	}
	return value
}

func fenceExportedText(text string) string {
	fence := "```"
	for strings.Contains(text, fence) {
		fence += "`"
	}
	return "\n\n" + fence + "text\n" + strings.TrimSpace(text) + "\n" + fence + "\n\n"
}

func normalizeChatGPTMarkup(text string) string {
	var result strings.Builder
	for i := 0; i < len(text); {
		// Tilde fences are block code too, including an unfinished final block.
		if i == 0 || text[i-1] == '\n' {
			start := i
			for start < len(text) && start-i < 3 && text[start] == ' ' {
				start++
			}
			end := start
			for end < len(text) && text[end] == '~' {
				end++
			}
			if end-start >= 3 {
				stop := len(text)
				for line := end; line < len(text); {
					next := strings.IndexByte(text[line:], '\n')
					if next < 0 {
						break
					}
					line += next + 1
					close := line
					for close < len(text) && close-line < 3 && text[close] == ' ' {
						close++
					}
					markerStart := close
					for close < len(text) && text[close] == '~' {
						close++
					}
					if close-markerStart >= end-start {
						lineEnd := strings.IndexByte(text[close:], '\n')
						if lineEnd < 0 {
							lineEnd = len(text) - close
						}
						if strings.TrimSpace(text[close:close+lineEnd]) == "" {
							stop = close + lineEnd
							break
						}
					}
				}
				result.WriteString(text[i:stop])
				i = stop
				continue
			}
		}
		// Preserve inline code and fenced code examples verbatim.
		if text[i] == '`' {
			end := i
			for end < len(text) && text[end] == '`' {
				end++
			}
			marker := text[i:end]
			if close := strings.Index(text[end:], marker); close >= 0 {
				stop := end + close + len(marker)
				result.WriteString(text[i:stop])
				i = stop
				continue
			}
		}
		tag, ok := readExportedUITag(text, i)
		if !ok {
			result.WriteByte(text[i])
			i++
			continue
		}
		if tag.name == "Cite" && tag.selfClosing {
			result.WriteString("[ChatGPT citation unavailable]")
			i = tag.end
			continue
		}
		if tag.name == "Link" && tag.selfClosing {
			label := "Link"
			if match := exportedTitleAttribute.FindStringSubmatch(tag.attrs); match != nil {
				label = match[1]
			}
			href := ""
			if match := exportedURLAttribute.FindStringSubmatch(tag.attrs); match != nil {
				href = safeExportedURL(match[1])
			}
			if href != "" {
				result.WriteString("[" + strings.NewReplacer("[", "\\[", "]", "\\]").Replace(label) + "](<" + href + ">)")
			} else {
				result.WriteString(label)
			}
			i = tag.end
			continue
		}
		if tag.name == "box" && !tag.closing {
			block, end := exportedLayoutText(text, i)
			result.WriteString(fenceExportedText(block))
			i = end
			continue
		}
		// Unknown exported components are kept literally rather than disappearing
		// through Markdown's HTML sanitizer. Ordinary lowercase HTML is unchanged.
		if tag.selfClosing && tag.name[0] >= 'A' && tag.name[0] <= 'Z' {
			result.WriteString(fenceExportedText(text[i:tag.end]))
			i = tag.end
			continue
		}
		result.WriteString(text[i:tag.end])
		i = tag.end
	}
	return result.String()
}

func exportedLayoutText(text string, start int) (string, int) {
	var result strings.Builder
	depth := 0
	i := start
	for i < len(text) {
		tag, ok := readExportedUITag(text, i)
		if !ok {
			result.WriteByte(text[i])
			i++
			continue
		}
		if tag.name == "box" {
			if tag.closing {
				depth--
			} else if !tag.selfClosing {
				depth++
			}
		}
		switch tag.name {
		case "box", "row", "title", "text":
			result.WriteByte('\n')
		case "icon": // Decorative icons have no portable text representation.
		case "button":
			if tag.closing {
				result.WriteByte('\n')
			} else if match := exportedOpenURL.FindStringSubmatch(tag.attrs); match != nil {
				if href := safeExportedURL(match[1]); href != "" {
					result.WriteString("\n" + href + "\n")
				}
			}
		default:
			result.WriteString(text[i:tag.end])
		}
		i = tag.end
		if depth == 0 {
			return tidyExportedLayout(result.String()), i
		}
	}
	return tidyExportedLayout(result.String()), i
}

func tidyExportedLayout(text string) string {
	lines := []string{}
	for _, line := range strings.Split(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	return strings.Join(lines, "\n")
}
