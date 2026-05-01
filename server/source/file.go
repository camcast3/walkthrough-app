package source

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"walkthrough-server/store"
)

// FileSource reads walkthroughs from a local directory. Used for local dev.
type FileSource struct {
	Dir string
}

func NewFileSource(dir string) *FileSource {
	return &FileSource{Dir: dir}
}

func (s *FileSource) List() ([]store.WalkthroughMeta, error) {
	var metas []store.WalkthroughMeta

	err := filepath.WalkDir(s.Dir, func(path string, d fs.DirEntry, err error) error {
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
		return nil, fmt.Errorf("walk dir: %w", err)
	}

	if metas == nil {
		metas = []store.WalkthroughMeta{}
	}
	return metas, nil
}

func (s *FileSource) Get(id string) ([]byte, error) {
	var found []byte

	_ = filepath.WalkDir(s.Dir, func(path string, d fs.DirEntry, err error) error {
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
		return nil, fmt.Errorf("walkthrough %q not found", id)
	}
	return found, nil
}
