// api/claude.js — Vercel Edge Function
// TrialForge AI Anthropic proxy

export const config = { runtime: "edge" };

const RL = new Map();

function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const e = RL.get(ip) || { n: 0, t: now };

  if (now - e.t > windowMs) {
    RL.set(ip, { n: 1, t: now });
    return false;
  }

  e.n++;
  RL.set(ip, e);
  return e.n > max;
}

const PHI = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bMRN[:\s#]*\d{4,10}\b/i,
  /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-]\d{4}\b/,
  /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i,
  /\b(\+1[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}\b/,
  /\bNPI[:\s#]*\d{10}\b/i,
];

function hasPHI(s) {
  return typeof s === "string" && PHI.some((p) => p.test(s));
}

async function hash(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-user-id, x-session-id",
  };
}

function json(data, status = 200, origin = "*", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

export default async function handler(req) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowedOrigin),
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, allowedOrigin);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";

  if (rateLimited(ip)) {
    return json({ error: "Rate limit: max 20 req/min" }, 429, allowedOrigin);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Server misconfiguration" }, 500, allowedOrigin);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, allowedOrigin);
  }

  const { model, max_tokens, system, messages } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages[] required" }, 400, allowedOrigin);
  }

  const allText = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ");

  if (hasPHI(allText)) {
    return json(
      {
        error: "PHI detected. De-identify all patient data before submission.",
        code: "PHI_DETECTED",
      },
      422,
      allowedOrigin
    );
  }

  const userId = req.headers.get("x-user-id") || "anon";
  const sessionId = req.headers.get("x-session-id") || "unknown";
  const inputHash = await hash(allText);
  const t0 = Date.now();

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
    console.error("[TF] upstream fetch error:", e?.message || e);
    return json({ error: "AI service unavailable" }, 502, allowedOrigin);
  }

  const durationMs = Date.now() - t0;
  const raw = await upstream.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[TF] non-JSON upstream response:", raw.slice(0, 300));
    return json(
      { error: "Upstream returned non-JSON response" },
      502,
      allowedOrigin,
      { "X-Duration-Ms": String(durationMs) }
    );
  }

  if (!upstream.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.type ||
      data?.message ||
      "Anthropic error";
    return json(
      { error: msg },
      upstream.status,
      allowedOrigin,
      { "X-Duration-Ms": String(durationMs) }
    );
  }

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      userId,
      sessionId,
      inputHash,
      durationMs,
      model: model || "claude-sonnet-4-20250514",
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    })
  );

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Duration-Ms": String(durationMs),
      ...corsHeaders(allowedOrigin),
    },
  });
}
