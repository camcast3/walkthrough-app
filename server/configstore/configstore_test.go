package configstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestNewInMemory(t *testing.T) {
	s := NewInMemory()

	cfg := s.Get()
	if cfg != (Config{}) {
		t.Errorf("expected zero Config from NewInMemory, got %+v", cfg)
	}

	want := Config{ServerURL: "http://example.com", SyncInterval: "30s"}
	if err := s.Set(want); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got := s.Get()
	if got != want {
		t.Errorf("Get after Set: got %+v, want %+v", got, want)
	}
}

func TestOpenNonExistentFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open non-existent path: %v", err)
	}

	cfg := s.Get()
	if cfg != (Config{}) {
		t.Errorf("expected zero Config for missing file, got %+v", cfg)
	}
}

func TestOpenExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	want := Config{
		ServerURL:    "http://server.example.com",
		SyncInterval: "30s",
	}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	got := s.Get()
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestSetPersists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	cfg := Config{ServerURL: "http://test.com", RefreshInterval: "5m"}
	if err := s.Set(cfg); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// Reload from disk and verify persistence.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after Set: %v", err)
	}
	got := s2.Get()
	if got != cfg {
		t.Errorf("reloaded config = %+v, want %+v", got, cfg)
	}
}

func TestConcurrentGetSet(t *testing.T) {
	s := NewInMemory()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = s.Get()
		}()
		go func() {
			defer wg.Done()
			_ = s.Set(Config{SyncInterval: "30s"})
		}()
	}
	wg.Wait()
}

// ── PowerSaverMode ────────────────────────────────────────────────────────────

func TestPowerSaverMode_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	// Enable PSM and persist.
	cfg := Config{PowerSaverMode: true}
	if err := s.Set(cfg); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// Reload and verify the flag survived.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after Set: %v", err)
	}
	if !s2.Get().PowerSaverMode {
		t.Error("expected PowerSaverMode=true after round-trip")
	}

	// Disable PSM — the flag should default back to false after reload.
	cfg.PowerSaverMode = false
	if err := s2.Set(cfg); err != nil {
		t.Fatalf("Set(false): %v", err)
	}
	s3, err := Open(path)
	if err != nil {
		t.Fatalf("Open after Set(false): %v", err)
	}
	if s3.Get().PowerSaverMode {
		t.Error("expected PowerSaverMode=false after setting to false")
	}
}
