package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// consoleRepository serves the console. Every read and write goes to the bus:
// the portal has no database of its own — the bus is the only service that talks
// to one, which is what makes "one owner per collection" checkable.
type consoleRepository struct {
	config        *configClient
	conversations *conversationClient
	users         *userAccountClient
	audit         *auditClient
	fleet         *fleetClient
	identity      *identityClient
}

// NewRepository wires the console to the bus.
//
// busURL is the only dependency: configuration, the conversation log, accounts,
// audit, the fleet, the directory links and the git shortcuts all come from there
// now. There is no DSN to configure and none to get wrong.
func NewRepository(busURL string) (Repository, error) {
	if busURL == "" {
		return nil, fmt.Errorf("bus URL is required")
	}
	return &consoleRepository{
		config:        newConfigClient(busURL),
		conversations: newConversationClient(busURL),
		users:         newUserAccountClient(busURL),
		audit:         newAuditClient(busURL),
		fleet:         newFleetClient(busURL),
		identity:      newIdentityClient(busURL),
	}, nil
}

// Close exists for the callers that defer it. There is nothing to close: the bus
// holds the connections, and this process holds none.
func (repo *consoleRepository) Close() error { return nil }

func (repo *consoleRepository) GetOverview(ctx context.Context) (model.Overview, error) {
	// The two account numbers come from the bus: it owns the table the console
	// used to count.
	activeUsers, _, err := repo.users.counts(ctx)
	if err != nil {
		return model.Overview{}, err
	}
	// The two backlogs come from the bus: it owns both queues and answers with
	// their pending depths in one round trip.
	pendingInbound, pendingOutbound, err := repo.fleet.queueDepths(ctx)
	if err != nil {
		return model.Overview{}, err
	}
	// The container and runner numbers come from the bus now; the buckets are
	// summed here because "active" is the console's word, not the bus's.
	containerStatus, err := repo.fleet.containerCounts(ctx)
	if err != nil {
		return model.Overview{}, err
	}
	activeContainers := containerStatus["running"] + containerStatus["creating"]
	tiers, err := repo.queryTiers(ctx)
	if err != nil {
		return model.Overview{}, err
	}

	systemHealth := "healthy"
	topAlerts := []model.AlertSummary{}
	if pendingInbound > 100 || pendingOutbound > 50 {
		systemHealth = "degraded"
		topAlerts = append(topAlerts, model.AlertSummary{
			RuleID:   "queue-backlog",
			Severity: "warning",
			Message:  "Message backlog is above the nominal threshold.",
		})
	}

	return model.Overview{
		SystemHealth: systemHealth,
		Summary: model.OverviewSummary{
			ActiveUsers:      activeUsers,
			RunningAgents:    activeUsers,
			PendingInbound:   pendingInbound,
			PendingOutbound:  pendingOutbound,
			ActiveContainers: activeContainers,
		},
		TierDistribution: tiers,
		TopAlerts:        topAlerts,
	}, nil
}

