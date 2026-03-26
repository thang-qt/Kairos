package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

var errInvalidCredentials = errors.New("invalid credentials")
var errSignupDisabled = errors.New("signup is disabled")
var errAuthDisabled = errors.New("authentication is disabled")
var errSessionNotFound = errors.New("session not found")
var errUserNotFound = errors.New("user not found")

type User struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	Role       string `json:"role"`
	CreatedAt  int64  `json:"createdAt"`
	DisabledAt *int64 `json:"disabledAt,omitempty"`
}

type AuthService struct {
	db     *sql.DB
	config Config
}

type passwordHashParams struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

func NewAuthService(db *sql.DB, config Config) *AuthService {
	return &AuthService{db: db, config: config}
}

func (service *AuthService) BootstrapAdmin() error {
	if !service.config.BootstrapAdmin {
		return nil
	}

	var existingID string
	err := service.db.QueryRow(`SELECT id FROM users WHERE lower(email) = lower(?)`, service.config.AdminEmail).Scan(&existingID)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("lookup bootstrap admin: %w", err)
	}

	passwordHash := service.config.AdminPasswordHash
	if passwordHash == "" {
		hashed, err := hashPassword(service.config.AdminPassword)
		if err != nil {
			return fmt.Errorf("hash bootstrap admin password: %w", err)
		}
		passwordHash = hashed
	}

	now := time.Now().Unix()
	_, err = service.db.Exec(`
		INSERT INTO users(id, email, password_hash, role, created_at, updated_at)
		VALUES (?, ?, ?, 'admin', ?, ?)
	`, newID(), normalizeEmail(service.config.AdminEmail), passwordHash, now, now)
	if err != nil {
		return fmt.Errorf("create bootstrap admin: %w", err)
	}

	return nil
}

func (service *AuthService) Signup(ctx context.Context, email string, password string, requestMeta RequestMeta) (*User, string, time.Time, error) {
	if !service.config.AuthEnabled {
		return nil, "", time.Time{}, errAuthDisabled
	}
	if !service.config.AllowSignup {
		return nil, "", time.Time{}, errSignupDisabled
	}

	normalizedEmail := normalizeEmail(email)
	if err := validateCredentials(normalizedEmail, password); err != nil {
		return nil, "", time.Time{}, err
	}

	passwordHash, err := hashPassword(password)
	if err != nil {
		return nil, "", time.Time{}, err
	}

	now := time.Now()
	user := &User{
		ID:        newID(),
		Email:     normalizedEmail,
		Role:      "user",
		CreatedAt: now.Unix(),
	}

	_, err = service.db.ExecContext(ctx, `
		INSERT INTO users(id, email, password_hash, role, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, user.ID, user.Email, passwordHash, user.Role, user.CreatedAt, user.CreatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, "", time.Time{}, errors.New("email is already in use")
		}
		return nil, "", time.Time{}, err
	}

	token, expiresAt, err := service.createSession(ctx, user.ID, requestMeta)
	if err != nil {
		return nil, "", time.Time{}, err
	}

	return user, token, expiresAt, nil
}

func (service *AuthService) Login(ctx context.Context, email string, password string, requestMeta RequestMeta) (*User, string, time.Time, error) {
	if !service.config.AuthEnabled {
		return nil, "", time.Time{}, errAuthDisabled
	}

	type loginRow struct {
		ID           string
		Email        string
		PasswordHash string
		Role         string
		CreatedAt    int64
		DisabledAt   sql.NullInt64
	}

	var row loginRow
	err := service.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, role, created_at, disabled_at
		FROM users
		WHERE lower(email) = lower(?)
	`, normalizeEmail(email)).Scan(
		&row.ID,
		&row.Email,
		&row.PasswordHash,
		&row.Role,
		&row.CreatedAt,
		&row.DisabledAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", time.Time{}, errInvalidCredentials
		}
		return nil, "", time.Time{}, err
	}

	if row.DisabledAt.Valid {
		return nil, "", time.Time{}, errors.New("account is disabled")
	}
	if !verifyPassword(password, row.PasswordHash) {
		return nil, "", time.Time{}, errInvalidCredentials
	}

	user := &User{
		ID:        row.ID,
		Email:     row.Email,
		Role:      row.Role,
		CreatedAt: row.CreatedAt,
	}
	if row.DisabledAt.Valid {
		user.DisabledAt = &row.DisabledAt.Int64
	}

	token, expiresAt, err := service.createSession(ctx, user.ID, requestMeta)
	if err != nil {
		return nil, "", time.Time{}, err
	}

	return user, token, expiresAt, nil
}

func (service *AuthService) CurrentUser(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, errSessionNotFound
	}

	tokenHash := hashToken(token)
	var user User
	var disabledAt sql.NullInt64
	var sessionID string
	var expiresAt int64
	var lastSeenAt int64
	err := service.db.QueryRowContext(ctx, `
		SELECT s.id, s.expires_at, s.last_seen_at, u.id, u.email, u.role, u.created_at, u.disabled_at
		FROM auth_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ?
	`, tokenHash).Scan(
		&sessionID,
		&expiresAt,
		&lastSeenAt,
		&user.ID,
		&user.Email,
		&user.Role,
		&user.CreatedAt,
		&disabledAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errSessionNotFound
		}
		return nil, err
	}

	now := time.Now().Unix()
	if expiresAt <= now {
		_, _ = service.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE id = ?`, sessionID)
		return nil, errSessionNotFound
	}
	if disabledAt.Valid {
		return nil, errors.New("account is disabled")
	}

	if shouldRefreshLastSeen(now, lastSeenAt) {
		if _, err := service.db.ExecContext(ctx, `
			UPDATE auth_sessions
			SET last_seen_at = ?
			WHERE id = ?
		`, now, sessionID); err != nil && !isSQLiteBusyError(err) {
			return nil, err
		}
	}

	if disabledAt.Valid {
		user.DisabledAt = &disabledAt.Int64
	}

	return &user, nil
}

func shouldRefreshLastSeen(now int64, lastSeenAt int64) bool {
	if lastSeenAt <= 0 {
		return true
	}
	return now-lastSeenAt >= 60
}

func isSQLiteBusyError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToUpper(err.Error()), "SQLITE_BUSY")
}

func (service *AuthService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}

	_, err := service.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = ?`, hashToken(token))
	return err
}

