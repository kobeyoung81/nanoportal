package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

type sampleRepository struct {
	mu        sync.Mutex
	users     []model.UserSummary
	rules     []model.AlertRule
	audit     []model.AuditEntry
	shortcuts []model.GitShortcut
	next      int64
}

func NewSampleRepository() Repository {
	return &sampleRepository{
		users: []model.UserSummary{
			{
				UserID:         "alice",
				DisplayName:    "Alice Admin",
				Status:         "active",
				Tier:           "pro",
				Role:           "admin",
				Channels:       []string{"cli", "wecom"},
				AgentStatus:    "healthy",
				LastActivityAt: "2026-04-26T07:38:00Z",
			},
			{
				UserID:         "bob",
				DisplayName:    "Bob Builder",
				Status:         "active",
				Tier:           "free",
				Role:           "support",
				Channels:       []string{"wechatkf"},
				AgentStatus:    "healthy",
				LastActivityAt: "2026-04-26T07:32:00Z",
			},
			{
				UserID:         "carol",
				DisplayName:    "Carol Analyst",
				Status:         "suspended",
				Tier:           "ultra",
				Role:           "user",
				Channels:       []string{"feishu"},
				AgentStatus:    "maintenance",
				LastActivityAt: "2026-04-25T18:10:00Z",
			},
			{
				UserID:         "dave",
				DisplayName:    "Dave Directory",
				Status:         "active",
				Tier:           "free",
				Role:           "user",
				AuthSource:     "ldap",
				Channels:       []string{},
				AgentStatus:    "healthy",
				LastActivityAt: "2026-04-26T07:45:00Z",
			},
		},
		rules: []model.AlertRule{
			{ID: 1, Severity: "warning", Message: "WeChat KF outbound lag is above the warning threshold.", Metric: "gateway_lag", Threshold: 5000, Enabled: true},
			{ID: 2, Severity: "info", Message: "Runner capacity is above 70%; watch for pending container requests.", Metric: "runner_capacity", Threshold: 0.7, Enabled: true},
		},
		audit: []model.AuditEntry{
			{ID: 1, ActorID: "alice", ActorRole: "operator", Action: "config.update", ResourceType: "config", ResourceID: "agent/model", CreatedAt: "2026-04-26T07:30:00Z", IP: "10.0.0.8"},
			{ID: 2, ActorID: "admin", ActorRole: "admin", Action: "agent.delete", ResourceType: "agent", ResourceID: "legacy-bot", CreatedAt: "2026-04-26T06:55:00Z", IP: "10.0.0.2"},
			{ID: 3, ActorID: "bob", ActorRole: "support", Action: "user.tier.change", ResourceType: "user", ResourceID: "carol", Detail: map[string]any{"from": "pro", "to": "ultra"}, CreatedAt: "2026-04-25T18:12:00Z", IP: "10.0.0.9"},
		},
		shortcuts: []model.GitShortcut{
			{ID: 1, UserID: "alice", AgentID: "agent-1", Path: "agents/Alice", Label: "Agent Home"},
		},
		next: 3,
	}
}

func (*sampleRepository) Close() error {
	return nil
}

func (*sampleRepository) GetOverview(context.Context) (model.Overview, error) {
	return model.Overview{
		SystemHealth: "healthy",
		Summary: model.OverviewSummary{
			ActiveUsers:      128,
			RunningAgents:    96,
			PendingInbound:   24,
			PendingOutbound:  5,
			ActiveContainers: 37,
		},
		TierDistribution: map[string]int{
			"free":  81,
			"pro":   39,
			"ultra": 8,
		},
		TopAlerts: []model.AlertSummary{
			{
				RuleID:   "gateway-wechatkf-lag",
				Severity: "warning",
				Message:  "WeChat KF outbound lag is above the warning threshold.",
			},
			{
				RuleID:   "runner-capacity",
				Severity: "info",
				Message:  "Runner capacity is above 70%; watch for pending container requests.",
			},
		},
	}, nil
}

