package store

import (
	"fmt"
	"testing"
	"time"
)

func openTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestParseMetaFromJSON(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		data := `{"id":"w1","game":"Portal","title":"Full Guide","author":"Alice","created_at":"2024-01-01"}`
		meta, err := ParseMetaFromJSON([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		if meta.ID != "w1" || meta.Game != "Portal" || meta.Title != "Full Guide" || meta.Author != "Alice" {
			t.Errorf("unexpected meta: %+v", meta)
		}
	})

	t.Run("missing_optional_fields", func(t *testing.T) {
		data := `{"id":"w2"}`
		meta, err := ParseMetaFromJSON([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		if meta.ID != "w2" || meta.Game != "" || meta.Author != "" {
			t.Errorf("unexpected meta: %+v", meta)
		}
	})

	t.Run("invalid_json", func(t *testing.T) {
		_, err := ParseMetaFromJSON([]byte(`not valid json`))
		if err == nil {
			t.Error("expected error for invalid JSON, got nil")
		}
	})
}

func TestPutGetProgress(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	rec := &ProgressRecord{
		WalkthroughID: "wt1",
		CheckedSteps:  []string{"step1", "step2"},
		UpdatedAt:     now,
	}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}
	got, err := db.GetProgress("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected record, got nil")
	}
	if got.WalkthroughID != "wt1" {
		t.Errorf("id mismatch: %s", got.WalkthroughID)
	}
	if len(got.CheckedSteps) != 2 || got.CheckedSteps[0] != "step1" || got.CheckedSteps[1] != "step2" {
		t.Errorf("steps mismatch: %v", got.CheckedSteps)
	}
	if !got.UpdatedAt.Equal(now) {
		t.Errorf("time mismatch: got %v want %v", got.UpdatedAt, now)
	}
}

func TestGetProgressNotFound(t *testing.T) {
	db := openTestDB(t)
	got, err := db.GetProgress("nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestPutProgressUpdate(t *testing.T) {
	db := openTestDB(t)
	rec := &ProgressRecord{
		WalkthroughID: "wt1",
		CheckedSteps:  []string{"s1"},
		UpdatedAt:     time.Now().UTC(),
	}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}

	rec.CheckedSteps = []string{"s1", "s2", "s3"}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}

	got, err := db.GetProgress("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.CheckedSteps) != 3 {
		t.Errorf("expected 3 steps after upsert, got %d: %v", len(got.CheckedSteps), got.CheckedSteps)
	}
}

func TestCheckoutCheckin(t *testing.T) {
	db := openTestDB(t)

	checked, err := db.IsCheckedOut("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if checked {
		t.Error("expected not checked out before Checkout()")
	}

	if err := db.Checkout("wt1"); err != nil {
		t.Fatalf("Checkout: %v", err)
	}

	checked, err = db.IsCheckedOut("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if !checked {
		t.Error("expected checked out after Checkout()")
	}

	ids, err := db.ListCheckoutIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "wt1" {
		t.Errorf("expected [wt1], got %v", ids)
	}

	if err := db.Checkin("wt1"); err != nil {
		t.Fatalf("Checkin: %v", err)
	}

	checked, err = db.IsCheckedOut("wt1")
	if err != nil {
		t.Fatal(err)
	}
	if checked {
		t.Error("expected not checked out after Checkin()")
	}
}

func TestListCheckoutIDsEmpty(t *testing.T) {
	db := openTestDB(t)
	ids, err := db.ListCheckoutIDs()
	if err != nil {
		t.Fatal(err)
	}
	if ids == nil {
		t.Error("expected empty slice, got nil")
	}
	if len(ids) != 0 {
		t.Errorf("expected empty, got %v", ids)
	}
}

func TestAddGetLocalWalkthrough(t *testing.T) {
	db := openTestDB(t)
	data := []byte(`{"id":"lw1","game":"Portal","title":"T1","sections":[{}]}`)

	if err := db.AddLocalWalkthrough("lw1", data); err != nil {
		t.Fatalf("AddLocalWalkthrough: %v", err)
	}

	got, err := db.GetLocalWalkthrough("lw1")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(data) {
		t.Errorf("data mismatch: got %s want %s", got, data)
	}

	notFound, err := db.GetLocalWalkthrough("noexist")
	if err != nil {
		t.Fatal(err)
	}
	if notFound != nil {
		t.Error("expected nil for missing walkthrough, got data")
	}
}

