package source

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
	"walkthrough-server/store"
)

// RemoteSource fetches walkthroughs from another walkthrough-server instance.
// Used in client mode — the handheld pulls content from the k8s server.
type RemoteSource struct {
	ServerURL    string
	Interval     time.Duration
	CacheDir     string
	CheckedOutFn func() ([]string, error)

	mu      sync.RWMutex
	metas   []store.WalkthroughMeta
	byID    map[string][]byte
	etag    string // ETag from last list response for conditional refresh
	cancel  context.CancelFunc
	resetCh chan time.Duration // signals interval changes to the running loop
}

type RemoteConfig struct {
	ServerURL    string
	Interval     time.Duration
	CacheDir     string
	// CheckedOutFn, if non-nil, returns the IDs of walkthroughs to prefetch and
	// cache locally. Walkthroughs not in this list are still accessible on-demand
	// but will not be proactively downloaded. When nil, all walkthroughs are
	// prefetched (backward-compatible behaviour).
	CheckedOutFn func() ([]string, error)
}

func NewRemoteSource(cfg RemoteConfig) *RemoteSource {
	if cfg.Interval == 0 {
		cfg.Interval = 10 * time.Minute
	}
	return &RemoteSource{
		ServerURL:    cfg.ServerURL,
		Interval:     cfg.Interval,
		CacheDir:     cfg.CacheDir,
		CheckedOutFn: cfg.CheckedOutFn,
		byID:         make(map[string][]byte),
		resetCh:      make(chan time.Duration, 1),
	}
}

// ── Thread-safe accessors ─────────────────────────────────────────────────────

func (s *RemoteSource) serverURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ServerURL
}

func (s *RemoteSource) cacheDir() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.CacheDir
}

func (s *RemoteSource) getInterval() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Interval
}

// GetServerURL returns the current remote server URL.
func (s *RemoteSource) GetServerURL() string { return s.serverURL() }

// GetCacheDir returns the current cache directory.
func (s *RemoteSource) GetCacheDir() string { return s.cacheDir() }

// GetInterval returns the current refresh interval.
func (s *RemoteSource) GetInterval() time.Duration { return s.getInterval() }

// SetServerURL updates the remote server URL at runtime.
func (s *RemoteSource) SetServerURL(url string) {
	s.mu.Lock()
	s.ServerURL = url
	s.mu.Unlock()
}

// SetCacheDir updates the local cache directory at runtime.
func (s *RemoteSource) SetCacheDir(dir string) {
	s.mu.Lock()
	s.CacheDir = dir
	s.mu.Unlock()
}

// SetInterval updates the refresh interval and resets the background ticker.
func (s *RemoteSource) SetInterval(d time.Duration) {
	s.mu.Lock()
	s.Interval = d
	s.mu.Unlock()
	// Non-blocking send; drain stale value first if channel is full.
	select {
	case s.resetCh <- d:
	default:
		select {
		case <-s.resetCh:
		default:
		}
		s.resetCh <- d
	}
}

// Refresh triggers an immediate re-fetch from the remote server.
// It is a no-op when no server URL is configured.
func (s *RemoteSource) Refresh(ctx context.Context) {
	if s.serverURL() == "" {
		return
	}
	go func() {
		if err := s.refresh(ctx); err != nil {
			log.Printf("[remote-source] manual refresh failed: %v", err)
		}
	}()
}

// Start loads disk cache, performs initial fetch, and starts background refresh.
func (s *RemoteSource) Start(ctx context.Context) {
	s.loadFromDisk()

	if s.serverURL() != "" {
		if err := s.refresh(ctx); err != nil {
			log.Printf("[remote-source] initial fetch failed (serving cached data if available): %v", err)
		}
	}

	rctx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	go s.refreshLoop(rctx)
}

func (s *RemoteSource) Close() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *RemoteSource) List() ([]store.WalkthroughMeta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.metas == nil {
		return []store.WalkthroughMeta{}, nil
	}
	return s.metas, nil
}

func (s *RemoteSource) Get(id string) ([]byte, error) {
	s.mu.RLock()
	data, ok := s.byID[id]
	s.mu.RUnlock()

	if ok {
		return data, nil
	}

	// Cache miss — try fetching directly from the server
	freshData, err := s.fetchWalkthrough(context.Background(), id)
	if err != nil {
		return nil, fmt.Errorf("walkthrough %q not found", id)
	}

	s.mu.Lock()
	s.byID[id] = freshData
	s.mu.Unlock()

	return freshData, nil
}

func (s *RemoteSource) refreshLoop(ctx context.Context) {
	ticker := time.NewTicker(s.getInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case d := <-s.resetCh:
			ticker.Reset(d)
		case <-ticker.C:
			if s.serverURL() == "" {
				continue
			}
			if err := s.refresh(ctx); err != nil {
				log.Printf("[remote-source] refresh failed (serving cached data): %v", err)
			}
		}
	}
}

