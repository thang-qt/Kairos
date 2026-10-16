package server

import (
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
)

func (app *App) withBrowserSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Security-Policy", app.contentSecurityPolicy())
		writer.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		writer.Header().Set("X-Frame-Options", "DENY")

		if !strings.HasPrefix(request.URL.Path, "/api/") || isSafeBrowserMethod(request.Method) || request.Method == http.MethodOptions {
			next.ServeHTTP(writer, request)
			return
		}

		if isJSONRequestRequired(request) && !hasJSONContentType(request) {
			writeError(writer, http.StatusUnsupportedMediaType, "Content-Type must be application/json.")
			return
		}

		if !app.isSameOriginBrowserRequest(request) {
			writeError(writer, http.StatusForbidden, "Cross-origin requests are not allowed.")
			return
		}

		next.ServeHTTP(writer, request)
	})
}

func (app *App) contentSecurityPolicy() string {
	scriptSource := "'self'"
	connectSources := "'self'"
	if app.config.AppEnv != "production" {
		// Vite injects its development entry point from index.html.
		scriptSource += " 'unsafe-inline'"
		connectSources += " ws: wss:"
	}
	return "default-src 'self'; " +
		"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
		"script-src " + scriptSource + "; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: blob:; font-src 'self' data:; " +
		"media-src 'self' data: blob:; worker-src 'self' blob:; " +
		"connect-src " + connectSources
}

func isSafeBrowserMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead
}

func isJSONRequestRequired(request *http.Request) bool {
	if request.Method == http.MethodDelete {
		return false
	}
	if request.Method == http.MethodPost && request.URL.Path == "/api/auth/logout" {
		return false
	}
	if request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/api/imports/") {
		return false
	}
	if request.Method == http.MethodPost && (strings.HasSuffix(request.URL.Path, "/test") || strings.HasSuffix(request.URL.Path, "/refresh-tools")) {
		return false
	}
	return request.Method == http.MethodPost || request.Method == http.MethodPut || request.Method == http.MethodPatch
}

func hasJSONContentType(request *http.Request) bool {
	contentTypes := request.Header.Values("Content-Type")
	if len(contentTypes) != 1 {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(contentTypes[0])
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func (app *App) isSameOriginBrowserRequest(request *http.Request) bool {
	fetchSites := request.Header.Values("Sec-Fetch-Site")
	if len(fetchSites) > 1 {
		return false
	}
	fetchSite := strings.ToLower(strings.TrimSpace(request.Header.Get("Sec-Fetch-Site")))
	if fetchSite != "" && fetchSite != "same-origin" && fetchSite != "same-site" && fetchSite != "none" {
		return false
	}

	origins := request.Header.Values("Origin")
	if len(origins) > 1 {
		return false
	}
	if origin := request.Header.Get("Origin"); origin != "" {
		return sameOrigin(origin, requestOrigin(request, app.config.CookieSecure))
	}

	// Browser requests from same-site sibling hosts carry Fetch Metadata even
	// when an Origin header is omitted. Reject that ambiguous cookie case. API
	// clients commonly omit both headers; their JSON content type is still
	// required above, which keeps HTML form submissions out of state changes.
	return !strings.EqualFold(strings.TrimSpace(request.Header.Get("Sec-Fetch-Site")), "same-site")
}

func requestOrigin(request *http.Request, cookieSecure bool) string {
	scheme := "http"
	if request.TLS != nil || request.URL.Scheme == "https" || cookieSecure {
		scheme = "https"
	} else if request.URL.Scheme == "http" {
		scheme = "http"
	}
	return scheme + "://" + request.Host
}

func sameOrigin(origin string, expected string) bool {
	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Scheme == "" || parsedOrigin.Host == "" || parsedOrigin.User != nil || parsedOrigin.Path != "" || parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
		return false
	}
	parsedExpected, err := url.Parse(expected)
	if err != nil || parsedExpected.Host == "" {
		return false
	}
	return canonicalOrigin(parsedOrigin) == canonicalOrigin(parsedExpected)
}

func canonicalOrigin(origin *url.URL) string {
	scheme := strings.ToLower(origin.Scheme)
	host := strings.ToLower(origin.Hostname())
	port := origin.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return scheme + "://" + host
}
