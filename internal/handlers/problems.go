package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/reynerpantou/cortex/internal/models"
)

func (s *Server) ListProblems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var where []string
	var args []any
	if v := q.Get("scope"); v != "" {
		where = append(where, "scope = ?")
		args = append(args, v)
	}
	if v := q.Get("source"); v != "" {
		where = append(where, "source = ?")
		args = append(args, v)
	}
	if v := q.Get("status"); v != "" {
		where = append(where, "status = ?")
		args = append(args, v)
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		where = append(where, "(title LIKE ? OR body LIKE ?)")
		args = append(args, "%"+v+"%", "%"+v+"%")
	}
	query := `SELECT id, scope, source, title, body, status, source_url, recurrence, created_at, updated_at FROM problems`
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY datetime(updated_at) DESC, id DESC"

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load problems")
		return
	}
	defer rows.Close()

	out := []models.Problem{}
	for rows.Next() {
		var p models.Problem
		if err := rows.Scan(&p.ID, &p.Scope, &p.Source, &p.Title, &p.Body, &p.Status, &p.SourceURL, &p.Recurrence, &p.CreatedAt, &p.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read problems")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

type problemInput struct {
	Scope  models.Scope  `json:"scope"`
	Source models.Source `json:"source"`
	Title  string        `json:"title"`
	Body   string        `json:"body"`
	Status models.Status `json:"status"`
}

func (in *problemInput) normalizeAndValidate() (string, bool) {
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	if in.Status == "" {
		in.Status = models.StatusInbox
	}
	switch {
	case in.Title == "":
		return "title is required", false
	case !in.Scope.Valid():
		return "scope must be 'id' or 'row'", false
	case !in.Source.Valid():
		return "source must be 'personal', 'other' or 'ai'", false
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
	res, err := s.DB.Exec(
		`INSERT INTO problems (scope, source, title, body, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.Scope, in.Source, in.Title, in.Body, in.Status, now, now,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the problem")
		return
	}
	id, _ := res.LastInsertId()
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
		`UPDATE problems SET scope=?, source=?, title=?, body=?, status=?, updated_at=? WHERE id=?`,
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
	res, err := s.DB.Exec(`DELETE FROM problems WHERE id = ?`, id)
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
	var p models.Problem
	err := s.DB.QueryRow(
		`SELECT id, scope, source, title, body, status, source_url, recurrence, created_at, updated_at FROM problems WHERE id = ?`, id,
	).Scan(&p.ID, &p.Scope, &p.Source, &p.Title, &p.Body, &p.Status, &p.SourceURL, &p.Recurrence, &p.CreatedAt, &p.UpdatedAt)
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
	stat["indonesia"] = count(`SELECT COUNT(*) FROM problems WHERE scope='id'`)
	stat["row"] = count(`SELECT COUNT(*) FROM problems WHERE scope='row'`)
	stat["ai"] = count(`SELECT COUNT(*) FROM problems WHERE source='ai'`)
	stat["validated"] = count(`SELECT COUNT(*) FROM problems WHERE status='validated'`)
	stat["new_today"] = count(`SELECT COUNT(*) FROM problems WHERE date(created_at) = date('now')`)
	writeJSON(w, http.StatusOK, stat)
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
