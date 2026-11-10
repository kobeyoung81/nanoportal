package store

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// sessionsCollection is the session projection. The portal reads it for the
// sidebar's attention snapshot; the writers move here with the session slice.
const sessionsCollection = "portal_sessions"

// ConversationAttention is one conversation's newest stored segment, reduced to
// the fields the sidebar's dots need.
type ConversationAttention struct {
	AgentID       string
	ChatID        string
	SessionID     string
	TurnRunning   bool
	TurnUpdatedAt time.Time
	// UpdatedAt is the newest segment's update time. The browser compares it
	// with what it had read to decide whether the conversation has unread
	// messages; both sides use this server timestamp, never the local clock.
	UpdatedAt time.Time
	Meta      string
}

// ListConversationAttention returns the newest stored segment of every
// conversation belonging to the user's agents. One query serves the whole
// sidebar: reading each agent's session list instead would cost a list and a
// count query per agent, per round.
//
// Only the newest segment per conversation is returned: a compaction leaves the
// older segments of the same chat_id behind, and their running/pending state is
// history, not something to show. This is sort-then-group with $first taking the
// row that a ROW_NUMBER() OVER (PARTITION BY agent_id, chat_id ORDER BY
// updated_at DESC, id DESC) ranking would have kept.
func (s *Store) ListConversationAttention(userID string) ([]ConversationAttention, error) {
	// The agent ids come from the agents collection, so the join is done in two
	// steps rather than one pipeline stage.
	agentIDs, err := s.agentIDsForUser(userID)
	if err != nil {
		return nil, fmt.Errorf("list conversation attention: %w", err)
	}
	if len(agentIDs) == 0 {
		return nil, nil
	}
	ids := make([]any, 0, len(agentIDs))
	for _, id := range agentIDs {
		ids = append(ids, id)
	}

	ctx, cancel := opCtx()
	defer cancel()

	out, err := s.aggregateAttention(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list conversation attention: %w", err)
	}
	return out, nil
}

func (s *Store) aggregateAttention(ctx context.Context, ids []any) ([]ConversationAttention, error) {
	cur, err := s.db.Collection(sessionsCollection).Aggregate(ctx, bson.A{
		bson.D{{Key: "$match", Value: bson.D{
			{Key: "channel", Value: "web"},
			{Key: "status", Value: bson.D{{Key: "$ne", Value: "archived"}}},
			{Key: "agent_id", Value: bson.D{{Key: "$in", Value: ids}}},
		}}},
		bson.D{{Key: "$sort", Value: bson.D{
			{Key: "updated_at", Value: -1}, {Key: "_id", Value: -1},
		}}},
		bson.D{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: bson.D{
				{Key: "agent_id", Value: "$agent_id"},
				{Key: "chat_id", Value: "$chat_id"},
			}},
			{Key: "session_id", Value: bson.D{{Key: "$first", Value: "$_id"}}},
			{Key: "turn_running", Value: bson.D{{Key: "$first", Value: "$turn_running"}}},
			{Key: "turn_updated_at", Value: bson.D{{Key: "$first", Value: "$turn_updated_at"}}},
			{Key: "updated_at", Value: bson.D{{Key: "$first", Value: "$updated_at"}}},
			{Key: "meta", Value: bson.D{{Key: "$first", Value: "$meta"}}},
		}}},
	})
	if err != nil {
		return nil, err
	}
	defer func() { _ = cur.Close(ctx) }()

	out := []ConversationAttention{}
	for cur.Next(ctx) {
		var doc struct {
			ID struct {
				AgentID string `bson:"agent_id"`
				ChatID  string `bson:"chat_id"`
			} `bson:"_id"`
			SessionID     string     `bson:"session_id"`
			TurnRunning   bool       `bson:"turn_running"`
			TurnUpdatedAt *time.Time `bson:"turn_updated_at"`
			UpdatedAt     *time.Time `bson:"updated_at"`
			Meta          string     `bson:"meta"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode conversation attention: %w", err)
		}
		rec := ConversationAttention{
			AgentID: doc.ID.AgentID, ChatID: doc.ID.ChatID, SessionID: doc.SessionID,
			TurnRunning: doc.TurnRunning, Meta: doc.Meta,
		}
		if doc.TurnUpdatedAt != nil {
			rec.TurnUpdatedAt = *doc.TurnUpdatedAt
		}
		if doc.UpdatedAt != nil {
			rec.UpdatedAt = *doc.UpdatedAt
		}
		out = append(out, rec)
	}
	return out, cur.Err()
}
