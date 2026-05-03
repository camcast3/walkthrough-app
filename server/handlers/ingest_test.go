package handlers

import (
	"fmt"
	"strings"
	"testing"
	"time"
	"walkthrough-server/store"
)

// waitForJob polls until the job reaches a terminal state or times out.
func waitForJob(t *testing.T, job *IngestJob, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		job.mu.Lock()
		status := job.Status
		job.mu.Unlock()
		if status == stepDone || status == stepError {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for ingest job to finish")
}

func TestValidateWalkthrough(t *testing.T) {
	cases := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{
			"valid",
			`{"id":"w1","game":"G","title":"T","sections":[{"name":"s1"}]}`,
			false,
		},
		{
			"missing_id",
			`{"game":"G","title":"T","sections":[{}]}`,
			true,
		},
		{
			"missing_game",
			`{"id":"w1","title":"T","sections":[{}]}`,
			true,
		},
		{
			"missing_title",
			`{"id":"w1","game":"G","sections":[{}]}`,
			true,
		},
		{
			"missing_sections",
			`{"id":"w1","game":"G","title":"T"}`,
			true,
		},
		{
			"empty_sections",
			`{"id":"w1","game":"G","title":"T","sections":[]}`,
			true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := []byte(tc.json)
			meta, _ := store.ParseMetaFromJSON(data)
			if meta == nil {
				meta = &store.WalkthroughMeta{}
			}
			err := validateWalkthrough(data, meta)
			if tc.wantErr && err == nil {
				t.Errorf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateIngestURL(t *testing.T) {
	// These cases do not require DNS resolution.
	cases := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"invalid_scheme_ftp", "ftp://example.com/file.json", true},
		{"invalid_scheme_file", "file:///etc/passwd", true},
		{"no_host", "https:///some/path", true},
		{"malformed_url", "://bad", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIngestURL(tc.url)
			if tc.wantErr && err == nil {
				t.Errorf("expected error for URL %q, got nil", tc.url)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error for URL %q: %v", tc.url, err)
			}
		})
	}
}

func TestIngestManagerSubmitJSON(t *testing.T) {
	db := openTestDB(t)
	m := NewIngestManager(db)

	input := minimalWalkthrough("wt-submit-1", "Portal", "Full Guide")
	job := m.Submit(input)
	waitForJob(t, job, 5*time.Second)

	snap := job.snapshot()
	if snap.Status != stepDone {
		t.Errorf("expected status=%q, got %q (error: %s)", stepDone, snap.Status, snap.ErrorMsg)
	}
	if snap.WalkthroughID != "wt-submit-1" {
		t.Errorf("expected WalkthroughID=%q, got %q", "wt-submit-1", snap.WalkthroughID)
	}
	for _, s := range snap.Steps {
		if s.Status != stepDone {
			t.Errorf("step %q: expected %q, got %q (msg: %s)", s.Name, stepDone, s.Status, s.Message)
		}
	}
}

func TestIngestManagerSubmitInvalidJSON(t *testing.T) {
	db := openTestDB(t)
	m := NewIngestManager(db)

	job := m.Submit(`not valid json {{{`)
	waitForJob(t, job, 5*time.Second)

	snap := job.snapshot()
	if snap.Status != stepError {
		t.Errorf("expected status=%q, got %q", stepError, snap.Status)
	}
}

func TestIngestManagerList(t *testing.T) {
	db := openTestDB(t)
	m := NewIngestManager(db)

	job1 := m.Submit(minimalWalkthrough("list-a", "G1", "T1"))
	job2 := m.Submit(minimalWalkthrough("list-b", "G2", "T2"))
	waitForJob(t, job1, 5*time.Second)
	waitForJob(t, job2, 5*time.Second)

	snaps := m.List()
	if len(snaps) != 2 {
		t.Fatalf("expected 2 jobs, got %d", len(snaps))
	}
	// List returns newest-first (job2 was submitted last).
	if snaps[0].ID != job2.ID {
		t.Errorf("expected newest job first: got ID=%q, want ID=%q", snaps[0].ID, job2.ID)
	}
}

func TestIngestManagerGet(t *testing.T) {
	db := openTestDB(t)
	m := NewIngestManager(db)

	job := m.Submit(minimalWalkthrough("get-wt", "G", "T"))

	got := m.Get(job.ID)
	if got == nil {
		t.Fatal("expected to find job by ID, got nil")
	}
	if got.ID != job.ID {
		t.Errorf("ID mismatch: got %q, want %q", got.ID, job.ID)
	}

	notFound := m.Get("unknown-id-xyz")
	if notFound != nil {
		t.Error("expected nil for unknown ID, got non-nil")
	}
}

func TestIngestManagerMaxJobs(t *testing.T) {
	db := openTestDB(t)
	m := NewIngestManager(db)

	for i := 0; i < 25; i++ {
		wt := fmt.Sprintf(`{"id":"wt%d","game":"G","title":"T","sections":[{}]}`, i)
		m.Submit(wt)
	}

	m.mu.RLock()
	count := len(m.jobs)
	m.mu.RUnlock()

	if count > maxJobs {
		t.Errorf("expected at most %d jobs, got %d", maxJobs, count)
	}
}

// validateIngestURL_PrivateIP tests that private IP addresses are rejected.
// This test requires DNS/network — it uses a literal IP, so no lookup needed.
func TestValidateIngestURL_PrivateIP(t *testing.T) {
	privateURLs := []string{
		"http://127.0.0.1/walkthrough.json",
		"http://192.168.1.1/walkthrough.json",
		"http://10.0.0.1/walkthrough.json",
		"http://[::1]/walkthrough.json",
	}
	for _, u := range privateURLs {
		t.Run(strings.ReplaceAll(u, "/", "_"), func(t *testing.T) {
			err := validateIngestURL(u)
			if err == nil {
				t.Errorf("expected private IP URL %q to be rejected, got nil error", u)
			}
		})
	}
}
