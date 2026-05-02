package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"walkthrough-server/store"

	"github.com/google/uuid"
)

// maxWalkthroughSize is the maximum number of bytes accepted from a remote URL.
const maxWalkthroughSize = 4 << 20 // 4 MiB

// fetchTimeout is the maximum time allowed for a remote walkthrough download.
const fetchTimeout = 30 * time.Second

// ingestHTTPClient is used for all walkthrough download requests.
// It enforces a response timeout independent of the request context.
var ingestHTTPClient = &http.Client{Timeout: fetchTimeout}

// stepStatus values used in IngestStep.
const (
	stepPending = "pending"
	stepRunning = "running"
	stepDone    = "done"
	stepError   = "error"
)

// Pipeline step indices — kept in sync with the Steps slice initialised in Submit.
const (
	stepIdxFetch    = 0
	stepIdxParse    = 1
	stepIdxValidate = 2
	stepIdxIndex    = 3
)

// IngestStep represents a single stage in the walkthrough ingest pipeline.
type IngestStep struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Status  string `json:"status"` // pending, running, done, error
	Message string `json:"message,omitempty"`
}

// IngestJob tracks a single walkthrough ingest pipeline run.
// Fields are protected by the embedded mutex; always use the pointer form.
type IngestJob struct {
	mu sync.Mutex

	ID            string
	Input         string
	Status        string // running, done, error
	Steps         []IngestStep
	WalkthroughID string
	ErrorMsg      string
	StartedAt     time.Time
	UpdatedAt     time.Time
}

