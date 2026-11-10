package store

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// The console's log pages ask for a person or an agent by name, while the
// collections store ids. These helpers close that gap in one place: one query
// turns a name fragment into the ids it names, and the id a caller already knows
// keeps working through the same condition.

// userSearchFields are the user fields a name fragment is matched against. Email
// is included because it is the login identifier an administrator is most likely
// to have at hand.
var userSearchFields = []string{"display_name", "email"}

// nameSearchLimit bounds how many ids one name fragment may resolve to. A
// fragment short enough to match thousands of documents is not a filter.
const nameSearchLimit = 500

// textPattern turns a free-text condition into a case-insensitive substring
// pattern. The fragment is quoted first: an agent called "a.b" must match itself
// rather than behave as a regular expression.
func textPattern(q string) bson.D {
	return bson.D{
		{Key: "$regex", Value: regexp.QuoteMeta(strings.TrimSpace(q))},
		{Key: "$options", Value: "i"},
	}
}

// matchesIDOrNames is one condition on an id column: the column's own text, or
// one of the ids whose name matched the fragment. The name branch is omitted
// when nothing matched, which keeps the condition honest — a name that names
// nothing must not widen the result set.
func matchesIDOrNames(column, q string, nameIDs []string) bson.D {
	clauses := bson.A{bson.D{{Key: column, Value: textPattern(q)}}}
	if len(nameIDs) > 0 {
		clauses = append(clauses, bson.D{{Key: column, Value: bson.D{{Key: "$in", Value: nameIDs}}}})
	}
	if len(clauses) == 1 {
		return bson.D{{Key: column, Value: textPattern(q)}}
	}
	return bson.D{{Key: "$or", Value: clauses}}
}

// idsByNames returns the ids of the documents in collection whose fields contain
// q. An empty fragment resolves to nothing rather than to everything.
func (s *Store) idsByNames(ctx context.Context, collection string, fields []string, q string) ([]string, error) {
	q = strings.TrimSpace(q)
	if q == "" || len(fields) == 0 {
		return nil, nil
	}

	any := make(bson.A, 0, len(fields))
	for _, field := range fields {
		any = append(any, bson.D{{Key: field, Value: textPattern(q)}})
	}

	cur, err := s.db.Collection(collection).Find(ctx,
		bson.D{{Key: "$or", Value: any}},
		options.Find().
			SetProjection(bson.D{{Key: "_id", Value: 1}}).
			SetLimit(nameSearchLimit))
	if err != nil {
		return nil, fmt.Errorf("resolve %s by name: %w", collection, err)
	}
	defer func() { _ = cur.Close(ctx) }()

	ids := []string{}
	for cur.Next(ctx) {
		var doc struct {
			ID string `bson:"_id"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode %s id: %w", collection, err)
		}
		ids = append(ids, doc.ID)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("resolve %s by name: %w", collection, err)
	}
	return ids, nil
}

// namesByIDs resolves one naming field for a set of ids. Ids that no longer
// exist — a deleted user, an agent whose row is gone — are simply absent from
// the map, so callers fall back to showing the id.
func (s *Store) namesByIDs(ctx context.Context, collection, field string, ids []string) (map[string]string, error) {
	names := map[string]string{}
	if len(ids) == 0 {
		return names, nil
	}

	values := make(bson.A, 0, len(ids))
	for _, id := range ids {
		values = append(values, id)
	}

	cur, err := s.db.Collection(collection).Find(ctx,
		bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: values}}}},
		options.Find().SetProjection(bson.D{{Key: field, Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("resolve %s names: %w", collection, err)
	}
	defer func() { _ = cur.Close(ctx) }()

	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode %s name: %w", collection, err)
		}
		id, _ := doc["_id"].(string)
		name, _ := doc[field].(string)
		names[id] = name
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("resolve %s names: %w", collection, err)
	}
	return names, nil
}

// distinctIDs collects the non-empty ids of a page, preserving first-seen order.
func distinctIDs(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
