package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Agent grouping errors. The handlers map these onto HTTP status codes: a
// missing group or an unknown id in a reorder is 404, a taken name is 409, and
// an invalid name or an over-limit list is 400.
var (
	ErrAgentGroupNotFound     = errors.New("agent group not found")
	ErrAgentGroupNameTaken    = errors.New("an agent group with this name already exists")
	ErrAgentGroupLimit        = errors.New("too many agent groups")
	ErrAgentGroupNameInvalid  = errors.New("a group name is required (up to 40 characters)")
	ErrAgentGroupOrderInvalid = errors.New("the order must list every group exactly once")
)

const (
	agentGroupsCollection = "portal_agent_groups"
	// MaxAgentGroupsPerUser bounds the sidebar's group count. It is a guard
	// against runaway clients, not a product constraint.
	MaxAgentGroupsPerUser = 100
	// MaxAgentGroupNameRunes keeps a group header readable in the narrow
	// sidebar.
	MaxAgentGroupNameRunes = 40
)

// AgentGroup is a user-private grouping of agents. Groups are single-level and
// an agent belongs to at most one of them.
type AgentGroup struct {
	ID        string
	UserID    string
	Name      string
	Position  int
	CreatedAt time.Time
}

type storedAgentGroup struct {
	ID        string    `bson:"_id"`
	UserID    string    `bson:"user_id"`
	Name      string    `bson:"name"`
	Position  int       `bson:"position"`
	CreatedAt time.Time `bson:"created_at"`
}

func (d storedAgentGroup) group() AgentGroup {
	return AgentGroup{ID: d.ID, UserID: d.UserID, Name: d.Name, Position: d.Position, CreatedAt: d.CreatedAt}
}

// NormalizeAgentGroupName trims a group name and rejects empty or over-long
// ones. Uniqueness per user is enforced by the unique index, not by a read.
func NormalizeAgentGroupName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > MaxAgentGroupNameRunes {
		return "", ErrAgentGroupNameInvalid
	}
	return name, nil
}

// ListAgentGroups returns a user's groups in display order.
func (s *Store) ListAgentGroups(userID string) ([]AgentGroup, error) {
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.db.Collection(agentGroupsCollection).Find(ctx,
		bson.D{{Key: "user_id", Value: userID}},
		options.Find().SetSort(bson.D{{Key: "position", Value: 1}, {Key: "created_at", Value: 1}}),
	)
	if err != nil {
		return nil, fmt.Errorf("list agent groups: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	groups := []AgentGroup{}
	for cur.Next(ctx) {
		var doc storedAgentGroup
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("scan agent group: %w", err)
		}
		groups = append(groups, doc.group())
	}
	return groups, cur.Err()
}

// CreateAgentGroup appends a group to the end of the user's list.
func (s *Store) CreateAgentGroup(userID, name string) (*AgentGroup, error) {
	name, err := NormalizeAgentGroupName(name)
	if err != nil {
		return nil, err
	}

	ctx, cancel := opCtx()
	defer cancel()

	coll := s.db.Collection(agentGroupsCollection)
	count, err := coll.CountDocuments(ctx, bson.D{{Key: "user_id", Value: userID}})
	if err != nil {
		return nil, fmt.Errorf("count agent groups: %w", err)
	}
	if count >= MaxAgentGroupsPerUser {
		return nil, ErrAgentGroupLimit
	}

	// Append after the current last position. Reading it rather than counting
	// keeps the order stable after a delete leaves a gap.
	position := 0
	var last struct {
		Position int `bson:"position"`
	}
	err = coll.FindOne(ctx, bson.D{{Key: "user_id", Value: userID}},
		options.FindOne().
			SetSort(bson.D{{Key: "position", Value: -1}}).
			SetProjection(bson.D{{Key: "position", Value: 1}}),
	).Decode(&last)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return nil, fmt.Errorf("read last agent group position: %w", err)
	}
	if err == nil {
		position = last.Position + 1
	}

	doc := storedAgentGroup{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      name,
		Position:  position,
		CreatedAt: time.Now().UTC(),
	}
	if _, err := coll.InsertOne(ctx, doc); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrAgentGroupNameTaken
		}
		return nil, fmt.Errorf("create agent group: %w", err)
	}
	group := doc.group()
	return &group, nil
}

