package api_test

import (
	"fmt"
	"sort"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// fakeStore is the portal's agent data in memory. The HTTP layer only needs the
// methods of api's agentStore port, so the route tests can run without MongoDB
// while the real behaviour of these operations stays covered by the store's own
// database-backed tests.
type fakeStore struct {
	agents        map[string]store.AgentRecord
	sessionAgents map[string][]store.SessionAgent
	groups        map[string]store.AgentGroup
	attention     []store.ConversationAttention
	cleared       []string
	// records is the conversation projection, keyed by session id.
	records map[string]*store.SessionRecord
	// bindings maps a channel binding to its preferred agent.
	bindings map[int64]string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		agents:        map[string]store.AgentRecord{},
		sessionAgents: map[string][]store.SessionAgent{},
		groups:        map[string]store.AgentGroup{},
		records:       map[string]*store.SessionRecord{},
		bindings:      map[int64]string{},
	}
}

// withAgent seeds one agent, defaulting its session agents to build+plan.
func (f *fakeStore) withAgent(a store.AgentRecord) *fakeStore {
	if a.Status == "" {
		a.Status = "running"
	}
	f.agents[a.ID] = a
	if _, ok := f.sessionAgents[a.ID]; !ok {
		f.sessionAgents[a.ID] = []store.SessionAgent{
			{DefID: "build", Position: 0, IsDefault: true},
			{DefID: "plan", Position: 1},
		}
	}
	return f
}

func (f *fakeStore) CreateAgent(a store.AgentRecord) error {
	if a.Status == "" {
		a.Status = "provisioning"
	}
	f.agents[a.ID] = a
	f.sessionAgents[a.ID] = []store.SessionAgent{
		{DefID: "build", Position: 0, IsDefault: true},
		{DefID: "plan", Position: 1},
	}
	return nil
}

func (f *fakeStore) GetAgent(id string) (*store.AgentRecord, error) {
	a, ok := f.agents[id]
	if !ok {
		return nil, nil
	}
	return &a, nil
}

