package store

// The session projection: the portal serves it and the agents write it. The
// document shape is unchanged from the service that used to own it; only the
// writer moved.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ErrSessionResync reports that a message delta could not be applied because the
// stored conversation is not the prefix it claims to be — a snapshot failed to
// land at some point. The sender's answer is to send the whole array, which is
// why this is a typed error rather than a silent append: appending anyway would
// leave a hole in the portal's history, and a hole looks exactly like a stretch
// where nobody spoke.
var ErrSessionResync = errors.New("session messages are out of sync: resend the full conversation")

// SessionRecord is a document in the agent_sessions collection.
type SessionRecord struct {
	ID            string
	AgentID       string
	AccountID     string
	Channel       string
	ChatID        string
	Messages      string // JSON array of provider messages
	Summary       string
	Meta          string
	Status        string
	Title         string
	MessageCount  int
	MessagesBytes int // serialized size of the stored messages, so readers never load them
	TurnRunning   bool
	TurnUpdatedAt time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time

	// FromIndex and MessagesOmitted describe a *delta* save: Messages holds only
	// the conversation from FromIndex on. A suffix cannot express the totals, so
	// the store accumulates message_count and messages_bytes from it instead —
	// exactly, by construction: appending k messages to the stored array grows its
	// JSON by the delta's own length minus the one "]" it replaces.
	//
	// Both are zero for a full save — which is what every agent sent before the
	// delta protocol existed.
	FromIndex       int
	MessagesOmitted bool
}

// storedSession is a session document.
//
// The three columns that used to be derived from the payload — title,
// message_count, messages_bytes — are still denormalized (the listing never
// reads the array), and a delta write supplies the last two from the sender
// rather than loading every message to measure them.
type storedSession struct {
	ID        string `bson:"_id"`
	AgentID   string `bson:"agent_id"`
	AccountID string `bson:"account_id"`
	Channel   string `bson:"channel"`
	ChatID    string `bson:"chat_id"`
	// Messages is a real array, which is what makes $push possible — the point of
	// the whole exercise. The elements are documents, so nothing is double
	// encoded.
	Messages      []any  `bson:"messages"`
	Summary       string `bson:"summary,omitempty"`
	Meta          string `bson:"meta,omitempty"`
	Status        string `bson:"status"`
	Title         string `bson:"title,omitempty"`
	MessageCount  int    `bson:"message_count"`
	MessagesBytes int    `bson:"messages_bytes"`
	TurnRunning   bool   `bson:"turn_running"`
	// Absent unless a turn is running, so a reader can tell "no turn" from
	// "a turn that a crashed agent never finished".
	TurnUpdatedAt *time.Time `bson:"turn_updated_at,omitempty"`
	CreatedAt     time.Time  `bson:"created_at"`
	UpdatedAt     time.Time  `bson:"updated_at"`
}

// sessions is the collection, configured so a decoded message element comes back
// as a map rather than the driver's bson.D: these values are handed straight to
// the browser as JSON, and bson.D marshals as an array of key/value pairs.
func (s *Store) sessions() *mongo.Collection {
	return s.db.Collection(sessionsCollection,
		options.Collection().SetBSONOptions(&options.BSONOptions{DefaultDocumentM: true}))
}