// IngestJobSnapshot is the JSON-serialisable view of an IngestJob.
type IngestJobSnapshot struct {
	ID            string       `json:"id"`
	Input         string       `json:"input"`
	Status        string       `json:"status"`
	Steps         []IngestStep `json:"steps"`
	WalkthroughID string       `json:"walkthrough_id,omitempty"`
	ErrorMsg      string       `json:"error,omitempty"`
	StartedAt     time.Time    `json:"started_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

func (j *IngestJob) updateStep(idx int, status, message string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Steps[idx].Status = status
	j.Steps[idx].Message = message
	j.UpdatedAt = time.Now().UTC()
}

func (j *IngestJob) snapshot() IngestJobSnapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	steps := make([]IngestStep, len(j.Steps))
	copy(steps, j.Steps)
	return IngestJobSnapshot{
		ID:            j.ID,
		Input:         j.Input,
		Status:        j.Status,
		Steps:         steps,
		WalkthroughID: j.WalkthroughID,
		ErrorMsg:      j.ErrorMsg,
		StartedAt:     j.StartedAt,
		UpdatedAt:     j.UpdatedAt,
	}
}

// IngestManager tracks active and recent ingest jobs (in-memory, ephemeral).
type IngestManager struct {
	db *store.DB

	mu   sync.RWMutex
	jobs []*IngestJob // ordered oldest-first; capped at maxJobs
}

const maxJobs = 20

// NewIngestManager creates an IngestManager backed by db for walkthrough storage.
func NewIngestManager(db *store.DB) *IngestManager {
	return &IngestManager{db: db}
}

// Submit starts a new ingest pipeline for the given input (URL or raw JSON string).
// It returns the job immediately while the pipeline runs in a background goroutine.
func (m *IngestManager) Submit(input string) *IngestJob {
	job := &IngestJob{
		ID:        uuid.New().String(),
		Input:     input,
		Status:    stepRunning,
		StartedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
		Steps: []IngestStep{
			{Name: "fetch", Label: "Fetch content", Status: stepPending},
			{Name: "parse", Label: "Parse walkthrough", Status: stepPending},
			{Name: "validate", Label: "Validate schema", Status: stepPending},
			{Name: "index", Label: "Add to library", Status: stepPending},
		},
	}

	m.mu.Lock()
	m.jobs = append(m.jobs, job)
	if len(m.jobs) > maxJobs {
		m.jobs = m.jobs[len(m.jobs)-maxJobs:]
	}
	m.mu.Unlock()

	go m.runPipeline(job)
	return job
}

// Get returns the job with the given ID, or nil if not found.
func (m *IngestManager) Get(id string) *IngestJob {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, j := range m.jobs {
		if j.ID == id {
			return j
		}
	}
	return nil
}

// List returns snapshots of all jobs, newest first.
func (m *IngestManager) List() []IngestJobSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]IngestJobSnapshot, 0, len(m.jobs))
	for i := len(m.jobs) - 1; i >= 0; i-- {
		out = append(out, m.jobs[i].snapshot())
	}
	return out
}

// runPipeline executes the four ingest stages on the given job.
func (m *IngestManager) runPipeline(job *IngestJob) {
	fail := func(stepIdx int, msg string) {
		job.updateStep(stepIdx, stepError, msg)
		job.mu.Lock()
		job.Status = stepError
		job.ErrorMsg = msg
		job.UpdatedAt = time.Now().UTC()
		job.mu.Unlock()
	}

	// ── Stage 1: Fetch ────────────────────────────────────────────────────────
	job.updateStep(stepIdxFetch, stepRunning, "Receiving walkthrough content…")

	var rawJSON []byte

	input := strings.TrimSpace(job.Input)
	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		if err := validateIngestURL(input); err != nil {
			fail(stepIdxFetch, fmt.Sprintf("URL rejected: %v", err))
			return
		}
		job.updateStep(stepIdxFetch, stepRunning, fmt.Sprintf("Downloading from %s…", input))

		ctx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, input, nil)
		if err != nil {
			fail(stepIdxFetch, fmt.Sprintf("Failed to build request: %v", err))
			return
		}
		resp, err := ingestHTTPClient.Do(req)
		if err != nil {
			fail(stepIdxFetch, fmt.Sprintf("HTTP request failed: %v", err))
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			fail(stepIdxFetch, fmt.Sprintf("Remote returned HTTP %d", resp.StatusCode))
			return
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxWalkthroughSize))
		if err != nil {
			fail(stepIdxFetch, fmt.Sprintf("Failed to read response: %v", err))
			return
		}
		rawJSON = body
		job.updateStep(stepIdxFetch, stepDone, fmt.Sprintf("Downloaded %d bytes", len(rawJSON)))
	} else {
		// Treat input as raw JSON
		rawJSON = []byte(input)
		job.updateStep(stepIdxFetch, stepDone, fmt.Sprintf("Received %d bytes of JSON", len(rawJSON)))
	}

	// ── Stage 2: Parse ────────────────────────────────────────────────────────
	job.updateStep(stepIdxParse, stepRunning, "Parsing walkthrough JSON…")

	meta, err := store.ParseMetaFromJSON(rawJSON)
	if err != nil {
		fail(stepIdxParse, fmt.Sprintf("JSON parse error: %v", err))
		return
	}
	job.updateStep(stepIdxParse, stepDone, fmt.Sprintf("Parsed: %q by %s", meta.Game, meta.Author))

	// ── Stage 3: Validate ─────────────────────────────────────────────────────
	job.updateStep(stepIdxValidate, stepRunning, "Validating required fields…")

	if err := validateWalkthrough(rawJSON, meta); err != nil {
		fail(stepIdxValidate, err.Error())
		return
	}
	job.updateStep(stepIdxValidate, stepDone, "All required fields present")

	// ── Stage 4: Index ────────────────────────────────────────────────────────
	job.updateStep(stepIdxIndex, stepRunning, "Adding to walkthrough library…")

	if err := m.db.AddLocalWalkthrough(meta.ID, rawJSON); err != nil {
		fail(stepIdxIndex, fmt.Sprintf("Database error: %v", err))
		return
	}
	job.updateStep(stepIdxIndex, stepDone, fmt.Sprintf("Added %q to library", meta.ID))

	job.mu.Lock()
	job.Status = stepDone
	job.WalkthroughID = meta.ID
	job.UpdatedAt = time.Now().UTC()
	job.mu.Unlock()
}

// validateWalkthrough checks that the JSON has the required top-level fields.
func validateWalkthrough(data []byte, meta *store.WalkthroughMeta) error {
	if meta.ID == "" {
		return fmt.Errorf("missing required field: id")
	}
	if meta.Game == "" {
		return fmt.Errorf("missing required field: game")
	}
	if meta.Title == "" {
		return fmt.Errorf("missing required field: title")
	}

	// Check that sections exist and is a non-empty array.
	var partial struct {
		Sections json.RawMessage `json:"sections"`
	}
	if err := json.Unmarshal(data, &partial); err != nil {
		return fmt.Errorf("invalid JSON: %v", err)
	}
	if len(partial.Sections) == 0 {
		return fmt.Errorf("missing required field: sections")
	}
	var sections []json.RawMessage
	if err := json.Unmarshal(partial.Sections, &sections); err != nil || len(sections) == 0 {
		return fmt.Errorf("sections must be a non-empty array")
	}

	return nil
}

// validateIngestURL checks that a user-supplied URL is safe to fetch.
// It rejects non-HTTP(S) schemes and private/loopback IP targets to prevent SSRF.
func validateIngestURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %v", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http and https URLs are supported")
	}

	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL has no host")
	}

	// Resolve the host and reject private/loopback addresses (SSRF protection).
	addrs, err := net.LookupHost(host)
	if err != nil {
		// Treat resolution failures as errors — we don't permit fetching from
		// unresolvable hosts, which also prevents DNS-rebinding attacks.
		return fmt.Errorf("cannot resolve host %q: %v", host, err)
	}
	for _, addrStr := range addrs {
		ip := net.ParseIP(addrStr)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("URL resolves to a private or loopback address, which is not permitted")
		}
	}
	return nil
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────

// PostIngest handles POST /api/server/ingest.
// Body: {"url": "..."} or {"content": "..."}
func (h *Handler) PostIngest(w http.ResponseWriter, r *http.Request) {
	if !h.requireServerMode(w) {
		return
	}

	var body struct {
		URL     string `json:"url"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	input := strings.TrimSpace(body.URL)
	if input == "" {
		input = strings.TrimSpace(body.Content)
	}
	if input == "" {
		respondError(w, http.StatusBadRequest, "provide either 'url' or 'content'")
		return
	}

	job := h.Ingest.Submit(input)
	snap := job.snapshot()
	respondJSON(w, http.StatusAccepted, snap)
}

// ListIngestJobs handles GET /api/server/ingest.
func (h *Handler) ListIngestJobs(w http.ResponseWriter, r *http.Request) {
	if !h.requireServerMode(w) {
		return
	}
	respondJSON(w, http.StatusOK, h.Ingest.List())
}

// GetIngestJob handles GET /api/server/ingest/{id}.
func (h *Handler) GetIngestJob(w http.ResponseWriter, r *http.Request) {
	if !h.requireServerMode(w) {
		return
	}
	id := r.PathValue("id")
	job := h.Ingest.Get(id)
	if job == nil {
		respondError(w, http.StatusNotFound, "job not found")
		return
	}
	respondJSON(w, http.StatusOK, job.snapshot())
}
