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
	agents    map[string]store.AgentRecord
	sessions  map[string][]store.SessionAgent
	groups    map[string]store.AgentGroup
	attention []store.ConversationAttention
	cleared   []string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		agents:   map[string]store.AgentRecord{},
		sessions: map[string][]store.SessionAgent{},
		groups:   map[string]store.AgentGroup{},
	}
}

// withAgent seeds one agent, defaulting its session agents to build+plan.
func (f *fakeStore) withAgent(a store.AgentRecord) *fakeStore {
	if a.Status == "" {
		a.Status = "running"
	}
	f.agents[a.ID] = a
	if _, ok := f.sessions[a.ID]; !ok {
		f.sessions[a.ID] = []store.SessionAgent{
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
	f.sessions[a.ID] = []store.SessionAgent{
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
	list, ok := f.sessions[id]
	if !ok {
		return store.ErrAgentNotFound
	}
	for i := range list {
		list[i].IsDefault = list[i].DefID == defID
	}
	f.sessions[id] = list
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
	return f.sessions[id], nil
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
var _ api.AgentStore = (*fakeStore)(nil)