func (s *RemoteSource) refresh(ctx context.Context) error {
	// Fetch the walkthrough list from the remote server
	metas, err := s.fetchList(ctx)
	if err != nil {
		return err
	}

	// If a checkout filter is configured, only prefetch checked-out walkthroughs.
	// The checkout list is re-evaluated on every refresh cycle, so newly checked-out
	// walkthroughs will be downloaded on the next cycle (interval set by
	// REMOTE_REFRESH_INTERVAL, default 10 min). Walkthroughs that are unchecked
	// between cycles keep their cached copy until it is evicted by the next refresh.
	// All walkthroughs remain discoverable via List(); only content prefetching is filtered.
	checkedOut := map[string]bool{}
	if s.CheckedOutFn != nil {
		ids, fnErr := s.CheckedOutFn()
		if fnErr != nil {
			log.Printf("[remote-source] checkout list unavailable, skipping content prefetch (metadata still updated; walkthroughs accessible on-demand): %v", fnErr)
			// Still update the metadata list so the catalog stays current.
			s.mu.Lock()
			s.metas = metas
			s.mu.Unlock()
			s.persistToDisk()
			log.Printf("[remote-source] refreshed metadata: %d walkthroughs from %s (0 content prefetched)", len(metas), s.ServerURL)
			return nil
		}
		for _, id := range ids {
			checkedOut[id] = true
		}
	}

	// Fetch full content for each walkthrough (or only checked-out ones).
	newByID := make(map[string][]byte, len(metas))
	for _, m := range metas {
		// When a checkout filter is active, skip walkthroughs not checked out.
		if s.CheckedOutFn != nil && !checkedOut[m.ID] {
			// Preserve any already-cached content so existing offline copies remain.
			s.mu.RLock()
			existing := s.byID[m.ID]
			s.mu.RUnlock()
			if existing != nil {
				newByID[m.ID] = existing
			}
			continue
		}

		// Reuse cached content if we already have it
		s.mu.RLock()
		existing := s.byID[m.ID]
		s.mu.RUnlock()

		if existing != nil {
			newByID[m.ID] = existing
			continue
		}

		data, fetchErr := s.fetchWalkthrough(ctx, m.ID)
		if fetchErr != nil {
			log.Printf("[remote-source] skip %s: %v", m.ID, fetchErr)
			continue
		}
		newByID[m.ID] = data
	}

	s.mu.Lock()
	s.metas = metas
	s.byID = newByID
	s.mu.Unlock()

	s.persistToDisk()
	log.Printf("[remote-source] refreshed: %d walkthroughs listed, %d cached from %s", len(metas), len(newByID), s.serverURL())
	return nil
}

func (s *RemoteSource) fetchList(ctx context.Context) ([]store.WalkthroughMeta, error) {
	surl := s.serverURL()
	if surl == "" {
		return nil, fmt.Errorf("server URL not configured")
	}
	url := surl + "/api/walkthroughs"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch list: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch list: status %d", resp.StatusCode)
	}

	var metas []store.WalkthroughMeta
	if err := json.NewDecoder(resp.Body).Decode(&metas); err != nil {
		return nil, fmt.Errorf("decode list: %w", err)
	}
	return metas, nil
}

func (s *RemoteSource) fetchWalkthrough(ctx context.Context, id string) ([]byte, error) {
	surl := s.serverURL()
	if surl == "" {
		return nil, fmt.Errorf("server URL not configured")
	}
	url := surl + "/api/walkthroughs/" + id
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch walkthrough %s: status %d", id, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// --- Disk cache for offline resilience ---

type remoteDiskCache struct {
	Metas []store.WalkthroughMeta `json:"metas"`
	Items map[string]json.RawMessage `json:"items"`
}

func (s *RemoteSource) cachePath() string {
	dir := s.cacheDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "remote-walkthrough-cache.json")
}

func (s *RemoteSource) persistToDisk() {
	path := s.cachePath()
	if path == "" {
		return
	}

	s.mu.RLock()
	cache := remoteDiskCache{
		Metas: s.metas,
		Items: make(map[string]json.RawMessage, len(s.byID)),
	}
	for id, data := range s.byID {
		cache.Items[id] = data
	}
	s.mu.RUnlock()

	data, err := json.Marshal(cache)
	if err != nil {
		log.Printf("[remote-source] persist failed: %v", err)
		return
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		log.Printf("[remote-source] persist mkdir failed: %v", err)
		return
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Printf("[remote-source] persist write failed: %v", err)
	}
}

func (s *RemoteSource) loadFromDisk() {
	path := s.cachePath()
	if path == "" {
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	var cache remoteDiskCache
	if err := json.Unmarshal(data, &cache); err != nil {
		log.Printf("[remote-source] corrupt cache file, ignoring: %v", err)
		return
	}

	s.mu.Lock()
	s.metas = cache.Metas
	s.byID = make(map[string][]byte, len(cache.Items))
	for id, raw := range cache.Items {
		s.byID[id] = raw
	}
	s.mu.Unlock()

	log.Printf("[remote-source] loaded %d walkthroughs from disk cache", len(cache.Items))
}
