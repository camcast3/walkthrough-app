package handlers

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"walkthrough-server/store"
)

type Handler struct {
	DB              *store.DB
	WalkthroughsDir string // path to the /walkthroughs directory from the repo
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

// ListWalkthroughs handles GET /api/walkthroughs
// Scans WalkthroughsDir for *.json files and returns metadata.
func (h *Handler) ListWalkthroughs(w http.ResponseWriter, r *http.Request) {
	var metas []store.WalkthroughMeta

	err := filepath.WalkDir(h.WalkthroughsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(d.Name(), ".json") && d.Name() != "walkthrough.schema.json" {
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			meta, parseErr := store.ParseMetaFromJSON(data)
			if parseErr != nil || meta.ID == "" {
				return nil
			}
			metas = append(metas, *meta)
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to list walkthroughs")
		return
	}

	if metas == nil {
		metas = []store.WalkthroughMeta{}
	}
	respondJSON(w, http.StatusOK, metas)
}

// GetWalkthrough handles GET /api/walkthroughs/{id}
// Finds the JSON file whose top-level "id" matches and returns the full content.
func (h *Handler) GetWalkthrough(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondError(w, http.StatusBadRequest, "missing id")
		return
	}

	var found []byte
	_ = filepath.WalkDir(h.WalkthroughsDir, func(path string, d fs.DirEntry, err error) error {
		if found != nil || err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(d.Name(), ".json") && d.Name() != "walkthrough.schema.json" {
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			meta, parseErr := store.ParseMetaFromJSON(data)
			if parseErr == nil && meta.ID == id {
				found = data
			}
		}
		return nil
	})

	if found == nil {
		respondError(w, http.StatusNotFound, "walkthrough not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(found)
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
	respondJSON(w, http.StatusOK, record)
}
