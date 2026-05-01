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
	"strings"
	"sync"
	"time"
	"walkthrough-server/store"
)

// GitHubSource fetches walkthroughs from a GitHub repo using the Trees API.
// It caches content in memory and persists snapshots to disk for cold-start
// resilience when GitHub is unreachable.
type GitHubSource struct {
	Owner    string
	Repo     string
	Path     string // subdirectory in the repo (e.g. "walkthroughs")
	Branch   string
	Token    string // optional; increases rate limit from 60 to 5000/hr
	Interval time.Duration
	CacheDir string // directory for persisted cache snapshots

	mu        sync.RWMutex
	treeSHA   string // last fetched tree SHA for conditional refresh
	metas     []store.WalkthroughMeta
	byID      map[string][]byte // id -> raw JSON
	cancel    context.CancelFunc
}

type GitHubConfig struct {
	Owner    string
	Repo     string
	Path     string
	Branch   string
	Token    string
	Interval time.Duration
	CacheDir string
}

func NewGitHubSource(cfg GitHubConfig) *GitHubSource {
	if cfg.Branch == "" {
		cfg.Branch = "main"
	}
	if cfg.Path == "" {
		cfg.Path = "walkthroughs"
	}
	if cfg.Interval == 0 {
		cfg.Interval = 5 * time.Minute
	}
	return &GitHubSource{
		Owner:    cfg.Owner,
		Repo:     cfg.Repo,
		Path:     cfg.Path,
		Branch:   cfg.Branch,
		Token:    cfg.Token,
		Interval: cfg.Interval,
		CacheDir: cfg.CacheDir,
		byID:     make(map[string][]byte),
	}
}

// Start loads the cache from disk, performs an initial fetch, and starts
// the background refresh loop. Blocks until the first fetch completes.
func (s *GitHubSource) Start(ctx context.Context) {
	s.loadFromDisk()

	if err := s.refresh(ctx); err != nil {
		log.Printf("[github-source] initial fetch failed (serving cached data if available): %v", err)
	}

	rctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	go s.refreshLoop(rctx)
}

// Close stops the background refresh goroutine.
func (s *GitHubSource) Close() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *GitHubSource) List() ([]store.WalkthroughMeta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.metas == nil {
		return []store.WalkthroughMeta{}, nil
	}
	return s.metas, nil
}

func (s *GitHubSource) Get(id string) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("walkthrough %q not found", id)
	}
	return data, nil
}

func (s *GitHubSource) refreshLoop(ctx context.Context) {
	ticker := time.NewTicker(s.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.refresh(ctx); err != nil {
				log.Printf("[github-source] refresh failed (serving stale data): %v", err)
			}
		}
	}
}

// refresh fetches the tree for the configured path, compares the SHA, and
// downloads any changed files. Atomically swaps the cache on success.
func (s *GitHubSource) refresh(ctx context.Context) error {
	// Step 1: Get the tree SHA for the walkthroughs path via the branch ref.
	treeSHA, entries, err := s.fetchTree(ctx)
	if err != nil {
		return err
	}

	// Check if tree hasn't changed (conditional refresh)
	s.mu.RLock()
	unchanged := s.treeSHA == treeSHA && treeSHA != ""
	s.mu.RUnlock()
	if unchanged {
		return nil
	}

	// Step 2: Fetch content for all JSON files (excluding schema).
	newMetas := make([]store.WalkthroughMeta, 0, len(entries))
	newByID := make(map[string][]byte, len(entries))

	for _, entry := range entries {
		if entry.Type != "blob" {
			continue
		}
		name := filepath.Base(entry.Path)
		if !strings.HasSuffix(name, ".json") || name == "walkthrough.schema.json" {
			continue
		}

		data, fetchErr := s.fetchBlob(ctx, entry.URL)
		if fetchErr != nil {
			log.Printf("[github-source] skip %s: %v", entry.Path, fetchErr)
			continue
		}

		meta, parseErr := store.ParseMetaFromJSON(data)
		if parseErr != nil || meta.ID == "" {
			continue
		}

		newMetas = append(newMetas, *meta)
		newByID[meta.ID] = data
	}

	// Step 3: Atomic swap — only if we got at least one walkthrough.
	if len(newByID) == 0 && len(entries) > 0 {
		return fmt.Errorf("fetched %d tree entries but parsed 0 walkthroughs", len(entries))
	}

	s.mu.Lock()
	s.treeSHA = treeSHA
	s.metas = newMetas
	s.byID = newByID
	s.mu.Unlock()

	s.persistToDisk()
	log.Printf("[github-source] refreshed: %d walkthroughs (tree: %s)", len(newByID), treeSHA[:8])
	return nil
}

