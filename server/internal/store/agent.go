package store

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ErrAgentNotFound reports an update against an agent that does not exist.
var ErrAgentNotFound = errors.New("agent not found")

type AgentRecord struct {
	ID          string
	UserID      string
	TypeID      string
	GroupID     string
	DisplayName string
	Description string
	// ModelID/Thinking/Settings are deprecated: the agent-level model, thinking
	// and runtime settings now live per (agent, type) in agent_type_overrides.
	// They remain as read-only zero values for wire compatibility (AgentInfo).
	ModelID               int64
	Thinking              string
	Settings              map[string]string
	MaxIterations         int
	MaxConcurrentMessages int
	Status                string
}

const (
	agentsCollection        = "portal_agents"
	bindingAgentsCollection = "portal_binding_preferences"
)

// storedSessionAgent is one entry of an agent's switchable session agents.
//
// It is embedded in the agent document rather than kept in its own collection so
// that flipping the default stays a single-document update. The SQL it replaces
// was one statement — `UPDATE agent_session_agents SET is_default = (def_id = ?)
// WHERE agent_id = ?` — and that atomicity is worth keeping: a standalone
// MongoDB has no multi-document transaction to fall back on.
type storedSessionAgent struct {
	DefID     string `bson:"def_id"`
	Position  int    `bson:"position"`
	IsDefault bool   `bson:"is_default"`
}

type storedAgent struct {
	ID      string `bson:"_id"`
	UserID  string `bson:"user_id"`
	TypeID  string `bson:"type_id,omitempty"`
	GroupID string `bson:"group_id,omitempty"`
	// Position is the agent's index inside its group. ArrangeAgents writes
	// 0..n; a freshly created agent gets a millisecond timestamp so it sorts
	// last, and legacy documents have none and fall back to created_at.
	Position              int64                `bson:"position,omitempty"`
	DisplayName           string               `bson:"display_name"`
	Description           string               `bson:"description,omitempty"`
	MaxIterations         int                  `bson:"max_iterations"`
	MaxConcurrentMessages int                  `bson:"max_concurrent_messages"`
	Status                string               `bson:"status"`
	Settings              map[string]string    `bson:"settings,omitempty"`
	SessionAgents         []storedSessionAgent `bson:"session_agents,omitempty"`
	CreatedAt             time.Time            `bson:"created_at"`
	UpdatedAt             time.Time            `bson:"updated_at"`
}

func (d storedAgent) record() AgentRecord {
	return AgentRecord{
		ID: d.ID, UserID: d.UserID, TypeID: d.TypeID, GroupID: d.GroupID,
		DisplayName: d.DisplayName, Description: d.Description,
		MaxIterations: d.MaxIterations, MaxConcurrentMessages: d.MaxConcurrentMessages,
		Status: d.Status, Settings: d.Settings,
	}
}

// maxAgentsForTier is how many agents one account may own. It is a product
// decision rather than an operational dial, so it lives in the binary next to
// the count it bounds; an unknown or empty tier has no ceiling, which is what
// the inline map this replaces did too.
func maxAgentsForTier(tier string) (int, bool) {
	switch tier {
	case "free":
		return 5, true
	case "pro":
		return 10, true
	case "ultra":
		return 40, true
	default:
		return 0, false
	}
}

