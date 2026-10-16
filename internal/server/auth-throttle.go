package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"
)

var errAuthBusy = errors.New("authentication service is busy")

const (
	maxConcurrentPasswordOps = 2
	maxAuthRateBuckets       = 8192
	maxArgonMemoryKiB        = 256 * 1024
	maxArgonIterations       = 10
	maxArgonParallelism      = 8
)

type authGuard struct {
	argonSlots chan struct{}
	rateMu     sync.Mutex
	rateMap    map[string]authRateBucket
}

type authRateBucket struct {
	tokens    float64
	updatedAt time.Time
	capacity  float64
	refill    float64
}

func newAuthGuard() *authGuard {
	return &authGuard{
		argonSlots: make(chan struct{}, maxConcurrentPasswordOps),
		rateMap:    make(map[string]authRateBucket),
	}
}

func (service *AuthService) hashPassword(password string) (string, error) {
	if !service.guard.acquireArgon() {
		return "", errAuthBusy
	}
	defer service.guard.releaseArgon()
	return hashPassword(password)
}

func (service *AuthService) verifyPassword(password string, encoded string) (bool, error) {
	if !service.guard.acquireArgon() {
		return false, errAuthBusy
	}
	defer service.guard.releaseArgon()
	return verifyPassword(password, encoded), nil
}

func (guard *authGuard) acquireArgon() bool {
	select {
	case guard.argonSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (guard *authGuard) releaseArgon() { <-guard.argonSlots }

func (guard *authGuard) allowAuthAttempt(ip string, email string) bool {
	keyEmail := normalizeEmail(email)
	if keyEmail == "" {
		keyEmail = "<empty>"
	}
	accountDigest := sha256.Sum256([]byte(keyEmail))
	keys := []authRateLimit{
		{key: "ip:" + strings.TrimSpace(ip), capacity: 60, refill: 60.0 / 60},
		{key: "account:" + hex.EncodeToString(accountDigest[:]), capacity: 12, refill: 12.0 / 900},
	}
	return guard.allowRateLimits(keys, time.Now())
}

type authRateLimit struct {
	key      string
	capacity float64
	refill   float64
}

func (guard *authGuard) allowRateLimits(limits []authRateLimit, now time.Time) bool {
	guard.rateMu.Lock()
	defer guard.rateMu.Unlock()
	guard.pruneRefilledBuckets(now)

	for _, limit := range limits {
		bucket, exists := guard.rateMap[limit.key]
		if !exists {
			continue
		}
		bucket = refillAuthBucket(bucket, limit, now)
		if bucket.tokens < 1 {
			guard.rateMap[limit.key] = bucket
			return false
		}
	}

	missing := 0
	for _, limit := range limits {
		if _, exists := guard.rateMap[limit.key]; !exists {
			missing++
		}
	}
	if len(guard.rateMap)+missing > maxAuthRateBuckets {
		return false
	}

	for _, limit := range limits {
		bucket, exists := guard.rateMap[limit.key]
		if !exists {
			bucket = authRateBucket{tokens: limit.capacity, updatedAt: now, capacity: limit.capacity, refill: limit.refill}
		}
		bucket = refillAuthBucket(bucket, limit, now)
		bucket.tokens--
		guard.rateMap[limit.key] = bucket
	}
	return true
}

func refillAuthBucket(bucket authRateBucket, limit authRateLimit, now time.Time) authRateBucket {
	if elapsed := now.Sub(bucket.updatedAt).Seconds(); elapsed > 0 {
		bucket.tokens += elapsed * limit.refill
		if bucket.tokens > limit.capacity {
			bucket.tokens = limit.capacity
		}
		bucket.updatedAt = now
	}
	return bucket
}

func (guard *authGuard) pruneRefilledBuckets(now time.Time) {
	for key, bucket := range guard.rateMap {
		limit := authRateLimit{capacity: bucket.capacity, refill: bucket.refill}
		bucket = refillAuthBucket(bucket, limit, now)
		if bucket.tokens >= bucket.capacity {
			delete(guard.rateMap, key)
			continue
		}
		guard.rateMap[key] = bucket
	}
}

var dummyPasswordHash = func() string {
	hash, err := hashPassword("kairos-dummy-password-verification")
	if err != nil {
		panic("create dummy password hash: " + err.Error())
	}
	return hash
}()
