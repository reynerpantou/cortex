-- Allow "unknown" so capture never forces a guess about scope or source.
ALTER TABLE problems DROP CONSTRAINT problems_scope_check;
ALTER TABLE problems ADD CONSTRAINT problems_scope_check
    CHECK (scope <@ ARRAY['unknown','id','row']::text[] AND array_length(scope, 1) > 0);
ALTER TABLE problems DROP CONSTRAINT problems_source_check;
ALTER TABLE problems ADD CONSTRAINT problems_source_check
    CHECK (source <@ ARRAY['unknown','personal','other','ai']::text[] AND array_length(source, 1) > 0);

-- AI assistance (helped write/summarize) is independent of where a problem
-- was noticed (source already covers that).
ALTER TABLE problems ADD COLUMN ai_assisted BOOLEAN NOT NULL DEFAULT false;

-- The research workspace: freeform, progressively-revealed sections. Kept as
-- plain text (not further broken into sub-fields) so capture stays light and
-- the guiding sub-questions live in the UI as placeholder text, not as rigid
-- form fields.
ALTER TABLE problems ADD COLUMN context         TEXT NOT NULL DEFAULT '';
ALTER TABLE problems ADD COLUMN brainstorming   TEXT NOT NULL DEFAULT '';
ALTER TABLE problems ADD COLUMN research_brief  TEXT NOT NULL DEFAULT '';
ALTER TABLE problems ADD COLUMN findings        TEXT NOT NULL DEFAULT '';
ALTER TABLE problems ADD COLUMN related_ids     INTEGER[] NOT NULL DEFAULT '{}';

-- Evidence is the one section that isn't a flat text blob: each item carries
-- its own source link and date, since that's what makes evidence trustworthy.
CREATE TABLE evidence (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    text       TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT '',
    noted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evidence_problem ON evidence(problem_id);
