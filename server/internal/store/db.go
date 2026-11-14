// Package store is the portal's own MongoDB access layer.
//
// The portal used to be a thin proxy with no data of its own: the console asked
// the bus for everything. It now owns the user-facing entities — the user's
// agents, their groups and binding preferences, and the session projection — so
// it needs a connection, migrations and the same store conventions the other
// modules use.
package store

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"

	"gitee.com/kobeyoung81/nanoportal/server/internal/metrics"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Store provides access to the portal's collections.
type Store struct {
	mongo *mongo.Client
	db    *mongo.Database
	// userTier is the one fact about an account this service still asks for: the
	// tier that caps how many agents a user may create. It comes from the service
	// that owns accounts (the bus today, nanoauth after the auth slice). The
	// binding→owner lookup is read directly (see bindings.go).
	userTier func(userID string) (string, error)
}

// Open connects and waits for the server to answer, so a bad URI or bad
// credentials fail at startup rather than on the first request.
func Open(mongoURI string) (*Store, error) {
	if mongoURI == "" {
		return nil, errors.New("mongo uri is required")
	}
	name, err := databaseNameOf(mongoURI)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// One monitor per client: it feeds the module's database numbers (command
	// counts and latency) without every call site having to time itself.
	client, err := mongo.Connect(options.Client().
		ApplyURI(mongoURI).
		SetMonitor(metrics.Monitor()))
	if err != nil {
		return nil, fmt.Errorf("connect mongo: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("ping mongo: %w", err)
	}
	return &Store{mongo: client, db: client.Database(name)}, nil
}

// databaseNameOf extracts the database name from the URI's path: an unnamed URI
// is an error rather than a silent fallback to the driver's default.
func databaseNameOf(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("parse mongo uri: %w", err)
	}
	name := strings.Trim(u.Path, "/")
	if name == "" {
		return "", errors.New("mongo uri must name a database, e.g. mongodb://host:27017/nanosec")
	}
	if i := strings.IndexByte(name, '/'); i >= 0 {
		return "", fmt.Errorf("mongo uri names more than one database: %q", name)
	}
	return name, nil
}

// NewMongo wraps an existing client (tests use it).
func NewMongo(client *mongo.Client, database string) *Store {
	return &Store{mongo: client, db: client.Database(database)}
}

// Close releases the client.
func (s *Store) Close() error {
	if s.mongo == nil {
		return nil
	}
	return s.mongo.Disconnect(context.Background())
}

// SetUserTier wires the account lookup the agent store needs.
func (s *Store) SetUserTier(userTier func(string) (string, error)) {
	s.userTier = userTier
}

// DB exposes the database for the few queries the repository layer runs itself.
func (s *Store) DB() *mongo.Database { return s.db }

const opTimeout = 15 * time.Second

func opCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), opTimeout)
}

// retryOnDuplicateUpsert retries once on a duplicate-key error: MongoDB
// documents that concurrent upserts on a unique index can raise E11000 instead
// of updating in place.
func retryOnDuplicateUpsert(fn func() error) error {
	err := fn()
	if err != nil && mongo.IsDuplicateKeyError(err) {
		return fn()
	}
	return err
}
