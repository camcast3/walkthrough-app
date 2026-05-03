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
		);
		CREATE TABLE IF NOT EXISTS checkouts (
			walkthrough_id  TEXT PRIMARY KEY,
			checked_out_at  TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS local_walkthroughs (
			id       TEXT PRIMARY KEY,
			data     TEXT NOT NULL,
			added_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS device_activity (
			device_id      TEXT NOT NULL,
			walkthrough_id TEXT NOT NULL,
			last_seen      TEXT NOT NULL,
			PRIMARY KEY (device_id, walkthrough_id)
		);
		CREATE TABLE IF NOT EXISTS device_checkouts (
			device_id      TEXT NOT NULL,
			walkthrough_id TEXT NOT NULL,
			checked_out_at TEXT NOT NULL,
			PRIMARY KEY (device_id, walkthrough_id)
		);
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

// Checkout marks a walkthrough as checked out on this client.
func (s *DB) Checkout(walkthroughID string) error {
	_, err := s.db.Exec(
		`INSERT INTO checkouts (walkthrough_id, checked_out_at)
		 VALUES (?, ?)
		 ON CONFLICT(walkthrough_id) DO NOTHING`,
		walkthroughID,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// Checkin removes a walkthrough from the checkout list on this client.
func (s *DB) Checkin(walkthroughID string) error {
	_, err := s.db.Exec(`DELETE FROM checkouts WHERE walkthrough_id = ?`, walkthroughID)
	return err
}

// ListCheckoutIDs returns the IDs of all walkthroughs currently checked out.
func (s *DB) ListCheckoutIDs() ([]string, error) {
	rows, err := s.db.Query(`SELECT walkthrough_id FROM checkouts ORDER BY checked_out_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, rows.Err()
}

// IsCheckedOut returns true if the given walkthrough is checked out.
func (s *DB) IsCheckedOut(walkthroughID string) (bool, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM checkouts WHERE walkthrough_id = ?`, walkthroughID,
	).Scan(&count)
	return count > 0, err
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
	MainStory      *float64 `json:"main_story,omitempty"`
	MainStorySides *float64 `json:"main_story_sides,omitempty"`
	Completionist  *float64 `json:"completionist,omitempty"`
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

// AddLocalWalkthrough stores a walkthrough JSON in the local database.
func (s *DB) AddLocalWalkthrough(id string, data []byte) error {
	_, err := s.db.Exec(
		`INSERT INTO local_walkthroughs (id, data, added_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data, added_at = excluded.added_at`,
		id,
		string(data),
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// GetLocalWalkthrough returns raw walkthrough JSON stored locally, or nil if not found.
func (s *DB) GetLocalWalkthrough(id string) ([]byte, error) {
	var data string
	err := s.db.QueryRow(`SELECT data FROM local_walkthroughs WHERE id = ?`, id).Scan(&data)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(data), nil
}

// ListLocalWalkthroughs returns metadata for all locally stored walkthroughs.
func (s *DB) ListLocalWalkthroughs() ([]WalkthroughMeta, error) {
	rows, err := s.db.Query(`SELECT data FROM local_walkthroughs ORDER BY added_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metas []WalkthroughMeta
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		meta, err := ParseMetaFromJSON([]byte(data))
		if err != nil || meta == nil || meta.ID == "" {
			continue
		}
		metas = append(metas, *meta)
	}
	if metas == nil {
		metas = []WalkthroughMeta{}
	}
	return metas, rows.Err()
}

// DeviceActivity describes a client device and the walkthroughs it has interacted with.
type DeviceActivity struct {
	DeviceID     string    `json:"device_id"`
	LastSeen     time.Time `json:"last_seen"`
	Walkthroughs []string  `json:"walkthroughs"`
	CheckedOut   []string  `json:"checked_out"`
}

// RecordDeviceActivity records that a device was active on a specific walkthrough.
func (s *DB) RecordDeviceActivity(deviceID, walkthroughID string) error {
	_, err := s.db.Exec(
		`INSERT INTO device_activity (device_id, walkthrough_id, last_seen)
		 VALUES (?, ?, ?)
		 ON CONFLICT(device_id, walkthrough_id) DO UPDATE SET last_seen = excluded.last_seen`,
		deviceID,
		walkthroughID,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// ListDeviceActivity returns all known devices, their associated walkthroughs, and current checkouts.
func (s *DB) ListDeviceActivity() ([]DeviceActivity, error) {
	byDevice := make(map[string]*DeviceActivity)
	var order []string

	// Load activity records.
	actRows, err := s.db.Query(
		`SELECT device_id, walkthrough_id, last_seen
		 FROM device_activity
		 ORDER BY device_id, last_seen DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer actRows.Close()

	for actRows.Next() {
		var deviceID, walkthroughID, lastSeenStr string
		if err := actRows.Scan(&deviceID, &walkthroughID, &lastSeenStr); err != nil {
			return nil, err
		}
		t, _ := time.Parse(time.RFC3339, lastSeenStr)
		if _, exists := byDevice[deviceID]; !exists {
			byDevice[deviceID] = &DeviceActivity{DeviceID: deviceID, LastSeen: t}
			order = append(order, deviceID)
		}
		da := byDevice[deviceID]
		da.Walkthroughs = append(da.Walkthroughs, walkthroughID)
		if t.After(da.LastSeen) {
			da.LastSeen = t
		}
	}
	if err := actRows.Err(); err != nil {
		return nil, err
	}

	// Load checkout records.
	coRows, err := s.db.Query(
		`SELECT device_id, walkthrough_id FROM device_checkouts ORDER BY device_id, checked_out_at`,
	)
	if err != nil {
		return nil, err
	}
	defer coRows.Close()

	for coRows.Next() {
		var deviceID, walkthroughID string
		if err := coRows.Scan(&deviceID, &walkthroughID); err != nil {
			return nil, err
		}
		if _, exists := byDevice[deviceID]; !exists {
			byDevice[deviceID] = &DeviceActivity{DeviceID: deviceID}
			order = append(order, deviceID)
		}
		byDevice[deviceID].CheckedOut = append(byDevice[deviceID].CheckedOut, walkthroughID)
	}
	if err := coRows.Err(); err != nil {
		return nil, err
	}

	result := make([]DeviceActivity, 0, len(order))
	for _, id := range order {
		da := byDevice[id]
		if da.Walkthroughs == nil {
			da.Walkthroughs = []string{}
		}
		if da.CheckedOut == nil {
			da.CheckedOut = []string{}
		}
		result = append(result, *da)
	}
	return result, nil
}

// RecordDeviceCheckout records that a device has checked out a specific walkthrough.
func (s *DB) RecordDeviceCheckout(deviceID, walkthroughID string) error {
	_, err := s.db.Exec(
		`INSERT INTO device_checkouts (device_id, walkthrough_id, checked_out_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(device_id, walkthrough_id) DO UPDATE SET checked_out_at = excluded.checked_out_at`,
		deviceID,
		walkthroughID,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// RecordDeviceCheckin removes a device's checkout record for a specific walkthrough.
func (s *DB) RecordDeviceCheckin(deviceID, walkthroughID string) error {
	_, err := s.db.Exec(
		`DELETE FROM device_checkouts WHERE device_id = ? AND walkthrough_id = ?`,
		deviceID,
		walkthroughID,
	)
	return err
}
