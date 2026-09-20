-- ai_assisted tried to distinguish "AI helped me think about this" from
-- Source: AI ("AI surfaced this"), but with AI now involved in nearly every
-- problem worked on, a self-reported per-problem flag for it stopped
-- carrying any signal. Source already covers provenance; drop the flag.
ALTER TABLE problems DROP COLUMN ai_assisted;
