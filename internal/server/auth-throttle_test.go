package server

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthRateLimitRefillsAndSeparatesKeys(t *testing.T) {
	guard := newAuthGuard()
	now := time.Now()
	limits := []authRateLimit{{key: "ip:one", capacity: 2, refill: 1}}
	if !guard.allowRateLimits(limits, now) || !guard.allowRateLimits(limits, now) {
		t.Fatal("initial attempts were rejected")
	}
	if guard.allowRateLimits(limits, now) {
		t.Fatal("attempt over burst capacity was accepted")
	}
	if !guard.allowRateLimits([]authRateLimit{{key: "ip:two", capacity: 2, refill: 1}}, now) {
		t.Fatal("separate key was rejected")
	}
	if !guard.allowRateLimits(limits, now.Add(time.Second)) {
		t.Fatal("refilled attempt was rejected")
	}
}

func TestAuthAttemptsLimitAccountWithoutBlockingOtherAccounts(t *testing.T) {
	guard := newAuthGuard()
	for range 12 {
		if !guard.allowAuthAttempt("192.0.2.1", "one@example.invalid") {
			t.Fatal("attempt inside account burst limit was rejected")
		}
	}
	if guard.allowAuthAttempt("192.0.2.1", "one@example.invalid") {
		t.Fatal("attempt over account burst limit was accepted")
	}
	if !guard.allowAuthAttempt("192.0.2.2", "two@example.invalid") {
		t.Fatal("unrelated account and IP were blocked")
	}
}

func TestAuthRateLimitUsesPeerInsteadOfForwardedHeader(t *testing.T) {
	request := httptest.NewRequest("POST", "/api/auth/login", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	request.Header.Set("X-Forwarded-For", "198.51.100.42")
	if got := peerIP(request); got != "192.0.2.10" {
		t.Fatalf("peerIP() = %q, want the socket peer", got)
	}
}

func TestAuthRateBucketsStayBounded(t *testing.T) {
	guard := newAuthGuard()
	now := time.Now()
	for index := 0; index < maxAuthRateBuckets-1; index++ {
		key := "bucket:" + string(rune(index+1))
		refill := 0.5
		if index == 0 {
			key = "protected"
		}
		limits := []authRateLimit{{key: key, capacity: 1, refill: refill}}
		if !guard.allowRateLimits(limits, now) {
			t.Fatalf("first attempt for bucket %d was rejected", index)
		}
	}
	if !guard.allowRateLimits([]authRateLimit{{key: "last", capacity: 1, refill: 0.5}}, now) {
		t.Fatal("last available bucket was rejected")
	}
	if guard.allowRateLimits([]authRateLimit{{key: "untracked", capacity: 1, refill: 1}}, now) {
		t.Fatal("untracked identity was accepted while the map was full")
	}
	if guard.allowRateLimits([]authRateLimit{{key: "protected", capacity: 1, refill: 0.5}}, now.Add(time.Second)) {
		t.Fatal("active blocked bucket was evicted or reset")
	}
	if got := len(guard.rateMap); got != maxAuthRateBuckets {
		t.Fatalf("rate bucket count = %d, want %d", got, maxAuthRateBuckets)
	}
	if !guard.allowRateLimits([]authRateLimit{{key: "after-refill", capacity: 1, refill: 1}}, now.Add(2*time.Second)) {
		t.Fatal("fully refilled buckets were not pruned")
	}
	if got := len(guard.rateMap); got != 1 {
		t.Fatalf("rate bucket count after pruning = %d, want 1", got)
	}
}

func TestDisabledSignupDoesNotConsumeAccountRateLimit(t *testing.T) {
	app := newTestApp(t, func(config *Config) { config.AllowSignup = false })
	response := performJSONRequest(t, app.handler, "POST", "/api/auth/signup", authRequest{
		Email:    "victim@example.invalid",
		Password: "valid-password",
	}, nil)
	assertStatusCode(t, response, 403)
	if count := len(app.app.auth.guard.rateMap); count != 0 {
		t.Fatalf("disabled signup created %d rate buckets, want none", count)
	}
}

func TestPasswordWorkRejectsWhenMemorySlotsAreFull(t *testing.T) {
	service := NewAuthService(nil, Config{})
	for range maxConcurrentPasswordOps {
		service.guard.argonSlots <- struct{}{}
	}
	if _, err := service.hashPassword("a-valid-long-password"); err != errAuthBusy {
		t.Fatalf("hashPassword error = %v, want errAuthBusy", err)
	}
	if _, err := service.verifyPassword("password", dummyPasswordHash); err != errAuthBusy {
		t.Fatalf("verifyPassword error = %v, want errAuthBusy", err)
	}
}
