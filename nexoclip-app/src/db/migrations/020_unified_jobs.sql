-- nexoclip-app/src/db/migrations/020_unified_jobs.sql
-- Generalize generation_jobs into the unified job store: every feature's async
-- work is a row here. Widen the kind whitelist and relax prompt/model (image-era
-- NOT NULL columns) so non-prompt jobs (clipping, workflow_node) fit.
ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_kind_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_kind_check
  CHECK (kind IN (
    'image', 'video', 'clipping', 'audio', 'workflow_node',
    'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video'
  ));

ALTER TABLE generation_jobs ALTER COLUMN prompt DROP NOT NULL;
ALTER TABLE generation_jobs ALTER COLUMN model DROP NOT NULL;
