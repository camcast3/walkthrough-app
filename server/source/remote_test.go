package source

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"walkthrough-server/store"
)

func TestRemoteSourceEvict_RemovesFromMemory(t *testing.T) {
	s := NewRemoteSource(RemoteConfig{})
	s.byID["wt1"] = []byte(`{"id":"wt1"}`)
	s.byID["wt2"] = []byte(`{"id":"wt2"}`)

	s.Evict("wt1")

	if _, ok := s.byID["wt1"]; ok {
		t.Error("expected wt1 to be evicted from in-memory cache")
	}
	if _, ok := s.byID["wt2"]; !ok {
		t.Error("expected wt2 to remain in in-memory cache")
	}
}

func TestRemoteSourceEvict_UpdatesDiskCache(t *testing.T) {
	dir := t.TempDir()
	s := NewRemoteSource(RemoteConfig{CacheDir: dir})
	s.metas = []store.WalkthroughMeta{
		{ID: "wt1", Game: "G1", Title: "T1"},
		{ID: "wt2", Game: "G2", Title: "T2"},
	}
	s.byID["wt1"] = []byte(`{"id":"wt1"}`)
	s.byID["wt2"] = []byte(`{"id":"wt2"}`)

	s.Evict("wt1")

	// Read the disk cache and verify wt1 is absent.
	data, err := os.ReadFile(filepath.Join(dir, "remote-walkthrough-cache.json"))
	if err != nil {
		t.Fatalf("cache file not written: %v", err)
	}
	var cache remoteDiskCache
	if err := json.Unmarshal(data, &cache); err != nil {
		t.Fatalf("decode cache: %v", err)
	}
	if _, ok := cache.Items["wt1"]; ok {
		t.Error("expected wt1 to be absent from disk cache after eviction")
	}
	if _, ok := cache.Items["wt2"]; !ok {
		t.Error("expected wt2 to remain in disk cache")
	}
}

func TestRemoteSourceEvict_NoCacheDir(t *testing.T) {
	// Evict should not panic when no cache directory is configured.
	s := NewRemoteSource(RemoteConfig{})
	s.byID["wt1"] = []byte(`{"id":"wt1"}`)
	s.Evict("wt1") // must not panic
	if _, ok := s.byID["wt1"]; ok {
		t.Error("expected wt1 to be evicted from in-memory cache even without a cache dir")
	}
}

// newFakeServer creates an httptest.Server that serves a minimal walkthrough
// list and individual walkthrough content.
func newFakeServer(t *testing.T, metas []store.WalkthroughMeta) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/walkthroughs" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(metas)
			return
		}
		// /api/walkthroughs/{id}
		for _, m := range metas {
			if r.URL.Path == "/api/walkthroughs/"+m.ID {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]string{"id": m.ID})
				return
			}
		}
		http.NotFound(w, r)
	}))
}

func TestRemoteSourceRefresh_DropsUncheckedCache(t *testing.T) {
	metas := []store.WalkthroughMeta{
		{ID: "wt1", Game: "G1", Title: "T1"},
		{ID: "wt2", Game: "G2", Title: "T2"},
	}
	srv := newFakeServer(t, metas)
	defer srv.Close()

	checkedOutWt2Only := func() ([]string, error) { return []string{"wt2"}, nil }
	s := NewRemoteSource(RemoteConfig{
		ServerURL:    srv.URL,
		CheckedOutFn: checkedOutWt2Only,
	})
	// Pre-populate both walkthroughs as if they were cached previously.
	s.byID["wt1"] = []byte(`{"id":"wt1"}`)
	s.byID["wt2"] = []byte(`{"id":"wt2"}`)

	if err := s.refresh(context.Background()); err != nil {
		t.Fatalf("refresh failed: %v", err)
	}

	// wt1 is not checked out — it should be dropped from the cache.
	if _, ok := s.byID["wt1"]; ok {
		t.Error("expected wt1 (not checked out) to be dropped from cache after refresh")
	}
	// wt2 is checked out — it should remain in the cache.
	if _, ok := s.byID["wt2"]; !ok {
		t.Error("expected wt2 (checked out) to remain in cache after refresh")
	}
}
