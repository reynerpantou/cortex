-- Captured only at the moment of archiving (a short prompt, not a
-- persistent form field) so future-you can see why an idea was killed
-- without it cluttering the form while a problem is still active.
ALTER TABLE problems ADD COLUMN archive_reason TEXT NOT NULL DEFAULT '';
