package server

import (
	"context"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

func TestValidateProviderEndpointRequiresCleanHTTPSURL(t *testing.T) {
	for _, endpoint := range []string{
		"http://provider.example/v1",
		"https://user:password@provider.example/v1",
		"https://provider.example/v1?token=secret",
		"https://provider.example:70000/v1",
	} {
		if _, err := validateProviderEndpoint(endpoint); err == nil {
			t.Errorf("validateProviderEndpoint(%q) succeeded", endpoint)
		}
	}
}

func TestProviderSafeTransportPinsPublicAddressAndPreservesHost(t *testing.T) {
	endpoint, err := url.Parse("https://provider.example/v1")
	if err != nil {
		t.Fatal(err)
	}
	transport := &providerSafeTransport{
		endpoint: endpoint,
		resolve: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
		},
		roundTrip: func(request *http.Request, transport *http.Transport) (*http.Response, error) {
			if request.URL.Host != "8.8.8.8:443" {
				t.Errorf("pinned URL host = %q, want 8.8.8.8:443", request.URL.Host)
			}
			if request.Host != "provider.example" {
				t.Errorf("HTTP Host = %q, want provider.example", request.Host)
			}
			if transport.TLSClientConfig.ServerName != "provider.example" {
				t.Errorf("TLS server name = %q, want provider.example", transport.TLSClientConfig.ServerName)
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok"))}, nil
		},
	}
	request, err := http.NewRequest(http.MethodGet, "https://provider.example/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(request); err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
}

func TestProviderSafeTransportRejectsPrivateDNSAndCrossOrigin(t *testing.T) {
	endpoint, err := url.Parse("https://provider.example/v1")
	if err != nil {
		t.Fatal(err)
	}
	transport := &providerSafeTransport{
		endpoint: endpoint,
		resolve: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")}, nil
		},
	}
	request, _ := http.NewRequest(http.MethodGet, "https://provider.example/v1/models", nil)
	if _, err := transport.RoundTrip(request); err == nil {
		t.Fatal("RoundTrip() succeeded when DNS included a private address")
	}

	request, _ = http.NewRequest(http.MethodGet, "https://other.example/v1/models", nil)
	if _, err := transport.RoundTrip(request); err == nil {
		t.Fatal("RoundTrip() succeeded for a cross-origin request")
	}
}

func TestProviderHTTPClientBlocksRedirects(t *testing.T) {
	client, err := newProviderHTTPClient("https://provider.example/v1")
	if err != nil {
		t.Fatal(err)
	}
	transport := client.Transport.(*providerSafeTransport)
	transport.resolve = func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}
	requests := 0
	transport.roundTrip = func(*http.Request, *http.Transport) (*http.Response, error) {
		requests++
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"https://attacker.example/collect"}},
			Body:       io.NopCloser(strings.NewReader("")),
		}, nil
	}
	request, _ := http.NewRequest(http.MethodGet, "https://provider.example/v1/models", nil)
	if _, err := client.Do(request); err == nil {
		t.Fatal("Do() succeeded after a provider redirect")
	}
	if requests != 1 {
		t.Fatalf("transport requests = %d, want 1", requests)
	}
}

func TestProductionProviderServiceSecuresOnlyUserProviders(t *testing.T) {
	service := NewProviderService(nil, Config{AppEnv: "production"})
	driver := service.drivers[openAIProviderKind].(*OpenAICompatibleDriver)
	if !driver.secureUserProviders {
		t.Fatal("production provider driver did not enable user-provider restrictions")
	}
	if client := driver.httpClientForProvider(resolvedProvider{Record: ProviderRecord{Owner: "system"}, BaseURL: "http://127.0.0.1:9000/v1"}); client == nil {
		t.Fatal("system provider should retain its configured HTTP client")
	} else if client.Transport != nil {
		if _, ok := client.Transport.(*providerSafeTransport); ok {
			t.Fatal("admin-configured system provider should not receive the user-provider transport")
		}
	}
	if client := driver.httpClientForProvider(resolvedProvider{Record: ProviderRecord{Owner: "user"}, BaseURL: "https://127.0.0.1/v1"}); client == nil {
		t.Fatal("user provider should receive the production safe HTTP client")
	}
	if client := driver.httpClientForProvider(resolvedProvider{Record: ProviderRecord{Owner: "user"}, BaseURL: "http://127.0.0.1/v1"}); client == nil {
		t.Fatal("invalid user provider endpoint should fail closed")
	}
}