// record converts a document. Messages is rendered only when asked for: the
// listing paths never want it, and for a multi-MiB conversation the difference
// is the whole reason those paths exist.
func (d storedSession) record(withMessages bool) SessionRecord {
	rec := SessionRecord{
		ID: d.ID, AgentID: d.AgentID, AccountID: d.AccountID,
		Channel: d.Channel, ChatID: d.ChatID,
		Summary: d.Summary, Meta: d.Meta, Status: d.Status, Title: d.Title,
		MessageCount: d.MessageCount, MessagesBytes: d.MessagesBytes,
		TurnRunning: d.TurnRunning,
		CreatedAt:   d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
	if d.TurnUpdatedAt != nil {
		rec.TurnUpdatedAt = *d.TurnUpdatedAt
	}
	if withMessages {
		// Marshalling the decoded array is what makes the stored bytes_ count
		// reproducible: a reader that measures the document gets this same number,
		// whatever order the original sender put the keys in.
		if encoded, err := json.Marshal(d.Messages); err == nil {
			rec.Messages = string(encoded)
		} else {
			rec.Messages = "[]"
		}
	}
	return rec
}

// sessionTitle derives a conversation title from the first user message so the
// chat sidebar can display something meaningful without fetching full history.
func sessionTitle(messages string) string {
	if messages == "" {
		return ""
	}
	var payload []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(messages), &payload); err != nil {
		return ""
	}
	for _, msg := range payload {
		if msg.Role == "user" && strings.TrimSpace(msg.Content) != "" {
			title := strings.Join(strings.Fields(msg.Content), " ")
			// Truncate on rune boundaries: byte-slicing CJK text would emit
			// invalid UTF-8.
			if runes := []rune(title); len(runes) > 60 {
				title = string(runes[:60]) + "…"
			}
			return title
		}
	}
	return ""
}

// sessionScalars is the part of a save that is not the message array: the fields
// the sender is authoritative for. Built once and used by both write paths.
func sessionScalars(rec SessionRecord, now time.Time) bson.D {
	set := bson.D{
		{Key: "summary", Value: rec.Summary},
		{Key: "meta", Value: rec.Meta},
		{Key: "status", Value: rec.Status},
		{Key: "turn_running", Value: rec.TurnRunning},
		{Key: "updated_at", Value: now},
	}
	// turn_updated_at is only meaningful while a turn is running; clearing it on
	// finish lets readers detect a stale flag left by a crashed agent.
	if rec.TurnRunning {
		set = append(set, bson.E{Key: "turn_updated_at", Value: now})
	} else {
		set = append(set, bson.E{Key: "turn_updated_at", Value: nil})
	}
	return set
}

// SaveSession upserts a session snapshot.
//
// Two shapes arrive here. A *full* save (the default, and what every agent sent
// before the delta protocol existed) carries the whole conversation and is
// applied as a replacement — the store derives title, message_count and
// messages_bytes from the payload itself. A *delta* save carries only the
// messages from FromIndex on, and is applied with $push against a filter that
// checks the stored length: one single-document, atomic update instead of
// rewriting a multi-MiB document every second, which is what the binlog was
// drowning in.
func (s *Store) SaveSession(rec SessionRecord) error {
	if rec.ID == "" {
		return fmt.Errorf("save session: id is required")
	}
	if rec.Status == "" {
		rec.Status = "active"
	}

	payload := rec.Messages
	if payload == "" {
		payload = "[]"
	}
	var messages []any
	if err := json.Unmarshal([]byte(payload), &messages); err != nil {
		return fmt.Errorf("save session %q: decode messages: %w", rec.ID, err)
	}
	if messages == nil {
		messages = []any{}
	}

	if rec.MessagesOmitted {
		return s.appendSessionMessages(rec, messages, payload)
	}
	return s.replaceSessionMessages(rec, messages)
}

// replaceSessionMessages writes the whole conversation.
func (s *Store) replaceSessionMessages(rec SessionRecord, messages []any) error {
	ctx, cancel := opCtx()
	defer cancel()

	encoded, err := json.Marshal(messages)
	if err != nil {
		return fmt.Errorf("save session %q: encode messages: %w", rec.ID, err)
	}
	// Derived from the *stored* form, not from the payload bytes the sender sent:
	// messages_bytes has to be reproducible by whoever re-measures the document.
	rec.MessageCount = len(messages)
	rec.MessagesBytes = len(encoded)
	if rec.Title == "" {
		rec.Title = sessionTitle(string(encoded))
	}

	now := time.Now().UTC()
	set := append(sessionScalars(rec, now),
		bson.E{Key: "agent_id", Value: rec.AgentID},
		bson.E{Key: "account_id", Value: rec.AccountID},
		bson.E{Key: "channel", Value: rec.Channel},
		bson.E{Key: "chat_id", Value: rec.ChatID},
		bson.E{Key: "messages", Value: messages},
		bson.E{Key: "title", Value: rec.Title},
		bson.E{Key: "message_count", Value: rec.MessageCount},
		bson.E{Key: "messages_bytes", Value: rec.MessagesBytes},
	)
	update := bson.D{
		{Key: "$set", Value: set},
		// created_at was not in the SQL upsert's column list either.
		{Key: "$setOnInsert", Value: bson.D{{Key: "created_at", Value: now}}},
	}
	if err := retryOnDuplicateUpsert(func() error {
		_, err := s.sessions().UpdateOne(ctx,
			bson.D{{Key: "_id", Value: rec.ID}}, update, options.UpdateOne().SetUpsert(true))
		return err
	}); err != nil {
		return fmt.Errorf("save session %q: %w", rec.ID, err)
	}
	return nil
}

