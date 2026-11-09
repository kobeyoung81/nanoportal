package store

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ErrAgentOrderInvalid reports an arrange request that names an agent or group
// the caller does not own, repeats an agent, or points at a group that is not
// theirs. Nothing is written when it is returned.
var ErrAgentOrderInvalid = errors.New("the order must name only the caller's agents and groups, once each")

// ListAgentOrder returns the agents of each group in display order, plus the
// ungrouped ones.
//
// The order is (position, created_at): arrange writes 0..n, and an agent created
// afterwards carries a millisecond timestamp, so it sorts last until the next
// arrange. Legacy documents have no position at all and fall back to their
// creation order, which is what the sidebar showed before order was editable.
func (s *Store) ListAgentOrder(userID string) (map[string][]string, []string, error) {
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.db.Collection(agentsCollection).Find(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}},
		},
		options.Find().
			SetProjection(bson.D{
				{Key: "_id", Value: 1},
				{Key: "group_id", Value: 1},
				{Key: "position", Value: 1},
				{Key: "created_at", Value: 1},
			}).
			SetSort(bson.D{{Key: "position", Value: 1}, {Key: "created_at", Value: 1}}),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("list agent order: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	groups := map[string][]string{}
	ungrouped := []string{}
	for cur.Next(ctx) {
		var doc struct {
			ID      string `bson:"_id"`
			GroupID string `bson:"group_id"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, nil, fmt.Errorf("scan agent order: %w", err)
		}
		if doc.GroupID == "" {
			ungrouped = append(ungrouped, doc.ID)
		} else {
			groups[doc.GroupID] = append(groups[doc.GroupID], doc.ID)
		}
	}
	return groups, ungrouped, cur.Err()
}

// ArrangeAgents writes the sidebar's order in one round trip: each listed agent
// gets its group (or none) and its index within that group.
//
// Every id must name an agent and a group owned by userID, and no agent may
// appear twice. Ids omitted from the request keep their previous values, which
// makes a single "move to group" (the menu's path) a one-agent request.
func (s *Store) ArrangeAgents(userID string, groups map[string][]string, ungrouped []string) error {
	ctx, cancel := opCtx()
	defer cancel()

	ownedAgents, err := s.ownedAgentIDs(ctx, userID)
	if err != nil {
		return err
	}
	ownedGroups, err := s.ownedGroupIDs(ctx, userID)
	if err != nil {
		return err
	}

	seen := make(map[string]bool, len(ungrouped))
	models := make([]mongo.WriteModel, 0, len(ungrouped))
	for groupID, ids := range groups {
		if !ownedGroups[groupID] {
			return fmt.Errorf("%w: unknown group %q", ErrAgentOrderInvalid, groupID)
		}
		for position, id := range ids {
			if err := claimAgent(seen, ownedAgents, id); err != nil {
				return err
			}
			models = append(models, mongo.NewUpdateOneModel().
				SetFilter(bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}}).
				SetUpdate(bson.D{{Key: "$set", Value: bson.D{
					{Key: "group_id", Value: groupID},
					{Key: "position", Value: int64(position)},
				}}}))
		}
	}
	for position, id := range ungrouped {
		if err := claimAgent(seen, ownedAgents, id); err != nil {
			return err
		}
		models = append(models, mongo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}}).
			SetUpdate(bson.D{
				{Key: "$unset", Value: bson.D{{Key: "group_id", Value: ""}}},
				{Key: "$set", Value: bson.D{{Key: "position", Value: int64(position)}}},
			}))
	}
	if len(models) == 0 {
		return nil
	}
	if _, err := s.db.Collection(agentsCollection).BulkWrite(ctx, models); err != nil {
		return fmt.Errorf("arrange agents: %w", err)
	}
	return nil
}

// claimAgent records that id is being arranged and reports whether it belongs
// to the caller and has not already appeared in the request.
func claimAgent(seen, owned map[string]bool, id string) error {
	if !owned[id] {
		return fmt.Errorf("%w: unknown agent %q", ErrAgentOrderInvalid, id)
	}
	if seen[id] {
		return fmt.Errorf("%w: repeated agent %q", ErrAgentOrderInvalid, id)
	}
	seen[id] = true
	return nil
}

// ownedAgentIDs is the set of live agents the user owns. Deleted agents are
// excluded: they are not in the sidebar, so they cannot be arranged.
func (s *Store) ownedAgentIDs(ctx context.Context, userID string) (map[string]bool, error) {
	cur, err := s.db.Collection(agentsCollection).Find(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}},
		},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}),
	)
	if err != nil {
		return nil, fmt.Errorf("list owned agents: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	owned := map[string]bool{}
	for cur.Next(ctx) {
		var doc struct {
			ID string `bson:"_id"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("scan owned agent: %w", err)
		}
		owned[doc.ID] = true
	}
	return owned, cur.Err()
}

func (s *Store) ownedGroupIDs(ctx context.Context, userID string) (map[string]bool, error) {
	groups, err := s.ListAgentGroups(userID)
	if err != nil {
		return nil, err
	}
	owned := make(map[string]bool, len(groups))
	for _, group := range groups {
		owned[group.ID] = true
	}
	return owned, nil
}
