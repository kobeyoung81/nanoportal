package store

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Channel bindings and the agent they talk to: the account lookup the agent
// resolution needs. Accounts are not this service's yet, so it is a read-only
// read of the channel embedded in the account document.

// userIDForBinding finds the account a binding id belongs to. Accounts are the
// bus's until the auth slice moves them, so this is a read-only lookup of the
// channel embedded in the account document.
func (s *Store) userIDForBinding(ctx context.Context, bindingID int64) (string, error) {
	var doc struct {
		ID string `bson:"_id"`
	}
	err := s.db.Collection(authUsersCollection).FindOne(ctx,
		bson.D{{Key: "channels.binding_id", Value: bindingID}},
		options.FindOne().SetProjection(bson.D{{Key: "_id", Value: 1}}),
	).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get binding owner: %w", err)
	}
	return doc.ID, nil
}