// appendSessionMessages appends the messages from FromIndex on.
func (s *Store) appendSessionMessages(rec SessionRecord, messages []any, payload string) error {
	ctx, cancel := opCtx()
	defer cancel()

	now := time.Now().UTC()
	set := sessionScalars(rec, now)
	// The one scalar a delta must not insist on: a title the bus derived from the
	// conversation's first user message is not in the sender's view, so an empty
	// one here means "I have nothing better", not "clear it".
	if rec.Title != "" {
		set = append(set, bson.E{Key: "title", Value: rec.Title})
	}

	update := bson.D{{Key: "$set", Value: set}}
	if len(messages) > 0 {
		// The counters are accumulated rather than stated: k appended messages add
		// k to the count, and the array's JSON grows by the delta's own length
		// minus the one "]" it replaces — exact, so a reader that re-measures the
		// document still lands on the same number (V-10).
		update = append([]bson.E{
			{Key: "$push", Value: bson.D{{Key: "messages", Value: bson.D{{Key: "$each", Value: messages}}}}},
			{Key: "$inc", Value: bson.D{
				{Key: "message_count", Value: len(messages)},
				{Key: "messages_bytes", Value: len(payload) - 1},
			}},
		}, update...)
	}

	// The guard is the filter: the stored conversation must be exactly the prefix
	// this delta follows. Checked by the server, in the same operation that
	// appends, so nothing can slip in between.
	res, err := s.sessions().UpdateOne(ctx,
		bson.D{
			{Key: "_id", Value: rec.ID},
			{Key: "message_count", Value: rec.FromIndex},
		},
		update)
	if err != nil {
		return fmt.Errorf("save session %q: append messages: %w", rec.ID, err)
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("save session %q: %w", rec.ID, ErrSessionResync)
	}
	return nil
}

// GetSessionMeta retrieves one session's metadata without touching the messages
// array. Callers that only need identity, ownership or display fields (the
// gateway's resume check, capacity views) use this so a multi-MiB conversation
// is never read — and never sorted — on their behalf.
func (s *Store) GetSessionMeta(id string) (*SessionRecord, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var doc storedSession
	err := s.sessions().FindOne(ctx, bson.D{{Key: "_id", Value: id}},
		options.FindOne().SetProjection(bson.D{{Key: "messages", Value: 0}})).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session meta %q: %w", id, err)
	}
	rec := doc.record(false)
	return &rec, nil
}

// GetSession retrieves a session by ID.
func (s *Store) GetSession(id string) (*SessionRecord, error) {
	ctx, cancel := opCtx()
	defer cancel()

	var doc storedSession
	err := s.sessions().FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session %q: %w", id, err)
	}
	rec := doc.record(true)
	return &rec, nil
}

