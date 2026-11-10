package store

import (
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// ClearAgentsTypeRef unsets type_id on every agent pointing at the type.
//
// The type catalogue belongs to the admin module now; when it deletes a type it
// asks its owner (this service) to clear the references first, so no agent is
// left pointing at a definition that no longer exists.
func (s *Store) ClearAgentsTypeRef(id string) (int, error) {
	ctx, cancel := opCtx()
	defer cancel()

	res, err := s.db.Collection(agentsCollection).UpdateMany(ctx,
		bson.D{{Key: "type_id", Value: id}},
		bson.D{
			{Key: "$unset", Value: bson.D{{Key: "type_id", Value: ""}}},
			{Key: "$set", Value: bson.D{{Key: "updated_at", Value: time.Now().UTC()}}},
		},
	)
	if err != nil {
		return 0, fmt.Errorf("clear agents of type %q: %w", id, err)
	}
	return int(res.ModifiedCount), nil
}