func (s *Store) CreateAgent(agent AgentRecord) error {
	// The tier caps how many agents a user may create. It lives with the
	// account, which this service does not own yet: ask, and refuse rather than
	// silently skipping the cap when the lookup is unavailable.
	if s.userTier == nil {
		return fmt.Errorf("user tier source is not configured")
	}
	tier, err := s.userTier(agent.UserID)
	if err != nil {
		return fmt.Errorf("lookup user tier: %w", err)
	}

	ctx, cancel := opCtx()
	defer cancel()

	count, err := s.db.Collection(agentsCollection).CountDocuments(ctx, bson.D{
		{Key: "user_id", Value: agent.UserID},
		{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}},
	})
	if err != nil {
		return fmt.Errorf("count agents: %w", err)
	}

	if limit, ok := maxAgentsForTier(tier); ok && int(count) >= limit {
		return fmt.Errorf("tier limit exceeded: %s allows max %d agents, currently have %d", tier, limit, count)
	}

	now := time.Now().UTC()
	sessionAgents := sessionAgentsFor(agent.TypeID)
	set := bson.D{
		{Key: "user_id", Value: agent.UserID},
		{Key: "type_id", Value: agent.TypeID},
		{Key: "display_name", Value: agent.DisplayName},
		{Key: "description", Value: agent.Description},
		{Key: "max_iterations", Value: agent.MaxIterations},
		{Key: "max_concurrent_messages", Value: agent.MaxConcurrentMessages},
		{Key: "updated_at", Value: now},
		// Appended last within its group until an arrange says otherwise.
		{Key: "position", Value: now.UnixMilli()},
	}
	// Only write a grouping the caller actually chose; an empty GroupID leaves
	// any existing assignment alone (the create also serves re-creation).
	if agent.GroupID != "" {
		set = append(set, bson.E{Key: "group_id", Value: agent.GroupID})
	}
	_, err = s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agent.ID}},
		bson.D{
			{Key: "$set", Value: set},
			{Key: "$setOnInsert", Value: bson.D{
				{Key: "created_at", Value: now},
				// A tombstone stays a tombstone: the SQL used
				// `status = IF(status = 'deleted', 'deleted', 'provisioning')`.
				{Key: "status", Value: "provisioning"},
			}},
		},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("create agent: %w", err)
	}
	// A re-created tombstone keeps its status; everything else is provisioning.
	if err := s.reviveUnlessDeleted(agent.ID); err != nil {
		return err
	}
	// Register the agent's session agents: its build type plus the platform plan.
	// Per-mode overrides are created lazily on first save.
	if err := s.mergeSessionAgents(agent.ID, sessionAgents); err != nil {
		return fmt.Errorf("create agent session links: %w", err)
	}
	return nil
}

// reviveUnlessDeleted mirrors the SQL upsert's status expression: a freshly
// inserted agent is 'provisioning', and an existing tombstone is left alone.
func (s *Store) reviveUnlessDeleted(agentID string) error {
	ctx, cancel := opCtx()
	defer cancel()
	_, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}, {Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "status", Value: "provisioning"}}}},
	)
	return err
}

// sessionAgentsFor is the link set an agent starts with: its own build type
// (default) plus the platform plan type.
func sessionAgentsFor(buildTypeID string) []storedSessionAgent {
	if buildTypeID == "" {
		buildTypeID = "build"
	}
	return []storedSessionAgent{
		{DefID: buildTypeID, Position: 0, IsDefault: true},
		{DefID: "plan", Position: 1, IsDefault: false},
	}
}

// mergeSessionAgents adds or refreshes the given links, leaving any other
// switchable mode in place.
//
// One aggregation-pipeline update rather than a read-modify-write: the whole
// array is derived server-side from its current value, so two concurrent calls
// cannot lose each other's entry.
func (s *Store) mergeSessionAgents(agentID string, links []storedSessionAgent) error {
	if len(links) == 0 {
		return nil
	}
	ids := make([]any, 0, len(links))
	additions := make(bson.A, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.DefID)
		additions = append(additions, bson.D{
			{Key: "def_id", Value: l.DefID},
			{Key: "position", Value: l.Position},
			{Key: "is_default", Value: l.IsDefault},
		})
	}

	// Keep every existing link whose def_id is not being written, then append
	// the new form of the ones that are.
	keepOthers := bson.D{{Key: "$filter", Value: bson.D{
		{Key: "input", Value: bson.D{{Key: "$ifNull", Value: bson.A{"$session_agents", bson.A{}}}}},
		{Key: "as", Value: "a"},
		{Key: "cond", Value: bson.D{{Key: "$not", Value: bson.D{{Key: "$in",
			Value: bson.A{"$$a.def_id", ids}}}}},
		}}}}
	merged := bson.D{{Key: "$concatArrays", Value: bson.A{keepOthers, additions}}}
	pipeline := bson.A{
		bson.D{{Key: "$set", Value: bson.D{{Key: "session_agents", Value: merged}}}},
	}

	ctx, cancel := opCtx()
	defer cancel()
	_, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}}, pipeline)
	if err != nil {
		return fmt.Errorf("merge session agents: %w", err)
	}
	return nil
}

// SessionAgent is one session definition linked to an agent.
type SessionAgent struct {
	DefID     string
	Position  int
	IsDefault bool
}

