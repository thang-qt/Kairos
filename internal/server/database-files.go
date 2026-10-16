package server

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func prepareDatabaseFiles(databasePath string) error {
	filename, err := databaseFilename(databasePath)
	if err != nil || filename == "" {
		return err
	}
	directory := filepath.Dir(filename)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create db directory: %w", err)
	}
	// Existing parents may contain unrelated files. Do not change their mode,
	// while newly created database directories are private to the process owner.
	file, err := os.OpenFile(filename, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("create db file: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return fmt.Errorf("restrict db permissions: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close db file: %w", err)
	}
	// SQLite derives permissions for newly created sidecars from the main file.
	// Tighten sidecars left by earlier versions before SQLite opens them.
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if err := os.Chmod(filename+suffix, 0o600); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("restrict db sidecar permissions: %w", err)
		}
	}
	return nil
}

func databaseFilename(databasePath string) (string, error) {
	if databasePath == ":memory:" {
		return "", nil
	}
	if !strings.HasPrefix(databasePath, "file:") {
		return databasePath, nil
	}
	parsed, err := url.Parse(databasePath)
	if err != nil {
		return "", fmt.Errorf("parse database path: %w", err)
	}
	if parsed.Query().Get("mode") == "memory" || parsed.Opaque == ":memory:" {
		return "", nil
	}
	if parsed.Host != "" && parsed.Host != "localhost" {
		return "", fmt.Errorf("database file URI must refer to the local host")
	}
	if parsed.Path != "" {
		return parsed.Path, nil
	}
	filename, err := url.PathUnescape(parsed.Opaque)
	if err != nil {
		return "", fmt.Errorf("parse database filename: %w", err)
	}
	return filename, nil
}
