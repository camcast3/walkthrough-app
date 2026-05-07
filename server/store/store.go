package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type dialect int

const (
	dialectSQLite   dialect = iota
	dialectPostgres
)

type ProgressRecord struct {
	WalkthroughID  string            `json:"walkthroughId"`
	CheckedSteps   []string          `json:"checkedSteps"`
	StepTimestamps map[string]time.Time `json:"stepTimestamps,omitempty"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

type DB struct {
	db      *sql.DB
	dialect dialect
}

// OpenSQLite opens a SQLite database at the given file path (or ":memory:").
func OpenSQLite(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	s := &DB{db: db, dialect: dialectSQLite}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// OpenPostgres opens a PostgreSQL database using the given connection string.
func OpenPostgres(dsn string) (*DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	s := &DB{db: db, dialect: dialectPostgres}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Open is a backward-compatible alias for OpenSQLite.
func Open(path string) (*DB, error) {
	return OpenSQLite(path)
}

func (s *DB) Close() error {
	return s.db.Close()
}

// q rewrites SQL placeholders from ? to $1, $2, ... for PostgreSQL.
// SQLite queries are returned unchanged.
func (s *DB) q(query string) string {
	if s.dialect == dialectSQLite {
		return query
	}
	var b strings.Builder
	n := 1
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			fmt.Fprintf(&b, "$%d", n)
			n++
		} else {
			b.WriteByte(query[i])
		}
	}
	return b.String()
}

func (s *DB) migrate() error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS progress (
			walkthrough_id TEXT PRIMARY KEY,
			checked_steps  TEXT NOT NULL DEFAULT '[]',
			updated_at     TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS checkouts (
			walkthrough_id  TEXT PRIMARY KEY,
			checked_out_at  TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS local_walkthroughs (
			id       TEXT PRIMARY KEY,
			data     TEXT NOT NULL,
			added_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS device_activity (
			device_id      TEXT NOT NULL,
			walkthrough_id TEXT NOT NULL,
			last_seen      TEXT NOT NULL,
			PRIMARY KEY (device_id, walkthrough_id)
		)`,
		`CREATE TABLE IF NOT EXISTS device_checkouts (
			device_id      TEXT NOT NULL,
			walkthrough_id TEXT NOT NULL,
			checked_out_at TEXT NOT NULL,
			PRIMARY KEY (device_id, walkthrough_id)
		)`,
		`CREATE TABLE IF NOT EXISTS progress_history (
			walkthrough_id TEXT NOT NULL,
			snapshot       TEXT NOT NULL,
			saved_at       TEXT NOT NULL
		)`,
	}
	for _, ddl := range tables {
		if _, err := s.db.Exec(ddl); err != nil {
			return fmt.Errorf("exec %q: %w", ddl[:min(len(ddl), 40)], err)
		}
	}

	// Add step_timestamps column to progress table (idempotent).
	// Errors are intentionally swallowed: the only expected failure is "column
	// already exists" on a database that already ran this migration. Any other
	// failure (e.g. permissions) will be caught the first time the column is
	// actually read or written.
	// PostgreSQL supports IF NOT EXISTS on ALTER TABLE; SQLite does not, so we
	// rely on the swallowed error for idempotency there.
	if s.dialect == dialectPostgres {
		if _, err := s.db.Exec(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS step_timestamps TEXT NOT NULL DEFAULT '{}'`); err != nil {
			log.Printf("[store] migrate: add step_timestamps column: %v", err)
		}
	} else {
		// SQLite returns an error when the column already exists; ignore it.
		// We match both common variations of the "already exists" message.
		if _, err := s.db.Exec(`ALTER TABLE progress ADD COLUMN step_timestamps TEXT NOT NULL DEFAULT '{}'`); err != nil &&
			!strings.Contains(err.Error(), "duplicate column name") &&
			!strings.Contains(err.Error(), "already exists") {
			log.Printf("[store] migrate: add step_timestamps column: %v", err)
		}
	}

	return nil
}

func (s *DB) GetProgress(walkthroughID string) (*ProgressRecord, error) {
	row := s.db.QueryRow(
		s.q(`SELECT walkthrough_id, checked_steps, step_timestamps, updated_at FROM progress WHERE walkthrough_id = ?`),
		walkthroughID,
	)
	var id, stepsJSON, tsJSON, updatedAt string
	if err := row.Scan(&id, &stepsJSON, &tsJSON, &updatedAt); err == sql.ErrNoRows {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var steps []string
	if err := json.Unmarshal([]byte(stepsJSON), &steps); err != nil {
		steps = []string{}
	}

	stepTimestamps := parseStepTimestamps(tsJSON)

	t, _ := time.Parse(time.RFC3339, updatedAt)
	return &ProgressRecord{
		WalkthroughID:  id,
		CheckedSteps:   steps,
		StepTimestamps: stepTimestamps,
		UpdatedAt:      t,
	}, nil
}

// parseStepTimestamps decodes a JSON object of stepID → RFC3339 timestamp strings.
func parseStepTimestamps(tsJSON string) map[string]time.Time {
	var raw map[string]string
	if err := json.Unmarshal([]byte(tsJSON), &raw); err != nil || raw == nil {
		return map[string]time.Time{}
	}
	out := make(map[string]time.Time, len(raw))
	for k, v := range raw {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			out[k] = t
		}
	}
	return out
}

// encodeStepTimestamps serialises a map of stepID → time to a JSON string.
func encodeStepTimestamps(ts map[string]time.Time) (string, error) {
	raw := make(map[string]string, len(ts))
	for k, v := range ts {
		raw[k] = v.UTC().Format(time.RFC3339)
	}
	b, err := json.Marshal(raw)
	return string(b), err
}

func (s *DB) PutProgress(r *ProgressRecord) error {
	stepsJSON, err := json.Marshal(r.CheckedSteps)
	if err != nil {
		return err
	}
	tsJSON, err := encodeStepTimestamps(r.StepTimestamps)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		s.q(`INSERT INTO progress (walkthrough_id, checked_steps, step_timestamps, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(walkthrough_id) DO UPDATE SET
		   checked_steps   = excluded.checked_steps,
		   step_timestamps = excluded.step_timestamps,
		   updated_at      = excluded.updated_at`),
		r.WalkthroughID,
		string(stepsJSON),
		tsJSON,
		r.UpdatedAt.UTC().Format(time.RFC3339),
	)
	return err
}

// maxProgressSnapshots is the maximum number of historical snapshots retained per walkthrough.
const maxProgressSnapshots = 5

// AddProgressSnapshot saves the current state of a progress record as a historical
// snapshot and prunes older entries so at most maxProgressSnapshots are retained.
func (s *DB) AddProgressSnapshot(r *ProgressRecord) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	savedAt := r.UpdatedAt.UTC().Format(time.RFC3339Nano)
	_, err = s.db.Exec(
		s.q(`INSERT INTO progress_history (walkthrough_id, snapshot, saved_at) VALUES (?, ?, ?)`),
		r.WalkthroughID,
		string(data),
		savedAt,
	)
	if err != nil {
		return err
	}
	// Prune: keep only the newest maxProgressSnapshots entries per walkthrough.
	_, err = s.db.Exec(
		s.q(`DELETE FROM progress_history
		 WHERE walkthrough_id = ?
		   AND saved_at NOT IN (
		     SELECT saved_at FROM progress_history
		     WHERE walkthrough_id = ?
		     ORDER BY saved_at DESC
		     LIMIT ?
		   )`),
		r.WalkthroughID,
		r.WalkthroughID,
		maxProgressSnapshots,
	)
	return err
}

// GetProgressHistory returns up to maxProgressSnapshots historical snapshots for the
// given walkthrough, ordered newest first.
func (s *DB) GetProgressHistory(walkthroughID string) ([]*ProgressRecord, error) {
	rows, err := s.db.Query(
		s.q(`SELECT snapshot FROM progress_history
		 WHERE walkthrough_id = ?
		 ORDER BY saved_at DESC
		 LIMIT ?`),
		walkthroughID,
		maxProgressSnapshots,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []*ProgressRecord
	for rows.Next() {
		var snapshotJSON string
		if err := rows.Scan(&snapshotJSON); err != nil {
			return nil, err
		}
		var rec ProgressRecord
		if err := json.Unmarshal([]byte(snapshotJSON), &rec); err != nil {
			log.Printf("[store] GetProgressHistory: skipping malformed snapshot for %s: %v", walkthroughID, err)
			continue // skip malformed entries
		}
		records = append(records, &rec)
	}
	if records == nil {
		records = []*ProgressRecord{}
	}
	return records, rows.Err()
}

// MergeProgress applies an rsync-like per-step merge of remote into local.
// For each step, whichever side has the newer StepTimestamp wins (its checked
// state is used). The merged record is returned; neither receiver nor argument
// is modified.
func MergeProgress(local, remote *ProgressRecord) *ProgressRecord {
	localChecked := make(map[string]bool, len(local.CheckedSteps))
	for _, id := range local.CheckedSteps {
		localChecked[id] = true
	}
	remoteChecked := make(map[string]bool, len(remote.CheckedSteps))
	for _, id := range remote.CheckedSteps {
		remoteChecked[id] = true
	}

	// Union of all step IDs that have a recorded timestamp on either side.
	allIDs := make(map[string]bool)
	for id := range local.StepTimestamps {
		allIDs[id] = true
	}
	for id := range remote.StepTimestamps {
		allIDs[id] = true
	}

	mergedChecked := []string{}
	mergedTS := make(map[string]time.Time, len(allIDs))

	// Steps with no recorded toggle time in a side's StepTimestamps map will
	// have the zero value of time.Time from the map lookup. The zero value
	// (0001-01-01) compares as older than any real timestamp, so a real
	// timestamped version from the other side will always win.
	for id := range allIDs {
		localTS := local.StepTimestamps[id]   // zero if key absent
		remoteTS := remote.StepTimestamps[id] // zero if key absent

		if !localTS.Before(remoteTS) {
			// Local is same age or newer: keep local checked state.
			if localChecked[id] {
				mergedChecked = append(mergedChecked, id)
			}
			// Only store the timestamp when it is non-zero; a zero timestamp
			// means neither side recorded an actual toggle time for this step.
			// When local wins but localTS is zero, remoteTS must also be zero
			// (otherwise remote would have won), so we fall through without
			// storing any timestamp.
			if !localTS.IsZero() {
				mergedTS[id] = localTS
			} else if !remoteTS.IsZero() {
				mergedTS[id] = remoteTS
			}
		} else {
			// Remote is newer: use remote checked state.
			if remoteChecked[id] {
				mergedChecked = append(mergedChecked, id)
			}
			if !remoteTS.IsZero() {
				mergedTS[id] = remoteTS
			} else if !localTS.IsZero() {
				mergedTS[id] = localTS
			}
		}
	}

	// Determine the overall updatedAt as the max of the two sides.
	updatedAt := local.UpdatedAt
	if remote.UpdatedAt.After(updatedAt) {
		updatedAt = remote.UpdatedAt
	}

	return &ProgressRecord{
		WalkthroughID:  local.WalkthroughID,
		CheckedSteps:   mergedChecked,
		StepTimestamps: mergedTS,
		UpdatedAt:      updatedAt,
	}
}

// Checkout marks a walkthrough as checked out on this client.
func (s *DB) Checkout(walkthroughID string) error {
	_, err := s.db.Exec(
		s.q(`INSERT INTO checkouts (walkthrough_id, checked_out_at)
		 VALUES (?, ?)
		 ON CONFLICT(walkthrough_id) DO NOTHING`),
		walkthroughID,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// Checkin removes a walkthrough from the checkout list on this client.
func (s *DB) Checkin(walkthroughID string) error {
	_, err := s.db.Exec(s.q(`DELETE FROM checkouts WHERE walkthrough_id = ?`), walkthroughID)
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
		s.q(`SELECT COUNT(*) FROM checkouts WHERE walkthrough_id = ?`), walkthroughID,
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
		s.q(`INSERT INTO local_walkthroughs (id, data, added_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data, added_at = excluded.added_at`),
		id,
		string(data),
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// GetLocalWalkthrough returns raw walkthrough JSON stored locally, or nil if not found.
func (s *DB) GetLocalWalkthrough(id string) ([]byte, error) {
	var data string
	err := s.db.QueryRow(s.q(`SELECT data FROM local_walkthroughs WHERE id = ?`), id).Scan(&data)
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
		s.q(`INSERT INTO device_activity (device_id, walkthrough_id, last_seen)
		 VALUES (?, ?, ?)
		 ON CONFLICT(device_id, walkthrough_id) DO UPDATE SET last_seen = excluded.last_seen`),
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
		s.q(`INSERT INTO device_checkouts (device_id, walkthrough_id, checked_out_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(device_id, walkthrough_id) DO UPDATE SET checked_out_at = excluded.checked_out_at`),
		deviceID,
		walkthroughID,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// RecordDeviceCheckin removes a device's checkout record for a specific walkthrough.
func (s *DB) RecordDeviceCheckin(deviceID, walkthroughID string) error {
	_, err := s.db.Exec(
		s.q(`DELETE FROM device_checkouts WHERE device_id = ? AND walkthrough_id = ?`),
		deviceID,
		walkthroughID,
	)
	return err
}
