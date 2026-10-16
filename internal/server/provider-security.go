package server

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

type providerSafeTransport struct {
	mu            sync.Mutex
	httpTransport *http.Transport
	endpoint      *url.URL
	resolve       func(context.Context, string) ([]netip.Addr, error)
	roundTrip     func(*http.Request, *http.Transport) (*http.Response, error)
}

func newProviderHTTPClient(endpoint string) (*http.Client, error) {
	u, err := validateProviderEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	return &http.Client{
		Transport: &providerSafeTransport{endpoint: u},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("provider redirects are blocked")
		},
	}, nil
}

func validateProviderEndpoint(value string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("custom provider endpoint must be an HTTPS URL without credentials, query or fragment")
	}
	if port := u.Port(); port != "" {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber < 1 || portNumber > 65535 {
			return nil, errors.New("custom provider endpoint has an invalid port")
		}
	}
	return u, nil
}

func (transport *providerSafeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != transport.endpoint.Scheme || !strings.EqualFold(request.URL.Host, transport.endpoint.Host) {
		return nil, errors.New("provider cross-origin requests are blocked")
	}
	resolve := transport.resolve
	if resolve == nil {
		resolve = func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}
	}
	addresses, err := resolve(request.Context(), request.URL.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("provider endpoint could not be safely resolved")
	}
	for _, address := range addresses {
		if !publicMCPAddress(address) {
			return nil, errors.New("provider endpoint resolved to a blocked address")
		}
	}

	// Pin the validated address while preserving the original Host header and TLS identity.
	clone := request.Clone(request.Context())
	requestURL := *request.URL
	port := request.URL.Port()
	if port == "" {
		port = "443"
	}
	requestURL.Host = net.JoinHostPort(addresses[0].String(), port)
	clone.URL = &requestURL
	clone.Host = request.URL.Host

	transport.mu.Lock()
	if transport.httpTransport == nil {
		transport.httpTransport = http.DefaultTransport.(*http.Transport).Clone()
		transport.httpTransport.TLSClientConfig = &tls.Config{ServerName: transport.endpoint.Hostname(), MinVersion: tls.VersionTLS12}
		transport.httpTransport.MaxIdleConnsPerHost = 4
	}
	httpTransport := transport.httpTransport
	transport.mu.Unlock()

	if transport.roundTrip != nil {
		return transport.roundTrip(clone, httpTransport)
	}
	return httpTransport.RoundTrip(clone)
}

func (transport *providerSafeTransport) CloseIdleConnections() {
	transport.mu.Lock()
	httpTransport := transport.httpTransport
	transport.mu.Unlock()
	if httpTransport != nil {
		httpTransport.CloseIdleConnections()
	}
}
