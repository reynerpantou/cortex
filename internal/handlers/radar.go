package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/reynerpantou/cortex/internal/models"
)

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// splitInts parses the comma-joined output of array_to_string(int[], ',').
// An empty source array joins to "", which must map to nil, not [""].
func splitInts(joined string) []int64 {
	if joined == "" {
		return nil
	}
	parts := strings.Split(joined, ",")
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		if n, err := strconv.ParseInt(p, 10, 64); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// scanProblemSummary reads the columns used by list results. scope/source
// come back as comma-joined text (via array_to_string) since scanning a
// Postgres array directly into a Go slice isn't supported by database/sql
// without extra plumbing.
func scanProblemSummary(row rowScanner) (models.Problem, error) {
	var p models.Problem
	var scopeJoined, sourceJoined string
	err := row.Scan(&p.ID, &scopeJoined, &sourceJoined, &p.Title, &p.Body, &p.Status, &p.SourceURL, &p.Recurrence, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	for _, v := range strings.Split(scopeJoined, ",") {
		p.Scope = append(p.Scope, models.Scope(v))
	}
	for _, v := range strings.Split(sourceJoined, ",") {
		p.Source = append(p.Source, models.Source(v))
	}
	return p, nil
}

const summaryColumns = `id, array_to_string(scope, ','), array_to_string(source, ','), title, body, status, source_url, recurrence, created_at, updated_at`

func (s *Server) ListProblems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var where []string
	var args []any
	param := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if v := q.Get("scope"); v != "" {
		where = append(where, "scope && "+param(strings.Split(v, ",")))
	}
	if v := q.Get("source"); v != "" {
		where = append(where, "source && "+param(strings.Split(v, ",")))
	}
	if v := q.Get("status"); v != "" {
		where = append(where, "status = ANY("+param(strings.Split(v, ","))+")")
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		p := param("%" + v + "%")
		where = append(where, "(title ILIKE "+p+" OR body ILIKE "+p+")")
	}
	query := `SELECT ` + summaryColumns + ` FROM radar_problems`
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	sort := "updated_at DESC, id DESC"
	if q.Get("sort") == "created" {
		sort = "created_at DESC, id DESC"
	}
	query += " ORDER BY " + sort

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load problems")
		return
	}
	defer rows.Close()

	out := []models.Problem{}
	for rows.Next() {
		p, err := scanProblemSummary(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read problems")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

type problemInput struct {
	Scope         models.Scopes  `json:"scope"`
	Source        models.Sources `json:"source"`
	Title         string         `json:"title"`
	Body          string         `json:"body"`
	Status        models.Status  `json:"status"`
	Context       string         `json:"context"`
	Brainstorming string         `json:"brainstorming"`
	ResearchBrief string         `json:"research_brief"`
	Findings      string         `json:"findings"`
	ArchiveReason string         `json:"archive_reason"`
	RelatedIDs    []int64        `json:"related_ids"`
}

// normalizeAndValidate fills in the defaults that let capture stay to just a
// title: unset scope/source become "unknown" rather than forcing a guess,
// and status defaults to backlog.
func (in *problemInput) normalizeAndValidate() (string, bool) {
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	in.ArchiveReason = strings.TrimSpace(in.ArchiveReason)
	if in.Status == "" {
		in.Status = models.StatusBacklog
	}
	if len(in.Scope) == 0 {
		in.Scope = models.Scopes{models.ScopeUnknown}
	}
	if len(in.Source) == 0 {
		in.Source = models.Sources{models.SourceUnknown}
	}
	if in.RelatedIDs == nil {
		in.RelatedIDs = []int64{}
	}
	switch {
	case in.Title == "":
		return "title is required", false
	case !in.Scope.Valid():
		return "scope must be one or more of 'unknown', 'id', 'row'", false
	case !in.Source.Valid():
		return "source must be one or more of 'unknown', 'personal', 'other', 'ai'", false
	case !in.Status.Valid():
		return "invalid status", false
	}
	return "", true
}

func (s *Server) CreateProblem(w http.ResponseWriter, r *http.Request) {
	var in problemInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the problem")
		return
	}
	if msg, ok := in.normalizeAndValidate(); !ok {
		writeError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	now := time.Now().UTC()
	var id int64
	err := s.DB.QueryRow(
		`INSERT INTO radar_problems (scope, source, title, body, status, context, brainstorming, research_brief, findings, archive_reason, related_ids, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
		in.Scope, in.Source, in.Title, in.Body, in.Status,
		in.Context, in.Brainstorming, in.ResearchBrief, in.Findings, in.ArchiveReason, in.RelatedIDs, now, now,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the problem")
		return
	}
	s.getProblemSummary(w, id, http.StatusCreated)
}

func (s *Server) UpdateProblem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in problemInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the problem")
		return
	}
	if msg, ok := in.normalizeAndValidate(); !ok {
		writeError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	res, err := s.DB.Exec(
		`UPDATE radar_problems SET scope=$1, source=$2, title=$3, body=$4, status=$5,
		 context=$6, brainstorming=$7, research_brief=$8, findings=$9, archive_reason=$10, related_ids=$11, updated_at=$12
		 WHERE id=$13`,
		in.Scope, in.Source, in.Title, in.Body, in.Status,
		in.Context, in.Brainstorming, in.ResearchBrief, in.Findings, in.ArchiveReason, in.RelatedIDs, time.Now().UTC(), id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not update the problem")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "problem not found")
		return
	}
	s.GetProblem(w, r)
}

func (s *Server) DeleteProblem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	res, err := s.DB.Exec(`DELETE FROM radar_problems WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not delete the problem")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "problem not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetProblem returns the full workspace (context/brainstorming/research
// brief/findings/related/evidence) — the heavier detail view. ListProblems
// deliberately omits these to keep the list payload light.
func (s *Server) GetProblem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var p models.Problem
	var scopeJoined, sourceJoined, relatedJoined string
	var context, brainstorming, researchBrief, findings, archiveReason string
	err := s.DB.QueryRow(
		`SELECT id, array_to_string(scope, ','), array_to_string(source, ','), title, body, status,
		        source_url, recurrence, context, brainstorming, research_brief, findings, archive_reason,
		        array_to_string(related_ids, ','), created_at, updated_at
		 FROM radar_problems WHERE id = $1`, id,
	).Scan(&p.ID, &scopeJoined, &sourceJoined, &p.Title, &p.Body, &p.Status,
		&p.SourceURL, &p.Recurrence, &context, &brainstorming, &researchBrief, &findings, &archiveReason,
		&relatedJoined, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "problem not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load the problem")
		return
	}
	for _, v := range strings.Split(scopeJoined, ",") {
		p.Scope = append(p.Scope, models.Scope(v))
	}
	for _, v := range strings.Split(sourceJoined, ",") {
		p.Source = append(p.Source, models.Source(v))
	}
	p.Context, p.Brainstorming, p.ResearchBrief, p.Findings = &context, &brainstorming, &researchBrief, &findings
	p.ArchiveReason = &archiveReason
	p.RelatedIDs = splitInts(relatedJoined)

	rows, err := s.DB.Query(
		`SELECT id, problem_id, text, url, noted_at, created_at FROM radar_evidence WHERE problem_id = $1 ORDER BY noted_at DESC, id DESC`, id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load evidence")
		return
	}
	defer rows.Close()
	p.Evidence = []models.Evidence{}
	for rows.Next() {
		var e models.Evidence
		if err := rows.Scan(&e.ID, &e.ProblemID, &e.Text, &e.URL, &e.NotedAt, &e.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read evidence")
			return
		}
		p.Evidence = append(p.Evidence, e)
	}
	writeJSON(w, http.StatusOK, p)
}

// getProblemSummary responds with the lean (list-shaped) view of one
// problem — used after create/update where the caller already has the
// workspace fields it just sent.
func (s *Server) getProblemSummary(w http.ResponseWriter, id int64, status int) {
	row := s.DB.QueryRow(`SELECT `+summaryColumns+` FROM radar_problems WHERE id = $1`, id)
	p, err := scanProblemSummary(row)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "problem not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load the problem")
		return
	}
	writeJSON(w, status, p)
}

type evidenceInput struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

func (s *Server) CreateEvidence(w http.ResponseWriter, r *http.Request) {
	problemID, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in evidenceInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the evidence")
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	in.URL = strings.TrimSpace(in.URL)
	if in.Text == "" && in.URL == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "evidence needs a note or a link")
		return
	}
	if in.URL != "" && !isWebURL(in.URL) {
		writeError(w, http.StatusBadRequest, "validation_error", "the link must start with http:// or https://")
		return
	}
	now := time.Now().UTC()
	var e models.Evidence
	err := s.DB.QueryRow(
		`INSERT INTO radar_evidence (problem_id, text, url, noted_at, created_at) VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, problem_id, text, url, noted_at, created_at`,
		problemID, in.Text, in.URL, now, now,
	).Scan(&e.ID, &e.ProblemID, &e.Text, &e.URL, &e.NotedAt, &e.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the evidence")
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) DeleteEvidence(w http.ResponseWriter, r *http.Request) {
	problemID, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	evidenceID, ok := pathID(r, "eid")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid evidence id")
		return
	}
	res, err := s.DB.Exec(`DELETE FROM radar_evidence WHERE id = $1 AND problem_id = $2`, evidenceID, problemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not delete the evidence")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "evidence not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Stats powers the home cockpit: totals by scope and by source, plus new-today.
func (s *Server) Stats(w http.ResponseWriter, r *http.Request) {
	stat := map[string]any{}
	count := func(q string, args ...any) int {
		var n int
		_ = s.DB.QueryRow(q, args...).Scan(&n)
		return n
	}
	stat["total"] = count(`SELECT COUNT(*) FROM radar_problems`)
	stat["indonesia"] = count(`SELECT COUNT(*) FROM radar_problems WHERE 'id' = ANY(scope)`)
	stat["row"] = count(`SELECT COUNT(*) FROM radar_problems WHERE 'row' = ANY(scope)`)
	stat["ai"] = count(`SELECT COUNT(*) FROM radar_problems WHERE 'ai' = ANY(source)`)
	stat["validated"] = count(`SELECT COUNT(*) FROM radar_problems WHERE status IN ('researching','in_review','building','shipped')`)
	todayStart := time.Now().UTC().Truncate(24 * time.Hour)
	stat["new_today"] = count(`SELECT COUNT(*) FROM radar_problems WHERE created_at >= $1`, todayStart)
	writeJSON(w, http.StatusOK, stat)
}

type aiSummaryRequest struct {
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Scope         []string `json:"scope"`
	Source        []string `json:"source"`
	Context       string   `json:"context"`
	Brainstorming string   `json:"brainstorming"`
	ResearchBrief string   `json:"research_brief"`
	Findings      string   `json:"findings"`
}

// RadarAISummary is the integration seam for handing a problem off to
// OpenClaw for the "Summary & Suggestions" analysis. There's no real
// OpenClaw connection yet, so this returns a templated mock shaped exactly
// like the real response will be (see the AI prompt template this mirrors),
// clearly marked as a mock so it's never mistaken for genuine analysis.
// The frontend posts the on-screen snapshot rather than this handler
// re-reading the DB, so a request reflects unsaved edits too, same as
// Copy/Export already do.
func (s *Server) RadarAISummary(w http.ResponseWriter, r *http.Request) {
	if _, ok := pathID(r, "id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in aiSummaryRequest
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the problem")
		return
	}
	writeJSON(w, http.StatusOK, mockAISummary(in))
}

func mockAISummary(in aiSummaryRequest) map[string]any {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "This problem"
	}

	var clarify []string
	if strings.TrimSpace(in.Context) == "" {
		clarify = append(clarify, "Who experiences this, and how often does it happen?")
	}
	if strings.TrimSpace(in.Body) == "" {
		clarify = append(clarify, "What's the concrete impact when it happens?")
	}
	if strings.TrimSpace(in.Brainstorming) == "" && len(clarify) < 2 {
		clarify = append(clarify, "What's the current workaround, and why does it fall short?")
	}
	if len(clarify) == 0 {
		clarify = append(clarify, "What would most change the assessment of this problem right now?")
	}
	if len(clarify) > 2 {
		clarify = clarify[:2]
	}

	scope := "unspecified scope"
	if len(in.Scope) > 0 {
		scope = strings.Join(in.Scope, "/")
	}
	source := "unspecified source"
	if len(in.Source) > 0 {
		source = strings.Join(in.Source, "/")
	}

	summary := fmt.Sprintf(
		"%s is captured with %s and %s. Based on what's recorded so far, frequency and impact aren't independently verified — this reflects what's written in the record, not confirmed prevalence. Mock response: OpenClaw isn't connected yet, so this is placeholder output shaped like the real analysis will be, not a genuine read of this problem.",
		title, scope, source,
	)

	return map[string]any{
		"summary": summary,
		"clarify": clarify,
		"solutions": []string{
			"Hypothesis: a lightweight manual or process fix before building anything.",
			"Hypothesis: an existing tool could already cover this with different configuration or habits.",
		},
		"next_step": "Talk to 2-3 people who'd plausibly hit this and check whether it's a real, recurring pain rather than a one-off.",
		"mock":      true,
	}
}

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// isWebURL accepts only absolute http(s) links, so a stored link can never
// be a javascript: or data: URL that runs when clicked.
func isWebURL(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
