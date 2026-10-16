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
	lastUsed  time.Time
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

	for _, limit := range limits {
		bucket, exists := guard.rateMap[limit.key]
		if !exists {
			guard.makeRateBucketRoom(now)
			bucket = authRateBucket{tokens: limit.capacity, updatedAt: now, lastUsed: now}
		}
		bucket = refillAuthBucket(bucket, limit, now)
		bucket.tokens--
		bucket.lastUsed = now
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
	bucket.lastUsed = now
	return bucket
}

func (guard *authGuard) makeRateBucketRoom(now time.Time) {
	if len(guard.rateMap) < maxAuthRateBuckets {
		return
	}
	cutoff := now.Add(-15 * time.Minute)
	for key, bucket := range guard.rateMap {
		if bucket.lastUsed.Before(cutoff) {
			delete(guard.rateMap, key)
		}
	}
	for len(guard.rateMap) >= maxAuthRateBuckets {
		var oldestKey string
		var oldest time.Time
		for key, bucket := range guard.rateMap {
			if oldestKey == "" || bucket.lastUsed.Before(oldest) {
				oldestKey = key
				oldest = bucket.lastUsed
			}
		}
		delete(guard.rateMap, oldestKey)
	}
}

var dummyPasswordHash = func() string {
	hash, err := hashPassword("kairos-dummy-password-verification")
	if err != nil {
		panic("create dummy password hash: " + err.Error())
	}
	return hash
}()
