package store

import (
	"testing"
	"time"
)

func openTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(":memory:")
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