// --- GitHub API types ---

type ghTreeResponse struct {
	SHA       string        `json:"sha"`
	Tree      []ghTreeEntry `json:"tree"`
	Truncated bool          `json:"truncated"`
}

type ghTreeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"` // "blob" or "tree"
	SHA  string `json:"sha"`
	URL  string `json:"url"` // blob API URL for fetching content
}

type ghBlobResponse struct {
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

// fetchTree uses the Git Trees API to get all files under the walkthroughs path.
func (s *GitHubSource) fetchTree(ctx context.Context) (string, []ghTreeEntry, error) {
	// First get the commit SHA for the branch to find the tree
	refURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/ref/heads/%s",
		s.Owner, s.Repo, s.Branch)

	var refResp struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := s.apiGet(ctx, refURL, &refResp); err != nil {
		return "", nil, fmt.Errorf("get ref: %w", err)
	}

	// Get the commit to find the root tree
	commitURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/commits/%s",
		s.Owner, s.Repo, refResp.Object.SHA)

	var commitResp struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := s.apiGet(ctx, commitURL, &commitResp); err != nil {
		return "", nil, fmt.Errorf("get commit: %w", err)
	}

	// Get the full tree recursively
	treeURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1",
		s.Owner, s.Repo, commitResp.Tree.SHA)

	var treeResp ghTreeResponse
	if err := s.apiGet(ctx, treeURL, &treeResp); err != nil {
		return "", nil, fmt.Errorf("get tree: %w", err)
	}

	// Filter to only entries under our path prefix
	var filtered []ghTreeEntry
	prefix := s.Path + "/"
	for _, e := range treeResp.Tree {
		if strings.HasPrefix(e.Path, prefix) {
			filtered = append(filtered, e)
		}
	}

	return commitResp.Tree.SHA, filtered, nil
}

// fetchBlob fetches raw file content from the blob API URL.
func (s *GitHubSource) fetchBlob(ctx context.Context, blobURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", blobURL, nil)
	if err != nil {
		return nil, err
	}
	// Request raw content directly instead of base64
	req.Header.Set("Accept", "application/vnd.github.raw")
	if s.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.Token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("blob fetch %s: status %d", blobURL, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (s *GitHubSource) apiGet(ctx context.Context, url string, target any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if s.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.Token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GET %s: %d %s", url, resp.StatusCode, string(body))
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

// --- Disk persistence for cold-start resilience ---

type diskCache struct {
	TreeSHA string                   `json:"tree_sha"`
	Items   []diskCacheItem          `json:"items"`
}

type diskCacheItem struct {
	ID   string `json:"id"`
	Meta store.WalkthroughMeta `json:"meta"`
	Data json.RawMessage       `json:"data"`
}

func (s *GitHubSource) cachePath() string {
	if s.CacheDir == "" {
		return ""
	}
	return filepath.Join(s.CacheDir, "walkthrough-cache.json")
}

func (s *GitHubSource) persistToDisk() {
	path := s.cachePath()
	if path == "" {
		return
	}

	s.mu.RLock()
	cache := diskCache{TreeSHA: s.treeSHA}
	for _, m := range s.metas {
		cache.Items = append(cache.Items, diskCacheItem{
			ID:   m.ID,
			Meta: m,
			Data: s.byID[m.ID],
		})
	}
	s.mu.RUnlock()

	data, err := json.Marshal(cache)
	if err != nil {
		log.Printf("[github-source] persist failed: %v", err)
		return
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		log.Printf("[github-source] persist mkdir failed: %v", err)
		return
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Printf("[github-source] persist write failed: %v", err)
	}
}

func (s *GitHubSource) loadFromDisk() {
	path := s.cachePath()
	if path == "" {
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return // no cache file yet, that's fine
	}

	var cache diskCache
	if err := json.Unmarshal(data, &cache); err != nil {
		log.Printf("[github-source] corrupt cache file, ignoring: %v", err)
		return
	}

	s.mu.Lock()
	s.treeSHA = cache.TreeSHA
	s.metas = make([]store.WalkthroughMeta, 0, len(cache.Items))
	s.byID = make(map[string][]byte, len(cache.Items))
	for _, item := range cache.Items {
		s.metas = append(s.metas, item.Meta)
		s.byID[item.ID] = item.Data
	}
	s.mu.Unlock()

	log.Printf("[github-source] loaded %d walkthroughs from disk cache", len(cache.Items))
}