// ListSessions returns session metadata for an agent, newest first.
//
// It projects the messages array away — never reading the blob is what keeps a
// listing cheap, and it is why the sort never fails on an oversized row.
//
// turn_updated_at travels with turn_running so the caller can apply the same
// staleness window as a single-session read: without the timestamp a flag left
// behind by a crashed agent would be believed forever.
//
// The id tiebreak matters because callers page with OFFSET: updated_at is
// compared at millisecond resolution, so rows written together would otherwise
// come back in an arbitrary order and could be skipped or repeated across pages.
func (s *Store) ListSessions(agentID string, limit, offset int) ([]SessionRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.sessions().Find(ctx,
		bson.D{{Key: "agent_id", Value: agentID}},
		options.Find().
			SetProjection(bson.D{{Key: "messages", Value: 0}}).
			SetSort(bson.D{{Key: "updated_at", Value: -1}, {Key: "_id", Value: -1}}).
			SetSkip(int64(offset)).
			SetLimit(int64(limit)),
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	sessions := []SessionRecord{}
	for cur.Next(ctx) {
		var doc storedSession
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode session: %w", err)
		}
		sessions = append(sessions, doc.record(false))
	}
	return sessions, cur.Err()
}

// ConversationFilter narrows the conversation log. Every non-empty field is its
// own condition and they are ANDed: the console's log page has one control per
// condition, because a single box that matches anything cannot say which field it
// hit.
type ConversationFilter struct {
	Limit   int
	Session string // session id fragment
	Agent   string // agent id fragment, or an agent's display name fragment
	Account string // account id fragment, or a user's display name / email fragment
	Channel string // exact, as picked from the log's dropdown
	Status  string // exact, as picked from the log's dropdown
}

// ConversationEntry is one row of the log with the names behind its ids. They are
// resolved when the page is listed rather than stored on the session: the console
// shows a person instead of an id, and a name that changes later must not be
// frozen into history.
type ConversationEntry struct {
	SessionRecord
	AgentName   string
	AccountName string
}