// RenameAgentGroup renames one of the user's groups. A group owned by someone
// else is reported as missing, never as forbidden: the caller has no business
// learning that the id exists.
func (s *Store) RenameAgentGroup(id, userID, name string) error {
	name, err := NormalizeAgentGroupName(name)
	if err != nil {
		return err
	}

	ctx, cancel := opCtx()
	defer cancel()

	res, err := s.db.Collection(agentGroupsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "name", Value: name}}}},
	)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return ErrAgentGroupNameTaken
		}
		return fmt.Errorf("rename agent group: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrAgentGroupNotFound
	}
	return nil
}

// DeleteAgentGroup removes a group and takes its agents out of it. The agents
// themselves are untouched: a group is organization, not ownership. Returns the
// number of agents that moved to ungrouped.
//
// The unset runs first: if it succeeds and the delete fails, the group is left
// empty (deletable again) rather than its agents left pointing at nothing.
func (s *Store) DeleteAgentGroup(id, userID string) (int64, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var doc storedAgentGroup
	err := s.db.Collection(agentGroupsCollection).FindOne(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}},
	).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return 0, ErrAgentGroupNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("find agent group: %w", err)
	}

	res, err := s.db.Collection(agentsCollection).UpdateMany(ctx,
		bson.D{{Key: "user_id", Value: userID}, {Key: "group_id", Value: id}},
		bson.D{{Key: "$unset", Value: bson.D{{Key: "group_id", Value: ""}}}},
	)
	if err != nil {
		return 0, fmt.Errorf("unassign agents from group: %w", err)
	}
	if _, err := s.db.Collection(agentGroupsCollection).DeleteOne(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}},
	); err != nil {
		return 0, fmt.Errorf("delete agent group: %w", err)
	}
	return res.ModifiedCount, nil
}

// ReorderAgentGroups writes the given order. ids must name exactly the user's
// groups — a missing, extra or repeated id is rejected rather than applied
// partially, because a half-applied order would silently reshuffle the sidebar.
func (s *Store) ReorderAgentGroups(userID string, ids []string) error {
	groups, err := s.ListAgentGroups(userID)
	if err != nil {
		return err
	}
	if len(ids) != len(groups) {
		return fmt.Errorf("%w: expected %d ids, got %d", ErrAgentGroupOrderInvalid, len(groups), len(ids))
	}
	known := make(map[string]bool, len(groups))
	for _, g := range groups {
		known[g.ID] = true
	}

	seen := make(map[string]bool, len(ids))
	models := make([]mongo.WriteModel, 0, len(ids))
	for position, id := range ids {
		if !known[id] || seen[id] {
			return fmt.Errorf("%w: unknown or repeated id %q", ErrAgentGroupOrderInvalid, id)
		}
		seen[id] = true
		models = append(models, mongo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "_id", Value: id}, {Key: "user_id", Value: userID}}).
			SetUpdate(bson.D{{Key: "$set", Value: bson.D{{Key: "position", Value: position}}}}))
	}
	if len(models) == 0 {
		return nil
	}

	ctx, cancel := opCtx()
	defer cancel()
	if _, err := s.db.Collection(agentGroupsCollection).BulkWrite(ctx, models); err != nil {
		return fmt.Errorf("reorder agent groups: %w", err)
	}
	return nil
}

// AgentGroupExists reports whether the group belongs to the user. An agent may
// only be placed in a group its owner created.
func (s *Store) AgentGroupExists(userID, groupID string) (bool, error) {
	if groupID == "" {
		return false, nil
	}
	ctx, cancel := opCtx()
	defer cancel()

	n, err := s.db.Collection(agentGroupsCollection).CountDocuments(ctx,
		bson.D{{Key: "_id", Value: groupID}, {Key: "user_id", Value: userID}})
	if err != nil {
		return false, fmt.Errorf("check agent group: %w", err)
	}
	return n > 0, nil
}

// SetAgentGroup moves one agent into a group, or takes it out when groupID is
// empty. Ownership is checked by the caller (the group and the agent must share
// an owner); this method only writes.
func (s *Store) SetAgentGroup(agentID, groupID string) error {
	ctx, cancel := opCtx()
	defer cancel()

	var update bson.D
	if groupID == "" {
		update = bson.D{
			{Key: "$unset", Value: bson.D{{Key: "group_id", Value: ""}}},
			{Key: "$set", Value: bson.D{{Key: "updated_at", Value: time.Now().UTC()}}},
		}
	} else {
		update = bson.D{{Key: "$set", Value: bson.D{
			{Key: "group_id", Value: groupID},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}}
	}
	if _, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}}, update); err != nil {
		return fmt.Errorf("set agent group: %w", err)
	}
	return nil
}
