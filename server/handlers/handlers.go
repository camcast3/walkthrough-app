package handlers

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"walkthrough-server/source"
	"walkthrough-server/store"
	"walkthrough-server/upstream"
)

type Handler struct {
	DB     *store.DB
	Source source.WalkthroughSource
	// Sync is non-nil in client mode; signals upstream sync on progress changes.
	Sync *upstream.ProgressSync
	// AppMode is the server's operating mode ("server", "client", or "").
	AppMode string
	// Ingest manages walkthrough ingest jobs (server mode only).
	Ingest *IngestManager
	// RemoteSource is non-nil in client mode; used for runtime config updates.
	RemoteSource *source.RemoteSource
}

// requireServerMode writes a 403 error if the server is not in server mode and returns false.
func (h *Handler) requireServerMode(w http.ResponseWriter) bool {
	if h.AppMode != "server" {
		respondError(w, http.StatusForbidden, "this endpoint is only available in server mode")
		return false
	}
	return true
}

// respondJSON writes a JSON response with the given status code.
func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// respondError writes a JSON error message.
func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}

// GetConfig handles GET /api/config — exposes non-sensitive runtime settings to the webapp.
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := map[string]any{
		"appMode": h.AppMode,
	}
	if h.AppMode == "client" && h.RemoteSource != nil {
		cfg["serverUrl"] = h.RemoteSource.GetServerURL()
		cfg["refreshInterval"] = h.RemoteSource.GetInterval().String()
		cfg["cacheDir"] = h.RemoteSource.GetCacheDir()
	}
	if h.AppMode == "client" && h.Sync != nil {
		cfg["syncInterval"] = h.Sync.GetInterval().String()
	}
	respondJSON(w, http.StatusOK, cfg)
}

