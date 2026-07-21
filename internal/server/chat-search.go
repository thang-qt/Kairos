package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxSessionSearchQueryRunes = 200
	maxSessionSearchResults    = 20
	maxSessionSearchSnippet    = 240
)

var errSessionSearchQueryTooLong = errors.New("search query is too long")

type SessionSearchResult struct {
	Key          string `json:"key"`
	FriendlyID   string `json:"friendlyId"`
	Title        string `json:"title,omitempty"`
	DerivedTitle string `json:"derivedTitle,omitempty"`
	Label        string `json:"label,omitempty"`
	UpdatedAt    int64  `json:"updatedAt,omitempty"`
	MessageID    string `json:"messageId,omitempty"`
	Snippet      string `json:"snippet,omitempty"`
}

func (service *ChatService) SearchSessions(
	ctx context.Context,
	userID string,
	query string,
) ([]SessionSearchResult, error) {
	if utf8.RuneCountInString(query) > maxSessionSearchQueryRunes {
		return nil, errSessionSearchQueryTooLong
	}

	tokens := sessionSearchTokens(query)
	if len(tokens) == 0 {
		return []SessionSearchResult{}, nil
	}

	rows, err := service.db.QueryContext(ctx, `
		SELECT
			chat_sessions.id,
			chat_sessions.friendly_id,
			coalesce(chat_sessions.title, ''),
			coalesce(chat_sessions.derived_title, ''),
			coalesce(chat_sessions.label, ''),
			chat_sessions.updated_at,
			coalesce(
				nullif(trim(json_extract(
					CASE
						WHEN json_valid(chat_messages.message_json) THEN chat_messages.message_json
						ELSE '{}'
					END,
					'$.id'
				)), ''),
				chat_session_search.message_id
			),
			chat_session_search.document_kind,
			chat_session_search.content
		FROM chat_session_search
		JOIN chat_sessions ON chat_sessions.id = chat_session_search.session_id
		LEFT JOIN chat_messages ON chat_messages.id = chat_session_search.message_id
		WHERE
			chat_session_search.user_id = ? AND
			chat_session_search MATCH ?
		ORDER BY bm25(chat_session_search, 0.0, 0.0, 0.0, 0.0, 8.0, 1.0), chat_sessions.updated_at DESC, chat_sessions.id DESC
		LIMIT ?
	`, userID, sessionSearchFTSQuery(tokens), maxSessionSearchResults)
	if err != nil {
		return nil, fmt.Errorf("search sessions: %w", err)
	}
	defer rows.Close()

	results := make([]SessionSearchResult, 0, maxSessionSearchResults)
	for rows.Next() {
		var result SessionSearchResult
		var documentKind string
		var content string
		if err := rows.Scan(
			&result.Key,
			&result.FriendlyID,
			&result.Title,
			&result.DerivedTitle,
			&result.Label,
			&result.UpdatedAt,
			&result.MessageID,
			&documentKind,
			&content,
		); err != nil {
			return nil, fmt.Errorf("scan session search result: %w", err)
		}
		result.Snippet = sessionSearchSnippet(result, documentKind, content, tokens)
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate session search results: %w", err)
	}

	return results, nil
}

func sessionSearchTokens(query string) []string {
	tokens := make([]string, 0, 10)
	var current []rune
	for _, character := range strings.ToLower(query) {
		if unicode.IsLetter(character) || unicode.IsNumber(character) {
			if len(current) < 64 {
				current = append(current, character)
			}
			continue
		}
		if len(current) > 0 {
			tokens = append(tokens, string(current))
			current = nil
			if len(tokens) == 10 {
				return tokens
			}
		}
	}
	if len(current) > 0 && len(tokens) < 10 {
		tokens = append(tokens, string(current))
	}
	return tokens
}

func sessionSearchFTSQuery(tokens []string) string {
	parts := make([]string, 0, len(tokens))
	for _, token := range tokens {
		parts = append(parts, `"`+token+`"*`)
	}
	return strings.Join(parts, " AND ")
}

func sessionSearchSnippet(
	result SessionSearchResult,
	documentKind string,
	content string,
	tokens []string,
) string {
	if documentKind == "title" {
		title := strings.Join([]string{result.Label, result.Title, result.DerivedTitle}, " ")
		return boundedSearchSnippet(title, tokens)
	}
	return boundedSearchSnippet(content, tokens)
}

func boundedSearchSnippet(value string, tokens []string) string {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return ""
	}

	lowerValue := strings.ToLower(value)
	matchIndex := -1
	for _, token := range tokens {
		if index := strings.Index(lowerValue, token); index >= 0 {
			matchIndex = index
			break
		}
	}
	if matchIndex < 0 {
		return truncateSearchSnippet(value, maxSessionSearchSnippet)
	}

	start := matchIndex - 80
	if start < 0 {
		start = 0
	}
	end := matchIndex + maxSessionSearchSnippet - 80
	if end > len(value) {
		end = len(value)
	}
	for start > 0 && !utf8.RuneStart(value[start]) {
		start--
	}
	for end < len(value) && !utf8.RuneStart(value[end]) {
		end--
	}

	prefix := ""
	if start > 0 {
		prefix = "…"
	}
	suffix := ""
	if end < len(value) {
		suffix = "…"
	}
	return prefix + value[start:end] + suffix
}

func truncateSearchSnippet(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit]) + "…"
}
