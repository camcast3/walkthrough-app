package source

import (
	"os"
	"path/filepath"
	"testing"
)

func writeJSON(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestFileSourceList(t *testing.T) {
	dir := t.TempDir()

	writeJSON(t, dir, "wt1.json", `{"id":"wt1","game":"Portal","title":"Guide 1","sections":[{}]}`)
	writeJSON(t, dir, "wt2.json", `{"id":"wt2","game":"HalfLife","title":"Guide 2","sections":[{}]}`)
	// Invalid JSON — should be skipped.
	writeJSON(t, dir, "broken.json", `not valid json {{{`)
	// Missing ID — should be skipped.
	writeJSON(t, dir, "noid.json", `{"game":"X","title":"Y","sections":[{}]}`)

	fs := NewFileSource(dir)
	metas, err := fs.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 2 {
		t.Errorf("expected 2 valid walkthroughs, got %d: %+v", len(metas), metas)
	}
	ids := make(map[string]bool)
	for _, m := range metas {
		ids[m.ID] = true
	}
	if !ids["wt1"] || !ids["wt2"] {
		t.Errorf("missing expected IDs in %v", ids)
	}
}

func TestFileSourceListEmpty(t *testing.T) {
	dir := t.TempDir()

	fs := NewFileSource(dir)
	metas, err := fs.List()
	if err != nil {
		t.Fatal(err)
	}
	if metas == nil {
		t.Error("expected non-nil empty slice, got nil")
	}
	if len(metas) != 0 {
		t.Errorf("expected 0 walkthroughs, got %d", len(metas))
	}
}

func TestFileSourceGet(t *testing.T) {
	dir := t.TempDir()
	content := `{"id":"wt1","game":"Portal","title":"Full Guide","sections":[{}]}`
	writeJSON(t, dir, "wt1.json", content)

	fs := NewFileSource(dir)
	data, err := fs.Get("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != content {
		t.Errorf("got %s, want %s", data, content)
	}
}

func TestFileSourceGetNotFound(t *testing.T) {
	dir := t.TempDir()

	fs := NewFileSource(dir)
	_, err := fs.Get("nonexistent-id")
	if err == nil {
		t.Error("expected error for unknown walkthrough ID, got nil")
	}
}
