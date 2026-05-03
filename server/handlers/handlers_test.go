package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"walkthrough-server/configstore"
	"walkthrough-server/source"
	"walkthrough-server/store"
	"walkthrough-server/upstream"
)

// ── Test helpers ──────────────────────────────────────────────────────────────

// mockSource implements source.WalkthroughSource for testing.
type mockSource struct {
	metas []store.WalkthroughMeta
	byID  map[string][]byte
}

func (m *mockSource) List() ([]store.WalkthroughMeta, error) {
	if m.metas == nil {
		return []store.WalkthroughMeta{}, nil
	}
	return m.metas, nil
}

func (m *mockSource) Get(id string) ([]byte, error) {
	if d, ok := m.byID[id]; ok {
		return d, nil
	}
	return nil, fmt.Errorf("walkthrough %q not found", id)
}

// openTestDB opens an in-memory SQLite DB for tests.
func openTestDB(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// minimalWalkthrough returns minimal valid walkthrough JSON.
func minimalWalkthrough(id, game, title string) string {
	return fmt.Sprintf(`{"id":%q,"game":%q,"title":%q,"sections":[{"name":"s1"}]}`, id, game, title)
}

// newTestHandler returns a Handler with an in-memory DB and mock source.
func newTestHandler(t *testing.T, mode string) (*Handler, *mockSource) {
	t.Helper()
	db := openTestDB(t)
	src := &mockSource{byID: make(map[string][]byte)}
	h := &Handler{
		DB:      db,
		Source:  src,
		AppMode: mode,
		Ingest:  NewIngestManager(db),
	}
	return h, src
}

// newClientTestHandler returns a Handler pre-configured for client mode.
func newClientTestHandler(t *testing.T) (*Handler, *mockSource) {
	t.Helper()
	h, src := newTestHandler(t, "client")
	h.RemoteSource = source.NewRemoteSource(source.RemoteConfig{
		ServerURL: "http://localhost:0", // unreachable — Refresh will fail silently
		Interval:  time.Minute,
	})
	db := h.DB
	h.Sync = upstream.NewProgressSync("http://localhost:0", db, 30*time.Second)
	h.ConfigStore = configstore.NewInMemory()
	return h, src
}

// decodeJSON is a test helper that decodes JSON from a response recorder body.
func decodeJSON(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(w.Body).Decode(v); err != nil {
		t.Fatalf("decode response JSON: %v (body: %s)", err, w.Body.String())
	}
}

// ── GetConfig ─────────────────────────────────────────────────────────────────

func TestGetConfig_FileMode(t *testing.T) {
	h, _ := newTestHandler(t, "")

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	w := httptest.NewRecorder()
	h.GetConfig(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var cfg map[string]any
	decodeJSON(t, w, &cfg)
	if cfg["appMode"] != "" {
		t.Errorf("expected appMode='', got %v", cfg["appMode"])
	}
	if _, ok := cfg["serverUrl"]; ok {
		t.Error("serverUrl should not appear in file mode")
	}
}

func TestGetConfig_ClientMode(t *testing.T) {
	h, _ := newClientTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	w := httptest.NewRecorder()
	h.GetConfig(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var cfg map[string]any
	decodeJSON(t, w, &cfg)
	if cfg["appMode"] != "client" {
		t.Errorf("expected appMode=client, got %v", cfg["appMode"])
	}
	if _, ok := cfg["serverUrl"]; !ok {
		t.Error("expected serverUrl to be present in client mode")
	}
}

// ── PutConfig ─────────────────────────────────────────────────────────────────

func TestPutConfig_NonClientMode(t *testing.T) {
	h, _ := newTestHandler(t, "server")

	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestPutConfig_InvalidBody(t *testing.T) {
	h, _ := newClientTestHandler(t)

	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(`not json`))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestPutConfig_InvalidServerURL(t *testing.T) {
	h, _ := newClientTestHandler(t)

	body := `{"serverUrl":"ftp://bad-scheme.example.com"}`
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestPutConfig_InvalidRefreshInterval(t *testing.T) {
	h, _ := newClientTestHandler(t)

	// Out of range: 25 hours > 24h max.
	body := `{"refreshInterval":"25h"}`
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestPutConfig_InvalidSyncInterval(t *testing.T) {
	h, _ := newClientTestHandler(t)

	// Out of range: 2h > 1h max.
	body := `{"syncInterval":"2h"}`
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestPutConfig_ValidClientMode(t *testing.T) {
	h, _ := newClientTestHandler(t)

	body := `{"serverUrl":"http://newserver.example.com","refreshInterval":"5m","syncInterval":"30s"}`
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PutConfig(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var cfg map[string]any
	decodeJSON(t, w, &cfg)
	if cfg["serverUrl"] != "http://newserver.example.com" {
		t.Errorf("expected updated serverUrl, got %v", cfg["serverUrl"])
	}
}

// ── ListWalkthroughs ──────────────────────────────────────────────────────────

func TestListWalkthroughs(t *testing.T) {
	h, src := newTestHandler(t, "")
	src.metas = []store.WalkthroughMeta{
		{ID: "wt1", Game: "Game1", Title: "Guide1"},
		{ID: "wt2", Game: "Game2", Title: "Guide2"},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/walkthroughs", nil)
	w := httptest.NewRecorder()
	h.ListWalkthroughs(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var metas []store.WalkthroughMeta
	decodeJSON(t, w, &metas)
	if len(metas) != 2 {
		t.Errorf("expected 2 walkthroughs, got %d", len(metas))
	}
}

func TestListWalkthroughs_WithLocalOverride(t *testing.T) {
	h, src := newTestHandler(t, "server")
	src.metas = []store.WalkthroughMeta{
		{ID: "wt1", Game: "G", Title: "Original"},
	}
	// Add a local override for wt1.
	if err := h.DB.AddLocalWalkthrough("wt1", []byte(minimalWalkthrough("wt1", "G", "Override"))); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/walkthroughs", nil)
	w := httptest.NewRecorder()
	h.ListWalkthroughs(w, req)

	var metas []store.WalkthroughMeta
	decodeJSON(t, w, &metas)
	if len(metas) != 1 {
		t.Fatalf("expected 1 walkthrough, got %d", len(metas))
	}
	if metas[0].Title != "Override" {
		t.Errorf("expected local override title, got %q", metas[0].Title)
	}
}

// ── GetWalkthrough ────────────────────────────────────────────────────────────

func TestGetWalkthrough_FromSource(t *testing.T) {
	h, src := newTestHandler(t, "")
	data := []byte(minimalWalkthrough("wt1", "Portal", "Guide"))
	src.byID["wt1"] = data

	req := httptest.NewRequest(http.MethodGet, "/api/walkthroughs/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.GetWalkthrough(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if !bytes.Equal(w.Body.Bytes(), data) {
		t.Errorf("response body mismatch")
	}
}

func TestGetWalkthrough_FromLocalDB(t *testing.T) {
	h, src := newTestHandler(t, "server")
	sourceData := []byte(minimalWalkthrough("wt1", "G", "SourceTitle"))
	localData := []byte(minimalWalkthrough("wt1", "G", "LocalTitle"))
	src.byID["wt1"] = sourceData
	if err := h.DB.AddLocalWalkthrough("wt1", localData); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/walkthroughs/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.GetWalkthrough(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	// Local DB should take precedence.
	if !bytes.Equal(w.Body.Bytes(), localData) {
		t.Errorf("expected local data, got: %s", w.Body.String())
	}
}

func TestGetWalkthrough_NotFound(t *testing.T) {
	h, _ := newTestHandler(t, "")

	req := httptest.NewRequest(http.MethodGet, "/api/walkthroughs/noexist", nil)
	req.SetPathValue("id", "noexist")
	w := httptest.NewRecorder()
	h.GetWalkthrough(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// ── GetProgress / PutProgress ─────────────────────────────────────────────────

func TestGetProgress_Found(t *testing.T) {
	h, _ := newTestHandler(t, "")
	rec := &store.ProgressRecord{
		WalkthroughID: "wt1",
		CheckedSteps:  []string{"s1"},
		UpdatedAt:     time.Now().UTC().Truncate(time.Second),
	}
	if err := h.DB.PutProgress(rec); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/progress/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.GetProgress(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var got store.ProgressRecord
	decodeJSON(t, w, &got)
	if got.WalkthroughID != "wt1" {
		t.Errorf("expected walkthroughId=wt1, got %q", got.WalkthroughID)
	}
}

func TestGetProgress_NotFound(t *testing.T) {
	h, _ := newTestHandler(t, "")

	req := httptest.NewRequest(http.MethodGet, "/api/progress/missing", nil)
	req.SetPathValue("id", "missing")
	w := httptest.NewRecorder()
	h.GetProgress(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestPutProgress_Valid(t *testing.T) {
	h, _ := newTestHandler(t, "")

	body := `{"checkedSteps":["step1","step2"],"updatedAt":"2024-06-01T00:00:00Z"}`
	req := httptest.NewRequest(http.MethodPut, "/api/progress/wt42", strings.NewReader(body))
	req.SetPathValue("id", "wt42")
	w := httptest.NewRecorder()
	h.PutProgress(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got store.ProgressRecord
	decodeJSON(t, w, &got)
	if got.WalkthroughID != "wt42" {
		t.Errorf("expected walkthroughId=wt42, got %q", got.WalkthroughID)
	}
	if len(got.CheckedSteps) != 2 {
		t.Errorf("expected 2 checked steps, got %d", len(got.CheckedSteps))
	}
	// Verify persisted in DB.
	stored, _ := h.DB.GetProgress("wt42")
	if stored == nil || len(stored.CheckedSteps) != 2 {
		t.Error("progress not persisted to DB")
	}
}

func TestPutProgress_InvalidBody(t *testing.T) {
	h, _ := newTestHandler(t, "")

	req := httptest.NewRequest(http.MethodPut, "/api/progress/wt1", strings.NewReader(`not json`))
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.PutProgress(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// ── Checkouts ─────────────────────────────────────────────────────────────────

func TestListCheckouts(t *testing.T) {
	h, _ := newTestHandler(t, "")

	req := httptest.NewRequest(http.MethodGet, "/api/checkouts", nil)
	w := httptest.NewRecorder()
	h.ListCheckouts(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var ids []string
	decodeJSON(t, w, &ids)
	if len(ids) != 0 {
		t.Errorf("expected empty checkout list, got %v", ids)
	}
}

func TestPutCheckout(t *testing.T) {
	h, src := newTestHandler(t, "")
	src.byID["wt1"] = []byte(minimalWalkthrough("wt1", "G", "T"))

	req := httptest.NewRequest(http.MethodPut, "/api/checkouts/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.PutCheckout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	checked, err := h.DB.IsCheckedOut("wt1")
	if err != nil || !checked {
		t.Errorf("expected wt1 to be checked out; err=%v checked=%v", err, checked)
	}
}

func TestDeleteCheckout(t *testing.T) {
	h, _ := newTestHandler(t, "")
	if err := h.DB.Checkout("wt1"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/checkouts/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.DeleteCheckout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	checked, err := h.DB.IsCheckedOut("wt1")
	if err != nil || checked {
		t.Errorf("expected wt1 to be checked in after delete; err=%v checked=%v", err, checked)
	}
}

func TestDeleteCheckout_EvictsRemoteCache(t *testing.T) {
	h, _ := newTestHandler(t, "client")
	rs := source.NewRemoteSource(source.RemoteConfig{})
	rs.SetData("wt1", []byte(minimalWalkthrough("wt1", "G", "T")))
	rs.SetData("wt2", []byte(minimalWalkthrough("wt2", "G", "T2")))
	h.RemoteSource = rs

	if err := h.DB.Checkout("wt1"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/checkouts/wt1", nil)
	req.SetPathValue("id", "wt1")
	w := httptest.NewRecorder()
	h.DeleteCheckout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	// wt1 should be evicted from the remote source cache.
	if rs.HasCached("wt1") {
		t.Error("expected wt1 to be evicted from remote source cache after checkin")
	}
	// wt2 should remain untouched.
	if !rs.HasCached("wt2") {
		t.Error("expected wt2 to remain in remote source cache")
	}
}

// ── GetDevices ────────────────────────────────────────────────────────────────

func TestGetDevices_ServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "server")
	if err := h.DB.RecordDeviceActivity("device-x", "wt1"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/server/devices", nil)
	w := httptest.NewRecorder()
	h.GetDevices(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var devices []store.DeviceActivity
	decodeJSON(t, w, &devices)
	if len(devices) != 1 || devices[0].DeviceID != "device-x" {
		t.Errorf("unexpected devices: %+v", devices)
	}
}

func TestGetDevices_NonServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "client")

	req := httptest.NewRequest(http.MethodGet, "/api/server/devices", nil)
	w := httptest.NewRecorder()
	h.GetDevices(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

// ── PostIngest ────────────────────────────────────────────────────────────────

func TestPostIngest_ServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "server")

	body := fmt.Sprintf(`{"content":%q}`, minimalWalkthrough("ingest-wt", "G", "T"))
	req := httptest.NewRequest(http.MethodPost, "/api/server/ingest", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PostIngest(w, req)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	var snap IngestJobSnapshot
	decodeJSON(t, w, &snap)
	if snap.ID == "" {
		t.Error("expected non-empty job ID in response")
	}
}

func TestPostIngest_NonServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "client")

	body := `{"content":"anything"}`
	req := httptest.NewRequest(http.MethodPost, "/api/server/ingest", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.PostIngest(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

// ── ListIngestJobs / GetIngestJob ─────────────────────────────────────────────

func TestListIngestJobs_ServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "server")

	// Submit a job via the manager directly.
	h.Ingest.Submit(minimalWalkthrough("list-ingest-1", "G", "T"))

	req := httptest.NewRequest(http.MethodGet, "/api/server/ingest", nil)
	w := httptest.NewRecorder()
	h.ListIngestJobs(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var snaps []IngestJobSnapshot
	decodeJSON(t, w, &snaps)
	if len(snaps) == 0 {
		t.Error("expected at least one job in list")
	}
}

func TestGetIngestJob_ServerMode(t *testing.T) {
	h, _ := newTestHandler(t, "server")

	job := h.Ingest.Submit(minimalWalkthrough("get-ingest-1", "G", "T"))

	req := httptest.NewRequest(http.MethodGet, "/api/server/ingest/"+job.ID, nil)
	req.SetPathValue("id", job.ID)
	w := httptest.NewRecorder()
	h.GetIngestJob(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var snap IngestJobSnapshot
	decodeJSON(t, w, &snap)
	if snap.ID != job.ID {
		t.Errorf("expected job ID %q, got %q", job.ID, snap.ID)
	}
}
