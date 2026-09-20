package models

import "time"

type Scope string

const (
	ScopeUnknown   Scope = "unknown" // not yet known where this applies
	ScopeIndonesia Scope = "id"
	ScopeROW       Scope = "row"
)

func (s Scope) Valid() bool { return s == ScopeUnknown || s == ScopeIndonesia || s == ScopeROW }

// Scopes is a set of Scope values. A problem can affect more than one.
type Scopes []Scope

func (s Scopes) Valid() bool { return validSet(s, Scope.Valid) }

type Source string

const (
	SourceUnknown  Source = "unknown"  // not yet known who/what noticed it
	SourcePersonal Source = "personal" // I noticed it about myself
	SourceOther    Source = "other"    // heard from other people
	SourceAI       Source = "ai"       // surfaced by the daily AI scan
)

func (s Source) Valid() bool {
	return s == SourceUnknown || s == SourcePersonal || s == SourceOther || s == SourceAI
}

// Sources is a set of Source values. A problem can come from more than one.
type Sources []Source

func (s Sources) Valid() bool { return validSet(s, Source.Valid) }

// validSet reports whether every element is valid per isValid, there's at
// least one element, and there are no duplicates.
func validSet[T comparable](vals []T, isValid func(T) bool) bool {
	if len(vals) == 0 {
		return false
	}
	seen := make(map[T]bool, len(vals))
	for _, v := range vals {
		if !isValid(v) || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}

// Status is a Jira-style pipeline tracking how far a captured problem has
// progressed, from first capture to a shipped product or a closed dead end.
type Status string

const (
	StatusBacklog     Status = "backlog"     // just captured, not yet looked at
	StatusResearching Status = "researching" // actively digging into the signal
	StatusInReview    Status = "in_review"   // judged, awaiting a pursue/drop call
	StatusBuilding    Status = "building"    // decided to pursue, in progress
	StatusShipped     Status = "shipped"     // built and launched
	StatusArchived    Status = "archived"    // parked or rejected
)

func (s Status) Valid() bool {
	switch s {
	case StatusBacklog, StatusResearching, StatusInReview, StatusBuilding, StatusShipped, StatusArchived:
		return true
	}
	return false
}

// Active reports whether a problem is anywhere past the backlog and short of
// a terminal state — the definition backing the "Active" stat.
func (s Status) Active() bool {
	switch s {
	case StatusResearching, StatusInReview, StatusBuilding, StatusShipped:
		return true
	}
	return false
}

type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

// Evidence is one attributed observation supporting a problem: a quote, a
// link, a screenshot description, or a plain note, each with its own source
// and date rather than folded into one flat text blob.
type Evidence struct {
	ID        int64     `json:"id"`
	ProblemID int64     `json:"problem_id"`
	Text      string    `json:"text"`
	URL       string    `json:"url,omitempty"`
	NotedAt   time.Time `json:"noted_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Problem struct {
	ID         int64     `json:"id"`
	Scope      Scopes    `json:"scope"`
	Source     Sources   `json:"source"`
	Title      string    `json:"title"`
	Body       string    `json:"body"`
	Status     Status    `json:"status"`
	SourceURL  string    `json:"source_url,omitempty"`
	Recurrence int       `json:"recurrence"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// Present only on the single-problem detail response, not in list results.
	Context       *string    `json:"context,omitempty"`
	Brainstorming *string    `json:"brainstorming,omitempty"`
	ResearchBrief *string    `json:"research_brief,omitempty"`
	Findings      *string    `json:"findings,omitempty"`
	ArchiveReason *string    `json:"archive_reason,omitempty"`
	RelatedIDs    []int64    `json:"related_ids,omitempty"`
	Evidence      []Evidence `json:"evidence,omitempty"`
}

// NavGroup is a user-created sidebar sub-category (e.g. "My Content").
type NavGroup struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

// NavPlacement records which group (if any) a fixed nav item — "home",
// "radar", or a future module's key — currently sits in, and its order.
// An item with no placement row renders at the top level in default order.
type NavPlacement struct {
	ItemKey  string `json:"item_key"`
	GroupID  *int64 `json:"group_id"`
	Position int    `json:"position"`
}
