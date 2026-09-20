-- Status becomes a Jira-style pipeline instead of a flat triage state.
ALTER TABLE problems DROP CONSTRAINT problems_status_check;
UPDATE problems SET status = CASE status
    WHEN 'inbox'     THEN 'backlog'
    WHEN 'validated' THEN 'in_review'
    WHEN 'parked'    THEN 'archived'
    WHEN 'dropped'   THEN 'archived'
    ELSE status
END;
ALTER TABLE problems ALTER COLUMN status SET DEFAULT 'backlog';
ALTER TABLE problems ADD CONSTRAINT problems_status_check
    CHECK (status IN ('backlog','researching','in_review','building','shipped','archived'));

-- Scope and source become multi-value tags: a problem can affect both id and
-- row, or come from more than one source, instead of being forced into one.
ALTER TABLE problems DROP CONSTRAINT problems_scope_check;
ALTER TABLE problems DROP CONSTRAINT problems_source_check;

ALTER TABLE problems ALTER COLUMN scope TYPE TEXT[] USING ARRAY[scope];
ALTER TABLE problems ALTER COLUMN source TYPE TEXT[] USING ARRAY[source];

ALTER TABLE problems ADD CONSTRAINT problems_scope_check
    CHECK (scope <@ ARRAY['id','row']::text[] AND array_length(scope, 1) > 0);
ALTER TABLE problems ADD CONSTRAINT problems_source_check
    CHECK (source <@ ARRAY['personal','other','ai']::text[] AND array_length(source, 1) > 0);

DROP INDEX idx_problems_scope;
DROP INDEX idx_problems_source;
CREATE INDEX idx_problems_scope  ON problems USING GIN (scope);
CREATE INDEX idx_problems_source ON problems USING GIN (source);
