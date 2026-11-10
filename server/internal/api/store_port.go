package api

import "gitee.com/kobeyoung81/nanoportal/server/internal/store"

// PortalStore is the portal's own data this API reads and writes:
// agents, their groups, the conversation projection and the attention snapshot
// built from it.
//
// It is an interface so the HTTP layer can be tested without a database — the
// concrete *store.Store is what the binary passes.
type PortalStore interface {
	CreateAgent(agent store.AgentRecord) error
	GetAgent(agentID string) (*store.AgentRecord, error)
	ListAgentsFiltered(userID string, includeDeleted bool) ([]store.AgentRecord, error)
	UpdateAgent(agent store.AgentRecord) error
	DeleteAgent(agentID string) error
	SetAgentStatus(agentID, status string) error
	RestoreAgent(agentID string) error
	SetDefaultSessionAgent(agentID, defID string) error
	SetAgentSettings(agentID string, settings map[string]string) error
	SetAgentGroup(agentID, groupID string) error
	AgentGroupExists(userID, groupID string) (bool, error)
	AgentDisplayNameTaken(userID, displayName, excludeAgentID string) (bool, error)
	SessionAgentsForAgent(agentID string) ([]store.SessionAgent, error)
	ClearAgentsTypeRef(id string) (int, error)

	ListAgentGroups(userID string) ([]store.AgentGroup, error)
	CreateAgentGroup(userID, name string) (*store.AgentGroup, error)
	RenameAgentGroup(id, userID, name string) error
	DeleteAgentGroup(id, userID string) (int64, error)
	ReorderAgentGroups(userID string, ids []string) error
	ListAgentOrder(userID string) (map[string][]string, []string, error)
	ArrangeAgents(userID string, groups map[string][]string, ungrouped []string) error

	ListSessions(agentID string, limit, offset int) ([]store.SessionRecord, error)
	CountSessions(agentID string) (int, error)
	GetSession(sessionID string) (*store.SessionRecord, error)
	GetSessionMeta(sessionID string) (*store.SessionRecord, error)
	SaveSession(rec store.SessionRecord) error
	ArchiveSession(sessionID string) error
	ListConversations(f store.ConversationFilter) ([]store.ConversationEntry, error)

	ListConversationAttention(userID string) ([]store.ConversationAttention, error)
}
