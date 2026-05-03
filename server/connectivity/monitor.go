// Package connectivity provides network reachability monitoring for client mode.
// A Monitor periodically probes a remote server and tracks online/offline state,
// emitting a single log line on each transition rather than per-tick errors.
package connectivity

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	// DefaultCheckInterval is how often the monitor probes the remote server.
	DefaultCheckInterval = 30 * time.Second
	// DefaultTimeout is the per-probe HTTP deadline.
	DefaultTimeout = 3 * time.Second
	// DefaultFailThreshold is the number of consecutive probe failures before
	// the monitor declares the client offline.
	DefaultFailThreshold = 3
)

// Monitor periodically issues a lightweight HEAD /api/health probe to a remote
// server and maintains an online/offline state. Both ProgressSync and
// RemoteSource gate their HTTP calls on Monitor.IsOnline() and react to
// state-change notifications from Monitor.Notify().
type Monitor struct {
	ServerURL     string
	CheckInterval time.Duration
	Timeout       time.Duration
	// FailThreshold is the number of consecutive probe failures required to
	// declare the client offline.
	FailThreshold int

	mu       sync.RWMutex
	online   bool
	failures int           // consecutive probe failures while online
	notifyCh chan struct{}  // closed on each online/offline state transition
	cancel   context.CancelFunc
	resetCh  chan time.Duration // signals CheckInterval changes to the running loop
}

// New creates a Monitor for the given server URL using default settings.
// The monitor starts in the online state (optimistic) so that the initial
// sync and refresh cycles behave as before until a failure threshold is hit.
func New(serverURL string) *Monitor {
	return &Monitor{
		ServerURL:     serverURL,
		CheckInterval: DefaultCheckInterval,
		Timeout:       DefaultTimeout,
		FailThreshold: DefaultFailThreshold,
		online:        true,
		notifyCh:      make(chan struct{}),
		resetCh:       make(chan time.Duration, 1),
	}
}

// Start begins the background probe loop. It is a no-op when ServerURL is empty.
func (m *Monitor) Start(ctx context.Context) {
	if m.ServerURL == "" {
		return
	}
	rctx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()
	go m.loop(rctx)
}

// Stop shuts down the background probe loop.
func (m *Monitor) Stop() {
	m.mu.RLock()
	cancel := m.cancel
	m.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
}

// IsOnline reports whether the remote server is currently considered reachable.
// Returns true when no Monitor is configured (nil receiver) so callers can
// use a nil monitor to mean "always online".
func (m *Monitor) IsOnline() bool {
	if m == nil {
		return true
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.online
}

// Notify returns a channel that is closed each time the online/offline state
// transitions. Callers should call IsOnline() after the channel fires to
// determine the new state, then call Notify() again to re-subscribe.
//
// Pattern for a select loop:
//
//	var notifyCh <-chan struct{}
//	for {
//	    if notifyCh == nil {
//	        notifyCh = monitor.Notify()
//	    }
//	    select {
//	    case <-notifyCh:
//	        notifyCh = nil
//	        if monitor.IsOnline() { /* reconnect action */ }
//	    case <-ticker.C:
//	        if monitor.IsOnline() { /* normal action */ }
//	    }
//	}
func (m *Monitor) Notify() <-chan struct{} {
	if m == nil {
		// Return a channel that is never closed — callers see no transitions.
		return make(chan struct{})
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.notifyCh
}

func (m *Monitor) loop(ctx context.Context) {
	ticker := time.NewTicker(m.CheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case d := <-m.resetCh:
			ticker.Reset(d)
		case <-ticker.C:
			m.probe(ctx)
		}
	}
}

// SetCheckInterval updates the probe interval and resets the background ticker.
// Mirrors the SetInterval pattern used by RemoteSource and ProgressSync.
func (m *Monitor) SetCheckInterval(d time.Duration) {
	m.mu.Lock()
	m.CheckInterval = d
	m.mu.Unlock()
	// Non-blocking send; drain stale value first if channel is full.
	select {
	case m.resetCh <- d:
	default:
		select {
		case <-m.resetCh:
		default:
		}
		m.resetCh <- d
	}
}

func (m *Monitor) probe(ctx context.Context) {
	reqCtx, cancel := context.WithTimeout(ctx, m.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodHead, m.ServerURL+"/api/health", nil)
	if err != nil {
		m.recordFailure()
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		m.recordFailure()
		return
	}
	resp.Body.Close()

	// Treat 5xx as a server-side failure (could be a transient overload), but
	// any 2xx/3xx/4xx means the server is reachable.
	if resp.StatusCode >= 500 {
		m.recordFailure()
		return
	}

	m.recordSuccess()
}

func (m *Monitor) recordFailure() {
	m.mu.Lock()
	m.failures++
	if !m.online || m.failures < m.FailThreshold {
		m.mu.Unlock()
		return
	}
	// Threshold reached — transition to offline.
	m.online = false
	oldCh := m.notifyCh
	m.notifyCh = make(chan struct{})
	m.mu.Unlock()

	log.Printf("[connectivity] going offline")
	close(oldCh)
}

func (m *Monitor) recordSuccess() {
	m.mu.Lock()
	m.failures = 0
	if m.online {
		m.mu.Unlock()
		return
	}
	// Was offline — transition back to online.
	m.online = true
	oldCh := m.notifyCh
	m.notifyCh = make(chan struct{})
	m.mu.Unlock()

	log.Printf("[connectivity] back online")
	close(oldCh)
}

// RecordFailureForTest drives the monitor into offline state without a real HTTP probe.
// Intended for use in unit tests only.
func (m *Monitor) RecordFailureForTest() {
	m.recordFailure()
}

// RecordSuccessForTest drives the monitor into online state without a real HTTP probe.
// Intended for use in unit tests only.
func (m *Monitor) RecordSuccessForTest() {
	m.recordSuccess()
}
