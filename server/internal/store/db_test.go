package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/migrations"
)

// These tests need a real MongoDB: the behaviour under test (the manifests
// creating indexes, the migration records being scoped by service) is the
// server's. Without NANOPORTAL_TEST_URI they skip rather than pretend to pass.
func testStore(t *testing.T) *Store {
	t.Helper()
	uri := os.Getenv("NANOPORTAL_TEST_URI")
	if uri == "" {
		t.Skip("NANOPORTAL_TEST_URI not set")
	}
	u, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse uri: %v", err)
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	u.Path = "/nanoportal_test_" + hex.EncodeToString(b[:])

	st, err := Open(u.String())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DB().Drop(context.Background())
		_ = st.Close()
	})

	manifests, err := migrations.Load()
	if err != nil {
		t.Fatalf("load manifests: %v", err)
	}
	if _, err := st.Migrate(manifests); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}

// The portal shares sys_migrations with the other modules; its records must be
// scoped so another module's manifest cannot look applied here.
func TestMigrationsAreScopedToThePortal(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	var record struct {
		ID string `bson:"_id"`
	}
	if err := st.DB().Collection("sys_migrations").FindOne(ctx,
		map[string]any{"service": "portal"}).Decode(&record); err != nil {
		t.Fatalf("read migration record: %v", err)
	}
	if len(record.ID) < len("portal:") || record.ID[:len("portal:")] != "portal:" {
		t.Fatalf("record id = %q, want a portal: prefix", record.ID)
	}
}

// Re-applying is a no-op: the manifests are declarative and the records say so.
func TestMigrationsAreIdempotent(t *testing.T) {
	st := testStore(t)
	manifests, err := migrations.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ran, err := st.Migrate(manifests)
	if err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
	if len(ran) != 0 {
		t.Fatalf("re-applied %d manifests, want 0", len(ran))
	}
}