func (*sampleRepository) ListComponents(context.Context) ([]model.ComponentSummary, error) {
	return []model.ComponentSummary{
		{
			Type:        "bus",
			DisplayName: "nanobus",
			Status:      "healthy",
			Detail:      "Queues are draining normally.",
			UpdatedAt:   "2026-04-26T07:40:00Z",
			Metrics: []model.LabelValue{
				{Label: "Inbound backlog", Value: "24"},
				{Label: "Outbound backlog", Value: "5"},
				{Label: "Config version", Value: "2026-04-26T07:15:00Z"},
			},
		},
		{
			Type:        "gateway",
			DisplayName: "nanogateway",
			Status:      "healthy",
			Detail:      "Channels are enabled and service is available.",
			UpdatedAt:   "2026-04-26T07:40:00Z",
			Metrics: []model.LabelValue{
				{Label: "Channels enabled", Value: "2/4"},
				{Label: "Last inbound", Value: "20s ago"},
				{Label: "Ack mode", Value: "disabled"},
			},
		},
		{
			Type:        "agent",
			DisplayName: "nanosec fleet",
			Status:      "healthy",
			Detail:      "Most user agents are active with low iteration counts.",
			UpdatedAt:   "2026-04-26T07:40:00Z",
			Metrics: []model.LabelValue{
				{Label: "Running agents", Value: "96"},
				{Label: "Avg iterations", Value: "5.2"},
				{Label: "Default model", Value: "gpt-4o"},
			},
		},
		{
			Type:        "runner",
			DisplayName: "nanorunner",
			Status:      "healthy",
			Detail:      "Provisioning is within target latency.",
			UpdatedAt:   "2026-04-26T07:40:00Z",
			Metrics: []model.LabelValue{
				{Label: "Pending requests", Value: "3"},
				{Label: "Active containers", Value: "37"},
				{Label: "Avg provision time", Value: "2.1s"},
			},
		},
		{
			Type:        "mysql",
			DisplayName: "MySQL",
			Status:      "healthy",
			Detail:      "Core platform database is reachable.",
			UpdatedAt:   "2026-04-26T07:40:00Z",
			Metrics: []model.LabelValue{
				{Label: "Queue growth", Value: "stable"},
				{Label: "Slow query indicator", Value: "normal"},
				{Label: "Storage pressure", Value: "41%"},
			},
		},
	}, nil
}

func (repo *sampleRepository) GetComponent(ctx context.Context, componentType string) (model.ComponentDetail, error) {
	components, _ := repo.ListComponents(ctx)
	for _, component := range components {
		if component.Type != componentType {
			continue
		}
		return model.ComponentDetail{
			Type:          component.Type,
			DisplayName:   component.DisplayName,
			Status:        component.Status,
			Description:   component.Detail,
			ConfigVersion: "2026-04-26T07:15:00Z",
			UpdatedAt:     component.UpdatedAt,
			Metrics:       component.Metrics,
			Instances: []model.ComponentInstance{
				{
					ID:         component.Type + "-01",
					Name:       component.DisplayName + " primary",
					Status:     component.Status,
					LastSeenAt: component.UpdatedAt,
					Detail:     component.Detail,
				},
			},
		}, nil
	}
	return model.ComponentDetail{}, fmt.Errorf("component %q not found", componentType)
}

func (repo *sampleRepository) ListUsers(_ context.Context, includeDeleted bool) ([]model.UserSummary, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	users := make([]model.UserSummary, 0, len(repo.users))
	for _, user := range repo.users {
		if !includeDeleted && user.Status == "deleted" {
			continue
		}
		users = append(users, user)
	}
	return users, nil
}

func (repo *sampleRepository) mutateUser(userID string, mutate func(*model.UserSummary)) error {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for i := range repo.users {
		if repo.users[i].UserID == userID {
			mutate(&repo.users[i])
			return nil
		}
	}
	return fmt.Errorf("user %q not found", userID)
}

func (repo *sampleRepository) UpdateUserRole(_ context.Context, userID, role string) error {
	return repo.mutateUser(userID, func(u *model.UserSummary) { u.Role = role })
}

func (repo *sampleRepository) UpdateUserStatus(_ context.Context, userID, status string) error {
	return repo.mutateUser(userID, func(u *model.UserSummary) { u.Status = status })
}

func (repo *sampleRepository) UpdateUserTier(_ context.Context, userID, tier string) error {
	return repo.mutateUser(userID, func(u *model.UserSummary) { u.Tier = tier })
}

func (repo *sampleRepository) SetUserPassword(context.Context, string, string, bool) error {
	return nil
}

// bcrypt hash of "oldpassword" (bcrypt.DefaultCost) for the sample repository.
const samplePasswordHash = "$2a$10$oiKWLj/rvYEEONdR74XedO9UkDj11xJ/ydjJiHEi0SRE/ID44RXmW"

func (repo *sampleRepository) GetUserPasswordHash(_ context.Context, userID string) (string, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, user := range repo.users {
		if user.UserID == userID {
			return samplePasswordHash, nil
		}
	}
	return "", fmt.Errorf("user %q not found", userID)
}