// SessionAgentsForAgent lists an agent's switchable session agents in order.
func (s *Store) SessionAgentsForAgent(agentID string) ([]SessionAgent, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var doc struct {
		SessionAgents []storedSessionAgent `bson:"session_agents"`
	}
	err := s.db.Collection(agentsCollection).FindOne(ctx, bson.D{{Key: "_id", Value: agentID}},
		options.FindOne().SetProjection(bson.D{{Key: "session_agents", Value: 1}}),
	).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list session agents: %w", err)
	}

	out := make([]SessionAgent, 0, len(doc.SessionAgents))
	for _, a := range doc.SessionAgents {
		out = append(out, SessionAgent{DefID: a.DefID, Position: a.Position, IsDefault: a.IsDefault})
	}
	// The SQL ordered by position then def_id; the array has no inherent order.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Position != out[j].Position {
			return out[i].Position < out[j].Position
		}
		return out[i].DefID < out[j].DefID
	})
	return out, nil
}

// SetAgentStatus updates an agent's lifecycle status. A deleted agent is a
// tombstone: runtime status reports must never resurrect it (explicit restore
// is a separate operation).
func (s *Store) SetAgentStatus(agentID, status string) error {
	ctx, cancel := opCtx()
	defer cancel()
	_, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}, {Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: status},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
	)
	if err != nil {
		return fmt.Errorf("set agent status: %w", err)
	}
	return nil
}

// RestoreAgent brings a deleted agent back to 'provisioning' so the supervisor
// can start it again. No-op (error) unless the agent is currently deleted.
func (s *Store) RestoreAgent(agentID string) error {
	ctx, cancel := opCtx()
	defer cancel()
	res, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}, {Key: "status", Value: "deleted"}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: "provisioning"},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
	)
	if err != nil {
		return fmt.Errorf("restore agent: %w", err)
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("agent not found or not deleted")
	}
	return nil
}

func (s *Store) UpdateAgent(agent AgentRecord) error {
	ctx, cancel := opCtx()
	defer cancel()

	var prev struct {
		TypeID string `bson:"type_id"`
	}
	err := s.db.Collection(agentsCollection).FindOne(ctx, bson.D{{Key: "_id", Value: agent.ID}},
		options.FindOne().SetProjection(bson.D{{Key: "type_id", Value: 1}}),
	).Decode(&prev)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return fmt.Errorf("read previous agent type: %w", err)
	}

	set := bson.D{
		{Key: "display_name", Value: agent.DisplayName},
		{Key: "description", Value: agent.Description},
		{Key: "max_iterations", Value: agent.MaxIterations},
		{Key: "max_concurrent_messages", Value: agent.MaxConcurrentMessages},
		{Key: "updated_at", Value: time.Now().UTC()},
	}
	// `type_id = COALESCE(NULLIF(?, ''), type_id)`: an empty incoming type leaves
	// the stored one alone rather than clearing it.
	if agent.TypeID != "" {
		set = append(set, bson.E{Key: "type_id", Value: agent.TypeID})
	}

	if _, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agent.ID}}, bson.D{{Key: "$set", Value: set}}); err != nil {
		return err
	}

	// Changing the primary type links the new session type and makes it the
	// default, keeping the previously linked modes switchable.
	if agent.TypeID != "" && agent.TypeID != prev.TypeID {
		if err := s.mergeSessionAgents(agent.ID, sessionAgentsFor(agent.TypeID)[:1]); err != nil {
			return err
		}
		if err := s.SetDefaultSessionAgent(agent.ID, agent.TypeID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteAgent(agentID string) error {
	ctx, cancel := opCtx()
	defer cancel()
	_, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: agentID}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: "deleted"},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
	)
	return err
}

// SetDefaultSessionAgent marks defID as the agent's default session agent. The
// def must already be linked to the agent.
//
// The filter carries the "must already be linked" condition, so an unlinked def
// matches nothing and the update cannot half-apply.
func (s *Store) SetDefaultSessionAgent(agentID, defID string) error {
	ctx, cancel := opCtx()
	defer cancel()

	// One document update, so "exactly one default" holds at every instant —
	// the same guarantee the single SQL UPDATE gave.
	mapped := bson.D{{Key: "$map", Value: bson.D{
		{Key: "input", Value: "$session_agents"},
		{Key: "as", Value: "a"},
		{Key: "in", Value: bson.D{{Key: "$mergeObjects", Value: bson.A{
			"$$a",
			bson.D{{Key: "is_default", Value: bson.D{{Key: "$eq",
				Value: bson.A{"$$a.def_id", defID}}}}},
		}}}},
	}}}
	res, err := s.db.Collection(agentsCollection).UpdateOne(ctx,
		bson.D{
			{Key: "_id", Value: agentID},
			{Key: "session_agents.def_id", Value: defID},
		},
		bson.A{bson.D{{Key: "$set", Value: bson.D{{Key: "session_agents", Value: mapped}}}}},
	)
	if err != nil {
		return fmt.Errorf("set default session agent: %w", err)
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("session agent %q is not linked to agent %q", defID, agentID)
	}
	return nil
}

