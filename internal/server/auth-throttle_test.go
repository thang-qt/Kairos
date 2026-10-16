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
	for index := 0; index < maxAuthRateBuckets+20; index++ {
		limits := []authRateLimit{{key: string(rune(index + 1)), capacity: 1, refill: 1}}
		if !guard.allowRateLimits(limits, now) {
			t.Fatalf("first attempt for bucket %d was rejected", index)
		}
	}
	if got := len(guard.rateMap); got > maxAuthRateBuckets {
		t.Fatalf("rate bucket count = %d, want at most %d", got, maxAuthRateBuckets)
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
