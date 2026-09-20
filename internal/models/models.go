package models

import "time"

type Scope string

const (
	ScopeIndonesia Scope = "id"
	ScopeROW       Scope = "row"
)

func (s Scope) Valid() bool { return s == ScopeIndonesia || s == ScopeROW }

// Scopes is a set of Scope values. A problem can affect more than one.
type Scopes []Scope

func (s Scopes) Valid() bool { return validSet(s, Scope.Valid) }

type Source string

const (
	SourcePersonal Source = "personal" // I submitted it about myself
	SourceOther    Source = "other"    // heard from other people
	SourceAI       Source = "ai"       // surfaced by the daily AI scan
)

func (s Source) Valid() bool {
	return s == SourcePersonal || s == SourceOther || s == SourceAI
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

type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
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
}
