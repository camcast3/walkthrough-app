package upstream

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"walkthrough-server/store"
)

func openTestDB(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newTestSync(t *testing.T, serverURL string) *ProgressSync {
	t.Helper()
	db := openTestDB(t)
	ps := NewProgressSync(serverURL, db, time.Hour) // long interval — no auto-tick
	return ps
}

// ── MarkDirty ─────────────────────────────────────────────────────────────────

func TestMarkDirty_NilFn(t *testing.T) {
	ps := newTestSync(t, "")

	ps.MarkDirty("wt1")
	ps.MarkDirty("wt2")

	ps.mu.Lock()
	count := len(ps.pending)
	ps.mu.Unlock()

	if count != 2 {
		t.Errorf("expected 2 pending, got %d", count)
	}
}

func TestMarkDirty_WithCheckedOutFn_Checked(t *testing.T) {
	ps := newTestSync(t, "")
	ps.IsCheckedOutFn = func(id string) (bool, error) { return true, nil }

	ps.MarkDirty("wt1")

	ps.mu.Lock()
	_, queued := ps.pending["wt1"]
	ps.mu.Unlock()

	if !queued {
		t.Error("expected wt1 to be queued when IsCheckedOutFn returns true")
	}
}

func TestMarkDirty_WithCheckedOutFn_NotChecked(t *testing.T) {
	ps := newTestSync(t, "")
	ps.IsCheckedOutFn = func(id string) (bool, error) { return false, nil }

	ps.MarkDirty("wt1")

	ps.mu.Lock()
	_, queued := ps.pending["wt1"]
	ps.mu.Unlock()

	if queued {
		t.Error("expected wt1 NOT to be queued when IsCheckedOutFn returns false")
	}
}

// ── GetInterval / SetInterval ─────────────────────────────────────────────────

func TestGetSetInterval(t *testing.T) {
	ps := newTestSync(t, "")

	got := ps.GetInterval()
	if got != time.Hour {
		t.Errorf("expected initial interval=1h, got %v", got)
	}

	ps.SetInterval(5 * time.Minute)
	if ps.GetInterval() != 5*time.Minute {
		t.Errorf("expected 5m after SetInterval, got %v", ps.GetInterval())
	}
}

// ── SetServerURL / serverURL ──────────────────────────────────────────────────

func TestGetSetServerURL(t *testing.T) {
	ps := newTestSync(t, "http://initial.example.com")

	if ps.serverURL() != "http://initial.example.com" {
		t.Errorf("unexpected initial serverURL: %s", ps.serverURL())
	}

	ps.SetServerURL("http://updated.example.com")
	if ps.serverURL() != "http://updated.example.com" {
		t.Errorf("expected updated serverURL, got %s", ps.serverURL())
	}
}

// ── flush ─────────────────────────────────────────────────────────────────────

func TestFlush_Empty(t *testing.T) {
	// flush with an empty pending map should be a no-op (no panics, no requests).
	ps := newTestSync(t, "http://should-not-be-called.example.com")
	ps.flush(context.Background()) // must not panic or make any HTTP call
}

// ── pushRemote ────────────────────────────────────────────────────────────────

func TestPushRemote(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotBody   []byte
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	db := openTestDB(t)
	ps := NewProgressSync(srv.URL, db, time.Hour)

	record := &store.ProgressRecord{
		WalkthroughID: "wt-push",
		CheckedSteps:  []string{"s1", "s2"},
		UpdatedAt:     time.Now().UTC(),
	}
	if err := ps.pushRemote(context.Background(), record); err != nil {
		t.Fatalf("pushRemote: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("expected PUT, got %s", gotMethod)
	}
	if gotPath != "/api/progress/wt-push" {
		t.Errorf("unexpected path: %s", gotPath)
	}
	if !strings.Contains(string(gotBody), "s1") {
		t.Errorf("expected s1 in push body, got: %s", gotBody)
	}
}

// ── pullRemote ────────────────────────────────────────────────────────────────

func TestPullRemote_Found(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	remoteRecord := store.ProgressRecord{
		WalkthroughID: "wt-pull",
		CheckedSteps:  []string{"step1"},
		UpdatedAt:     now,
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/progress/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(remoteRecord)
		}
	}))
	defer srv.Close()

	db := openTestDB(t)
	ps := NewProgressSync(srv.URL, db, time.Hour)

	got, err := ps.pullRemote(context.Background(), "wt-pull")
	if err != nil {
		t.Fatalf("pullRemote: %v", err)
	}
	if got == nil {
		t.Fatal("expected record, got nil")
	}
	if got.WalkthroughID != "wt-pull" {
		t.Errorf("expected WalkthroughID=wt-pull, got %q", got.WalkthroughID)
	}
	if len(got.CheckedSteps) != 1 || got.CheckedSteps[0] != "step1" {
		t.Errorf("unexpected CheckedSteps: %v", got.CheckedSteps)
	}
}

func TestPullRemote_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	db := openTestDB(t)
	ps := NewProgressSync(srv.URL, db, time.Hour)

	got, err := ps.pullRemote(context.Background(), "wt-missing")
	if err != nil {
		t.Fatalf("pullRemote: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil record for 404, got %+v", got)
	}
}

// ── PullAll ───────────────────────────────────────────────────────────────────

func TestPullAll_SkipsUnchecked(t *testing.T) {
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	db := openTestDB(t)
	ps := NewProgressSync(srv.URL, db, time.Hour)
	// IsCheckedOutFn always returns false — nothing should be pulled.
	ps.IsCheckedOutFn = func(id string) (bool, error) { return false, nil }

	ps.PullAll(context.Background(), []string{"wt1", "wt2", "wt3"})

	if requests != 0 {
		t.Errorf("expected no HTTP requests when all walkthroughs are unchecked, got %d", requests)
	}
}

// ── ProgressSync lifecycle: flush on shutdown ─────────────────────────────────

func TestProgressSync_FlushOnShutdown(t *testing.T) {
	pushed := make(chan string, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/progress/") {
			select {
			case pushed <- r.URL.Path:
			default:
			}
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	db := openTestDB(t)

	// Seed a progress record so flush has something to push.
	rec := &store.ProgressRecord{
		WalkthroughID: "wt-flush",
		CheckedSteps:  []string{"s1"},
		UpdatedAt:     time.Now().UTC(),
	}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}

	ps := NewProgressSync(srv.URL, db, time.Hour) // long interval — no auto-tick
	ps.MarkDirty("wt-flush")

	ctx := context.Background()
	ps.Start(ctx)
	// Give the goroutine a moment to start its select loop.
	time.Sleep(20 * time.Millisecond)
	ps.Close()

	select {
	case path := <-pushed:
		if !strings.Contains(path, "wt-flush") {
			t.Errorf("unexpected push path: %s", path)
		}
	case <-time.After(5 * time.Second):
		t.Error("timeout: expected push on shutdown, got none")
	}
}
