
export function corsHeaders(origin: string | null) {
  // Sederhana: allow all. Kalau mau lebih aman, whitelist origin.
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400"
  };
}
