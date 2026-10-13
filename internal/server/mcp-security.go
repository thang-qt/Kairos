package server

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

const mcpResponseLimit = 2 << 20

var errMCPAuth = errors.New("MCP credentials were rejected or expired; replace the bearer token")
var errMCPRemote = errors.New("MCP connection failed; check the endpoint, credentials and server availability")
var errMCPNotFound = errors.New("MCP server or tool not found")

func validateMCPEndpoint(value string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("MCP endpoint must be an HTTPS URL without credentials, query or fragment")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return nil, errors.New("local MCP endpoints are not allowed")
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicMCPAddress(ip) {
		return nil, errors.New("private MCP endpoints are not allowed")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, errors.New("invalid MCP port")
		}
	}
	return u, nil
}

func publicMCPAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "168.63.129.16/32", "64:ff9b:1::/48", "fec0::/10", "100::/64", "2001:db8::/32", "2001::/32", "2002::/16", "64:ff9b::/96"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

type mcpSafeTransport struct {
	mu            sync.Mutex
	httpTransport *http.Transport
	roundTrip     func(*http.Request, *http.Transport) (*http.Response, error)
	endpoint      *url.URL
	token         string
	resolve       func(context.Context, string) ([]netip.Addr, error)
}

func (transport *mcpSafeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != transport.endpoint.Scheme || !strings.EqualFold(request.URL.Host, transport.endpoint.Host) {
		return nil, errors.New("MCP cross-origin requests are blocked")
	}
	resolve := transport.resolve
	if resolve == nil {
		resolve = func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}
	}
	addresses, err := resolve(request.Context(), request.URL.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errMCPRemote
	}
	for _, address := range addresses {
		if !publicMCPAddress(address) {
			return nil, errors.New("MCP DNS resolved to a blocked address")
		}
	}
	// Pin the validated address even when a configured proxy performs CONNECT.
	// Keep the original HTTP Host and TLS identity; never let the proxy re-resolve the untrusted hostname.
	clone := request.Clone(request.Context())
	u := *request.URL
	port := request.URL.Port()
	if port == "" {
		port = "443"
	}
	u.Host = net.JoinHostPort(addresses[0].String(), port)
	clone.URL = &u
	clone.Host = request.URL.Host
	clone.Header = clone.Header.Clone()
	clone.Header.Del("Authorization")
	if transport.token != "" {
		clone.Header.Set("Authorization", "Bearer "+transport.token)
	}
	transport.mu.Lock()
	if transport.httpTransport == nil {
		transport.httpTransport = http.DefaultTransport.(*http.Transport).Clone()
		transport.httpTransport.TLSClientConfig = &tls.Config{ServerName: transport.endpoint.Hostname(), MinVersion: tls.VersionTLS12}
		transport.httpTransport.MaxIdleConnsPerHost = 4
	}
	httpTransport := transport.httpTransport
	transport.mu.Unlock()

	var response *http.Response
	if transport.roundTrip != nil {
		response, err = transport.roundTrip(clone, httpTransport)
	} else {
		response, err = httpTransport.RoundTrip(clone)
	}
	if err != nil {
		httpTransport.CloseIdleConnections()
		return nil, errMCPRemote
	}
	if response.StatusCode == 401 || response.StatusCode == 403 {
		response.Body.Close()
		httpTransport.CloseIdleConnections()
		return nil, errMCPAuth
	}
	response.Body = &mcpLimitedBody{ReadCloser: response.Body, remaining: mcpResponseLimit, cleanup: func() {}}
	return response, nil
}

type mcpLimitedBody struct {
	io.ReadCloser
	remaining int
	cleanup   func()
}

func (body *mcpLimitedBody) Read(p []byte) (int, error) {
	if body.remaining <= 0 {
		var probe [1]byte
		n, err := body.ReadCloser.Read(probe[:])
		if n == 0 && err == io.EOF {
			return 0, io.EOF
		}
		return 0, errors.New("MCP response exceeded size limit")
	}
	if len(p) > body.remaining {
		p = p[:body.remaining]
	}
	n, err := body.ReadCloser.Read(p)
	body.remaining -= n
	return n, err
}
func (body *mcpLimitedBody) Close() error { err := body.ReadCloser.Close(); body.cleanup(); return err }

func redactMCP(value, token string) string {
	if token == "" {
		return value
	}
	for _, secret := range []string{token, url.QueryEscape(token), base64.StdEncoding.EncodeToString([]byte(token)), base64.RawURLEncoding.EncodeToString([]byte(token))} {
		value = strings.ReplaceAll(value, secret, "[redacted]")
	}
	return value
}

func (transport *mcpSafeTransport) CloseIdleConnections() {
	transport.mu.Lock()
	client := transport.httpTransport
	transport.mu.Unlock()
	if client != nil {
		client.CloseIdleConnections()
	}
}
