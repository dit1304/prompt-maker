# Prompt Maker (Video → Prompt) — Cloudflare Workers

Fitur:
- Upload MP4 minimal 10MB (multipart) ke R2
- Ambil beberapa frame di browser (smart frame selection)
- Generate prompt dari frames (OpenAI)
- Simpan history hasil prompt ke D1 + UI history (view/copy/delete)

## Prasyarat
- Node.js 18+
- Cloudflare account + Wrangler
- OpenAI API key

## Setup lokal
```bash
npm i
wrangler login