func (service *AuthService) ChangeEmail(
	ctx context.Context,
	userID string,
	currentPassword string,
	nextEmail string,
) (*User, error) {
	normalizedEmail := normalizeEmail(nextEmail)
	if !strings.Contains(normalizedEmail, "@") || len(normalizedEmail) < 3 {
		return nil, errors.New("enter a valid email address")
	}

	type userRow struct {
		Email        string
		PasswordHash string
		Role         string
		CreatedAt    int64
		DisabledAt   sql.NullInt64
	}

	var row userRow
	err := service.db.QueryRowContext(ctx, `
		SELECT email, password_hash, role, created_at, disabled_at
		FROM users
		WHERE id = ?
	`, userID).Scan(
		&row.Email,
		&row.PasswordHash,
		&row.Role,
		&row.CreatedAt,
		&row.DisabledAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errUserNotFound
		}
		return nil, err
	}

	if row.DisabledAt.Valid {
		return nil, errors.New("account is disabled")
	}
	if !verifyPassword(currentPassword, row.PasswordHash) {
		return nil, errInvalidCredentials
	}
	if row.Email == normalizedEmail {
		return nil, errors.New("email is unchanged")
	}

	now := time.Now().Unix()
	_, err = service.db.ExecContext(ctx, `
		UPDATE users
		SET email = ?, updated_at = ?
		WHERE id = ?
	`, normalizedEmail, now, userID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("email is already in use")
		}
		return nil, err
	}

	user := &User{
		ID:        userID,
		Email:     normalizedEmail,
		Role:      row.Role,
		CreatedAt: row.CreatedAt,
	}
	if row.DisabledAt.Valid {
		user.DisabledAt = &row.DisabledAt.Int64
	}

	return user, nil
}

func (service *AuthService) ChangePassword(
	ctx context.Context,
	userID string,
	currentPassword string,
	nextPassword string,
	currentToken string,
) error {
	var existingHash string
	var disabledAt sql.NullInt64
	err := service.db.QueryRowContext(ctx, `
		SELECT password_hash, disabled_at
		FROM users
		WHERE id = ?
	`, userID).Scan(&existingHash, &disabledAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errUserNotFound
		}
		return err
	}

	if disabledAt.Valid {
		return errors.New("account is disabled")
	}
	if !verifyPassword(currentPassword, existingHash) {
		return errInvalidCredentials
	}
	if currentPassword == nextPassword {
		return errors.New("new password must be different")
	}

	nextHash, err := hashPassword(nextPassword)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	if _, err := transaction.ExecContext(ctx, `
		UPDATE users
		SET password_hash = ?, updated_at = ?
		WHERE id = ?
	`, nextHash, now, userID); err != nil {
		_ = transaction.Rollback()
		return err
	}

	if strings.TrimSpace(currentToken) != "" {
		if _, err := transaction.ExecContext(ctx, `
			DELETE FROM auth_sessions
			WHERE user_id = ? AND token_hash != ?
		`, userID, hashToken(currentToken)); err != nil {
			_ = transaction.Rollback()
			return err
		}
	} else {
		if _, err := transaction.ExecContext(ctx, `
			DELETE FROM auth_sessions
			WHERE user_id = ?
		`, userID); err != nil {
			_ = transaction.Rollback()
			return err
		}
	}

	return transaction.Commit()
}

type RequestMeta struct {
	IPAddress string
	UserAgent string
}

func (service *AuthService) createSession(ctx context.Context, userID string, requestMeta RequestMeta) (string, time.Time, error) {
	token, err := randomToken()
	if err != nil {
		return "", time.Time{}, err
	}

	sessionID := newID()
	now := time.Now()
	expiresAt := now.Add(service.config.SessionTTL)
	_, err = service.db.ExecContext(ctx, `
		INSERT INTO auth_sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, sessionID, userID, hashToken(token), now.Unix(), expiresAt.Unix(), now.Unix(), requestMeta.IPAddress, requestMeta.UserAgent)
	if err != nil {
		return "", time.Time{}, err
	}

	return token, expiresAt, nil
}

func hashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}

	params := passwordHashParams{
		Memory:      64 * 1024,
		Iterations:  3,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	}

	salt := make([]byte, params.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hash := argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength)
	return fmt.Sprintf(
		"argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		params.Memory,
		params.Iterations,
		params.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func verifyPassword(password string, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 {
		return false
	}
	if parts[0] != "argon2id" {
		return false
	}

	var version int
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[1], "v=%d", &version); err != nil || version != 19 {
		return false
	}
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}

	actualHash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expectedHash)))
	return subtleCompare(actualHash, expectedHash)
}

func subtleCompare(left []byte, right []byte) bool {
	if len(left) != len(right) {
		return false
	}

	var diff byte
	for index := range left {
		diff |= left[index] ^ right[index]
	}
	return diff == 0
}

func validateCredentials(email string, password string) error {
	if !strings.Contains(email, "@") || len(email) < 3 {
		return errors.New("enter a valid email address")
	}
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	return nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func newID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes)
}
