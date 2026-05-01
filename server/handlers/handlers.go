package handlers

import (
	"encoding/json"
	"net/http"
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
	respondJSON(w, http.StatusOK, map[string]string{
		"appMode": h.AppMode,
	})
}

// ListWalkthroughs handles GET /api/walkthroughs
func (h *Handler) ListWalkthroughs(w http.ResponseWriter, r *http.Request) {
	metas, err := h.Source.List()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to list walkthroughs")
		return
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

	data, err := h.Source.Get(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "walkthrough not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// GetProgress handles GET /api/progress/{id}
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

	// In client mode, queue for upstream sync
	if h.Sync != nil {
		h.Sync.MarkDirty(id)
	}

	respondJSON(w, http.StatusOK, record)
}
