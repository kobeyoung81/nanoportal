package repository

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// fleetClient reads the runners and the container requests through the bus.
//
// The console's fleet page, the runtime snapshot and three of the overview's
// counters used to be SELECTs against MySQL. The bus owns both collections now; it
// also knows which runner a container landed on, which is a field the agent-facing
// protocol shape deliberately does not carry.
type fleetClient struct {
	base string
	http *http.Client
}

func newFleetClient(busURL string) *fleetClient {
	return &fleetClient{
		base: busURL,
		http: &http.Client{Timeout: 15 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// runnerPayload is one runner as the bus serves it.
type runnerPayload struct {
	ID            string `json:"id"`
	Hostname      string `json:"hostname"`
	DockerHost    string `json:"docker_host"`
	Status        string `json:"status"`
	LastHeartbeat string `json:"last_heartbeat"`
	RegisteredAt  string `json:"registered_at"`
}

func (p runnerPayload) summary() model.RunnerSummary {
	return model.RunnerSummary{
		ID: p.ID, Hostname: p.Hostname, DockerHost: p.DockerHost,
		Status: p.Status, LastHeartbeat: p.LastHeartbeat, RegisteredAt: p.RegisteredAt,
	}
}

// runners lists the fleet, most recently registered first.
func (c *fleetClient) runners(ctx context.Context) ([]model.RunnerSummary, error) {
	var payload struct {
		Runners []runnerPayload `json:"runners"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/runners", nil, &payload); err != nil {
		return nil, err
	}
	out := make([]model.RunnerSummary, 0, len(payload.Runners))
	for _, r := range payload.Runners {
		out = append(out, r.summary())
	}
	return out, nil
}

// deleteRunner prunes a runner by hand.
func (c *fleetClient) deleteRunner(ctx context.Context, id string) error {
	return busDo(ctx, c.http, c.base, http.MethodDelete, "/api/v1/runners/"+url.PathEscape(id), nil, nil)
}

// onlineRunners is the overview's fleet counter.
func (c *fleetClient) onlineRunners(ctx context.Context) (int, error) {
	var payload struct {
		Online int `json:"online"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/runners/counts", nil, &payload); err != nil {
		return 0, err
	}
	return payload.Online, nil
}

// containerPayload is one container request as the bus serves it. It carries the
// union of what the two console views need: the per-user list shows status/level,
// the runtime snapshot also shows the user and the runner.
type containerPayload struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Level     string `json:"level"`
	Status    string `json:"status"`
	RunnerID  string `json:"runner_id"`
	UpdatedAt string `json:"updated_at"`
}

func (p containerPayload) runtime() model.RuntimeContainer {
	return model.RuntimeContainer{
		UserID: p.UserID, Level: p.Level, Status: p.Status,
		RunnerID: p.RunnerID, UpdatedAt: p.UpdatedAt,
	}
}

func (p containerPayload) state() model.ContainerState {
	return model.ContainerState{
		ID: p.ID, Status: p.Status, Level: p.Level, UpdatedAt: p.UpdatedAt,
	}
}

// containers lists container requests: one user's when userID is set, everybody's
// when it is empty (the runtime snapshot's view).
func (c *fleetClient) containers(ctx context.Context, userID string, limit int) ([]containerPayload, error) {
	path := "/api/v1/container-requests"
	query := url.Values{}
	if userID != "" {
		query.Set("user_id", userID)
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}

	var payload struct {
		Containers []containerPayload `json:"containers"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	return payload.Containers, nil
}

// containerCounts returns the per-status buckets; the caller sums the ones it
// shows, so a status added later needs no change here.
func (c *fleetClient) containerCounts(ctx context.Context) (map[string]int, error) {
	var payload struct {
		ByStatus map[string]int `json:"by_status"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/container-requests/counts", nil, &payload); err != nil {
		return nil, err
	}
	if payload.ByStatus == nil {
		payload.ByStatus = map[string]int{}
	}
	return payload.ByStatus, nil
}

// agentPayload is one agent as the runtime snapshot shows it.
type agentPayload struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updated_at"`
}

// agentFleet lists every agent on the platform, newest first — the runtime
// snapshot's view, not one user's slice.
func (c *fleetClient) agentFleet(ctx context.Context, limit int) ([]model.RuntimeAgent, error) {
	path := "/api/v1/agent-fleet"
	if limit > 0 {
		path += "?limit=" + strconv.Itoa(limit)
	}
	var payload struct {
		Agents []agentPayload `json:"agents"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	out := make([]model.RuntimeAgent, 0, len(payload.Agents))
	for _, a := range payload.Agents {
		out = append(out, model.RuntimeAgent{
			ID: a.ID, UserID: a.UserID, DisplayName: a.DisplayName,
			Status: a.Status, UpdatedAt: a.UpdatedAt,
		})
	}
	return out, nil
}

// activityByUser returns each user's last activity, as an RFC3339 string.
//
// The platform knows it only through the queues, and the bus merges the two of
// them: the console asks one question and does not have to know there are two.
func (c *fleetClient) activityByUser(ctx context.Context) (map[string]string, error) {
	var payload struct {
		Activity map[string]string `json:"activity"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/user-activity", nil, &payload); err != nil {
		return nil, err
	}
	if payload.Activity == nil {
		payload.Activity = map[string]string{}
	}
	return payload.Activity, nil
}

// queueDepths returns the two backlogs the overview prints.
func (c *fleetClient) queueDepths(ctx context.Context) (inbound, outbound int, err error) {
	var payload struct {
		Inbound  int `json:"inbound_pending"`
		Outbound int `json:"outbound_pending"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/queues/counts", nil, &payload); err != nil {
		return 0, 0, err
	}
	return payload.Inbound, payload.Outbound, nil
}

// wechatAccounts is the gateway component's WeChat channel count.
func (c *fleetClient) wechatAccounts(ctx context.Context) (int, error) {
	var payload struct {
		Accounts int `json:"accounts"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/api/v1/wechat-kf/counts", nil, &payload); err != nil {
		return 0, err
	}
	return payload.Accounts, nil
}