func (repo *consoleRepository) ListComponents(ctx context.Context) ([]model.ComponentSummary, error) {
	overview, err := repo.GetOverview(ctx)
	if err != nil {
		return nil, err
	}
	busUpdatedAt, _ := repo.config.updatedAt(ctx, "bus")
	gatewayUpdatedAt, _ := repo.config.updatedAt(ctx, "gateway")
	agentUpdatedAt, _ := repo.config.updatedAt(ctx, "agent")
	runnerUpdatedAt, _ := repo.config.updatedAt(ctx, "runner")
	wechatKFCount, _ := repo.fleet.wechatAccounts(ctx)
	// Containers and runners are the bus's now. The two counts left above and
	// below still read MySQL: the WeChat sync state belongs to the next table to
	// move, and the channel count is a LIKE over service_config_items (also the
	// bus's, but it needs an endpoint that can count by prefix).
	containerStatus, _ := repo.fleet.containerCounts(ctx)
	pendingContainers := containerStatus["pending"]
	onlineRunners, _ := repo.fleet.onlineRunners(ctx)
	enabledChannels, _ := repo.config.count(ctx, "gateway", "channels.", ".enabled", "true")

	components := []model.ComponentSummary{
		{
			Type:        "bus",
			DisplayName: "nanobus",
			Status:      overview.SystemHealth,
			Detail:      "Derived from queue health and config availability.",
			UpdatedAt:   busUpdatedAt,
			Metrics: []model.LabelValue{
				{Label: "Inbound backlog", Value: fmt.Sprintf("%d", overview.Summary.PendingInbound)},
				{Label: "Outbound backlog", Value: fmt.Sprintf("%d", overview.Summary.PendingOutbound)},
				{Label: "Active users", Value: fmt.Sprintf("%d", overview.Summary.ActiveUsers)},
			},
		},
		{
			Type:        "gateway",
			DisplayName: "nanogateway",
			Status:      statusFromCount(enabledChannels, "healthy", "degraded"),
			Detail:      "Healthy when at least one channel is enabled; reflects channel sync state otherwise.",
			UpdatedAt:   gatewayUpdatedAt,
			Metrics: []model.LabelValue{
				{Label: "Enabled channels", Value: fmt.Sprintf("%d", enabledChannels)},
				{Label: "WeChat KF states", Value: fmt.Sprintf("%d", wechatKFCount)},
				{Label: "Pending outbound", Value: fmt.Sprintf("%d", overview.Summary.PendingOutbound)},
			},
		},
		{
			Type:        "agent",
			DisplayName: "nanosec fleet",
			Status:      "healthy",
			Detail:      "Derived from active users and queue activity.",
			UpdatedAt:   agentUpdatedAt,
			Metrics: []model.LabelValue{
				{Label: "Running agents", Value: fmt.Sprintf("%d", overview.Summary.RunningAgents)},
				{Label: "Active users", Value: fmt.Sprintf("%d", overview.Summary.ActiveUsers)},
				{Label: "Tier spread", Value: formatTierDistribution(overview.TierDistribution)},
			},
		},
		{
			Type:        "runner",
			DisplayName: "nanorunner",
			Status:      statusFromCount(onlineRunners, "healthy", "degraded"),
			Detail:      "Healthy when at least one runner is online and heartbeating.",
			UpdatedAt:   runnerUpdatedAt,
			Metrics: []model.LabelValue{
				{Label: "Online runners", Value: fmt.Sprintf("%d", onlineRunners)},
				{Label: "Pending requests", Value: fmt.Sprintf("%d", pendingContainers)},
				{Label: "Active containers", Value: fmt.Sprintf("%d", overview.Summary.ActiveContainers)},
			},
		},
		{
			Type:        "mongodb",
			DisplayName: "MongoDB",
			Status:      "healthy",
			Detail:      "Operational database (the bus owns it).",
			UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
			Metrics: []model.LabelValue{
				{Label: "Users", Value: fmt.Sprintf("%d", overview.Summary.ActiveUsers)},
				{Label: "Pending inbound", Value: fmt.Sprintf("%d", overview.Summary.PendingInbound)},
				{Label: "Pending outbound", Value: fmt.Sprintf("%d", overview.Summary.PendingOutbound)},
			},
		},
	}
	return components, nil
}

