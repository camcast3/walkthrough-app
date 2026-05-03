// Package configstore provides lightweight, file-based persistence for runtime
// client-mode settings. Config is stored as a single JSON file on disk — no
// database required, and no background connections to maintain.
package configstore

import (
	"encoding/json"
	"os"
	"sync"
)

// Config holds all runtime-configurable settings for client mode.
// Zero/empty values mean "use the startup default"; they are omitted when
// writing the file so the file only records explicit overrides.
type Config struct {
	ServerURL       string `json:"serverUrl,omitempty"`
	RefreshInterval string `json:"refreshInterval,omitempty"`
	SyncInterval    string `json:"syncInterval,omitempty"`
	CacheDir        string `json:"cacheDir,omitempty"`
}

// Store reads and writes Config to a JSON file.
// All methods are safe for concurrent use.
type Store struct {
	path string
	mu   sync.RWMutex
	cfg  Config
}

// Open loads (or creates) the config file at path.
// If the file does not exist yet, an empty Config is returned — callers should
// treat that as "all defaults".
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// NewInMemory returns a Store that never reads or writes any file.
// Useful as a safe no-op fallback when the config file is inaccessible.
func NewInMemory() *Store {
	return &Store{} // empty path — load is a no-op, Set returns an error that the caller logs
}

// load reads the file into s.cfg. Must be called with mu held or before s is
// shared with other goroutines.
func (s *Store) load() error {
	if s.path == "" {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil // no file yet — defaults apply
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil // empty file — treat as no config
	}
	return json.Unmarshal(data, &s.cfg)
}

// Get returns a copy of the current config.
func (s *Store) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// Set atomically replaces the in-memory config and writes it to disk.
// Returns an error if the store has no path (in-memory only) or if the write fails.
func (s *Store) Set(cfg Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	if s.path == "" {
		return nil // in-memory store — changes are applied but not persisted
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0644)
}
