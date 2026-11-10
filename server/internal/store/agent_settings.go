package store

import (
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// ErrUnsupportedAgentSetting reports a settings key or value the platform does
// not accept from a client.
var ErrUnsupportedAgentSetting = errors.New("unsupported agent setting")

// AgentSettingKeys are the per-agent settings a user-facing client may write
// through the agent update endpoint. The list is deliberately short: the field
// is a general store, and a UI-facing write path must not become a way to set
// arbitrary runtime policy.
var AgentSettingKeys = map[string]bool{
	"scheduled_task_mode": true,
}

// ValidAgentSettingValue reports whether value is usable for key. An empty
// value is always allowed: it means "inherit" and is dropped on read.
func ValidAgentSettingValue(key, value string) bool {
	if !AgentSettingKeys[key] {
		return false
	}
	if value == "" {
		return true
	}
	switch key {
	case "scheduled_task_mode":
		return value == "build" || value == "plan"
	}
	return false
}

// SetAgentSettings replaces an agent's runtime override map, as documented on
// UpdateAgentRequest.Settings. An empty (or all-empty) map clears the field.
// Keys outside AgentSettingKeys, or values a key does not accept, are refused
// with ErrUnsupportedAgentSetting so the caller can answer 400.
func (s *Store) SetAgentSettings(agentID string, settings map[string]string) error {
	cleaned := map[string]string{}
	for k, v := range settings {
		if !ValidAgentSettingValue(k, v) {
			return fmt.Errorf("%w: %s=%q", ErrUnsupportedAgentSetting, k, v)
		}
		if v != "" {
			cleaned[k] = v
		}
	}

	ctx, cancel := opCtx()
	defer cancel()

	// An empty map is a cleared setting, not "keep whatever was there": the wire
	// semantics are "present = replace".
	set := bson.D{{Key: "settings", Value: cleaned}}
	set = append(set, bson.E{Key: "updated_at", Value: time.Now().UTC()})

	res, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}}, bson.D{{Key: "$set", Value: set}})
	if err != nil {
		return fmt.Errorf("set agent settings: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrAgentNotFound
	}
	return nil
}