func (repo *consoleRepository) GetComponent(ctx context.Context, componentType string) (model.ComponentDetail, error) {
	components, err := repo.ListComponents(ctx)
	if err != nil {
		return model.ComponentDetail{}, err
	}
	for _, component := range components {
		if component.Type != componentType {
			continue
		}
		return model.ComponentDetail{
			Type:          component.Type,
			DisplayName:   component.DisplayName,
			Status:        component.Status,
			Description:   component.Detail,
			ConfigVersion: component.UpdatedAt,
			UpdatedAt:     component.UpdatedAt,
			Metrics:       component.Metrics,
			Instances: []model.ComponentInstance{
				{
					ID:         componentType + "-primary",
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

// ListUsers is the console's user list: identity from the bus, the directory
// linkage from the portal's own OAuth table, and "last seen" from the bus's
// queues.
//
// The account row used to be one SELECT with an EXISTS for the linkage and two
// aggregates for the channels and the activity. Each of those lives where its data
// does now, and the composition is here — where the console's shape belongs.
func (repo *consoleRepository) ListUsers(ctx context.Context, includeDeleted bool) ([]model.UserSummary, error) {
	accounts, err := repo.users.accounts(ctx, includeDeleted, 200)
	if err != nil {
		return nil, err
	}
	ldapLinked, err := repo.ldapLinkedUsers(ctx)
	if err != nil {
		return nil, err
	}
	activity, err := repo.fleet.activityByUser(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]model.UserSummary, 0, len(accounts))
	for _, a := range accounts {
		agentStatus := "healthy"
		if a.Status != "active" {
			agentStatus = "maintenance"
		}
		authSource := ""
		if ldapLinked[a.UserID] {
			authSource = "ldap"
		}
		channels := a.Channels
		if channels == nil {
			channels = []string{}
		}
		users = append(users, model.UserSummary{
			UserID:         a.UserID,
			DisplayName:    a.DisplayName,
			Status:         a.Status,
			Tier:           a.Tier,
			Role:           a.Role,
			AuthSource:     authSource,
			Channels:       channels,
			AgentStatus:    agentStatus,
			LastActivityAt: activity[a.UserID],
		})
	}
	return users, nil
}

// ldapLinkedUsers is the set of accounts that sign in through the directory.
//
// It used to be the portal's own query against its own OAuth table. That table
// belongs to the bus now (the auth service writes the links), so this asks the bus
// — one call for the whole page.
func (repo *consoleRepository) ldapLinkedUsers(ctx context.Context) (map[string]bool, error) {
	return repo.identity.directoryLinkedUsers(ctx)
}

func (repo *consoleRepository) GetUser(ctx context.Context, userID string) (model.UserDetail, error) {
	users, err := repo.ListUsers(ctx, true)
	if err != nil {
		return model.UserDetail{}, err
	}
	var summary *model.UserSummary
	for i := range users {
		if users[i].UserID == userID {
			summary = &users[i]
			break
		}
	}
	if summary == nil {
		return model.UserDetail{}, fmt.Errorf("user %q not found", userID)
	}

	containers, err := repo.listContainers(ctx, userID)
	if err != nil {
		return model.UserDetail{}, err
	}
	config, err := repo.GetConfig(ctx, "agent")
	if err != nil {
		config = model.ConfigDetail{ComponentType: "agent", Config: map[string]any{}}
	}

	return model.UserDetail{
		UserSummary:     *summary,
		OverrideScopes:  []string{},
		Containers:      containers,
		EffectiveConfig: config.Config,
	}, nil
}

// The three administration writes below used to be three UPDATEs preceded by a
// "does this user exist" SELECT (ensureUser). The bus's PATCH answers 404 for an
// account that is not there, so the existence check travels with the write —
// there is no window between the two any more.

func (repo *consoleRepository) UpdateUserRole(ctx context.Context, userID, role string) error {
	return repo.users.update(ctx, userID, map[string]string{"role": role})
}

func (repo *consoleRepository) UpdateUserStatus(ctx context.Context, userID, status string) error {
	return repo.users.update(ctx, userID, map[string]string{"status": status})
}

func (repo *consoleRepository) UpdateUserTier(ctx context.Context, userID, tier string) error {
	return repo.users.update(ctx, userID, map[string]string{"tier": tier})
}

func (repo *consoleRepository) SetUserPassword(ctx context.Context, userID, passwordHash string, mustChange bool) error {
	// The hash is produced here (bcrypt, see api/users_admin.go) and only stored by
	// the bus.
	return repo.users.setPassword(ctx, userID, passwordHash, mustChange)
}

func (repo *consoleRepository) GetUserPasswordHash(ctx context.Context, userID string) (string, error) {
	// Verification stays in this process: the bus hands the hash back, and the
	// comparison happens next to the login form.
	return repo.users.passwordHash(ctx, userID)
}

// GetUserDisplayName is the one field other portal pages need, so it asks for the
// account and keeps the name.
//
// A name for somebody who is not there is empty rather than an error: this is a
// display lookup, and the SELECT it replaces tolerated "no row" the same way.
func (repo *consoleRepository) GetUserDisplayName(ctx context.Context, userID string) (string, error) {
	account, err := repo.users.account(ctx, userID)
	if err != nil {
		if isNotFound(err) {
			return "", nil
		}
		return "", err
	}
	return account.DisplayName, nil
}

// IsDirectoryAccount reports whether the account signs in through the directory,
// in which case its platform password is not usable.
func (repo *consoleRepository) IsDirectoryAccount(ctx context.Context, userID string) (bool, error) {
	return repo.identity.isDirectoryAccount(ctx, userID)
}

func (repo *consoleRepository) CountActiveAdmins(ctx context.Context) (int, error) {
	// The same count the bus runs for its own guard: one definition of "active
	// admin", used by the console before it demotes or deletes one.
	_, admins, err := repo.users.counts(ctx)
	return admins, err
}

func (repo *consoleRepository) ListConfigs(ctx context.Context) ([]model.ConfigSummary, error) {
	components, err := repo.config.components(ctx)
	if err != nil {
		return nil, err
	}
	configs := make([]model.ConfigSummary, 0, len(components))
	for _, componentType := range components {
		configs = append(configs, model.ConfigSummary{
			ComponentType: componentType,
			UpdatedAt:     "",
			// The bus owns this table now, so the summary names the bus rather
			// than a table the portal reads itself.
			Source: "nanobus",
		})
	}
	return configs, nil
}

// GetConfigValues reads the named keys of one component; missing keys are
// simply absent from the result.
//
// The bus has no "selected keys" read, so the whole component is fetched and then
// filtered here. Filtering still matters even though the portal is a trusted
// caller: callers of this method use it to read one platform default on behalf of
// a user, and handing them a component that may hold secrets would widen what
// they can see.
func (repo *consoleRepository) GetConfigValues(ctx context.Context, componentType string, keys []string) (map[string]string, error) {
	out := map[string]string{}
	if len(keys) == 0 {
		return out, nil
	}
	items, err := repo.config.items(ctx, componentType)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		if value, ok := items[key]; ok {
			out[key] = value
		}
	}
	return out, nil
}

func (repo *consoleRepository) GetConfig(ctx context.Context, componentType string) (model.ConfigDetail, error) {
	items, err := repo.config.items(ctx, componentType)
	if err != nil {
		return model.ConfigDetail{}, err
	}
	if len(items) == 0 {
		return model.ConfigDetail{}, fmt.Errorf("config %q not found", componentType)
	}
	config := make(map[string]any, len(items))
	for key, value := range items {
		config[key] = value
	}
	return model.ConfigDetail{
		ComponentType: componentType,
		UpdatedAt:     "",
		Config:        config,
	}, nil
}

// The audit trail and the alert rules are the bus's tables now. The portal keeps
// writing the trail — an administrator's action is recorded where the action is —
// but through the bus, which also resolves the actor's display name so the console
// does not have to join it back itself.

func (repo *consoleRepository) ListAudit(ctx context.Context, query model.AuditQuery) ([]model.AuditEntry, error) {
	return repo.audit.entries(ctx, query)
}

func (repo *consoleRepository) RecordAudit(ctx context.Context, entry model.AuditEntry) error {
	return repo.audit.record(ctx, entry)
}

func (repo *consoleRepository) ListAlertRules(ctx context.Context) ([]model.AlertRule, error) {
	return repo.audit.alertRules(ctx)
}

func (repo *consoleRepository) CreateAlertRule(ctx context.Context, rule model.AlertRule) (int64, error) {
	return repo.audit.createAlertRule(ctx, rule)
}

func (repo *consoleRepository) DeleteAlertRule(ctx context.Context, id int64) error {
	return repo.audit.deleteAlertRule(ctx, id)
}

func (repo *consoleRepository) queryTiers(ctx context.Context) (map[string]int, error) {
	return repo.users.tierCounts(ctx)
}

// ListGitShortcuts returns the paths a user has starred, newest first.
func (repo *consoleRepository) ListGitShortcuts(ctx context.Context, userID, agentID string) ([]model.GitShortcut, error) {
	return repo.identity.gitShortcuts(ctx, userID, agentID)
}

// AddGitShortcut stars a path, or re-labels it when it is already starred.
func (repo *consoleRepository) AddGitShortcut(ctx context.Context, userID, agentID, path, label string) (model.GitShortcut, error) {
	return repo.identity.addGitShortcut(ctx, userID, agentID, path, label)
}

// DeleteGitShortcut removes one star; an unknown id is an error, as it was when
// this was a DELETE that had to match a row.
func (repo *consoleRepository) DeleteGitShortcut(ctx context.Context, userID string, id int64) error {
	return repo.identity.deleteGitShortcut(ctx, userID, id)
}

func (repo *consoleRepository) ListRunners(ctx context.Context) ([]model.RunnerSummary, error) {
	return repo.fleet.runners(ctx)
}

func (repo *consoleRepository) DeleteRunner(ctx context.Context, id string) error {
	return repo.fleet.deleteRunner(ctx, id)
}

func (repo *consoleRepository) listContainers(ctx context.Context, userID string) ([]model.ContainerState, error) {
	containers, err := repo.fleet.containers(ctx, userID, 10)
	if err != nil {
		return nil, err
	}
	out := make([]model.ContainerState, 0, len(containers))
	for _, c := range containers {
		out = append(out, c.state())
	}
	return out, nil
}

func formatTierDistribution(tiers map[string]int) string {
	return fmt.Sprintf("free:%d pro:%d ultra:%d", tiers["free"], tiers["pro"], tiers["ultra"])
}

func statusFromCount(value int, healthy, degraded string) string {
	if value == 0 {
		return degraded
	}
	return healthy
}

func (repo *consoleRepository) ListConversations(ctx context.Context, query model.ConversationQuery) ([]model.ConversationSummary, error) {
	// The listing used to be a SELECT whose shape had to stay compatible with the
	// bus's writes (message_count and messages_bytes are denormalized exactly so
	// this never has to evaluate the messages). The bus serves it now, and this
	// repository goes on being the portal's only door to data.
	return repo.conversations.conversations(ctx, query)
}

func (repo *consoleRepository) GetConversation(ctx context.Context, id string) (model.ConversationDetail, error) {
	detail, err := repo.conversations.conversation(ctx, id)
	if err != nil {
		return model.ConversationDetail{}, err
	}
	if len(detail.Messages) == 0 {
		// A conversation with no messages still renders: an empty array, not a
		// null the caller has to special-case.
		detail.Messages = json.RawMessage("[]")
	}
	return detail, nil
}

func (repo *consoleRepository) GetRuntimeSnapshot(ctx context.Context) (model.RuntimeSnapshot, error) {
	snapshot := model.RuntimeSnapshot{
		Containers: []model.RuntimeContainer{},
		Agents:     []model.RuntimeAgent{},
		Runners:    []model.RunnerSummary{},
	}

	// The snapshot's view of the containers: everybody's, newest first, with the
	// runner each one landed on — the bus serves exactly that.
	containers, err := repo.fleet.containers(ctx, "", 200)
	if err != nil {
		return snapshot, err
	}
	for _, c := range containers {
		snapshot.Containers = append(snapshot.Containers, c.runtime())
	}

	agents, err := repo.fleet.agentFleet(ctx, 200)
	if err != nil {
		return snapshot, err
	}
	snapshot.Agents = agents

	runners, err := repo.ListRunners(ctx)
	if err != nil {
		return snapshot, err
	}
	snapshot.Runners = runners
	return snapshot, nil
}
