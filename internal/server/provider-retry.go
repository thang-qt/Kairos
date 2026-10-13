package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	openai "github.com/openai/openai-go/v3"
)

type ProviderHTTPError struct {
	StatusCode int
	Body       string
	Cause      error
}

func (err *ProviderHTTPError) Error() string {
	return fmt.Sprintf("Provider HTTP %d: %s", err.StatusCode, err.Body)
}

// Retry only before the first provider event and before any tool effects.
// Once output was observed, an incomplete attempt is surfaced to the user.
func generateWithRetry(ctx context.Context, driver ProviderDriver, provider resolvedProvider, request ChatGenerationRequest, allowRetry bool, onDelta func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
	for attempt := 0; ; attempt++ {
		observed := false
		result, err := driver.GenerateChatStream(ctx, provider, request, func(delta ChatGenerationDelta) error { observed = true; return onDelta(delta) })
		if err == nil || !allowRetry || observed || attempt >= 2 || ctx.Err() != nil || !retryableProviderError(err) {
			return result, err
		}
		timer := time.NewTimer(time.Duration(100*(1<<attempt)) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return result, ctx.Err()
		case <-timer.C:
		}
	}
}
func retryableProviderError(err error) bool {
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		return true
	}
	var provider *ProviderHTTPError
	if errors.As(err, &provider) {
		return provider.StatusCode == 429 || provider.StatusCode >= 500
	}
	var api *openai.Error
	if errors.As(err, &api) {
		return api.StatusCode == 429 || api.StatusCode >= 500
	}
	return false
}

func (err *ProviderHTTPError) Unwrap() error { return err.Cause }
func normalizeProviderHTTPError(err error) error {
	var api *openai.Error
	if errors.As(err, &api) {
		return &ProviderHTTPError{StatusCode: api.StatusCode, Body: api.Error(), Cause: err}
	}
	return err
}
