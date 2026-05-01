package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
	"walkthrough-server/store"
)

// ProgressSync handles background sync of progress data to a remote server.
// Used in client mode to push local progress upstream without blocking the user.
type ProgressSync struct {
	ServerURL string
	DB        *store.DB
	Interval  time.Duration

	mu      sync.Mutex
	pending map[string]struct{} // walkthrough IDs with unsent progress
	cancel  context.CancelFunc
}

func NewProgressSync(serverURL string, db *store.DB, interval time.Duration) *ProgressSync {
	if interval == 0 {
		interval = 30 * time.Second
	}
	return &ProgressSync{
		ServerURL: serverURL,
		DB:        db,
		Interval:  interval,
		pending:   make(map[string]struct{}),
	}
}

// Start begins the background sync loop.
func (ps *ProgressSync) Start(ctx context.Context) {
	rctx, cancel := context.WithCancel(ctx)
	ps.cancel = cancel
	go ps.syncLoop(rctx)
}

func (ps *ProgressSync) Close() {
	if ps.cancel != nil {
		ps.cancel()
	}
}

// MarkDirty queues a walkthrough ID for upstream sync.
func (ps *ProgressSync) MarkDirty(walkthroughID string) {
	ps.mu.Lock()
	ps.pending[walkthroughID] = struct{}{}
	ps.mu.Unlock()
}

// PullAll fetches progress for all known walkthroughs from the remote server
// and updates local state if the remote is newer. Called on startup.
func (ps *ProgressSync) PullAll(ctx context.Context, walkthroughIDs []string) {
	for _, id := range walkthroughIDs {
		remote, err := ps.pullRemote(ctx, id)
		if err != nil || remote == nil {
			continue
		}

		local, _ := ps.DB.GetProgress(id)
		if local == nil || remote.UpdatedAt.After(local.UpdatedAt) {
			if err := ps.DB.PutProgress(remote); err != nil {
				log.Printf("[upstream-sync] failed to save pulled progress for %s: %v", id, err)
			}
		}
	}
}

func (ps *ProgressSync) syncLoop(ctx context.Context) {
	ticker := time.NewTicker(ps.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Flush remaining on shutdown
			ps.flush(context.Background())
			return
		case <-ticker.C:
			ps.flush(ctx)
		}
	}
}

func (ps *ProgressSync) flush(ctx context.Context) {
	ps.mu.Lock()
	if len(ps.pending) == 0 {
		ps.mu.Unlock()
		return
	}
	ids := make([]string, 0, len(ps.pending))
	for id := range ps.pending {
		ids = append(ids, id)
	}
	ps.pending = make(map[string]struct{})
	ps.mu.Unlock()

	for _, id := range ids {
		record, err := ps.DB.GetProgress(id)
		if err != nil || record == nil {
			continue
		}
		if err := ps.pushRemote(ctx, record); err != nil {
			log.Printf("[upstream-sync] push %s failed: %v", id, err)
			// Re-queue for next attempt
			ps.mu.Lock()
			ps.pending[id] = struct{}{}
			ps.mu.Unlock()
		}
	}
}

func (ps *ProgressSync) pushRemote(ctx context.Context, record *store.ProgressRecord) error {
	body, err := json.Marshal(map[string]any{
		"checkedSteps": record.CheckedSteps,
		"updatedAt":    record.UpdatedAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/api/progress/%s", ps.ServerURL, record.WalkthroughID)
	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("push progress: status %d", resp.StatusCode)
	}
	return nil
}

func (ps *ProgressSync) pullRemote(ctx context.Context, walkthroughID string) (*store.ProgressRecord, error) {
	url := fmt.Sprintf("%s/api/progress/%s", ps.ServerURL, walkthroughID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pull progress: status %d", resp.StatusCode)
	}

	var record store.ProgressRecord
	if err := json.NewDecoder(resp.Body).Decode(&record); err != nil {
		return nil, err
	}
	return &record, nil
}
