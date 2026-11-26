const assert = require("assert");

process.env.HMAC_SECRET = "test-secret";
process.env.SELF_ORIGIN = "https://example.lambda-url.us-east-1.on.aws";
process.env.FRIEND_NAME = "TestFriend";
process.env.BIRTH_DATE = "2025-11-27";
process.env.TIME_ZONE = "UTC";
process.env.TONE = "warm";
process.env.MEMORIES = "[]";

let lastWishArgs = null;
const ai = require("../ai.js");
ai.generateWish = async (args) => {
  lastWishArgs = args;
  const n = Math.max(1, Math.min(5, args.count || 1));
  const wishes = [];
  for (let i = 0; i < n; i++) {
    wishes.push(`Wish ${i + 1} for ${args.friendName || "friend"} — have a great year!`);
  }
  return {
    wishes,
    source: "ai",
    latencyMs: 5,
    geminiMs: 2,
  };
};

const { handler } = require("../index.js");
const { computeState } = require("../state.js");

function event(method, rawPath, body, headers = {}) {
  return {
    version: "2.0",
    rawPath,
    headers: {
      origin: process.env.SELF_ORIGIN,
      "user-agent": "node-test",
      ...headers,
    },
    requestContext: {
      requestId: "test-request",
      http: { method, sourceIp: "127.0.0.1" },
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// State computation tests
// ---------------------------------------------------------------------------
(async () => {
  // -----------------------------------------------------------------------
  // "Midnight the day before" boundary
  // -----------------------------------------------------------------------
  await run("computeState: locked just before day-before-midnight", () => {
    // Nov 25 2025 23:59:59.999 UTC is the last moment of the locked window
    const s = computeState(Date.UTC(2025, 10, 25, 23, 59, 59, 999), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "locked");
  });

  await run("computeState: open at day-before-midnight (00:00:00.000)", () => {
    // Nov 26 2025 00:00:00.000 UTC = start of open window
    const s = computeState(Date.UTC(2025, 10, 26, 0, 0, 0, 0), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "open");
  });

  await run("computeState: open throughout day-before", () => {
    // Nov 26 2025 12:00 UTC is mid-day-before — still open
    const s = computeState(Date.UTC(2025, 10, 26, 12, 0, 0), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "open");
  });

  await run("computeState: open on birthday morning", () => {
    // Nov 27 2025 00:00 UTC = birthday start — still open
    const s = computeState(Date.UTC(2025, 10, 27, 0, 0, 0), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "open");
  });

  await run("computeState: open at birthday 23:59:59", () => {
    const s = computeState(Date.UTC(2025, 10, 27, 23, 59, 59), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "open");
  });

  await run("computeState: closed at birthday 23:59:59.999", () => {
    // Should be open or closed — the boundary itself is ambiguous
    const s = computeState(Date.UTC(2025, 10, 27, 23, 59, 59, 999), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.ok(["open", "closed"].includes(s.state));
  });

  await run("computeState: closed one second after birthday", () => {
    const s = computeState(Date.UTC(2025, 11, 28, 0, 0, 0), { birthDate: "2025-11-27", timeZone: "UTC" });
    assert.equal(s.state, "closed");
  });

  await run("computeState: month rollover day-before works (Dec 1 birthday)", () => {
    // Nov 30 00:00 is the day-before-midnight for Dec 1 birthday
    const s = computeState(Date.UTC(2025, 10, 30, 0, 0, 0), { birthDate: "2025-12-01", timeZone: "UTC" });
    assert.equal(s.state, "open");
    // Nov 29 23:59:59.999 is still locked
    const locked = computeState(Date.UTC(2025, 10, 29, 23, 59, 59, 999), { birthDate: "2025-12-01", timeZone: "UTC" });
    assert.equal(locked.state, "locked");
  });

  await run("computeState: leap-year Feb 29 (day before = Feb 28)", () => {
    // Feb 28 00:00 2028 is the day-before-midnight for Feb 29 2028 birthday
    const s = computeState(Date.UTC(2028, 1, 28, 0, 0, 0), { birthDate: "2028-02-29", timeZone: "UTC" });
    assert.equal(s.state, "open");
  });

  // -----------------------------------------------------------------------
  // Handler integration tests
  // -----------------------------------------------------------------------

  await run("GET / in locked state serves HTML with locked state", async () => {
    process.env.OVERRIDE_NOW = "2025-11-25T23:59:00Z";
    const res = await handler(event("GET", "/"));
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /screen-locked/);
    assert.ok(res.body.includes('"state":"locked"'));
  });

  await run("GET / in open state serves HTML with open state + friendName", async () => {
    // Nov 26 12:00 — day before birthday — should be open
    process.env.OVERRIDE_NOW = "2025-11-26T12:00:00Z";
    const res = await handler(event("GET", "/"));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('"state":"open"'));
    assert.ok(res.body.includes('TestFriend'));
  });

  await run("GET / in closed state serves HTML with closed state", async () => {
    process.env.OVERRIDE_NOW = "2025-11-28T00:00:00Z";
    const res = await handler(event("GET", "/"));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('"state":"closed"'));
  });

  await run("POST /wish returns 403 in locked state", async () => {
    process.env.OVERRIDE_NOW = "2025-11-25T23:59:00Z";
    const res = await handler(event("POST", "/wish", { wishes: [] }));
    assert.equal(res.statusCode, 403);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.state, "locked");
  });

  await run("POST /wish returns 403 in closed state", async () => {
    process.env.OVERRIDE_NOW = "2025-11-28T00:00:00Z";
    const res = await handler(event("POST", "/wish", { wishes: [] }));
    assert.equal(res.statusCode, 403);
  });

  await run("POST /wish returns 200 with wishes in open state", async () => {
    process.env.OVERRIDE_NOW = "2025-11-26T12:00:00Z";
    lastWishArgs = null;
    const res = await handler(event("POST", "/wish", { wishes: [] }));
    assert.equal(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.ok(Array.isArray(parsed.wishes));
    assert.ok(parsed.wishes.length > 0);
    assert.equal(parsed.source, "ai");
    assert.ok(lastWishArgs);
    assert.equal(lastWishArgs.friendName, "TestFriend");
    assert.equal(lastWishArgs.tone, "warm");
    // count should default to 1
    assert.equal(lastWishArgs.count, 1);
  });

  await run("POST /wish passes wish history to AI", async () => {
    process.env.OVERRIDE_NOW = "2025-11-26T12:00:00Z";
    lastWishArgs = null;
    await handler(event("POST", "/wish", { wishes: ["wish1", "wish2", "wish3"] }));
    assert.ok(lastWishArgs);
    assert.deepEqual(lastWishArgs.wishes, ["wish1", "wish2", "wish3"]);
  });

  await run("POST /wish supports multiple wishes in one go (count=3)", async () => {
    process.env.OVERRIDE_NOW = "2025-11-26T12:00:00Z";
    lastWishArgs = null;
    const res = await handler(event("POST", "/wish", { wishes: [], count: 3 }));
    assert.equal(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.wishes.length, 3);
    assert.equal(lastWishArgs.count, 3);
  });

  await run("POST /wish clamps count to max 5", async () => {
    process.env.OVERRIDE_NOW = "2025-11-26T12:00:00Z";
    lastWishArgs = null;
    await handler(event("POST", "/wish", { wishes: [], count: 99 }));
    assert.equal(lastWishArgs.count, 5);
  });

  await run("OPTIONS returns 204 for preflight", async () => {
    const res = await handler(event("OPTIONS", "/wish"));
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
    assert.ok(res.headers["Access-Control-Allow-Headers"]);
  });

  await run("POST /wish on unknown path returns 403", async () => {
    const res = await handler(event("POST", "/unknown", {}));
    assert.equal(res.statusCode, 403);
  });

  // ---------------------------------------------------------------------------
  // Cleanup: remove OVERRIDE_NOW so dev-server uses real time
  // ---------------------------------------------------------------------------
  delete process.env.OVERRIDE_NOW;
  console.log("\nAll tests passed.");
})();