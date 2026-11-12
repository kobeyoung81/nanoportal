package store

import (
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// EnsureDefaultAgent makes sure an account has at least one usable agent and
// returns it. Onboarding a channel identity creates the account and the
// container request but no agent; without this the account would have a running
// container and nobody to answer a message.
//
// It is idempotent: the first active agent wins, and only an account with no
// agent at all gets the deterministic "<userID>-default" row. A tombstone at
// that id is revived (the console's restore does the same), because "make sure
// the user has an agent" is an explicit instruction, not a resurrection by the
// supervisor.
func (s *Store) EnsureDefaultAgent(userID, typeID, displayName string) (string, bool, error) {
	if userID == "" {
		return "", false, fmt.Errorf("user id is required")
	}
	ctx, cancel := opCtx()
	defer cancel()

	var existing struct {
		ID string `bson:"_id"`
	}
	err := s.db.Collection(agentsCollection).FindOne(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}},
		},
		options.FindOne().
			SetSort(bson.D{{Key: "created_at", Value: 1}}).
			SetProjection(bson.D{{Key: "_id", Value: 1}}),
	).Decode(&existing)
	if err == nil {
		return existing.ID, false, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return "", false, fmt.Errorf("find the owner's agents: %w", err)
	}

	id := userID + "-default"
	if err := s.CreateAgent(AgentRecord{
		ID:                    id,
		UserID:                userID,
		TypeID:                typeID,
		DisplayName:           displayName,
		MaxConcurrentMessages: 4,
	}); err != nil {
		return "", false, err
	}

	// CreateAgent leaves an existing tombstone deleted (its status is $setOnInsert
	// only). Bring it back the way the console's restore does.
	if _, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{
			{Key: "_id", Value: id},
			{Key: "status", Value: "deleted"},
		},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: "provisioning"},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
	); err != nil {
		return "", false, fmt.Errorf("revive the default agent: %w", err)
	}
	return id, true, nil
}