// AgentDisplayNameTaken reports whether another (non-deleted) agent of the same
// user already claims the display name. excludeAgentID skips the agent being
// edited.
//
// MySQL's default collation made this comparison case-insensitive; an exact-match
// query would not be, so the name is compared with a case-insensitive collation
// rather than silently tightening the rule.
func (s *Store) AgentDisplayNameTaken(userID, displayName, excludeAgentID string) (bool, error) {
	ctx, cancel := opCtx()
	defer cancel()

	filter := bson.D{
		{Key: "user_id", Value: userID},
		{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}},
		{Key: "display_name", Value: displayName},
	}
	if excludeAgentID != "" {
		filter = append(filter, bson.E{Key: "_id", Value: bson.D{{Key: "$ne", Value: excludeAgentID}}})
	}

	// The comparison happens server-side under an explicit collation. MySQL's
	// default collation ("_ai_ci") made this case-insensitive; MongoDB's default
	// is case-sensitive, so matching without saying so would silently tighten the
	// rule. (Comparing in Go would not work at all: a collation only affects
	// server-side comparisons, and the client-side == is always exact.)
	count, err := s.db.Collection(agentsCollection).CountDocuments(ctx, filter,
		options.Count().SetCollation(&options.Collation{Locale: "en", Strength: 2}),
	)
	if err != nil {
		return false, fmt.Errorf("check agent display name: %w", err)
	}
	return count > 0, nil
}

// agentProjection keeps the read shape stable: the deprecated model_id/thinking/
// settings positions are gone from storage (the SQL selected NULL literals for
// them after migration 067 dropped the columns).
var agentProjection = bson.D{
	{Key: "_id", Value: 1},
	{Key: "user_id", Value: 1},
	{Key: "type_id", Value: 1},
	{Key: "group_id", Value: 1},
	{Key: "position", Value: 1},
	{Key: "display_name", Value: 1},
	{Key: "description", Value: 1},
	{Key: "max_iterations", Value: 1},
	{Key: "max_concurrent_messages", Value: 1},
	{Key: "status", Value: 1},
	// The per-agent runtime overrides travel with the row: the form that edits
	// scheduled_task_mode and the update endpoint that replaces the map both
	// need to see what is stored, and the write path is a separate statement.
	{Key: "settings", Value: 1},
}

func (s *Store) GetAgent(agentID string) (*AgentRecord, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var doc storedAgent
	err := s.db.Collection(agentsCollection).FindOne(ctx, bson.D{{Key: "_id", Value: agentID}},
		options.FindOne().SetProjection(agentProjection),
	).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get agent: %w", err)
	}
	rec := doc.record()
	return &rec, nil
}

func (s *Store) ListAgents(userID string) ([]AgentRecord, error) {
	return s.ListAgentsFiltered(userID, false)
}

// AgentFleetEntry is one row of the runtime snapshot's agent list: every agent on
// the platform, with its owner, newest first.
type AgentFleetEntry struct {
	ID          string
	UserID      string
	DisplayName string
	Status      string
	UpdatedAt   time.Time
}