// PutConfig handles PUT /api/config — updates runtime settings without a restart.
// Only available in client mode.
func (h *Handler) PutConfig(w http.ResponseWriter, r *http.Request) {
	if h.AppMode != "client" {
		respondError(w, http.StatusForbidden, "config updates are only available in client mode")
		return
	}

	var body struct {
		ServerURL       string `json:"serverUrl"`
		RefreshInterval string `json:"refreshInterval"`
		SyncInterval    string `json:"syncInterval"`
		CacheDir        string `json:"cacheDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate serverUrl
	if body.ServerURL != "" {
		if !strings.HasPrefix(body.ServerURL, "http://") && !strings.HasPrefix(body.ServerURL, "https://") {
			respondError(w, http.StatusBadRequest, "serverUrl must start with http:// or https://")
			return
		}
		body.ServerURL = strings.TrimRight(body.ServerURL, "/")
	}

	// Validate refreshInterval (1m – 24h)
	var refreshInterval time.Duration
	if body.RefreshInterval != "" {
		d, err := time.ParseDuration(body.RefreshInterval)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid refreshInterval: "+err.Error())
			return
		}
		if d < time.Minute || d > 24*time.Hour {
			respondError(w, http.StatusBadRequest, "refreshInterval must be between 1m and 24h")
			return
		}
		refreshInterval = d
	}

	// Validate syncInterval (10s – 1h)
	var syncInterval time.Duration
	if body.SyncInterval != "" {
		d, err := time.ParseDuration(body.SyncInterval)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid syncInterval: "+err.Error())
			return
		}
		if d < 10*time.Second || d > time.Hour {
			respondError(w, http.StatusBadRequest, "syncInterval must be between 10s and 1h")
			return
		}
		syncInterval = d
	}

	// Validate cacheDir: must be an absolute path to an existing directory
	if body.CacheDir != "" {
		if !filepath.IsAbs(body.CacheDir) {
			respondError(w, http.StatusBadRequest, "cacheDir must be an absolute path")
			return
		}
		body.CacheDir = filepath.Clean(body.CacheDir)
		fi, err := os.Stat(body.CacheDir)
		if err != nil {
			if os.IsNotExist(err) {
				respondError(w, http.StatusBadRequest, "cacheDir does not exist — create it first")
			} else {
				respondError(w, http.StatusBadRequest, "cacheDir is inaccessible: "+err.Error())
			}
			return
		}
		if !fi.IsDir() {
			respondError(w, http.StatusBadRequest, "cacheDir must be a directory")
			return
		}
	}

	// Apply and persist changes
	var persistWarnings []string

	if body.ServerURL != "" {
		if h.RemoteSource != nil {
			h.RemoteSource.SetServerURL(body.ServerURL)
			// Trigger an immediate re-fetch with the new URL
			h.RemoteSource.Refresh(r.Context())
		}
		if h.Sync != nil {
			h.Sync.SetServerURL(body.ServerURL)
		}
		if err := h.DB.SetSetting("server_url", body.ServerURL); err != nil {
			log.Printf("[config] failed to persist server_url: %v", err)
			persistWarnings = append(persistWarnings, "server_url could not be persisted: "+err.Error())
		}
	}

	if refreshInterval > 0 && h.RemoteSource != nil {
		h.RemoteSource.SetInterval(refreshInterval)
		if err := h.DB.SetSetting("refresh_interval", body.RefreshInterval); err != nil {
			log.Printf("[config] failed to persist refresh_interval: %v", err)
			persistWarnings = append(persistWarnings, "refresh_interval could not be persisted: "+err.Error())
		}
	}

	if syncInterval > 0 && h.Sync != nil {
		h.Sync.SetInterval(syncInterval)
		if err := h.DB.SetSetting("sync_interval", body.SyncInterval); err != nil {
			log.Printf("[config] failed to persist sync_interval: %v", err)
			persistWarnings = append(persistWarnings, "sync_interval could not be persisted: "+err.Error())
		}
	}

	if body.CacheDir != "" && h.RemoteSource != nil {
		h.RemoteSource.SetCacheDir(body.CacheDir)
		if err := h.DB.SetSetting("cache_dir", body.CacheDir); err != nil {
			log.Printf("[config] failed to persist cache_dir: %v", err)
			persistWarnings = append(persistWarnings, "cache_dir could not be persisted: "+err.Error())
		}
	}

	// Build and return the updated config, including any persistence warnings.
	cfg := map[string]any{
		"appMode": h.AppMode,
	}
	if h.RemoteSource != nil {
		cfg["serverUrl"] = h.RemoteSource.GetServerURL()
		cfg["refreshInterval"] = h.RemoteSource.GetInterval().String()
		cfg["cacheDir"] = h.RemoteSource.GetCacheDir()
	}
	if h.Sync != nil {
		cfg["syncInterval"] = h.Sync.GetInterval().String()
	}
	if len(persistWarnings) > 0 {
		cfg["persistWarnings"] = persistWarnings
	}
	respondJSON(w, http.StatusOK, cfg)
}

// ListWalkthroughs handles GET /api/walkthroughs
func (h *Handler) ListWalkthroughs(w http.ResponseWriter, r *http.Request) {
	metas, err := h.Source.List()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to list walkthroughs")
		return
	}

	// Merge any locally-added walkthroughs (server mode ingest).
	// Local walkthroughs take precedence over the primary source so that the
	// list and detail endpoints agree when an ingested walkthrough overrides an
	// existing ID.
	localMetas, err := h.DB.ListLocalWalkthroughs()
	if err == nil && len(localMetas) > 0 {
		idxByID := make(map[string]int, len(metas))
		for i, m := range metas {
			idxByID[m.ID] = i
		}
		for _, lm := range localMetas {
			if idx, dup := idxByID[lm.ID]; dup {
				metas[idx] = lm // local overrides primary source
			} else {
				metas = append(metas, lm)
			}
		}
	}

	respondJSON(w, http.StatusOK, metas)
}

// GetWalkthrough handles GET /api/walkthroughs/{id}
func (h *Handler) GetWalkthrough(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondError(w, http.StatusBadRequest, "missing id")
		return
	}

	// Check local DB first (covers walkthroughs added via ingest pipeline).
	local, err := h.DB.GetLocalWalkthrough(id)
	if err == nil && local != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(local)
		return
	}

	data, err := h.Source.Get(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "walkthrough not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// ListCheckouts handles GET /api/checkouts — returns IDs of checked-out walkthroughs.
// An empty list is a valid response and means no walkthroughs are currently checked out.
func (h *Handler) ListCheckouts(w http.ResponseWriter, r *http.Request) {
	ids, err := h.DB.ListCheckoutIDs()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to retrieve checkout list")
		return
	}
	respondJSON(w, http.StatusOK, ids)
}

// PutCheckout handles PUT /api/checkouts/{id} — checks out a walkthrough to this client.
// It records the checkout in the DB and eagerly fetches the walkthrough content so it is
// available offline immediately.
func (h *Handler) PutCheckout(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondError(w, http.StatusBadRequest, "missing id")
		return
	}

	if err := h.DB.Checkout(id); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to checkout")
		return
	}

	// Eagerly fetch the content so it is cached locally for offline use.
	// Ignore errors — the walkthrough may not be available right now.
	_, _ = h.Source.Get(id)

	respondJSON(w, http.StatusOK, map[string]string{"walkthroughId": id, "status": "checked_out"})
}

// DeleteCheckout handles DELETE /api/checkouts/{id} — checks in a walkthrough.
func (h *Handler) DeleteCheckout(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondError(w, http.StatusBadRequest, "missing id")
		return
	}

	if err := h.DB.Checkin(id); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to checkin")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"walkthroughId": id, "status": "checked_in"})
}

func (h *Handler) GetProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	record, err := h.DB.GetProgress(id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "db error")
		return
	}
	if record == nil {
		respondError(w, http.StatusNotFound, "no progress found")
		return
	}
	respondJSON(w, http.StatusOK, record)
}

// PutProgress handles PUT /api/progress/{id}
func (h *Handler) PutProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body struct {
		CheckedSteps []string `json:"checkedSteps"`
		UpdatedAt    string   `json:"updatedAt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid body")
		return
	}

	t, err := time.Parse(time.RFC3339, body.UpdatedAt)
	if err != nil {
		t = time.Now().UTC()
	}

	record := &store.ProgressRecord{
		WalkthroughID: id,
		CheckedSteps:  body.CheckedSteps,
		UpdatedAt:     t,
	}
	if record.CheckedSteps == nil {
		record.CheckedSteps = []string{}
	}

	if err := h.DB.PutProgress(record); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to save progress")
		return
	}

	// In server mode, record which device was active on this walkthrough.
	if h.AppMode == "server" {
		deviceID := deviceIDFromRequest(r)
		_ = h.DB.RecordDeviceActivity(deviceID, id)
	}

	// In client mode, queue for upstream sync
	if h.Sync != nil {
		h.Sync.MarkDirty(id)
	}

	respondJSON(w, http.StatusOK, record)
}

// GetDevices handles GET /api/server/devices — returns all known client devices and their activity.
func (h *Handler) GetDevices(w http.ResponseWriter, r *http.Request) {
	if !h.requireServerMode(w) {
		return
	}

	devices, err := h.DB.ListDeviceActivity()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to list devices")
		return
	}
	respondJSON(w, http.StatusOK, devices)
}

// deviceIDFromRequest returns a stable device identifier from the request.
// It prefers the X-Device-ID header set by the client, falling back to the remote IP.
func deviceIDFromRequest(r *http.Request) string {
	if id := r.Header.Get("X-Device-ID"); id != "" {
		return strings.TrimSpace(id)
	}
	// Use net.SplitHostPort to correctly handle both IPv4 and IPv6 addresses.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
