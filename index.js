// Lambda Function URL handler — Birthday wisher.
//
// Routing, rate limiting, CORS, OPTIONS, state enforcement, structured logging.
// Calls into ai.js for Gemini work and state.js for birthday date states.
// Nothing personal ever leaves this file while the birthday is locked or closed.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const state = require("./state.js");
const ai = require("./ai.js");
const { check: rateCheck } = require("./rateLimit.js");

// Global process-level handlers to ensure uncaught errors are logged in CloudWatch
process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ type: "uncaughtException", ts: Date.now(), error: String(err && err.message || err), stack: err && err.stack }));
});
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ type: "unhandledRejection", ts: Date.now(), reason: String(reason) }));
});
// Current request correlation id, set at handler entry and cleared after.
let CURRENT_CORRELATION_ID = null;

// ---------- Config ----------

const SELF_ORIGIN = process.env.SELF_ORIGIN || "";

// OVERRIDE_NOW is supported for local tests (OVERRIDE_NOW=... npm run dev).
// Never set it in production: anyone with read access to Lambda env vars could
// reopen the birthday window — state is enforced here, so prod needs the
// deployer simply not to set it.
const TEST_OVERRIDE_NOW = process.env.OVERRIDE_NOW || "";

const MAX_BODY_BYTES = 1024 * 10; // 10 KB — keeps wish history small and cheap

// ---------- Static asset cache ----------
// Read files at module load so we don't hit the filesystem on every request.
// Lambda's /var/task is read-only so this is safe.

const PUBLIC_DIR = path.join(__dirname, "public");
let INDEX_HTML = null;
function loadIndexHtml() {
  if (INDEX_HTML === null) {
    INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  }
  return INDEX_HTML;
}

// Serve a file from public/ by relative path. Path traversal guard.
function serveStatic(relPath, defaultContentType) {
  if (!relPath || relPath.includes("..") || path.isAbsolute(relPath)) return null;
  const abs = path.resolve(PUBLIC_DIR, relPath);
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) return null;
  try {
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const ct =
      defaultContentType ||
      ({
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
      }[ext] || "application/octet-stream");
    return { data, contentType: ct };
  } catch (_) {
    return null;
  }
}

// ---------- Birthday state ----------
// Enforced on the server for every GET / (page chrome) and POST /wish.
// The client receives only the JSON state block — personal data (friend name,
// memories, AI output) is only embedded when state is open.

function computePageState() {
  const s = state.computeState();
  const out = { state: s.state };
  if (s.targetMs !== null) out.targetTs = s.targetMs; // countdown target for locked/open
  // Always expose the birthday date so the client can recompute the state from
  // the browser's own timezone (via Moment). The birthday day itself is already
  // revealed by the countdown target, so this is not extra personal data.
  if (s.birthYmd) out.birthYmd = s.birthYmd;
  if (s.state === "open") {
    const friendName = process.env.FRIEND_NAME || "friend";
    out.friendName = friendName;
  }
  return out;
}