// IsDirectoryAccount mirrors the MySQL implementation against the in-memory
// users, which carry the same auth_source field.
func (repo *sampleRepository) IsDirectoryAccount(_ context.Context, userID string) (bool, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, user := range repo.users {
		if user.UserID == userID {
			return user.AuthSource == "ldap", nil
		}
	}
	return false, fmt.Errorf("user %q not found", userID)
}

func (repo *sampleRepository) CountActiveAdmins(context.Context) (int, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	count := 0
	for _, user := range repo.users {
		if user.Role == "admin" && user.Status != "deleted" {
			count++
		}
	}
	return count, nil
}

func (*sampleRepository) GetUserDisplayName(_ context.Context, userID string) (string, error) {
	names := map[string]string{"alice": "Alice Admin", "bob": "Bob Builder", "carol": "Carol Analyst"}
	return names[userID], nil
}

func (*sampleRepository) ListRunners(context.Context) ([]model.RunnerSummary, error) {
	return []model.RunnerSummary{
		{ID: "runner-primary", Hostname: "runner-1", DockerHost: "local", Status: "online", LastHeartbeat: "2026-04-26T07:39:00Z", RegisteredAt: "2026-04-26T06:00:00Z"},
		{ID: "runner-legacy-9f3a", Hostname: "a1b2c3d4e5f6", DockerHost: "local", Status: "offline", LastHeartbeat: "2026-04-10T02:00:00Z", RegisteredAt: "2026-04-10T02:00:00Z"},
	}, nil
}

func (*sampleRepository) DeleteRunner(_ context.Context, id string) error {
	if id == "" {
		return fmt.Errorf("runner id is required")
	}
	return nil
}

func (repo *sampleRepository) GetUser(ctx context.Context, userID string) (model.UserDetail, error) {
	users, _ := repo.ListUsers(ctx, true)
	for _, user := range users {
		if user.UserID != userID {
			continue
		}
		return model.UserDetail{
			UserSummary:    user,
			OverrideScopes: []string{"agent", "tools"},
			Containers: []model.ContainerState{
				{
					ID:        "ctr-" + userID + "-01",
					Status:    "running",
					Level:     user.Tier,
					UpdatedAt: "2026-04-26T07:35:00Z",
				},
			},
			EffectiveConfig: map[string]any{
				"provider": map[string]any{
					"default_model": "gpt-4o",
				},
				"agent": map[string]any{
					"max_iterations": 20,
				},
				"tools": map[string]any{
					"web_tool_enabled": true,
				},
			},
		}, nil
	}
	return model.UserDetail{}, fmt.Errorf("user %q not found", userID)
}

func (*sampleRepository) ListConfigs(context.Context) ([]model.ConfigSummary, error) {
	return []model.ConfigSummary{
		{ComponentType: "bus", UpdatedAt: "2026-04-26T07:15:00Z", Source: "sample"},
		{ComponentType: "gateway", UpdatedAt: "2026-04-26T07:15:00Z", Source: "sample"},
		{ComponentType: "agent", UpdatedAt: "2026-04-26T07:15:00Z", Source: "sample"},
		{ComponentType: "runner", UpdatedAt: "2026-04-26T07:15:00Z", Source: "sample"},
	}, nil
}

// GetConfigValues has nothing to resolve in the sample backend: a caller then
// falls back to its own defaults, which is the same behaviour as a deployment
// that never changed the key.
func (*sampleRepository) GetConfigValues(context.Context, string, []string) (map[string]string, error) {
	return map[string]string{}, nil
}

func (*sampleRepository) GetConfig(_ context.Context, componentType string) (model.ConfigDetail, error) {
	configs := map[string]map[string]any{
		"bus": {
			"host": "0.0.0.0",
			"port": 9000,
		},
		"gateway": {
			"channels": map[string]any{
				"cli": map[string]any{
					"enabled": true,
					"user_id": "alice",
				},
				"wechatkf": map[string]any{
					"enabled":  false,
					"openKfID": "masked",
				},
			},
			"ack": map[string]any{
				"enabled": false,
				"text":    "Received, processing...",
			},
		},
		"agent": {
			"provider": map[string]any{
				"default_model": "gpt-4o",
				"api_key":       "***masked***",
			},
			"agent": map[string]any{
				"max_iterations": 20,
			},
		},
		"runner": {
			"runner": map[string]any{
				"pollInterval": 5,
				"runnerID":     "runner-01",
			},
			"agentImage": "nanosec:latest",
		},
	}
	config, ok := configs[componentType]
	if !ok {
		return model.ConfigDetail{}, fmt.Errorf("config %q not found", componentType)
	}
	return model.ConfigDetail{
		ComponentType: componentType,
		UpdatedAt:     "2026-04-26T07:15:00Z",
		Config:        config,
	}, nil
}

