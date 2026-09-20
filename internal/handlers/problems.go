package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/reynerpantou/cortex/internal/models"
)

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanProblem reads one problem row. scope/source come back as comma-joined
// text (via array_to_string) since scanning a Postgres text[] directly into a
// Go slice isn't supported by database/sql without extra plumbing.
func scanProblem(row rowScanner) (models.Problem, error) {
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

const problemColumns = `id, array_to_string(scope, ','), array_to_string(source, ','), title, body, status, source_url, recurrence, created_at, updated_at`

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
		where = append(where, "status = "+param(v))
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		p := param("%" + v + "%")
		where = append(where, "(title ILIKE "+p+" OR body ILIKE "+p+")")
	}
	query := `SELECT ` + problemColumns + ` FROM problems`
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY updated_at DESC, id DESC"

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load problems")
		return
	}
	defer rows.Close()

	out := []models.Problem{}
	for rows.Next() {
		p, err := scanProblem(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read problems")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

type problemInput struct {
	Scope  models.Scopes  `json:"scope"`
	Source models.Sources `json:"source"`
	Title  string         `json:"title"`
	Body   string         `json:"body"`
	Status models.Status  `json:"status"`
}

func (in *problemInput) normalizeAndValidate() (string, bool) {
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	if in.Status == "" {
		in.Status = models.StatusBacklog
	}
	switch {
	case in.Title == "":
		return "title is required", false
	case !in.Scope.Valid():
		return "scope must be one or more of 'id', 'row'", false
	case !in.Source.Valid():
		return "source must be one or more of 'personal', 'other', 'ai'", false
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
		`INSERT INTO problems (scope, source, title, body, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		in.Scope, in.Source, in.Title, in.Body, in.Status, now, now,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the problem")
		return
	}
	s.getProblemByID(w, id, http.StatusCreated)
}

func (s *Server) UpdateProblem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
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
		`UPDATE problems SET scope=$1, source=$2, title=$3, body=$4, status=$5, updated_at=$6 WHERE id=$7`,
		in.Scope, in.Source, in.Title, in.Body, in.Status, time.Now().UTC(), id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not update the problem")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "problem not found")
		return
	}
	s.getProblemByID(w, id, http.StatusOK)
}

func (s *Server) DeleteProblem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	res, err := s.DB.Exec(`DELETE FROM problems WHERE id = $1`, id)
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

func (s *Server) getProblemByID(w http.ResponseWriter, id int64, status int) {
	row := s.DB.QueryRow(`SELECT `+problemColumns+` FROM problems WHERE id = $1`, id)
	p, err := scanProblem(row)
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

// Stats powers the home cockpit: totals by scope and by source, plus new-today.
func (s *Server) Stats(w http.ResponseWriter, r *http.Request) {
	stat := map[string]any{}
	count := func(q string, args ...any) int {
		var n int
		_ = s.DB.QueryRow(q, args...).Scan(&n)
		return n
	}
	stat["total"] = count(`SELECT COUNT(*) FROM problems`)
	stat["indonesia"] = count(`SELECT COUNT(*) FROM problems WHERE 'id' = ANY(scope)`)
	stat["row"] = count(`SELECT COUNT(*) FROM problems WHERE 'row' = ANY(scope)`)
	stat["ai"] = count(`SELECT COUNT(*) FROM problems WHERE 'ai' = ANY(source)`)
	stat["validated"] = count(`SELECT COUNT(*) FROM problems WHERE status IN ('in_review','building','shipped')`)
	todayStart := time.Now().UTC().Truncate(24 * time.Hour)
	stat["new_today"] = count(`SELECT COUNT(*) FROM problems WHERE created_at >= $1`, todayStart)
	writeJSON(w, http.StatusOK, stat)
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
