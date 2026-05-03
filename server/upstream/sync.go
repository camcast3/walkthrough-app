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
	"walkthrough-server/connectivity"
	"walkthrough-server/store"
)

// ProgressSync handles background sync of progress data to a remote server.
// Used in client mode to push local progress upstream without blocking the user.
type ProgressSync struct {
	ServerURL string
	DB        *store.DB
	Interval  time.Duration

	// IsCheckedOutFn, when non-nil, gates both push and pull to only operate on
	// walkthroughs that are currently checked out. Progress for unchecked walkthroughs
	// is neither sent to nor fetched from the remote server.
	IsCheckedOutFn func(id string) (bool, error)

	// Monitor, when non-nil, gates flush calls on connectivity state and
	// triggers an immediate flush when the monitor reports back online.
	Monitor *connectivity.Monitor

	configMu sync.RWMutex // protects ServerURL and Interval
	mu        sync.Mutex
	pending   map[string]struct{} // walkthrough IDs with unsent progress
	cancel    context.CancelFunc
	resetCh   chan time.Duration // signals interval changes to the running loop
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
		resetCh:   make(chan time.Duration, 1),
	}
}

// ── Thread-safe accessors ─────────────────────────────────────────────────────

func (ps *ProgressSync) serverURL() string {
	ps.configMu.RLock()
	defer ps.configMu.RUnlock()
	return ps.ServerURL
}

// GetInterval returns the current sync interval.
func (ps *ProgressSync) GetInterval() time.Duration {
	ps.configMu.RLock()
	defer ps.configMu.RUnlock()
	return ps.Interval
}

// SetServerURL updates the remote server URL at runtime.
func (ps *ProgressSync) SetServerURL(url string) {
	ps.configMu.Lock()
	ps.ServerURL = url
	ps.configMu.Unlock()
}

// SetInterval updates the sync interval and resets the background ticker.
func (ps *ProgressSync) SetInterval(d time.Duration) {
	ps.configMu.Lock()
	ps.Interval = d
	ps.configMu.Unlock()
	// Non-blocking send; drain stale value first if channel is full.
	select {
	case ps.resetCh <- d:
	default:
		select {
		case <-ps.resetCh:
		default:
		}
		ps.resetCh <- d
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
// If IsCheckedOutFn is set, the walkthrough is only queued when it is checked out.
func (ps *ProgressSync) MarkDirty(walkthroughID string) {
	if ps.IsCheckedOutFn != nil {
		ok, err := ps.IsCheckedOutFn(walkthroughID)
		if err != nil || !ok {
			return
		}
	}
	ps.mu.Lock()
	ps.pending[walkthroughID] = struct{}{}
	ps.mu.Unlock()
}

// PullAll fetches progress for checked-out walkthroughs from the remote server
// and updates local state if the remote is newer. Called on startup.
// When IsCheckedOutFn is set, only walkthroughs that are currently checked out are pulled.
func (ps *ProgressSync) PullAll(ctx context.Context, walkthroughIDs []string) {
	for _, id := range walkthroughIDs {
		if ps.IsCheckedOutFn != nil {
			ok, err := ps.IsCheckedOutFn(id)
			if err != nil || !ok {
				continue
			}
		}
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
	ticker := time.NewTicker(ps.GetInterval())
	defer ticker.Stop()

	var notifyCh <-chan struct{}

	for {
		// Re-subscribe to connectivity notifications at the start of each iteration.
		if notifyCh == nil {
			notifyCh = ps.Monitor.Notify()
		}

		select {
		case <-ctx.Done():
			// Flush remaining on shutdown
			ps.flush(context.Background())
			return
		case d := <-ps.resetCh:
			ticker.Reset(d)
		case <-ticker.C:
			if ps.serverURL() != "" && ps.Monitor.IsOnline() {
				ps.flush(ctx)
			}
		case <-notifyCh:
			notifyCh = nil // re-subscribe on next iteration
			if ps.Monitor.IsOnline() && ps.serverURL() != "" {
				// Connectivity restored — flush queued changes immediately.
				ps.flush(ctx)
			}
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

	url := fmt.Sprintf("%s/api/progress/%s", ps.serverURL(), record.WalkthroughID)
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
	url := fmt.Sprintf("%s/api/progress/%s", ps.serverURL(), walkthroughID)
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
