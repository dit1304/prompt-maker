CREATE TABLE IF NOT EXISTS prompt_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_key TEXT,
  video_name TEXT,
  video_size INTEGER,

  template TEXT NOT NULL,
  goal TEXT,
  language TEXT,
  style TEXT,
  frames_count INTEGER,

  summary TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  tags_json TEXT,
  notes TEXT,

  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_runs_created_at ON prompt_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_runs_video_key ON prompt_runs(video_key);
