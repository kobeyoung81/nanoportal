package repository

import (
	"context"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

type Repository interface {
	Close() error
	GetOverview(ctx context.Context) (model.Overview, error)
	ListComponents(ctx context.Context) ([]model.ComponentSummary, error)
	GetComponent(ctx context.Context, componentType string) (model.ComponentDetail, error)
	ListUsers(ctx context.Context, includeDeleted bool) ([]model.UserSummary, error)
	GetUser(ctx context.Context, userID string) (model.UserDetail, error)
	GetUserDisplayName(ctx context.Context, userID string) (string, error)
	UpdateUserRole(ctx context.Context, userID, role string) error
	UpdateUserStatus(ctx context.Context, userID, status string) error
	UpdateUserTier(ctx context.Context, userID, tier string) error
	SetUserPassword(ctx context.Context, userID, passwordHash string, mustChange bool) error
	GetUserPasswordHash(ctx context.Context, userID string) (string, error)
	IsDirectoryAccount(ctx context.Context, userID string) (bool, error)
	CountActiveAdmins(ctx context.Context) (int, error)
	ListRunners(ctx context.Context) ([]model.RunnerSummary, error)
	DeleteRunner(ctx context.Context, id string) error
	ListConfigs(ctx context.Context) ([]model.ConfigSummary, error)
	GetConfig(ctx context.Context, componentType string) (model.ConfigDetail, error)
	// GetConfigValues reads selected keys of one component. It exists so a
	// user-facing caller can read a single platform default without being
	// handed the whole component (which holds secrets).
	GetConfigValues(ctx context.Context, componentType string, keys []string) (map[string]string, error)
	ListAudit(ctx context.Context, query model.AuditQuery) ([]model.AuditEntry, error)
	RecordAudit(ctx context.Context, entry model.AuditEntry) error
	ListAlertRules(ctx context.Context) ([]model.AlertRule, error)
	CreateAlertRule(ctx context.Context, rule model.AlertRule) (int64, error)
	DeleteAlertRule(ctx context.Context, id int64) error
	ListGitShortcuts(ctx context.Context, userID, agentID string) ([]model.GitShortcut, error)
	AddGitShortcut(ctx context.Context, userID, agentID, path, label string) (model.GitShortcut, error)
	DeleteGitShortcut(ctx context.Context, userID string, id int64) error
	ListConversations(ctx context.Context, query model.ConversationQuery) ([]model.ConversationSummary, error)
	GetConversation(ctx context.Context, id string) (model.ConversationDetail, error)
	GetRuntimeSnapshot(ctx context.Context) (model.RuntimeSnapshot, error)
}
