package handlers

import (
	"net/http"
	"strings"

	"github.com/reynerpantou/cortex/internal/middleware"
	"github.com/reynerpantou/cortex/internal/models"
)

// GetNav returns the signed-in user's sidebar customization: their custom
// groups and which item sits in which (an item with no placement row just
// renders at the top level in default order).
func (s *Server) GetNav(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.UserIDFrom(r.Context())

	groups := []models.NavGroup{}
	rows, err := s.DB.Query(`SELECT id, name, position FROM nav_groups WHERE user_id = $1 ORDER BY position, id`, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load your layout")
		return
	}
	for rows.Next() {
		var g models.NavGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Position); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "server_error", "could not load your layout")
			return
		}
		groups = append(groups, g)
	}
	rows.Close()

	placements := []models.NavPlacement{}
	rows2, err := s.DB.Query(`SELECT item_key, group_id, position FROM nav_placements WHERE user_id = $1 ORDER BY position, id`, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load your layout")
		return
	}
	for rows2.Next() {
		var p models.NavPlacement
		if err := rows2.Scan(&p.ItemKey, &p.GroupID, &p.Position); err != nil {
			rows2.Close()
			writeError(w, http.StatusInternalServerError, "server_error", "could not load your layout")
			return
		}
		placements = append(placements, p)
	}
	rows2.Close()

	writeJSON(w, http.StatusOK, map[string]any{"groups": groups, "placements": placements})
}

type navGroupInput struct {
	TempID   string `json:"tempId"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

type navPlacementInput struct {
	ItemKey  string  `json:"item_key"`
	Group    *string `json:"group"` // a group's tempId, or null for top-level
	Position int     `json:"position"`
}

type updateNavRequest struct {
	Groups     []navGroupInput     `json:"groups"`
	Placements []navPlacementInput `json:"placements"`
}

// UpdateNav replaces the user's entire sidebar layout in one transaction —
// the Organize UI edits a full local draft and saves it atomically, so
// there's no per-item diffing to get right here. New groups arrive with a
// client-chosen tempId; placements reference the group they belong to by
// that same tempId, resolved to a real id after the group rows are inserted.
func (s *Server) UpdateNav(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.UserIDFrom(r.Context())
	var req updateNavRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the request")
		return
	}
	for i := range req.Groups {
		req.Groups[i].Name = strings.TrimSpace(req.Groups[i].Name)
		if req.Groups[i].Name == "" {
			writeError(w, http.StatusBadRequest, "validation_error", "group name is required")
			return
		}
	}

	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM nav_placements WHERE user_id = $1`, uid); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
		return
	}
	if _, err := tx.Exec(`DELETE FROM nav_groups WHERE user_id = $1`, uid); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
		return
	}

	realID := make(map[string]int64, len(req.Groups))
	for _, g := range req.Groups {
		var id int64
		err := tx.QueryRow(
			`INSERT INTO nav_groups (user_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
			uid, g.Name, g.Position,
		).Scan(&id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
			return
		}
		realID[g.TempID] = id
	}

	for _, p := range req.Placements {
		var groupID *int64
		if p.Group != nil {
			if id, ok := realID[*p.Group]; ok {
				groupID = &id
			}
		}
		_, err := tx.Exec(
			`INSERT INTO nav_placements (user_id, item_key, group_id, position) VALUES ($1, $2, $3, $4)`,
			uid, p.ItemKey, groupID, p.Position,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save your layout")
		return
	}
	s.GetNav(w, r)
}
