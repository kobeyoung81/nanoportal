package model

import "encoding/json"

type AdminIdentity struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type LabelValue struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type AlertSummary struct {
	RuleID   string `json:"rule_id"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type OverviewSummary struct {
	ActiveUsers      int `json:"active_users"`
	RunningAgents    int `json:"running_agents"`
	PendingInbound   int `json:"pending_inbound"`
	PendingOutbound  int `json:"pending_outbound"`
	ActiveContainers int `json:"active_containers"`
}

type Overview struct {
	SystemHealth     string          `json:"system_health"`
	Summary          OverviewSummary `json:"summary"`
	TierDistribution map[string]int  `json:"tier_distribution"`
	TopAlerts        []AlertSummary  `json:"top_alerts"`
}

type ComponentSummary struct {
	Type        string       `json:"type"`
	DisplayName string       `json:"display_name"`
	Status      string       `json:"status"`
	Detail      string       `json:"detail"`
	Metrics     []LabelValue `json:"metrics"`
	UpdatedAt   string       `json:"updated_at"`
}

type ComponentInstance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	LastSeenAt string `json:"last_seen_at"`
	Detail     string `json:"detail"`
}

type ComponentDetail struct {
	Type          string              `json:"type"`
	DisplayName   string              `json:"display_name"`
	Status        string              `json:"status"`
	Description   string              `json:"description"`
	ConfigVersion string              `json:"config_version"`
	UpdatedAt     string              `json:"updated_at"`
	Metrics       []LabelValue        `json:"metrics"`
	Instances     []ComponentInstance `json:"instances"`
}

type ContainerState struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Level     string `json:"level"`
	UpdatedAt string `json:"updated_at"`
}

type RunnerSummary struct {
	ID            string `json:"id"`
	Hostname      string `json:"hostname"`
	DockerHost    string `json:"docker_host"`
	Status        string `json:"status"`
	LastHeartbeat string `json:"last_heartbeat"`
	RegisteredAt  string `json:"registered_at"`
}

type UserSummary struct {
	UserID         string   `json:"user_id"`
	DisplayName    string   `json:"display_name"`
	Status         string   `json:"status"`
	Tier           string   `json:"tier"`
	Role           string   `json:"role"`
	AuthSource     string   `json:"auth_source"`
	Channels       []string `json:"channels"`
	AgentStatus    string   `json:"agent_status"`
	LastActivityAt string   `json:"last_activity_at"`
}

type UserDetail struct {
	UserSummary
	OverrideScopes  []string         `json:"override_scopes"`
	Containers      []ContainerState `json:"containers"`
	EffectiveConfig map[string]any   `json:"effective_config"`
}

type ConfigSummary struct {
	ComponentType string `json:"component_type"`
	UpdatedAt     string `json:"updated_at"`
	Source        string `json:"source"`
}

type ConfigDetail struct {
	ComponentType string         `json:"component_type"`
	UpdatedAt     string         `json:"updated_at"`
	Config        map[string]any `json:"config"`
}

type AuditEntry struct {
	ID      int64  `json:"id"`
	ActorID string `json:"actor_id"`
	// ActorName and ResourceName are resolved by the bus when the trail is
	// listed: the console shows a person or an agent, not an id.
	ActorName    string         `json:"actor_name,omitempty"`
	ActorRole    string         `json:"actor_role"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	ResourceID   string         `json:"resource_id"`
	ResourceName string         `json:"resource_name,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
	IP           string         `json:"ip"`
	CreatedAt    string         `json:"created_at"`
}

// AuditQuery is the audit trail's read: a limit plus one condition per control on
// the console's page. Empty fields are not conditions.
type AuditQuery struct {
	Limit        int
	Action       string
	Actor        string
	ResourceType string
	Resource     string
}

type AlertRule struct {
	ID        int64   `json:"id"`
	Severity  string  `json:"severity"`
	Message   string  `json:"message"`
	Metric    string  `json:"metric"`
	Threshold float64 `json:"threshold"`
	Enabled   bool    `json:"enabled"`
}

// GitShortcut is a user's starred path within a specific agent's container.
type GitShortcut struct {
	ID      int64  `json:"id"`
	UserID  string `json:"user_id"`
	AgentID string `json:"agent_id"`
	Path    string `json:"path"`
	Label   string `json:"label,omitempty"`
}

type ConversationSummary struct {
	ID        string `json:"id"`
	AgentID   string `json:"agent_id"`
	AgentName string `json:"agent_name,omitempty"`
	AccountID string `json:"account_id"`
	// AccountName is the owner's display name, resolved by the bus when the log is
	// listed; empty when the account no longer exists.
	AccountName   string `json:"account_name,omitempty"`
	Channel       string `json:"channel"`
	ChatID        string `json:"chat_id"`
	Status        string `json:"status"`
	MessageCount  int    `json:"message_count"`
	MessagesBytes int64  `json:"messages_bytes"`
	UpdatedAt     string `json:"updated_at"`
}

// ConversationQuery is the conversation log's read: a limit plus one condition
// per control on the console's page. Empty fields are not conditions.
type ConversationQuery struct {
	Limit   int
	Session string
	Agent   string
	Account string
	Channel string
	Status  string
}

type ConversationDetail struct {
	ConversationSummary
	Summary  string          `json:"summary"`
	Messages json.RawMessage `json:"messages"`
}

type RuntimeContainer struct {
	UserID    string `json:"user_id"`
	Level     string `json:"level"`
	Status    string `json:"status"`
	RunnerID  string `json:"runner_id"`
	UpdatedAt string `json:"updated_at"`
}

type RuntimeAgent struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updated_at"`
}

type RuntimeSnapshot struct {
	Containers []RuntimeContainer `json:"containers"`
	Agents     []RuntimeAgent     `json:"agents"`
	Runners    []RunnerSummary    `json:"runners"`
}
