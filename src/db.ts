import type { TemplateName } from "./prompts";

export interface PromptRunInsert {
  video_key?: string | null;
  video_name?: string | null;
  video_size?: number | null;

  template: TemplateName;
  goal?: string | null;
  language?: string | null;
  style?: string | null;
  frames_count?: number | null;

  summary?: string | null;
  prompt?: string | null;
  negative_prompt?: string | null;
  tags_json?: string | null;
  notes?: string | null;

  raw_json?: string | null;
}

export async function insertRun(db: D1Database, r: PromptRunInsert) {
  const stmt = db.prepare(
    `INSERT INTO prompt_runs
    (video_key, video_name, video_size, template, goal, language, style, frames_count,
     summary, prompt, negative_prompt, tags_json, notes, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const res = await stmt
    .bind(
      r.video_key ?? null,
      r.video_name ?? null,
      r.video_size ?? null,
      r.template,
      r.goal ?? null,
      r.language ?? null,
      r.style ?? null,
      r.frames_count ?? null,
      r.summary ?? null,
      r.prompt ?? null,
      r.negative_prompt ?? null,
      r.tags_json ?? null,
      r.notes ?? null,
      r.raw_json ?? null
    )
    .run();

  // D1 returns lastRowId in meta
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta: any = res.meta || {};
  return meta.last_row_id ?? meta.lastRowId ?? null;
}

export async function listRuns(db: D1Database, limit = 20, offset = 0) {
  const stmt = db.prepare(
    `SELECT id, video_key, video_name, template, goal, language, style, frames_count,
            summary, prompt, negative_prompt, tags_json, notes, created_at
     FROM prompt_runs
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`
  );
  const out = await stmt.bind(limit, offset).all();
  return out.results ?? [];
}

export async function getRun(db: D1Database, id: number) {
  const stmt = db.prepare(
    `SELECT *
     FROM prompt_runs
     WHERE id = ?`
  );
  const out = await stmt.bind(id).first();
  return out ?? null;
}

export async function deleteRun(db: D1Database, id: number) {
  const stmt = db.prepare(`DELETE FROM prompt_runs WHERE id = ?`);
  const out = await stmt.bind(id).run();
  return out.meta?.changes ?? 0;
}
