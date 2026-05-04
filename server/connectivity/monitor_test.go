package connectivity

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ── IsOnline / nil receiver ───────────────────────────────────────────────────

func TestMonitor_NilReceiverIsOnline(t *testing.T) {
	var m *Monitor
	if !m.IsOnline() {
		t.Error("nil monitor should report online=true")
	}
}

func TestMonitor_NilReceiverNotify(t *testing.T) {
	var m *Monitor
	ch := m.Notify()
	if ch == nil {
		t.Error("nil Notify() should return a non-nil (never-closed) channel")
	}
	// The channel must never be closed.
	select {
	case <-ch:
		t.Error("nil monitor Notify() channel must never close")
	default:
	}
}

// ── recordSuccess / recordFailure ─────────────────────────────────────────────

func TestMonitor_StaysOnlineBeforeThreshold(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 3

	// Two failures — below threshold, should still be online.
	m.recordFailure()
	m.recordFailure()

	if !m.IsOnline() {
		t.Error("expected online after fewer failures than threshold")
	}
}

func TestMonitor_GoesOfflineAtThreshold(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 3

	notifyCh := m.Notify()

	m.recordFailure()
	m.recordFailure()
	m.recordFailure() // hits threshold

	if m.IsOnline() {
		t.Error("expected offline after reaching fail threshold")
	}

	// Notification channel must have fired.
	select {
	case <-notifyCh:
	default:
		t.Error("Notify() channel should be closed after going offline")
	}
}

func TestMonitor_ComesBackOnline(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 1

	// Go offline first.
	m.recordFailure()
	if m.IsOnline() {
		t.Fatal("expected offline after failure")
	}

	notifyCh := m.Notify()

	// One success brings it back.
	m.recordSuccess()

	if !m.IsOnline() {
		t.Error("expected online after success")
	}

	select {
	case <-notifyCh:
	default:
		t.Error("Notify() channel should be closed after coming back online")
	}
}

func TestMonitor_FailureCountResetOnSuccess(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 3

	m.recordFailure()
	m.recordFailure()

	// A success resets the count.
	m.recordSuccess()

	// Two more failures after reset — still below threshold.
	m.recordFailure()
	m.recordFailure()

	if !m.IsOnline() {
		t.Error("expected online: failure count should have been reset by success")
	}
}

func TestMonitor_AdditionalFailuresIgnoredWhileOffline(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 1

	m.recordFailure() // goes offline

	ch1 := m.Notify()

	// Additional failures while already offline should not close the new channel.
	m.recordFailure()
	m.recordFailure()

	select {
	case <-ch1:
		t.Error("notify channel should not close on repeated failure while already offline")
	default:
	}
}

// ── probe ─────────────────────────────────────────────────────────────────────

func TestMonitor_ProbeSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead && r.URL.Path == "/api/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	m := New(srv.URL)
	m.FailThreshold = 1

	// Manually drive to offline state.
	m.recordFailure()
	if m.IsOnline() {
		t.Fatal("expected offline after failure")
	}

	notifyCh := m.Notify()

	// A successful probe should bring it back online.
	ctx := t.Context()
	m.probe(ctx)

	if !m.IsOnline() {
		t.Error("expected online after successful probe")
	}
	select {
	case <-notifyCh:
	default:
		t.Error("Notify() channel should have closed after probe success")
	}
}

func TestMonitor_ProbeFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	m := New(srv.URL)
	m.FailThreshold = 1

	notifyCh := m.Notify()

	ctx := t.Context()
	m.probe(ctx) // 500 → treated as failure

	if m.IsOnline() {
		t.Error("expected offline after 5xx probe")
	}
	select {
	case <-notifyCh:
	default:
		t.Error("Notify() channel should have closed after going offline")
	}
}

// ── Notify re-subscription ────────────────────────────────────────────────────

func TestMonitor_NotifyResubscribe(t *testing.T) {
	m := New("http://example.com")
	m.FailThreshold = 1

	// First transition: online → offline.
	ch1 := m.Notify()
	m.recordFailure()

	select {
	case <-ch1:
	case <-time.After(time.Second):
		t.Fatal("ch1 should have closed after going offline")
	}

	// Re-subscribe before second transition: offline → online.
	ch2 := m.Notify()
	m.recordSuccess()

	select {
	case <-ch2:
	case <-time.After(time.Second):
		t.Fatal("ch2 should have closed after coming back online")
	}

	// ch1 is already closed; ch2 is now closed too.
	// A fresh Notify() call should return a new open channel.
	ch3 := m.Notify()
	select {
	case <-ch3:
		t.Error("ch3 should be open (no pending transition)")
	default:
	}
}

// ── SetCheckInterval ──────────────────────────────────────────────────────────

func TestMonitor_SetCheckInterval(t *testing.T) {
	m := New("http://example.com")

	if m.CheckInterval != DefaultCheckInterval {
		t.Errorf("expected initial CheckInterval=%v, got %v", DefaultCheckInterval, m.CheckInterval)
	}

	newInterval := 2 * time.Minute
	m.SetCheckInterval(newInterval)

	if m.CheckInterval != newInterval {
		t.Errorf("expected CheckInterval=%v after SetCheckInterval, got %v", newInterval, m.CheckInterval)
	}

	// resetCh must have received the new interval.
	select {
	case d := <-m.resetCh:
		if d != newInterval {
			t.Errorf("expected resetCh value=%v, got %v", newInterval, d)
		}
	default:
		t.Error("expected resetCh to contain a value after SetCheckInterval")
	}
}

func TestMonitor_SetCheckInterval_DrainStale(t *testing.T) {
	m := New("http://example.com")

	// Fill the channel with a stale value.
	m.resetCh <- 99 * time.Second

	// SetCheckInterval should drain the stale value and send the new one.
	m.SetCheckInterval(5 * time.Minute)

	select {
	case d := <-m.resetCh:
		if d != 5*time.Minute {
			t.Errorf("expected drained+new value=5m, got %v", d)
		}
	default:
		t.Error("expected resetCh to contain the new interval after draining stale")
	}
}
