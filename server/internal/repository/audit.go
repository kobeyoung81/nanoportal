package repository

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// auditClient reads and writes the audit trail (bus) and the alert rules (admin
// module) — each from the service that owns it.
//
// Both tables were shared: the portal recorded an administrator's actions with its
// own INSERT and read the trail back with a query that joined `users` for the
// actor's name. The bus owns them now, and it resolves the name itself — one
// lookup per page instead of a join the portal had to phrase.
type auditClient struct {
	// base is the bus, which owns the audit trail.
	base string
	// adminBase is the admin module, which owns the alert rules.
	adminBase string
	http      *http.Client
}

func newAuditClient(busURL, adminURL string) *auditClient {
	return &auditClient{
		base:      busURL,
		adminBase: adminURL,
		http:      &http.Client{Timeout: 15 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// entries returns the most recent trail entries. Each non-empty condition travels
// as its own query parameter, the way the console's controls are laid out.
func (c *auditClient) entries(ctx context.Context, query model.AuditQuery) ([]model.AuditEntry, error) {
	values := url.Values{}
	if query.Limit > 0 {
		values.Set("limit", strconv.Itoa(query.Limit))
	}
	for key, value := range map[string]string{
		"action":        query.Action,
		"actor":         query.Actor,
		"resource_type": query.ResourceType,
		"resource":      query.Resource,
	} {
		if value != "" {
			values.Set(key, value)
		}
	}
	path := "/api/v1/audit"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var payload struct {
		Entries []model.AuditEntry `json:"entries"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	if payload.Entries == nil {
		payload.Entries = []model.AuditEntry{}
	}
	return payload.Entries, nil
}

// record appends one entry. The bus stamps the time and assigns the id.
func (c *auditClient) record(ctx context.Context, entry model.AuditEntry) error {
	body := map[string]any{
		"actor_id":      entry.ActorID,
		"actor_role":    entry.ActorRole,
		"action":        entry.Action,
		"resource_type": entry.ResourceType,
		"resource_id":   entry.ResourceID,
		"ip":            entry.IP,
	}
	if entry.Detail != nil {
		body["detail"] = entry.Detail
	}
	return busDo(ctx, c.http, c.base, http.MethodPost, "/api/v1/audit", body, nil)
}

// alertRules lists the operator-defined rules.
func (c *auditClient) alertRules(ctx context.Context) ([]model.AlertRule, error) {
	var payload struct {
		Rules []model.AlertRule `json:"rules"`
	}
	if err := busDo(ctx, c.http, c.adminBase, http.MethodGet, "/api/v1/alert-rules", nil, &payload); err != nil {
		return nil, err
	}
	if payload.Rules == nil {
		payload.Rules = []model.AlertRule{}
	}
	return payload.Rules, nil
}

// createAlertRule creates a rule and returns the id the bus assigned it.
func (c *auditClient) createAlertRule(ctx context.Context, rule model.AlertRule) (int64, error) {
	var payload struct {
		ID int64 `json:"id"`
	}
	err := busDo(ctx, c.http, c.adminBase, http.MethodPost, "/api/v1/alert-rules", map[string]any{
		"severity":  rule.Severity,
		"message":   rule.Message,
		"metric":    rule.Metric,
		"threshold": rule.Threshold,
		"enabled":   rule.Enabled,
	}, &payload)
	if err != nil {
		return 0, err
	}
	return payload.ID, nil
}

// deleteAlertRule removes a rule by id.
func (c *auditClient) deleteAlertRule(ctx context.Context, id int64) error {
	path := "/api/v1/alert-rules/" + url.PathEscape(strconv.FormatInt(id, 10))
	err := busDo(ctx, c.http, c.adminBase, http.MethodDelete, path, nil, nil)
	if err != nil && isNotFound(err) {
		return fmt.Errorf("alert rule %d not found", id)
	}
	return err
}
