package models

import "time"

type Scope string

const (
	ScopeIndonesia Scope = "id"
	ScopeROW       Scope = "row"
)

func (s Scope) Valid() bool { return s == ScopeIndonesia || s == ScopeROW }

type Source string

const (
	SourcePersonal Source = "personal" // I submitted it about myself
	SourceOther    Source = "other"    // heard from other people
	SourceAI       Source = "ai"       // surfaced by the daily AI scan
)

func (s Source) Valid() bool {
	return s == SourcePersonal || s == SourceOther || s == SourceAI
}

type Status string

const (
	StatusInbox     Status = "inbox"
	StatusValidated Status = "validated"
	StatusParked    Status = "parked"
	StatusDropped   Status = "dropped"
)

func (s Status) Valid() bool {
	switch s {
	case StatusInbox, StatusValidated, StatusParked, StatusDropped:
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
	Scope      Scope     `json:"scope"`
	Source     Source    `json:"source"`
	Title      string    `json:"title"`
	Body       string    `json:"body"`
	Status     Status    `json:"status"`
	SourceURL  string    `json:"source_url,omitempty"`
	Recurrence int       `json:"recurrence"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
