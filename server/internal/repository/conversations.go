package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// conversationClient reads the conversation log through the bus's REST API.
//
// The portal used to select `agent_sessions` itself. That is the same problem the
// configuration read had (see busconfig.go), and it is why the session storage
// could not move without the portal moving too: one table's schema was a contract
// between two services. The column names survive here only as field names on the
// wire, and the bus owns what is behind them.
type conversationClient struct {
	base string
	http *http.Client
}

func newConversationClient(busURL string) *conversationClient {
	return &conversationClient{
		base: busURL,
		// As with configuration: the bus refuses its endpoints to anonymous
		// callers, and the portal is a caller.
		http: &http.Client{Timeout: 30 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// conversations lists the newest conversations across every agent. Each non-empty
// condition travels as its own query parameter: the console has one control per
// condition, and the bus ANDs them.
func (c *conversationClient) conversations(ctx context.Context, query model.ConversationQuery) ([]model.ConversationSummary, error) {
	values := url.Values{}
	if query.Limit > 0 {
		values.Set("limit", fmt.Sprint(query.Limit))
	}
	for key, value := range map[string]string{
		"session": query.Session,
		"agent":   query.Agent,
		"account": query.Account,
		"channel": query.Channel,
		"status":  query.Status,
	} {
		if value != "" {
			values.Set(key, value)
		}
	}
	path := "/api/v1/conversations"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var payload struct {
		Conversations []model.ConversationSummary `json:"conversations"`
	}
	if err := c.get(ctx, path, &payload); err != nil {
		return nil, err
	}
	if payload.Conversations == nil {
		payload.Conversations = []model.ConversationSummary{}
	}
	return payload.Conversations, nil
}

// conversation reads one conversation, messages included.
func (c *conversationClient) conversation(ctx context.Context, id string) (model.ConversationDetail, error) {
	var payload struct {
		model.ConversationSummary
		Summary  string          `json:"summary"`
		Messages json.RawMessage `json:"messages"`
	}
	if err := c.get(ctx, "/api/v1/conversations/"+url.PathEscape(id), &payload); err != nil {
		return model.ConversationDetail{}, err
	}
	return model.ConversationDetail{
		ConversationSummary: payload.ConversationSummary,
		Summary:             payload.Summary,
		Messages:            payload.Messages,
	}, nil
}

func (c *conversationClient) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("bus conversations %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("bus conversations %s: read body: %w", path, err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		message := fmt.Sprintf("bus %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			if m, ok := payload["error"].(string); ok && m != "" {
				message = m
			}
		}
		return fmt.Errorf("bus conversations %s: %s", path, message)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("bus conversations %s: decode: %w", path, err)
	}
	return nil
}
