// Birthday state machine.
//
// State is computed SERVER-SIDE from BIRTH_DATE + TIME_ZONE so the browser
// can never see personal content outside the open window.
//
//   locked  — now < 00:00 (TIME_ZONE) the day BEFORE the birthday  → countdown only
//   open    — 00:00:00–23:59:59 of the birthday day (TIME_ZONE)    → greeting + cake
//   closed  — now > 23:59:59.999 of the birthday day                → "just for birthday" page
//
// The open window starts at midnight of the day BEFORE the birthday and ends
// at 23:59:59.999 of the birthday day — so the surprise unlocks the night before.
//
// OVERRIDE_NOW (epoch ms or ISO string) replaces Date.now() for local tests.
// Never set it in production — it is read from env here, so prod has no way
// to override time unless someone explicitly deploys the variable.

function nowMs() {
  const raw = process.env.OVERRIDE_NOW;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

// Civil (wall-clock) date parts of an instant, in a named IANA timezone.
function civilPartsInTz(epochMs, timeZone) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = f.formatToParts(new Date(epochMs));
  return {
    y: Number(p.find((x) => x.type === "year").value),
    m: Number(p.find((x) => x.type === "month").value),
    d: Number(p.find((x) => x.type === "day").value),
  };
}

// Epoch ms of 00:00:00 in `timeZone` on civil date (y, m, d).
// Works regardless of the process's own timezone; tolerant of DST edges.
function midnightInTz(y, m, d, timeZone) {
  // Start from noon UTC on that civil date: its tz wall clock is always within
  // one day of midnight, never on a DST-ambiguous midnight.
  const guess = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = f.formatToParts(new Date(guess));
  const h = Number(p.find((x) => x.type === "hour").value) % 24;
  const mi = Number(p.find((x) => x.type === "minute").value);
  const s = Number(p.find((x) => x.type === "second").value);
  let ms = guess - (h * 3600 + mi * 60 + s) * 1000;
  const cp = civilPartsInTz(ms, timeZone);
  if (cp.y !== y || cp.m !== m || cp.d !== d) {
    // Crossed a day boundary (rare DST edge) — step back/forward one day.
    ms += cp.y < y || cp.m < m || cp.d < d ? 86400000 : -86400000;
  }
  return ms;
}

function parseBirthDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || "");
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function daysInMonth(y, m) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let feb = 28;
  if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) feb = 29;
  return m === 2 ? feb : days[m - 1];
}

function prevCivilDate({ y, m, d }) {
  if (d > 1) return { y, m, d: d - 1 };
  if (m > 1) return { y, m: m - 1, d: daysInMonth(y, m - 1) };
  return { y: y - 1, m: 12, d: 31 };
}

// Public: returns { state, targetMs, birthYmd } for an optional epoch override.
function computeState(epochMs = nowMs(), opts = {}) {
  const timeZone = opts.timeZone || process.env.TIME_ZONE || "UTC";
  const birth = parseBirthDate(opts.birthDate || process.env.BIRTH_DATE || "");
  if (!birth) return { state: "locked", targetMs: null, birthYmd: null, error: "bad BIRTH_DATE" };

  const nowParts = civilPartsInTz(epochMs, timeZone);
  const nowKey = nowParts.y * 10000 + nowParts.m * 100 + nowParts.d;

  // Midnight of the birthday day (start of birthday)
  const birthdayStartMs = midnightInTz(birth.y, birth.m, birth.d, timeZone);
  // Midnight of the day BEFORE the birthday (open window starts here)
  const prev = prevCivilDate(birth);
  const openStartMs = midnightInTz(prev.y, prev.m, prev.d, timeZone);
  // End of birthday day: 23:59:59.999
  const openEndMs = birthdayStartMs + 86400000 - 1;

  const birthYmd = `${birth.y}-${String(birth.m).padStart(2, "0")}-${String(birth.d).padStart(2, "0")}`;

  if (epochMs < openStartMs) {
    return { state: "locked", targetMs: openStartMs, birthYmd };
  }
  if (epochMs <= openEndMs) {
    return { state: "open", targetMs: openStartMs, birthYmd };
  }
  return { state: "closed", targetMs: openStartMs, birthYmd };
}

module.exports = { computeState, nowMs, midnightInTz, civilPartsInTz, parseBirthDate };