// ListAgentFleet returns every agent on the platform, most recently updated first.
//
// The console's runtime snapshot is the only caller: it shows the whole fleet, not
// one user's slice, and it needs the owner — which is why this is not
// ListAgentsFiltered with an empty user.
func (s *Store) ListAgentFleet(limit int) ([]AgentFleetEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.db.Collection(agentsCollection).Find(ctx, bson.D{},
		options.Find().
			SetProjection(bson.D{
				{Key: "user_id", Value: 1}, {Key: "display_name", Value: 1},
				{Key: "status", Value: 1}, {Key: "updated_at", Value: 1},
			}).
			SetSort(bson.D{{Key: "updated_at", Value: -1}, {Key: "_id", Value: 1}}).
			SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("list agent fleet: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := []AgentFleetEntry{}
	for cur.Next(ctx) {
		var doc storedAgent
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode agent: %w", err)
		}
		out = append(out, AgentFleetEntry{
			ID: doc.ID, UserID: doc.UserID, DisplayName: doc.DisplayName,
			Status: doc.Status, UpdatedAt: doc.UpdatedAt,
		})
	}
	return out, cur.Err()
}

// ListAgentsFiltered lists a user's agents; when includeDeleted is false
// (default), deleted tombstones are hidden.
func (s *Store) ListAgentsFiltered(userID string, includeDeleted bool) ([]AgentRecord, error) {
	ctx, cancel := opCtx()
	defer cancel()

	filter := bson.D{{Key: "user_id", Value: userID}}
	if !includeDeleted {
		filter = append(filter, bson.E{Key: "status", Value: bson.D{{Key: "$ne", Value: "deleted"}}})
	}

	cur, err := s.db.Collection(agentsCollection).Find(ctx, filter,
		options.Find().SetProjection(agentProjection).SetSort(bson.D{{Key: "created_at", Value: 1}}),
	)
	if err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	agents := []AgentRecord{}
	for cur.Next(ctx) {
		var doc storedAgent
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("scan agent: %w", err)
		}
		agents = append(agents, doc.record())
	}
	return agents, cur.Err()
}

// GetBindingAgent returns the default agent for a channel binding. An explicit
// binding_agent_preferences entry wins; otherwise the binding owner's first
// active agent is used. Returns "" when neither exists.
func (s *Store) GetBindingAgent(bindingID int64) (string, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var pref struct {
		AgentID string `bson:"agent_id"`
	}
	err := s.db.Collection(bindingAgentsCollection).FindOne(ctx,
		bson.D{{Key: "_id", Value: bindingID}},
	).Decode(&pref)
	if err == nil && pref.AgentID != "" {
		return pref.AgentID, nil
	}
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return "", fmt.Errorf("get binding agent preference: %w", err)
	}

	// The fallback finds the binding's owner through the channel embedded in the
	// account document, then reads that account's first active agent. The account
	// read is read-only until the auth slice moves accounts.
	userID, err := s.userIDForBinding(ctx, bindingID)
	if err != nil {
		return "", err
	}
	if userID == "" {
		return "", nil
	}

	cur, err := s.db.Collection(agentsCollection).Find(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "status", Value: bson.D{{Key: "$nin", Value: bson.A{"deleted", "suspended", "failed"}}}},
		},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}).
			SetSort(bson.D{{Key: "created_at", Value: 1}}).SetLimit(1),
	)
	if err != nil {
		return "", fmt.Errorf("get binding fallback agent: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	if cur.Next(ctx) {
		var doc struct {
			ID string `bson:"_id"`
		}
		if err := cur.Decode(&doc); err != nil {
			return "", fmt.Errorf("scan fallback agent: %w", err)
		}
		return doc.ID, nil
	}
	return "", cur.Err()
}

// SetBindingAgent assigns the default agent for a channel binding. An empty
// agent id clears the preference (falls back to the user's first active agent).
func (s *Store) SetBindingAgent(bindingID int64, agentID string) error {
	ctx, cancel := opCtx()
	defer cancel()

	if agentID == "" {
		if _, err := s.db.Collection(bindingAgentsCollection).DeleteOne(ctx,
			bson.D{{Key: "_id", Value: bindingID}}); err != nil {
			return fmt.Errorf("clear binding agent preference: %w", err)
		}
		return nil
	}
	_, err := s.db.Collection(bindingAgentsCollection).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: bindingID}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "agent_id", Value: agentID},
			// The original column stored '{}': an empty preferences object.
			{Key: "preferences", Value: bson.D{}},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("set binding agent preference: %w", err)
	}
	return nil
}

// agentIDsForUser returns the ids of a user's agents.
//
// It exists so a caller that needs to scope a query to a user's agents — the
// conversation-attention sidebar, whose sessions live in their own collection —
// can ask here instead of reaching into the agents collection itself.
func (s *Store) agentIDsForUser(userID string) ([]string, error) {
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.db.Collection(agentsCollection).Find(ctx,
		bson.D{{Key: "user_id", Value: userID}},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}),
	)
	if err != nil {
		return nil, fmt.Errorf("list agent ids: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	var ids []string
	for cur.Next(ctx) {
		var doc struct {
			ID string `bson:"_id"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("scan agent id: %w", err)
		}
		ids = append(ids, doc.ID)
	}
	return ids, cur.Err()
}
