export type TemplateName = "general" | "sdxl" | "midjourney" | "video";

export function systemInstruction() {
  return [
    "Kamu adalah Prompt Maker.",
    "Input: beberapa frame (gambar) dari sebuah video.",
    "Output: JSON VALID sesuai schema yang diminta.",
    "Jangan pakai markdown. Jangan pakai codefence.",
    "Kalau ada teks pada video, masukkan ke ringkasan dan prompt."
  ].join("\n");
}

export function outputSchemaHint() {
  return [
    "Outputkan JSON dengan format persis:",
    "{",
    '  "summary": "string",',
    '  "prompt": "string",',
    '  "negative_prompt": "string",',
    '  "tags": ["string"],',
    '  "notes": "string"',
    "}"
  ].join("\n");
}

export function templateGuide(template: TemplateName) {
  switch (template) {
    case "sdxl":
      return [
        "Template: SDXL (image generation).",
        "- Prompt: detail subject, environment, lighting, style, camera, composition.",
        "- Negative prompt: artefacts, low quality, watermark, text, blur, deformed, extra limbs, etc.",
        "- Tags: kata kunci utama.",
        "- Notes: optional parameter suggestions (steps, cfg, aspect ratio) tapi tetap di field notes."
      ].join("\n");
    case "midjourney":
      return [
        "Template: Midjourney.",
        "- Prompt: natural language dengan style cues.",
        "- Notes: rekomendasi parameter seperti --ar 16:9, --stylize 200, --quality 1 (tulis di notes).",
        "- Negative_prompt boleh diisi dengan hal yang harus dihindari (walau MJ tidak pakai negative prompt resmi, tetap tulis)."
      ].join("\n");
    case "video":
      return [
        "Template: Video prompt (generative video).",
        "- Prompt: jelaskan adegan, subjek, aksi, emosi, lingkungan, waktu, lighting.",
        "- Tambahkan camera movement (pan, dolly, handheld), lens, depth of field, pacing.",
        "- Negative_prompt: flicker, jitter, morphing faces, text artifacts, watermark, etc.",
        "- Notes: rekomendasi durasi, fps, aspect ratio."
      ].join("\n");
    case "general":
    default:
      return [
        "Template: General.",
        "- Prompt: paling universal, bisa untuk model image/video tergantung tujuan user.",
        "- Negative prompt: hal yang harus dihindari.",
        "- Tags: kata kunci utama."
      ].join("\n");
  }
}
