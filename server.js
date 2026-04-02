// ============================================================
// server.js — TrialForge AI Express Server (Production)
// Replaces the broken MCP v1.1 and v1.2 mock servers
//
// Run:  node server.js
// Dev:  PORT=4000 ANTHROPIC_API_KEY=sk-ant-... node server.js
//
// Required env vars (.env file or system env):
//   ANTHROPIC_API_KEY   your sk-ant-... key
//   ALLOWED_ORIGIN      https://your-frontend.vercel.app
//   PROXY_SECRET        shared secret (same as in Vercel env)
//   PORT                default 4000
// ============================================================

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:3000";
const PROXY_SECRET = process.env.PROXY_SECRET || null;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-proxy-secret", "x-user-id", "x-session-id"],
}));
app.use(express.json({ limit: "1mb" }));

// ─── Rate limiter (simple in-process, use Redis for multi-instance) ───────────
const rateMap = new Map();
function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { n: 0, t: now };
  if (now - entry.t > windowMs) { rateMap.set(ip, { n: 1, t: now }); return false; }
  entry.n++;
  rateMap.set(ip, entry);
  return entry.n > max;
}

// ─── PHI detection ───────────────────────────────────────────────────────────
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bMRN[:\s#]*\d{4,10}\b/i,
  /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-]\d{4}\b/,
  /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i,
  /\b(\+1[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}\b/,
  /\bNPI[:\s#]*\d{10}\b/i,
];
const hasPHI = (s) => typeof s === "string" && PHI_PATTERNS.some((p) => p.test(s));

// ─── Safe audit log (no PHI, no raw content) ─────────────────────────────────
function auditLog(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authCheck(req, res, next) {
  if (!PROXY_SECRET) return next(); // no secret set = open (dev only)
  if (req.headers["x-proxy-secret"] !== PROXY_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Rate limit middleware ────────────────────────────────────────────────────
function rateCheck(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 20 requests/minute." });
  }
  next();
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    model: "claude-sonnet-4-20250514",
    keyLoaded: !!ANTHROPIC_API_KEY,
  });
});

// ─── Main completions endpoint ─────────────────────────────────────────────────
app.post("/mcp/v1/chat/completions", rateCheck, authCheck, async (req, res) => {
  const { messages, model, max_tokens, system } = req.body || {};
  const ip = req.ip || "unknown";
  const userId = req.headers["x-user-id"] || "anon";
  const sessionId = req.headers["x-session-id"] || "unknown";

  // Validate body
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages[] is required and must not be empty" });
  }

  // Check API key
  if (!ANTHROPIC_API_KEY) {
    auditLog({ event: "config_error", userId, ip });
    return res.status(500).json({ error: "Server misconfiguration: ANTHROPIC_API_KEY not set" });
  }

  // PHI detection
  const allText = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ");
  if (hasPHI(allText)) {
    auditLog({ event: "phi_detected", userId, ip });
    return res.status(422).json({
      error: "PHI detected in request. De-identify all patient data before submission.",
      code: "PHI_DETECTED",
    });
  }

  const t0 = Date.now();

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: Math.min(max_tokens || 3000, 4000),
        system: system || "",
        messages,
      }),
    });

    const durationMs = Date.now() - t0;
    const data = await upstream.json();

    if (data.error) {
      auditLog({ event: "anthropic_error", type: data.error.type, userId, durationMs });
      return res.status(upstream.status).json({ error: data.error.message });
    }

    // HIPAA-safe audit: log only hash + metadata, never raw content
    const { createHash } = require("crypto");
    const inputHash = createHash("sha256").update(allText).digest("hex");
    auditLog({
      event: "completion",
      userId,
      sessionId,
      inputHash,
      model: model || "claude-sonnet-4-20250514",
      durationMs,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    });

    // Return in OpenAI-compatible format (as the frontend expects choices[0].message.content)
    // AND in Anthropic format (content[0].text) — support both
    res.json({
      ...data,
      choices: [{
        message: {
          role: "assistant",
          content: data.content?.[0]?.text || "",
        },
        finish_reason: data.stop_reason || "end_turn",
        index: 0,
      }],
    });
  } catch (err) {
    const durationMs = Date.now() - t0;
    auditLog({ event: "proxy_error", error: err.message, userId, durationMs });
    res.status(502).json({ error: "AI service unavailable. Please try again." });
  }
});

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[TF] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[TrialForge] MCP server v2.0 running on http://localhost:${PORT}`);
  console.log(`[TrialForge] API key: ${ANTHROPIC_API_KEY ? "loaded" : "MISSING"}`);
  console.log(`[TrialForge] Auth: ${PROXY_SECRET ? "enabled" : "disabled (dev mode)"}`);
  console.log(`[TrialForge] CORS origin: ${ALLOWED_ORIGIN}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("[TrialForge] WARNING: ANTHROPIC_API_KEY not set. All AI calls will fail.");
  }
});
