package models

type FinanceKind string

const (
	FinanceIncome  FinanceKind = "income"
	FinanceExpense FinanceKind = "expense"
)

func (k FinanceKind) Valid() bool { return k == FinanceIncome || k == FinanceExpense }

type FinanceSource string

const (
	FinanceSourceManual FinanceSource = "manual"
	FinanceSourceCSV    FinanceSource = "csv"
	FinanceSourceVoice  FinanceSource = "voice"
	FinanceSourceEmail  FinanceSource = "email"
)

func (s FinanceSource) Valid() bool {
	return s == FinanceSourceManual || s == FinanceSourceCSV || s == FinanceSourceVoice || s == FinanceSourceEmail
}

type FinanceCategory struct {
	ID       int64       `json:"id"`
	Kind     FinanceKind `json:"kind"`
	ParentID *int64      `json:"parent_id"`
	Name     string      `json:"name"`
	Icon     string      `json:"icon"`
	Position int         `json:"position"`
	Archived bool        `json:"archived"`
}

type FinancePaymentMethod struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Position int    `json:"position"`
	Archived bool   `json:"archived"`
}

type FinanceTransaction struct {
	ID              int64         `json:"id"`
	Kind            FinanceKind   `json:"kind"`
	OccurredOn      string        `json:"occurred_on"` // YYYY-MM-DD
	Amount          float64       `json:"amount"`
	Currency        string        `json:"currency"`
	Rate            float64       `json:"rate"`
	BaseAmount      float64       `json:"base_amount"`
	CategoryID      *int64        `json:"category_id"`
	PaymentMethodID *int64        `json:"payment_method_id"`
	Note            string        `json:"note"`
	Source          FinanceSource `json:"source"`
	ExternalID      *string       `json:"external_id,omitempty"`
}
