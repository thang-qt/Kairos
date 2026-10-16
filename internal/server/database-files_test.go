package server

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDatabaseFilesArePrivateBeforeAndAfterSQLiteOpens(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission bits do not describe Windows ACLs")
	}
	directory := filepath.Join(t.TempDir(), "private")
	databasePath := filepath.Join(directory, "kairos.db")
	if err := prepareDatabaseFiles(databasePath); err != nil {
		t.Fatal(err)
	}
	assertDatabaseFileMode(t, directory, 0o700)
	assertDatabaseFileMode(t, databasePath, 0o600)

	app := newTestApp(t, func(config *Config) {
		config.DBPath = databasePath
	})
	if _, err := app.app.db.Exec(`CREATE TABLE permission_test(value TEXT)`); err != nil {
		t.Fatal(err)
	}
	for _, filename := range []string{databasePath, databasePath + "-wal", databasePath + "-shm"} {
		assertDatabaseFileMode(t, filename, 0o600)
	}
}

func TestExistingDatabaseAndSidecarsLosePublicPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission bits do not describe Windows ACLs")
	}
	directory := t.TempDir()
	databasePath := filepath.Join(directory, "kairos.db")
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		filename := databasePath + suffix
		if err := os.WriteFile(filename, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := prepareDatabaseFiles(databasePath); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		assertDatabaseFileMode(t, databasePath+suffix, 0o600)
	}
}

func TestExistingDatabaseParentPermissionsRemainUnchanged(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission bits do not describe Windows ACLs")
	}
	directory := t.TempDir()
	if err := os.Chmod(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := prepareDatabaseFiles(filepath.Join(directory, "kairos.db")); err != nil {
		t.Fatal(err)
	}
	assertDatabaseFileMode(t, directory, 0o755)
}

func TestDatabaseFilenameResolvesSQLiteURIs(t *testing.T) {
	for input, expected := range map[string]string{
		":memory:":                      "",
		"file::memory:?cache=shared":    "",
		"file:temporary?mode=memory":    "",
		"file:relative.db?cache=shared": "relative.db",
		"file:///tmp/kairos%20data.db":  "/tmp/kairos data.db",
		"file:/tmp/kairos.db?mode=rwc":  "/tmp/kairos.db",
		"/tmp/private/kairos.db":        "/tmp/private/kairos.db",
	} {
		actual, err := databaseFilename(input)
		if err != nil || actual != expected {
			t.Errorf("databaseFilename(%q) = %q, %v; want %q", input, actual, err, expected)
		}
	}
}

func assertDatabaseFileMode(t *testing.T, filename string, expected os.FileMode) {
	t.Helper()
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatal(err)
	}
	if actual := info.Mode().Perm(); actual != expected {
		t.Fatalf("%s permissions = %o, want %o", filename, actual, expected)
	}
}
