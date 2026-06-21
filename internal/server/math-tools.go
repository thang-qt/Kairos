package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const (
	mathEvalToolName = "math_eval"
	mathJSAPIURL     = "https://api.mathjs.org/v4/"
)

func buildMathTools() []ProviderTool {
	return []ProviderTool{
		{
			Name:        mathEvalToolName,
			Description: "Evaluate a mathematical expression using the math.js web service. Useful for arithmetic, algebraic expressions, units, matrices, complex numbers, and common math functions. The expression must be self-contained.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"expr":      map[string]any{"type": "string", "description": "The math.js expression to evaluate, for example: 2*(7-3), 5.08 cm in inch, sin(45 deg)^2, det([-1, 2; 3, 1])."},
					"precision": map[string]any{"type": "integer", "description": "Optional number of significant digits in the formatted output.", "minimum": 1, "maximum": 64},
				},
				"required": []string{"expr"},
			},
		},
	}
}

func (runtime *WebToolRuntime) evalMathJS(ctx context.Context, expr string, precision int) (WebToolResult, error) {
	if strings.TrimSpace(expr) == "" {
		return WebToolResult{}, errors.New("math_eval expr is required")
	}
	payload := map[string]any{"expr": expr}
	if precision > 0 {
		payload["precision"] = clampInt(precision, 1, 64)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return WebToolResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, mathJSAPIURL, bytes.NewReader(body))
	if err != nil {
		return WebToolResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := runtime.httpClient.Do(request)
	if err != nil {
		return WebToolResult{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil {
		return WebToolResult{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return WebToolResult{}, fmt.Errorf("math.js API error (%s): %s", response.Status, strings.TrimSpace(string(data)))
	}
	var decoded mathJSResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return WebToolResult{}, fmt.Errorf("decode math.js response: %w", err)
	}
	if strings.TrimSpace(decoded.Error) != "" {
		return WebToolResult{}, errors.New(strings.TrimSpace(decoded.Error))
	}
	if decoded.Result == nil {
		return WebToolResult{}, errors.New("math.js returned no result")
	}
	result := stringFromAny(decoded.Result)
	if result == "" {
		encodedResult, _ := json.Marshal(decoded.Result)
		result = string(encodedResult)
	}
	output := map[string]any{"expr": expr, "result": result}
	if precision > 0 {
		output["precision"] = clampInt(precision, 1, 64)
	}
	content, _ := json.Marshal(output)
	return WebToolResult{Content: string(content), Details: output}, nil
}

type mathJSResponse struct {
	Result any    `json:"result"`
	Error  string `json:"error"`
}