function jsonEscapeForHtml(json) {
  // Embed JSON inside a <script> tag safely: break any accidental </script>.
  return json.replace(/<\//g, "<\\/");
}

// ---------- CORS ----------

function corsHeadersFor(requestOrigin) {
  // Echo the request's Origin only if it matches our own. Never wildcard.
  if (!SELF_ORIGIN || !requestOrigin) return { Vary: "Origin" };
  if (requestOrigin === SELF_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": SELF_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return { Vary: "Origin" };
}

function buildResponse(status, body, contentType, requestOrigin, extraHeaders = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const headers = {
    "Content-Type": contentType,
    ...corsHeadersFor(requestOrigin),
    ...extraHeaders,
  };
  if (!headers["X-Correlation-Id"] && CURRENT_CORRELATION_ID) headers["X-Correlation-Id"] = CURRENT_CORRELATION_ID;

  let outBody = body;
  try {
    const ct = (contentType || "").toLowerCase();
    if (!isBuffer && typeof outBody === "string" && ct.includes("application/json")) {
      const parsed = JSON.parse(outBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.correlationId && CURRENT_CORRELATION_ID) parsed.correlationId = CURRENT_CORRELATION_ID;
        outBody = JSON.stringify(parsed);
      }
    }
  } catch (_) {
    // If parsing fails, leave the body unchanged.
  }

  return {
    statusCode: status,
    headers,
    body: isBuffer ? body.toString("base64") : outBody,
    isBase64Encoded: isBuffer,
  };
}

// ---------- Helpers ----------

function getRequestContext(event) {
  const headers = event.headers || {};
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  const requestContext = event.requestContext || {};
  return {
    requestId: requestContext.requestId || lower["x-amzn-trace-id"] || "local",
    correlationId: lower["x-correlation-id"] || lower["x-request-id"] || null,
    ip: lower["x-forwarded-for"]?.split(",")[0].trim() || requestContext.http?.sourceIp || "0.0.0.0",
    ua: lower["user-agent"] || "",
    referer: lower["referer"] || lower["referrer"] || "",
    origin: lower["origin"] || "",
    method: event.httpMethod || requestContext.http?.method || "GET",
    rawPath: event.rawPath || (event.path || "/"),
  };
}

function logLine(line) {
  if (line && !line.correlationId && CURRENT_CORRELATION_ID) line.correlationId = CURRENT_CORRELATION_ID;
  console.log(JSON.stringify(line));
}

function logError(err, ctx) {
  const out = {
    type: "internal_error",
    requestId: ctx?.requestId || "local",
    ts: Date.now(),
    error: String(err && err.message || err),
    stack: err && err.stack,
  };
  if (ctx?.correlationId) out.correlationId = ctx.correlationId;
  else if (CURRENT_CORRELATION_ID) out.correlationId = CURRENT_CORRELATION_ID;
  console.error(JSON.stringify(out));
}

// ---------- Handlers ----------

async function handleGet(ctx) {
  const url = ctx.rawPath.split("?")[0];

  if (url === "/" || url === "/index.html") {
    const html = loadIndexHtml();
    const pageState = computePageState();
    const body = html.replace("__BIRTHDAY_STATE_PLACEHOLDER__", jsonEscapeForHtml(JSON.stringify(pageState)));
    logLine({
      type: "page_load",
      requestId: ctx.requestId,
      ts: Date.now(),
      ip: ctx.ip,
      ua: ctx.ua,
      referer: ctx.referer,
      state: pageState.state,
      warmup: ctx.rawPath.includes("warmup=1"),
    });
    return buildResponse(200, body, "text/html; charset=utf-8", ctx.origin);
  }

  const rel = url.replace(/^\/+/, "");
  const staticFile = serveStatic(rel);
  if (staticFile) {
    return buildResponse(200, staticFile.data, staticFile.contentType, ctx.origin);
  }
  return buildResponse(404, "Not Found", "text/plain; charset=utf-8", ctx.origin);
}

function parseJsonBody(event) {
  if (!event.body) return { ok: false, status: 403, reason: "no body" };
  const body = typeof event.body === "string" ? Buffer.from(event.body, "utf8") : event.body;
  if (body.length > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "body too large" };
  try {
    return { ok: true, body: JSON.parse(body.toString("utf8")) };
  } catch (_) {
    return { ok: false, status: 403, reason: "bad json" };
  }
}

async function handlePostWish(ctx, event) {
  const bodyLength = event.body ? (typeof event.body === "string" ? Buffer.byteLength(event.body, "utf8") : event.body.length) : 0;
  logLine({
    type: "wish_request",
    requestId: ctx.requestId,
    ts: Date.now(),
    ip: ctx.ip,
    path: ctx.rawPath,
    origin: ctx.origin,
    bodyLength,
  });

  // Rate limit per IP to prevent abuse.
  const rl = rateCheck(ctx.ip);
  if (!rl.allowed) {
    logLine({ type: "wish", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "rate_limited", retryAfterMs: rl.retryAfterMs });
    return buildResponse(429, JSON.stringify({ error: "rate_limited" }), "application/json", ctx.origin, { "Retry-After": String(Math.ceil((rl.retryAfterMs || 60_000) / 1000)) });
  }

  const parsed = parseJsonBody(event);
  if (!parsed.ok) {
    logLine({ type: "wish", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: parsed.reason, bodyLength });
    return buildResponse(parsed.status, JSON.stringify({ error: "forbidden" }), "application/json", ctx.origin);
  }

  // 403 outside the birthday — enforced on the server, never trust the client clock.
  const pageState = computePageState();
  if (pageState.state !== "open") {
    logLine({ type: "wish", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "outside_birthday", state: pageState.state });
    return buildResponse(403, JSON.stringify({ error: "outside_birthday", state: pageState.state }), "application/json", ctx.origin);
  }

  const { wishes, count } = parsed.body || {};
  const wishHistory = Array.isArray(wishes) ? wishes.filter((w) => typeof w === "string") : [];
  const wishCount = Math.max(1, Math.min(5, Number.isFinite(Number(count)) ? Number(count) : 1));

  let result;
  try {
    result = await ai.generateWish({
      friendName: pageState.friendName,
      tone: process.env.TONE || "warm",
      memories: JSON.parse(process.env.MEMORIES || "[]"),
      wishes: wishHistory.slice(0, 8),
      birthday: pageState.birthYmd,
      count: wishCount,
      correlationId: ctx.correlationId,
    });
  } catch (err) {
    logError(err, ctx);
    return buildResponse(500, JSON.stringify({ error: "internal_server_error" }), "application/json", ctx.origin);
  }

  const outcome = result.source === "fallback" ? "fallback" : "ok";
  logLine({
    type: "wish",
    requestId: ctx.requestId,
    ts: Date.now(),
    ip: ctx.ip,
    source: result.source,
    latencyMs: result.latencyMs,
    outcome,
  });

  return buildResponse(200, JSON.stringify({ wishes: result.wishes, source: result.source }), "application/json", ctx.origin);
}

function handleOptions(ctx) {
  // Preflight. Always return 204 with CORS headers for the matching origin.
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...corsHeadersFor(ctx.origin),
  };
  if (!headers["X-Correlation-Id"] && CURRENT_CORRELATION_ID) headers["X-Correlation-Id"] = CURRENT_CORRELATION_ID;
  return { statusCode: 204, headers, body: "" };
}

// ---------- Entry ----------

exports.handler = async (event) => {
  const ctx = getRequestContext(event);
  if (!ctx.correlationId) ctx.correlationId = crypto.randomUUID();
  CURRENT_CORRELATION_ID = ctx.correlationId;

  try {
    if (ctx.method === "OPTIONS") {
      return handleOptions(ctx);
    }
    if (ctx.method === "GET") {
      return await handleGet(ctx);
    }
    if (ctx.method === "POST") {
      if (ctx.rawPath.endsWith("/wish")) return await handlePostWish(ctx, event);
      return buildResponse(403, "Forbidden", "application/json", ctx.origin);
    }
    return buildResponse(403, "Forbidden", "application/json", ctx.origin);
  } catch (err) {
    // Catch-all so the error is logged to CloudWatch and a 500 is returned.
    logError(err, ctx);
    return buildResponse(500, JSON.stringify({ error: "internal_server_error" }), "application/json", ctx.origin);
  } finally {
    CURRENT_CORRELATION_ID = null;
  }
};