func (r *sampleRepository) ListAudit(_ context.Context, query model.AuditQuery) ([]model.AuditEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries := slices.Clone(r.audit)
	limit := query.Limit
	if limit <= 0 || limit > len(entries) {
		limit = len(entries)
	}
	return entries[:limit], nil
}

func (r *sampleRepository) RecordAudit(_ context.Context, entry model.AuditEntry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.next++
	entry.ID = r.next
	if entry.CreatedAt == "" {
		entry.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	r.audit = append(r.audit, entry)
	return nil
}

func (r *sampleRepository) ListAlertRules(context.Context) ([]model.AlertRule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	copyOf := make([]model.AlertRule, len(r.rules))
	copy(copyOf, r.rules)
	return copyOf, nil
}

func (r *sampleRepository) CreateAlertRule(_ context.Context, rule model.AlertRule) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rule.ID = r.next
	r.next++
	r.rules = append(r.rules, rule)
	return rule.ID, nil
}

func (r *sampleRepository) DeleteAlertRule(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, rule := range r.rules {
		if rule.ID == id {
			r.rules = append(r.rules[:i], r.rules[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("alert rule %d not found", id)
}

func (r *sampleRepository) ListGitShortcuts(_ context.Context, userID, agentID string) ([]model.GitShortcut, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []model.GitShortcut
	for _, s := range r.shortcuts {
		if s.UserID == userID && (agentID == "" || s.AgentID == agentID) {
			out = append(out, s)
		}
	}
	return out, nil
}

func (r *sampleRepository) AddGitShortcut(_ context.Context, userID, agentID, path, label string) (model.GitShortcut, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.shortcuts {
		if s.UserID == userID && s.AgentID == agentID && s.Path == path {
			return s, nil
		}
	}
	r.next++
	s := model.GitShortcut{ID: r.next, UserID: userID, AgentID: agentID, Path: path, Label: label}
	r.shortcuts = append(r.shortcuts, s)
	return s, nil
}

func (r *sampleRepository) DeleteGitShortcut(_ context.Context, userID string, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, s := range r.shortcuts {
		if s.ID == id && s.UserID == userID {
			r.shortcuts = append(r.shortcuts[:i], r.shortcuts[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("shortcut %d not found", id)
}

func (*sampleRepository) ListConversations(context.Context, model.ConversationQuery) ([]model.ConversationSummary, error) {
	return []model.ConversationSummary{
		{ID: "agent-1:cli:demo:v1", AgentID: "agent-1", AccountID: "alice", Channel: "cli", ChatID: "demo", Status: "active", MessageCount: 4, UpdatedAt: "2026-04-26T07:38:00Z"},
		{ID: "agent-1:wecom:ops:v1", AgentID: "agent-1", AccountID: "bob", Channel: "wecom", ChatID: "ops", Status: "archived", MessageCount: 12, UpdatedAt: "2026-04-25T18:10:00Z"},
	}, nil
}

func (*sampleRepository) GetConversation(_ context.Context, id string) (model.ConversationDetail, error) {
	return model.ConversationDetail{
		ConversationSummary: model.ConversationSummary{
			ID: id, AgentID: "agent-1", AccountID: "alice", Channel: "cli",
			ChatID: "demo", Status: "active", MessageCount: 2, UpdatedAt: "2026-04-26T07:38:00Z",
		},
		Summary:  "Demo conversation",
		Messages: json.RawMessage(`[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]`),
	}, nil
}

func (*sampleRepository) GetRuntimeSnapshot(context.Context) (model.RuntimeSnapshot, error) {
	return model.RuntimeSnapshot{
		Containers: []model.RuntimeContainer{
			{UserID: "alice", Level: "pro", Status: "running", RunnerID: "runner-primary", UpdatedAt: "2026-04-26T07:35:00Z"},
		},
		Agents: []model.RuntimeAgent{
			{ID: "agent-1", UserID: "alice", DisplayName: "Default Assistant", Status: "running", UpdatedAt: "2026-04-26T07:36:00Z"},
		},
		Runners: []model.RunnerSummary{
			{ID: "runner-primary", Hostname: "runner-1", DockerHost: "local", Status: "online", LastHeartbeat: "2026-04-26T07:39:00Z", RegisteredAt: "2026-04-26T06:00:00Z"},
		},
	}, nil
}