// ListConversations returns the newest sessions across every agent. The admin
// conversation log reads it: it is not scoped to one agent, and it never needs
// the messages, so it uses the same small-column shape as ListSessions.
func (s *Store) ListConversations(f ConversationFilter) ([]ConversationEntry, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	ctx, cancel := opCtx()
	defer cancel()

	agentIDs, err := s.idsByNames(ctx, agentsCollection, []string{"display_name"}, f.Agent)
	if err != nil {
		return nil, err
	}
	accountIDs, err := s.idsByNames(ctx, authUsersCollection, userSearchFields, f.Account)
	if err != nil {
		return nil, err
	}

	cur, err := s.sessions().Find(ctx, conversationFilter(f, agentIDs, accountIDs),
		options.Find().
			SetProjection(bson.D{{Key: "messages", Value: 0}}).
			SetSort(bson.D{{Key: "updated_at", Value: -1}, {Key: "_id", Value: -1}}).
			SetLimit(int64(limit)),
	)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := []ConversationEntry{}
	for cur.Next(ctx) {
		var doc storedSession
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode conversation: %w", err)
		}
		out = append(out, ConversationEntry{SessionRecord: doc.record(false)})
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	if err := s.fillConversationNames(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// conversationFilter assembles the log's conditions. nameIDs are the agents and
// users whose display name (or email) matched the corresponding fragment; the
// caller resolves those, so this stays a pure function the tests can assert on.
func conversationFilter(f ConversationFilter, agentIDs, accountIDs []string) bson.D {
	clauses := bson.A{}
	if q := strings.TrimSpace(f.Session); q != "" {
		clauses = append(clauses, bson.D{{Key: "_id", Value: textPattern(q)}})
	}
	if q := strings.TrimSpace(f.Agent); q != "" {
		clauses = append(clauses, matchesIDOrNames("agent_id", q, agentIDs))
	}
	if q := strings.TrimSpace(f.Account); q != "" {
		clauses = append(clauses, matchesIDOrNames("account_id", q, accountIDs))
	}
	if v := strings.TrimSpace(f.Channel); v != "" {
		clauses = append(clauses, bson.D{{Key: "channel", Value: v}})
	}
	if v := strings.TrimSpace(f.Status); v != "" {
		clauses = append(clauses, bson.D{{Key: "status", Value: v}})
	}
	if len(clauses) == 0 {
		return bson.D{}
	}
	return bson.D{{Key: "$and", Value: clauses}}
}

// fillConversationNames resolves the agent and account names of a page, one query
// each rather than one per row.
func (s *Store) fillConversationNames(ctx context.Context, entries []ConversationEntry) error {
	agentIDs := make([]string, 0, len(entries))
	accountIDs := make([]string, 0, len(entries))
	for _, e := range entries {
		agentIDs = append(agentIDs, e.AgentID)
		accountIDs = append(accountIDs, e.AccountID)
	}

	agentNames, err := s.namesByIDs(ctx, agentsCollection, "display_name", distinctIDs(agentIDs))
	if err != nil {
		return err
	}
	accountNames, err := s.namesByIDs(ctx, authUsersCollection, "display_name", distinctIDs(accountIDs))
	if err != nil {
		return err
	}

	for i := range entries {
		entries[i].AgentName = agentNames[entries[i].AgentID]
		entries[i].AccountName = accountNames[entries[i].AccountID]
	}
	return nil
}

// CountSessions returns the total number of sessions for an agent, so callers
// can page the list without fetching every row.
func (s *Store) CountSessions(agentID string) (int, error) {
	ctx, cancel := opCtx()
	defer cancel()

	total, err := s.sessions().CountDocuments(ctx, bson.D{{Key: "agent_id", Value: agentID}})
	if err != nil {
		return 0, fmt.Errorf("count sessions: %w", err)
	}
	return int(total), nil
}

// BackfillSessionTitles fills the denormalized title for rows written before
// migration 035 (message_count is backfilled in SQL). It is idempotent and
// cheap: after the first run the filter matches nothing.
func (s *Store) BackfillSessionTitles() (int, error) {
	ctx, cancel := opCtx()
	defer cancel()

	cur, err := s.sessions().Find(ctx,
		bson.D{
			{Key: "message_count", Value: bson.D{{Key: "$gt", Value: 0}}},
			// Empty *or* absent: title is written only when it has a value, and a
			// document without the field is a title the SQL column held as ''.
			// Matching only "" would have made this backfill a no-op.
			{Key: "title", Value: bson.D{{Key: "$in", Value: bson.A{"", nil}}}},
		},
		options.Find().SetProjection(bson.D{{Key: "messages", Value: 1}}),
	)
	if err != nil {
		return 0, fmt.Errorf("query sessions for title backfill: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	type idMsg struct {
		id       string
		messages string
	}
	var pending []idMsg
	for cur.Next(ctx) {
		var doc struct {
			ID       string `bson:"_id"`
			Messages []any  `bson:"messages"`
		}
		if err := cur.Decode(&doc); err != nil {
			return 0, fmt.Errorf("decode session for title backfill: %w", err)
		}
		encoded, err := json.Marshal(doc.Messages)
		if err != nil {
			continue
		}
		pending = append(pending, idMsg{id: doc.ID, messages: string(encoded)})
	}
	if err := cur.Err(); err != nil {
		return 0, err
	}

	for _, im := range pending {
		if _, err := s.sessions().UpdateOne(ctx,
			bson.D{{Key: "_id", Value: im.id}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "title", Value: sessionTitle(im.messages)}}}},
		); err != nil {
			return 0, fmt.Errorf("backfill title for session %q: %w", im.id, err)
		}
	}
	return len(pending), nil
}

// ArchiveSession marks a session as archived.
func (s *Store) ArchiveSession(id string) error {
	ctx, cancel := opCtx()
	defer cancel()

	if _, err := s.sessions().UpdateOne(ctx,
		bson.D{{Key: "_id", Value: id}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: "archived"},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
	); err != nil {
		return fmt.Errorf("archive session %q: %w", id, err)
	}
	return nil
}

// authUsersCollection is the account collection. The portal does not own it —
// this is the read-only lookup the conversation log uses to show a person
// instead of an id, the same shape other services use for accounts.
const authUsersCollection = "auth_users"
