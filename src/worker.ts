import { corsHeaders } from "./cors";
import { MB, bad, clamp, json, makeVideoKey, ok, requireJson, toInt } from "./utils";
import { insertRun, listRuns, getRun, deleteRun } from "./db";
import { outputSchemaHint, systemInstruction, templateGuide, type TemplateName } from "./prompts";

export interface Env {
  VIDEOS: R2Bucket;
  DB: D1Database;
  OPENAI_API_KEY: string;
}

const PART_SIZE = 5 * MB; // multipart part size

function withCors(req: Request, res: Response) {
  const origin = req.headers.get("origin");
  const headers = new Headers(res.headers);
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

function parseMaybeJson(text: string): any | null {
  // attempt to find first {...} json object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callOpenAI(env: Env, payload: unknown) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, detail: j };
  }
  return { ok: true, detail: j };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }

    try {
      // ============= Upload multipart to R2 =============

      // POST /api/upload/start
      if (req.method === "POST" && url.pathname === "/api/upload/start") {
        requireJson(req);
        const body = await req.json().catch(() => ({} as any));
        const filename = String(body?.filename || "video.mp4");
        const size = Number(body?.size || 0);

        if (!Number.isFinite(size) || size < 10 * MB) {
          return withCors(req, bad("File harus minimal 10MB."));
        }
        if (!filename.toLowerCase().endsWith(".mp4")) {
          return withCors(req, bad("Format harus .mp4"));
        }

        const key = makeVideoKey(filename);
        const mp = await env.VIDEOS.createMultipartUpload(key, {
          httpMetadata: { contentType: "video/mp4" }
        });

        return withCors(req, ok({ key, uploadId: mp.uploadId, partSize: PART_SIZE }));
      }

      // PUT /api/upload/part?key=...&uploadId=...&partNumber=1
      if (req.method === "PUT" && url.pathname === "/api/upload/part") {
        const key = url.searchParams.get("key") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = toInt(url.searchParams.get("partNumber"), 0);

        if (!key || !uploadId || partNumber < 1) {
          return withCors(req, bad("Missing key/uploadId/partNumber"));
        }
        const mp = env.VIDEOS.resumeMultipartUpload(key, uploadId);
        const etag = await mp.uploadPart(partNumber, req.body as ReadableStream);
        return withCors(req, ok({ etag, partNumber }));
      }

      // POST /api/upload/complete
      if (req.method === "POST" && url.pathname === "/api/upload/complete") {
        requireJson(req);
        const body = await req.json().catch(() => ({} as any));

        const key = String(body?.key || "");
        const uploadId = String(body?.uploadId || "");
        const parts = Array.isArray(body?.parts) ? body.parts : [];

        if (!key || !uploadId || parts.length === 0) {
          return withCors(req, bad("Missing key/uploadId/parts"));
        }

        const normalized = parts
          .map((p: any) => ({
            partNumber: Number(p.partNumber),
            etag: String(p.etag || "")
          }))
          .filter((p: any) => Number.isFinite(p.partNumber) && p.partNumber >= 1 && p.etag);

        if (normalized.length === 0) return withCors(req, bad("Invalid parts"));

        const mp = env.VIDEOS.resumeMultipartUpload(key, uploadId);
        await mp.complete(normalized);

        return withCors(req, ok({ key }));
      }

      // ============= Make prompt =============

      // POST /api/make-prompt
      if (req.method === "POST" && url.pathname === "/api/make-prompt") {
        requireJson(req);
        const body = await req.json().catch(() => ({} as any));

        const frames: string[] = Array.isArray(body?.frames) ? body.frames : [];
        const goal = String(body?.goal || "Buat prompt terbaik berdasarkan isi video ini.");
        const language = String(body?.language || "id");
        const style = String(body?.style || "ringkas, jelas, siap copy-paste");
        const template = String(body?.template || "general") as TemplateName;

        const video_key = body?.video_key ? String(body.video_key) : null;
        const video_name = body?.video_name ? String(body.video_name) : null;
        const video_size = body?.video_size ? Number(body.video_size) : null;

        if (!env.OPENAI_API_KEY) {
          return withCors(req, json({ ok: false, error: "OPENAI_API_KEY belum di-set (wrangler secret put)." }, { status: 500 }));
        }
        if (frames.length === 0) return withCors(req, bad("frames kosong"));
        if (frames.length > 16) return withCors(req, bad("maks 16 frames"));

        const inputContent: any[] = [
          {
            type: "input_text",
            text: [
              systemInstruction(),
              "",
              `Tujuan prompt: ${goal}`,
              `Bahasa output: ${language}`,
              `Gaya: ${style}`,
              "",
              templateGuide(template),
              "",
              outputSchemaHint()
            ].join("\n")
          },
          ...frames.map((dataUrl) => ({
            type: "input_image",
            image_url: dataUrl,
            detail: "low"
          }))
        ];

        const payload = {
          model: "gpt-5",
          input: [{ role: "user", content: inputContent }]
        };

        const ai = await callOpenAI(env, payload);
        if (!ai.ok) {
          return withCors(req, json({ ok: false, error: "OpenAI error", detail: ai.detail }, { status: 502 }));
        }

        const detail: any = ai.detail;
        const outputText =
          (detail?.output_text as string) ||
          (Array.isArray(detail?.output)
            ? detail.output
                .map((o: any) => (Array.isArray(o?.content) ? o.content.map((c: any) => c?.text || "").join("") : ""))
                .join("\n")
            : "");

        // Parse JSON result (best effort)
        const parsed = parseMaybeJson(outputText) || {};
        const summary = typeof parsed.summary === "string" ? parsed.summary : "";
        const prompt = typeof parsed.prompt === "string" ? parsed.prompt : outputText;
        const negative_prompt = typeof parsed.negative_prompt === "string" ? parsed.negative_prompt : "";
        const tags = Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 50) : [];
        const notes = typeof parsed.notes === "string" ? parsed.notes : "";

        const id = await insertRun(env.DB, {
          video_key,
          video_name,
          video_size: Number.isFinite(video_size as number) ? (video_size as number) : null,
          template,
          goal,
          language,
          style,
          frames_count: frames.length,
          summary,
          prompt,
          negative_prompt,
          tags_json: JSON.stringify(tags),
          notes,
          raw_json: JSON.stringify(detail)
        });

        return withCors(
          req,
          ok({
            id,
            result: {
              summary,
              prompt,
              negative_prompt,
              tags,
              notes
            }
          })
        );
      }

      // ============= History API (D1) =============

      // GET /api/history?limit=20&offset=0
      if (req.method === "GET" && url.pathname === "/api/history") {
        const limit = clamp(toInt(url.searchParams.get("limit"), 20), 1, 100);
        const offset = clamp(toInt(url.searchParams.get("offset"), 0), 0, 10_000);

        const rows = await listRuns(env.DB, limit, offset);
        // parse tags_json
        const mapped = rows.map((r: any) => ({
          ...r,
          tags: (() => {
            try {
              return JSON.parse(r.tags_json || "[]");
            } catch {
              return [];
            }
          })()
        }));
        return withCors(req, ok({ items: mapped, limit, offset }));
      }

      // GET /api/history/:id
      if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
        const id = toInt(url.pathname.split("/").pop() || "", 0);
        if (id < 1) return withCors(req, bad("Invalid id"));

        const row: any = await getRun(env.DB, id);
        if (!row) return withCors(req, bad("Not found", 404));

        let tags: any[] = [];
        try {
          tags = JSON.parse(row.tags_json || "[]");
        } catch {
          tags = [];
        }
        return withCors(req, ok({ item: { ...row, tags } }));
      }

      // DELETE /api/history/:id
      if (req.method === "DELETE" && url.pathname.startsWith("/api/history/")) {
        const id = toInt(url.pathname.split("/").pop() || "", 0);
        if (id < 1) return withCors(req, bad("Invalid id"));

        const changes = await deleteRun(env.DB, id);
        if (changes === 0) return withCors(req, bad("Not found", 404));
        return withCors(req, ok({ deleted: true }));
      }

      return withCors(req, notFound());
    } catch (e: any) {
      return withCors(req, json({ ok: false, error: String(e?.message || e) }, { status: 500 }));
    }
  }
};
