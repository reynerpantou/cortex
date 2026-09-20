-- Cortex is becoming a multi-module platform (Home hosting Radar today,
-- more modules later) — each module's own tables should carry its name so
-- a future module's tables (e.g. a stats table of its own) can't collide
-- with or be confused for Radar's. Renaming the tables also renames their
-- auto-generated PK constraint; everything else (checks, FK, indexes) keeps
-- its old name unless renamed explicitly below.
ALTER TABLE problems RENAME TO radar_problems;
ALTER TABLE evidence RENAME TO radar_evidence;

ALTER TABLE radar_problems RENAME CONSTRAINT problems_status_check TO radar_problems_status_check;
ALTER TABLE radar_problems RENAME CONSTRAINT problems_scope_check TO radar_problems_scope_check;
ALTER TABLE radar_problems RENAME CONSTRAINT problems_source_check TO radar_problems_source_check;

ALTER TABLE radar_evidence RENAME CONSTRAINT evidence_problem_id_fkey TO radar_evidence_problem_id_fkey;

ALTER INDEX idx_problems_scope RENAME TO idx_radar_problems_scope;
ALTER INDEX idx_problems_source RENAME TO idx_radar_problems_source;
ALTER INDEX idx_problems_status RENAME TO idx_radar_problems_status;
ALTER INDEX idx_evidence_problem RENAME TO idx_radar_evidence_problem;
