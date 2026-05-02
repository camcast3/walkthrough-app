package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type ProgressRecord struct {
	WalkthroughID string    `json:"walkthroughId"`
	CheckedSteps  []string  `json:"checkedSteps"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type DB struct {
	db *sql.DB
}

func Open(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &DB{db: db}, nil
}

func (s *DB) Close() error {
	return s.db.Close()
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS progress (
			walkthrough_id TEXT PRIMARY KEY,
			checked_steps  TEXT NOT NULL DEFAULT '[]',
			updated_at     TEXT NOT NULL
		)
	`)
	return err
}

func (s *DB) GetProgress(walkthroughID string) (*ProgressRecord, error) {
	row := s.db.QueryRow(
		`SELECT walkthrough_id, checked_steps, updated_at FROM progress WHERE walkthrough_id = ?`,
		walkthroughID,
	)
	var id, stepsJSON, updatedAt string
	if err := row.Scan(&id, &stepsJSON, &updatedAt); err == sql.ErrNoRows {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var steps []string
	if err := json.Unmarshal([]byte(stepsJSON), &steps); err != nil {
		steps = []string{}
	}

	t, _ := time.Parse(time.RFC3339, updatedAt)
	return &ProgressRecord{
		WalkthroughID: id,
		CheckedSteps:  steps,
		UpdatedAt:     t,
	}, nil
}

func (s *DB) PutProgress(r *ProgressRecord) error {
	stepsJSON, err := json.Marshal(r.CheckedSteps)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO progress (walkthrough_id, checked_steps, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(walkthrough_id) DO UPDATE SET
		   checked_steps = excluded.checked_steps,
		   updated_at    = excluded.updated_at`,
		r.WalkthroughID,
		string(stepsJSON),
		r.UpdatedAt.UTC().Format(time.RFC3339),
	)
	return err
}

// WalkthroughMeta holds the summary fields served at GET /api/walkthroughs.
type WalkthroughMeta struct {
	ID        string       `json:"id"`
	Game      string       `json:"game"`
	Title     string       `json:"title"`
	Author    string       `json:"author"`
	CreatedAt string       `json:"created_at"`
	Hltb      *HltbData    `json:"hltb,omitempty"`
}

// HltbData holds HowLongToBeat time estimates in hours.
type HltbData struct {
	MainStory    *float64 `json:"main_story,omitempty"`
	Completionist *float64 `json:"completionist,omitempty"`
}

// ParseMetaFromJSON extracts summary fields from a full walkthrough JSON.
func ParseMetaFromJSON(data []byte) (*WalkthroughMeta, error) {
	var m struct {
		ID        string    `json:"id"`
		Game      string    `json:"game"`
		Title     string    `json:"title"`
		Author    string    `json:"author"`
		CreatedAt string    `json:"created_at"`
		Hltb      *HltbData `json:"hltb"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	_ = strings.TrimSpace // imported for use elsewhere if needed
	return &WalkthroughMeta{
		ID:        m.ID,
		Game:      m.Game,
		Title:     m.Title,
		Author:    m.Author,
		CreatedAt: m.CreatedAt,
		Hltb:      m.Hltb,
	}, nil
}