func (f *fakeStore) ListAgentsFiltered(userID string, includeDeleted bool) ([]store.AgentRecord, error) {
	out := []store.AgentRecord{}
	for _, a := range f.agents {
		if a.UserID != userID {
			continue
		}
		if !includeDeleted && a.Status == "deleted" {
			continue
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *fakeStore) UpdateAgent(a store.AgentRecord) error {
	if _, ok := f.agents[a.ID]; !ok {
		return store.ErrAgentNotFound
	}
	f.agents[a.ID] = a
	return nil
}

func (f *fakeStore) DeleteAgent(id string) error {
	a, ok := f.agents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	a.Status = "deleted"
	f.agents[id] = a
	return nil
}

func (f *fakeStore) SetAgentStatus(id, status string) error {
	a, ok := f.agents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	a.Status = status
	f.agents[id] = a
	return nil
}

// EnsureDefaultAgent mirrors the store: the first agent that is not deleted wins,
// otherwise "<user>-default" is created (reviving a tombstone).
func (f *fakeStore) EnsureDefaultAgent(userID, typeID, displayName string) (string, bool, error) {
	for id, a := range f.agents {
		if a.UserID == userID && a.Status != "deleted" {
			return id, false, nil
		}
	}
	id := userID + "-default"
	f.agents[id] = store.AgentRecord{
		ID: id, UserID: userID, TypeID: typeID, DisplayName: displayName,
		Status: "provisioning", MaxConcurrentMessages: 4,
	}
	return id, true, nil
}

func (f *fakeStore) RestoreAgent(id string) error {
	a, ok := f.agents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	a.Status = "provisioning"
	f.agents[id] = a
	return nil
}

func (f *fakeStore) SetDefaultSessionAgent(id, defID string) error {
	list, ok := f.sessionAgents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	for i := range list {
		list[i].IsDefault = list[i].DefID == defID
	}
	f.sessionAgents[id] = list
	return nil
}

func (f *fakeStore) SetAgentSettings(id string, settings map[string]string) error {
	for k, v := range settings {
		if !store.ValidAgentSettingValue(k, v) {
			return fmt.Errorf("%w: %s=%q", store.ErrUnsupportedAgentSetting, k, v)
		}
	}
	a, ok := f.agents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	cleaned := map[string]string{}
	for k, v := range settings {
		if v != "" {
			cleaned[k] = v
		}
	}
	a.Settings = cleaned
	f.agents[id] = a
	return nil
}

func (f *fakeStore) SetAgentGroup(id, groupID string) error {
	a, ok := f.agents[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	a.GroupID = groupID
	f.agents[id] = a
	return nil
}

func (f *fakeStore) AgentGroupExists(userID, groupID string) (bool, error) {
	g, ok := f.groups[groupID]
	return ok && g.UserID == userID, nil
}

func (f *fakeStore) AgentDisplayNameTaken(userID, displayName, exclude string) (bool, error) {
	for _, a := range f.agents {
		if a.UserID == userID && a.ID != exclude && a.DisplayName == displayName && a.Status != "deleted" {
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeStore) SessionAgentsForAgent(id string) ([]store.SessionAgent, error) {
	return f.sessionAgents[id], nil
}

func (f *fakeStore) ClearAgentsTypeRef(id string) (int, error) {
	cleared := 0
	for agentID, a := range f.agents {
		if a.TypeID == id {
			a.TypeID = ""
			f.agents[agentID] = a
			cleared++
		}
	}
	f.cleared = append(f.cleared, id)
	return cleared, nil
}

func (f *fakeStore) ListAgentGroups(userID string) ([]store.AgentGroup, error) {
	out := []store.AgentGroup{}
	for _, g := range f.groups {
		if g.UserID == userID {
			out = append(out, g)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *fakeStore) CreateAgentGroup(userID, name string) (*store.AgentGroup, error) {
	if name == "" {
		return nil, store.ErrAgentGroupNameInvalid
	}
	g := store.AgentGroup{ID: fmt.Sprintf("group-%d", len(f.groups)+1), UserID: userID, Name: name, Position: len(f.groups)}
	f.groups[g.ID] = g
	return &g, nil
}

func (f *fakeStore) RenameAgentGroup(id, userID, name string) error {
	g, ok := f.groups[id]
	if !ok || g.UserID != userID {
		return store.ErrAgentGroupNotFound
	}
	g.Name = name
	f.groups[id] = g
	return nil
}

func (f *fakeStore) DeleteAgentGroup(id, userID string) (int64, error) {
	g, ok := f.groups[id]
	if !ok || g.UserID != userID {
		return 0, store.ErrAgentGroupNotFound
	}
	delete(f.groups, id)
	var unassigned int64
	for agentID, a := range f.agents {
		if a.GroupID == id {
			a.GroupID = ""
			f.agents[agentID] = a
			unassigned++
		}
	}
	return unassigned, nil
}

func (f *fakeStore) ReorderAgentGroups(userID string, ids []string) error {
	for i, id := range ids {
		g, ok := f.groups[id]
		if !ok || g.UserID != userID {
			return store.ErrAgentGroupOrderInvalid
		}
		g.Position = i
		f.groups[id] = g
	}
	return nil
}

func (f *fakeStore) ListAgentOrder(userID string) (map[string][]string, []string, error) {
	byGroup := map[string][]string{}
	ungrouped := []string{}
	for id, a := range f.agents {
		if a.UserID != userID {
			continue
		}
		if a.GroupID == "" {
			ungrouped = append(ungrouped, id)
			continue
		}
		byGroup[a.GroupID] = append(byGroup[a.GroupID], id)
	}
	sort.Strings(ungrouped)
	return byGroup, ungrouped, nil
}

func (f *fakeStore) ArrangeAgents(userID string, groups map[string][]string, ungrouped []string) error {
	for groupID, ids := range groups {
		g, ok := f.groups[groupID]
		if !ok || g.UserID != userID {
			return store.ErrAgentOrderInvalid
		}
		for _, id := range ids {
			a, ok := f.agents[id]
			if !ok || a.UserID != userID {
				return store.ErrAgentOrderInvalid
			}
			a.GroupID = groupID
			f.agents[id] = a
		}
	}
	for _, id := range ungrouped {
		a, ok := f.agents[id]
		if !ok || a.UserID != userID {
			return store.ErrAgentOrderInvalid
		}
		a.GroupID = ""
		f.agents[id] = a
	}
	return nil
}

func (f *fakeStore) ListConversationAttention(userID string) ([]store.ConversationAttention, error) {
	out := []store.ConversationAttention{}
	for _, c := range f.attention {
		a, ok := f.agents[c.AgentID]
		if !ok || a.UserID != userID {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

// compile-time check: the fake satisfies the port the server takes.
var _ api.PortalStore = (*fakeStore)(nil)

// ---- the conversation projection ----

func (f *fakeStore) ListSessions(agentID string, limit, offset int) ([]store.SessionRecord, error) {
	out := []store.SessionRecord{}
	for _, rec := range f.records {
		if rec.AgentID == agentID {
			out = append(out, *rec)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if offset > len(out) {
		return []store.SessionRecord{}, nil
	}
	out = out[offset:]
	if limit > 0 && limit < len(out) {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeStore) CountSessions(agentID string) (int, error) {
	n := 0
	for _, rec := range f.records {
		if rec.AgentID == agentID {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) GetSession(sessionID string) (*store.SessionRecord, error) {
	rec, ok := f.records[sessionID]
	if !ok {
		return nil, nil
	}
	copy := *rec
	return &copy, nil
}

func (f *fakeStore) GetSessionMeta(sessionID string) (*store.SessionRecord, error) {
	rec, ok := f.records[sessionID]
	if !ok {
		return nil, nil
	}
	copy := *rec
	copy.Messages = ""
	return &copy, nil
}

func (f *fakeStore) SaveSession(rec store.SessionRecord) error {
	copy := rec
	f.records[rec.ID] = &copy
	return nil
}

func (f *fakeStore) ArchiveSession(sessionID string) error {
	rec, ok := f.records[sessionID]
	if !ok {
		return nil
	}
	rec.Status = "archived"
	return nil
}

func (f *fakeStore) ListConversations(query store.ConversationFilter) ([]store.ConversationEntry, error) {
	out := []store.ConversationEntry{}
	for _, rec := range f.records {
		out = append(out, store.ConversationEntry{SessionRecord: *rec})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *fakeStore) GetBindingAgent(bindingID int64) (string, error) {
	return f.bindings[bindingID], nil
}

func (f *fakeStore) SetBindingAgent(bindingID int64, agentID string) error {
	if agentID == "" {
		delete(f.bindings, bindingID)
		return nil
	}
	f.bindings[bindingID] = agentID
	return nil
}