func TestListLocalWalkthroughs(t *testing.T) {
	db := openTestDB(t)
	walkthroughs := []struct{ id, game, title string }{
		{"a1", "Game A", "Guide A"},
		{"b2", "Game B", "Guide B"},
		{"c3", "Game C", "Guide C"},
	}
	for _, w := range walkthroughs {
		data := []byte(`{"id":"` + w.id + `","game":"` + w.game + `","title":"` + w.title + `","sections":[{}]}`)
		if err := db.AddLocalWalkthrough(w.id, data); err != nil {
			t.Fatalf("AddLocalWalkthrough(%s): %v", w.id, err)
		}
	}

	metas, err := db.ListLocalWalkthroughs()
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 3 {
		t.Errorf("expected 3 walkthroughs, got %d", len(metas))
	}
	ids := make(map[string]bool)
	for _, m := range metas {
		ids[m.ID] = true
	}
	for _, w := range walkthroughs {
		if !ids[w.id] {
			t.Errorf("missing walkthrough %s in list", w.id)
		}
	}
}

func TestRecordListDeviceActivity(t *testing.T) {
	db := openTestDB(t)

	if err := db.RecordDeviceActivity("device1", "wt1"); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordDeviceActivity("device1", "wt2"); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordDeviceActivity("device2", "wt1"); err != nil {
		t.Fatal(err)
	}

	devices, err := db.ListDeviceActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}

	byID := make(map[string]DeviceActivity)
	for _, d := range devices {
		byID[d.DeviceID] = d
	}

	if d1, ok := byID["device1"]; !ok {
		t.Error("device1 not found")
	} else if len(d1.Walkthroughs) != 2 {
		t.Errorf("device1: expected 2 walkthroughs, got %d", len(d1.Walkthroughs))
	}

	if d2, ok := byID["device2"]; !ok {
		t.Error("device2 not found")
	} else if len(d2.Walkthroughs) != 1 {
		t.Errorf("device2: expected 1 walkthrough, got %d", len(d2.Walkthroughs))
	}
}

func TestRecordDeviceCheckout(t *testing.T) {
	db := openTestDB(t)

	if err := db.RecordDeviceCheckout("device1", "wt1"); err != nil {
		t.Fatalf("RecordDeviceCheckout: %v", err)
	}
	if err := db.RecordDeviceCheckout("device1", "wt2"); err != nil {
		t.Fatalf("RecordDeviceCheckout: %v", err)
	}
	if err := db.RecordDeviceCheckout("device2", "wt1"); err != nil {
		t.Fatalf("RecordDeviceCheckout: %v", err)
	}

	devices, err := db.ListDeviceActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}

	byID := make(map[string]DeviceActivity)
	for _, d := range devices {
		byID[d.DeviceID] = d
	}

	if d1, ok := byID["device1"]; !ok {
		t.Error("device1 not found")
	} else if len(d1.CheckedOut) != 2 {
		t.Errorf("device1: expected 2 checked-out walkthroughs, got %d: %v", len(d1.CheckedOut), d1.CheckedOut)
	}

	if d2, ok := byID["device2"]; !ok {
		t.Error("device2 not found")
	} else if len(d2.CheckedOut) != 1 || d2.CheckedOut[0] != "wt1" {
		t.Errorf("device2: expected [wt1] checked-out, got %v", d2.CheckedOut)
	}
}

func TestRecordDeviceCheckin(t *testing.T) {
	db := openTestDB(t)

	if err := db.RecordDeviceCheckout("device1", "wt1"); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordDeviceCheckout("device1", "wt2"); err != nil {
		t.Fatal(err)
	}

	// Check in wt1
	if err := db.RecordDeviceCheckin("device1", "wt1"); err != nil {
		t.Fatalf("RecordDeviceCheckin: %v", err)
	}

	devices, err := db.ListDeviceActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if len(devices[0].CheckedOut) != 1 || devices[0].CheckedOut[0] != "wt2" {
		t.Errorf("expected [wt2] after checkin of wt1, got %v", devices[0].CheckedOut)
	}
}

