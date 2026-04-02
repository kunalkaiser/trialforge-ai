// ============================================================
// api/claude.js — Vercel Edge Function
// HIPAA-safe Anthropic proxy for TrialForge AI
//
// Required env vars (set in Vercel Dashboard → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   sk-ant-... (NEVER in frontend)
//   ALLOWED_ORIGIN      https://your-app.vercel.app
//   PROXY_SECRET        any random string, same value set in App.jsx
// ============================================================

export const config = { runtime: "edge" };

// ─── In-memory rate limiter (resets per edge cold start) ─────────────────────
const RL = new Map();
function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const e = RL.get(ip) || { n: 0, t: now };
  if (now - e.t > windowMs) { RL.set(ip, { n: 1, t: now }); return false; }
  e.n++;
  RL.set(ip, e);
  return e.n > max;
}

// ─── PHI detection ───────────────────────────────────────────────────────────
const PHI = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bMRN[:\s#]*\d{4,10}\b/i,
  /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-]\d{4}\b/,
  /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i,
  /\b(\+1[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}\b/,
  /\bNPI[:\s#]*\d{10}\b/i,
];
const hasPHI = (s) => typeof s === "string" && PHI.some((p) => p.test(s));

// ─── SHA-256 of request content (for audit — never log raw text) ─────────────
async function hash(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── CORS ────────────────────────────────────────────────────────────────────
function cors() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:3000",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-proxy-secret, x-user-id, x-session-id",
  };
}
const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return ok({ error: "Method not allowed" }, 405);

  // Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (rateLimited(ip)) return ok({ error: "Rate limit: max 20 req/min" }, 429);

  // Shared secret
  const secret = process.env.PROXY_SECRET;
  if (secret && req.headers.get("x-proxy-secret") !== secret)
    return ok({ error: "Unauthorized" }, 401);

  // Server API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return ok({ error: "Server misconfiguration" }, 500);

  // Parse body
  let body;
  try { body = await req.json(); } catch { return ok({ error: "Invalid JSON" }, 400); }

  const { model, max_tokens, system, messages } = body;
  if (!Array.isArray(messages) || messages.length === 0)
    return ok({ error: "messages[] required" }, 400);

  // PHI check — scan all user message content
  const allText = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ");
  if (hasPHI(allText))
    return ok({
      error: "PHI detected. De-identify all patient data before submission.",
      code: "PHI_DETECTED",
    }, 422);

  // Audit metadata (no raw text ever logged)
  const userId = req.headers.get("x-user-id") || "anon";
  const sessionId = req.headers.get("x-session-id") || "unknown";
  const inputHash = await hash(allText);
  const t0 = Date.now();

  // Call Anthropic
  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: Math.min(max_tokens || 3000, 4000),
        system: system || "",
        messages,
      }),
    });
  } catch (e) {
    console.error("[TF] upstream error:", e.message);
    return ok({ error: "AI service unavailable" }, 502);
  }

  const durationMs = Date.now() - t0;
  const data = await upstream.json();

  if (data.error) return ok({ error: data.error.message }, upstream.status);

  // HIPAA-safe audit log (replace console with DB write for production)
  console.log(JSON.stringify({
    ts: new Date().toISOString(), userId, sessionId,
    inputHash, durationMs, model: model || "claude-sonnet-4-20250514",
    inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens,
  }));

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Duration-Ms": String(durationMs),
      ...cors(),
    },
  });
}
