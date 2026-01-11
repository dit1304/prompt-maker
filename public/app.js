// Kalau UI + Worker 1 domain (routes /api/*), biarkan kosong.
const API_BASE = "https://api.zeroprompt.biz.id";

// Helpers
const $ = (id) => document.getElementById(id);
const log = (msg) => { $("log").textContent += msg + "\n"; };
const setOut = (obj) => { $("out").value = JSON.stringify(obj, null, 2); };

const MB = 1024 * 1024;
const PART_SIZE = 5 * MB;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function uploadMultipart(file) {
  // start
  const startRes = await fetch(API_BASE + "/api/upload/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size })
  });
  const startJson = await startRes.json();
  if (!startRes.ok || !startJson.ok) throw new Error(startJson.error || "upload/start gagal");

  const { key, uploadId, partSize } = startJson;
  log(`start ok: key=${key}`);
  log(`uploadId=${uploadId}, partSize=${partSize}`);

  // parts
  const parts = [];
  let partNumber = 1;

  for (let offset = 0; offset < file.size; offset += partSize) {
    const chunk = file.slice(offset, offset + partSize);
    log(`upload part ${partNumber} (${chunk.size} bytes)`);

    const partRes = await fetch(
      API_BASE + `/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
      { method: "PUT", body: chunk }
    );
    const partJson = await partRes.json();
    if (!partRes.ok || !partJson.ok) throw new Error(partJson.error || "upload/part gagal");

    parts.push({
  partNumber,
  etag: String(partJson.etag || "").replaceAll('"', "")
});

parts.sort((a, b) => a.partNumber - b.partNumber);

  // complete
  log("complete upload...");
  const compRes = await fetch(API_BASE + "/api/upload/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts })
  });
  const compJson = await compRes.json();
  if (!compRes.ok || !compJson.ok) throw new Error(compJson.error || "upload/complete gagal");

  log("upload selesai ✅");
  return { key };
}

/**
 * Extract many candidate frames, score by difference, pick top N.
 * - decode video via <video>
 * - downscale to small 64x64 for scoring
 * - keep the best diverse frames
 */
async function extractSmartFrames(file, pickN = 8, candidates = 16) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(file);

  await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Gagal load video metadata"));
  });

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Durasi video tidak valid.");

  // Canvas output (for sending frames)
  const outCanvas = document.createElement("canvas");
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });

  // Small canvas for scoring
  const scoreCanvas = document.createElement("canvas");
  scoreCanvas.width = 64;
  scoreCanvas.height = 64;
  const scoreCtx = scoreCanvas.getContext("2d", { willReadFrequently: true });

  // target width for output frames (token-friendly)
  const targetW = 512;
  const scale = targetW / video.videoWidth;
  outCanvas.width = targetW;
  outCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  // candidate timestamps (avoid first/last 2%)
  const times = [];
  for (let i = 0; i < candidates; i++) {
    const t = duration * (0.02 + 0.96 * (i / Math.max(1, candidates - 1)));
    times.push(t);
  }

  let prevSmall = null;

  const candidatesArr = [];
  for (const t of times) {
    video.currentTime = t;
    await new Promise((res) => (video.onseeked = () => res()));

    // draw small for scoring
    scoreCtx.drawImage(video, 0, 0, scoreCanvas.width, scoreCanvas.height);
    const imgData = scoreCtx.getImageData(0, 0, scoreCanvas.width, scoreCanvas.height).data;

    // score vs prev
    let diff = 0;
    if (prevSmall) {
      for (let i = 0; i < imgData.length; i += 4) {
        diff += Math.abs(imgData[i] - prevSmall[i]);
        diff += Math.abs(imgData[i + 1] - prevSmall[i + 1]);
        diff += Math.abs(imgData[i + 2] - prevSmall[i + 2]);
      }
    } else {
      diff = 1e9; // first frame always high
    }
    prevSmall = imgData;

    // render output frame
    outCtx.drawImage(video, 0, 0, outCanvas.width, outCanvas.height);
    const blob = await new Promise((res) => outCanvas.toBlob(res, "image/jpeg", 0.72));
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });

    candidatesArr.push({ t, diff, dataUrl });
    await sleep(20);
  }

  // pick top by diff, but keep time spread
  candidatesArr.sort((a, b) => b.diff - a.diff);

  const picked = [];
  const minGap = duration / (pickN + 1); // avoid frames too close
  for (const c of candidatesArr) {
    if (picked.length >= pickN) break;
    if (picked.every(p => Math.abs(p.t - c.t) >= minGap * 0.5)) {
      picked.push(c);
    }
  }

  // fallback if too strict
  while (picked.length < pickN && picked.length < candidatesArr.length) {
    const next = candidatesArr[picked.length];
    if (!picked.includes(next)) picked.push(next);
  }

  // sort by time for nicer order
  picked.sort((a, b) => a.t - b.t);

  // show thumbs
  $("thumbs").innerHTML = "";
  for (const p of picked) {
    const img = document.createElement("img");
    img.src = p.dataUrl;
    img.title = `t=${p.t.toFixed(2)}s`;
    $("thumbs").appendChild(img);
  }

  URL.revokeObjectURL(video.src);
  return picked.map(p => p.dataUrl);
}

async function makePrompt({ frames, template, goal, language, style, video }) {
  const res = await fetch(API_BASE + "/api/make-prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      frames,
      template,
      goal,
      language,
      style,
      video_key: video?.key || null,
      video_name: video?.name || null,
      video_size: video?.size || null
    })
  });
  const j = await res.json();
  if (!res.ok || !j.ok) throw new Error(j.error || "make-prompt gagal");
  return j;
}

async function loadHistory() {
  const res = await fetch(API_BASE + "/api/history?limit=20&offset=0");
  const j = await res.json();
  if (!res.ok || !j.ok) throw new Error(j.error || "history gagal");

  const wrap = $("history");
  wrap.innerHTML = "";

  for (const item of j.items) {
    const div = document.createElement("div");
    div.className = "hitem";
    div.innerHTML = `
      <div class="meta">
        #${item.id} • ${item.template} • ${item.created_at}
        ${item.video_name ? " • " + item.video_name : ""}
      </div>
      <div><b>Summary:</b> ${escapeHtml(item.summary || "")}</div>
      <div class="actions">
        <button data-act="view" data-id="${item.id}">View</button>
        <button data-act="copy" data-id="${item.id}">Copy Prompt</button>
        <button data-act="del" data-id="${item.id}">Delete</button>
      </div>
    `;
    wrap.appendChild(div);
  }

  wrap.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === "view") {
      const r = await fetch(API_BASE + `/api/history/${id}`);
      const j2 = await r.json();
      if (!r.ok || !j2.ok) return alert(j2.error || "gagal");
      const out = {
        id: j2.item.id,
        template: j2.item.template,
        created_at: j2.item.created_at,
        summary: j2.item.summary,
        prompt: j2.item.prompt,
        negative_prompt: j2.item.negative_prompt,
        tags: j2.item.tags,
        notes: j2.item.notes
      };
      setOut(out);
      log(`Loaded history #${id}`);
    }

    if (act === "copy") {
      const r = await fetch(API_BASE + `/api/history/${id}`);
      const j2 = await r.json();
      if (!r.ok || !j2.ok) return alert(j2.error || "gagal");
      await navigator.clipboard.writeText(j2.item.prompt || "");
      alert("Prompt copied!");
    }

    if (act === "del") {
      if (!confirm("Delete item ini?")) return;
      const r = await fetch(API_BASE + `/api/history/${id}`, { method: "DELETE" });
      const j2 = await r.json();
      if (!r.ok || !j2.ok) return alert(j2.error || "gagal");
      await loadHistory();
      log(`Deleted history #${id}`);
    }
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// UI actions
$("run").addEventListener("click", async () => {
  $("log").textContent = "";
  $("out").value = "";
  $("thumbs").innerHTML = "";

  const file = $("file").files?.[0];
  if (!file) return alert("Pilih file MP4 dulu.");
  if (!file.name.toLowerCase().endsWith(".mp4")) return alert("Harus MP4.");
  if (file.size < 10 * MB) return alert("Minimal 10MB.");

  const template = $("template").value || "general";
  const language = $("language").value || "id";
  const goal = $("goal").value || "Buat prompt terbaik berdasarkan isi video ini.";
  const style = $("style").value || "ringkas, jelas, siap copy-paste";

  try {
    log(`file: ${file.name} (${file.size} bytes)`);

    // Upload ke R2 (arsip)
    const up = await uploadMultipart(file);

    // Extract frames (smart)
    log("extract frames...");
    const frames = await extractSmartFrames(file, 8, 16);
    log(`frames selected: ${frames.length}`);

    // Generate prompt
    log("generate prompt...");
    const out = await makePrompt({
      frames,
      template,
      goal,
      language,
      style,
      video: { key: up.key, name: file.name, size: file.size }
    });

    setOut(out.result);
    log(`saved as history id=${out.id}`);
    await loadHistory();
    log("done ✅");
  } catch (e) {
    console.error(e);
    log("ERROR: " + (e.message || e));
    alert(e.message || e);
  }
});

$("copyPrompt").addEventListener("click", async () => {
  try {
    const j = JSON.parse($("out").value || "{}");
    await navigator.clipboard.writeText(j.prompt || "");
    alert("Prompt copied!");
  } catch {
    alert("Output belum valid JSON.");
  }
});

$("copyAll").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("out").value || "");
  alert("JSON copied!");
});

$("loadHistory").addEventListener("click", async () => {
  try {
    await loadHistory();
    log("history refreshed");
  } catch (e) {
    alert(e.message || e);
  }
});

// auto load history on start
loadHistory().catch(() => {});