func TestListDeviceActivity_CheckedOutEmpty(t *testing.T) {
	db := openTestDB(t)

	// Activity without checkouts
	if err := db.RecordDeviceActivity("device1", "wt1"); err != nil {
		t.Fatal(err)
	}

	devices, err := db.ListDeviceActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0].CheckedOut == nil {
		t.Error("CheckedOut should be empty slice, not nil")
	}
	if len(devices[0].CheckedOut) != 0 {
		t.Errorf("expected no checkouts, got %v", devices[0].CheckedOut)
	}
}

func TestListDeviceActivity_CheckoutOnlyDevice(t *testing.T) {
	db := openTestDB(t)

	// Checkout without any progress activity
	if err := db.RecordDeviceCheckout("device-co", "wt1"); err != nil {
		t.Fatal(err)
	}

	devices, err := db.ListDeviceActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0].DeviceID != "device-co" {
		t.Errorf("unexpected device id: %s", devices[0].DeviceID)
	}
	if len(devices[0].CheckedOut) != 1 || devices[0].CheckedOut[0] != "wt1" {
		t.Errorf("expected checked_out=[wt1], got %v", devices[0].CheckedOut)
	}
	if len(devices[0].Walkthroughs) != 0 {
		t.Errorf("expected no activity walkthroughs, got %v", devices[0].Walkthroughs)
	}
}

// ── Step timestamps ───────────────────────────────────────────────────────────

func TestPutGetProgressWithStepTimestamps(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	ts := map[string]time.Time{
		"step1": now.Add(-5 * time.Minute),
		"step2": now,
	}
	rec := &ProgressRecord{
		WalkthroughID:  "wt-ts",
		CheckedSteps:   []string{"step1", "step2"},
		StepTimestamps: ts,
		UpdatedAt:      now,
	}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}

	got, err := db.GetProgress("wt-ts")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected record, got nil")
	}
	if len(got.StepTimestamps) != 2 {
		t.Errorf("expected 2 step timestamps, got %d: %v", len(got.StepTimestamps), got.StepTimestamps)
	}
	if !got.StepTimestamps["step1"].Equal(ts["step1"]) {
		t.Errorf("step1 timestamp mismatch: got %v want %v", got.StepTimestamps["step1"], ts["step1"])
	}
	if !got.StepTimestamps["step2"].Equal(ts["step2"]) {
		t.Errorf("step2 timestamp mismatch: got %v want %v", got.StepTimestamps["step2"], ts["step2"])
	}
}

func TestPutGetProgressNilTimestamps(t *testing.T) {
	db := openTestDB(t)
	rec := &ProgressRecord{
		WalkthroughID: "wt-no-ts",
		CheckedSteps:  []string{"step1"},
		UpdatedAt:     time.Now().UTC(),
	}
	if err := db.PutProgress(rec); err != nil {
		t.Fatal(err)
	}
	got, err := db.GetProgress("wt-no-ts")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected record, got nil")
	}
	// StepTimestamps should be an empty map (not nil) when none were provided.
	if got.StepTimestamps == nil {
		t.Error("expected non-nil StepTimestamps, got nil")
	}
}

// ── Progress history (SFV) ───────────────────────────────────────────────────

func TestAddProgressSnapshot_PrunesOldest(t *testing.T) {
	db := openTestDB(t)
	base := time.Now().UTC()

	for i := 0; i < maxProgressSnapshots+2; i++ {
		rec := &ProgressRecord{
			WalkthroughID: "wt-snap",
			CheckedSteps:  []string{fmt.Sprintf("s%d", i)},
			UpdatedAt:     base.Add(time.Duration(i) * time.Second),
		}
		if err := db.AddProgressSnapshot(rec); err != nil {
			t.Fatalf("AddProgressSnapshot(%d): %v", i, err)
		}
	}

	history, err := db.GetProgressHistory("wt-snap")
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != maxProgressSnapshots {
		t.Errorf("expected %d snapshots, got %d", maxProgressSnapshots, len(history))
	}
}

