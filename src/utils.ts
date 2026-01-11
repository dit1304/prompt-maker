
export const MB = 1024 * 1024;

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

export function bad(message: string, status = 400) {
  return json({ ok: false, error: message }, { status });
}

export function ok(data: Record<string, unknown> = {}, init: ResponseInit = {}) {
  return json({ ok: true, ...data }, init);
}

export function safeFilename(name: string) {
  const base = (name || "video.mp4").trim();
  // replace weird chars
  return base.replace(/[^\w.\-]+/g, "_");
}

export function makeVideoKey(filename: string) {
  const id = crypto.randomUUID();
  return `uploads/${id}/${safeFilename(filename)}`;
}

export function requireJson(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("Expected application/json");
}

export function toInt(value: string | null, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