func TestGetProgressHistory_OrderedNewestFirst(t *testing.T) {
	db := openTestDB(t)
	base := time.Now().UTC()

	for i := 0; i < 3; i++ {
		rec := &ProgressRecord{
			WalkthroughID: "wt-order",
			CheckedSteps:  []string{fmt.Sprintf("step%d", i)},
			UpdatedAt:     base.Add(time.Duration(i) * time.Second),
		}
		if err := db.AddProgressSnapshot(rec); err != nil {
			t.Fatalf("AddProgressSnapshot(%d): %v", i, err)
		}
	}

	history, err := db.GetProgressHistory("wt-order")
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 3 {
		t.Fatalf("expected 3 snapshots, got %d", len(history))
	}
	// Newest first: step2, step1, step0
	if len(history[0].CheckedSteps) != 1 || history[0].CheckedSteps[0] != "step2" {
		t.Errorf("expected step2 first, got %v", history[0].CheckedSteps)
	}
}

func TestGetProgressHistory_EmptyWhenNone(t *testing.T) {
	db := openTestDB(t)
	history, err := db.GetProgressHistory("no-such-walkthrough")
	if err != nil {
		t.Fatal(err)
	}
	if history == nil {
		t.Error("expected empty slice, got nil")
	}
	if len(history) != 0 {
		t.Errorf("expected 0 snapshots, got %d", len(history))
	}
}

// ── MergeProgress ─────────────────────────────────────────────────────────────

func TestMergeProgress_LocalNewerWins(t *testing.T) {
	base := time.Now().UTC()
	local := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{"s1"},
		StepTimestamps: map[string]time.Time{
			"s1": base.Add(10 * time.Second), // local toggled s1 more recently
			"s2": base.Add(-5 * time.Second), // local toggled s2 earlier
		},
		UpdatedAt: base,
	}
	remote := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{"s1", "s2"},
		StepTimestamps: map[string]time.Time{
			"s1": base,                       // remote toggled s1 earlier
			"s2": base.Add(20 * time.Second), // remote toggled s2 more recently
		},
		UpdatedAt: base.Add(20 * time.Second),
	}

	merged := MergeProgress(local, remote)

	// s1: local is newer (base+10s > base) — local has s1 checked → s1 in merged
	// s2: remote is newer (base+20s > base-5s) — remote has s2 checked → s2 in merged
	checkedSet := make(map[string]bool)
	for _, id := range merged.CheckedSteps {
		checkedSet[id] = true
	}
	if !checkedSet["s1"] {
		t.Error("expected s1 to be checked (local is newer)")
	}
	if !checkedSet["s2"] {
		t.Error("expected s2 to be checked (remote is newer)")
	}
}

func TestMergeProgress_RemoteUncheckWins(t *testing.T) {
	base := time.Now().UTC()
	local := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{"s1"},
		StepTimestamps: map[string]time.Time{
			"s1": base, // checked at base
		},
		UpdatedAt: base,
	}
	remote := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{}, // s1 was unchecked
		StepTimestamps: map[string]time.Time{
			"s1": base.Add(5 * time.Second), // unchecked later than local checked it
		},
		UpdatedAt: base.Add(5 * time.Second),
	}

	merged := MergeProgress(local, remote)

	for _, id := range merged.CheckedSteps {
		if id == "s1" {
			t.Error("expected s1 to be unchecked: remote unchecked it more recently")
		}
	}
}

func TestMergeProgress_NilTimestampsFallsBack(t *testing.T) {
	base := time.Now().UTC()
	local := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{"s1"},
		UpdatedAt:     base,
	}
	remote := &ProgressRecord{
		WalkthroughID: "wt",
		CheckedSteps:  []string{"s2"},
		UpdatedAt:     base.Add(time.Minute),
	}

	// Neither side has step timestamps; merge should produce an empty set
	// (no timestamps means neither side has any steps to merge).
	merged := MergeProgress(local, remote)
	if len(merged.CheckedSteps) != 0 {
		t.Errorf("expected empty merged steps when no timestamps, got %v", merged.CheckedSteps)
	}
	// UpdatedAt should be the max of the two sides.
	if !merged.UpdatedAt.Equal(base.Add(time.Minute)) {
		t.Errorf("expected updatedAt=%v, got %v", base.Add(time.Minute), merged.UpdatedAt)
	}
}
