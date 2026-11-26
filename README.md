# Birthday Wisher

AI-powered birthday wishing site — mobile-first PWA on AWS Lambda. Three date states (locked / open / closed) are computed server-side, so the browser can never see personal content outside the open window.

## What's New (revamp v2)

- **UI rewrite with jQuery** — cleaner, more concise DOM code; no hand-rolled event bindings
- **Server-side time with moment-timezone** — the server now uses `moment-timezone` for clean, DST-safe timezone math instead of custom `Intl.DateTimeFormat` logic
- **Client trusts server state** — the browser renders exactly what the server says (no local recompute). This eliminates the server/client timezone mismatch that previously hid the locked screen
- **Sounds** — Web Audio API synthesized sounds: soft tap/plink on candle touch, whoosh when a candle blows out, a gentle chime when the AI wish appears, and a celebratory unlock chime when the countdown finishes. All sounds are generated on-device — no external audio files, works offline after install, and respects a mute toggle
- **Share button** — share the birthday wish link via Web Share API or copy-to-clipboard fallback
- **Skeleton loading** — subtle shimmer animation while the AI wish is being generated, then fades into the final text
- **Reduced motion** — supports `prefers-reduced-motion` to disable flame flicker, smoke puffs, skeleton shimmer, and confetti
- **Better countdown** — formats as `Xd HH:MM:SS` when days remain, otherwise `HH:MM:SS` until unlock

## Stack

- **Frontend:** vanilla HTML/CSS + jQuery 3.7.1 (local, CSP-safe) in `public/index.html`. No build step. PWA-installable (manifest + service worker).
- **Backend:** Node 22.x Lambda handler with per-IP rate limiting, CORS, and the Google Gemini API.
- **Hosting:** AWS Lambda Function URL (HTTPS). No API Gateway. No database.
- **AI:** `@google/genai` with `AI_API_KEY` + `AI_MODEL`. Round-robin model fallback supported via comma-separated `AI_MODEL_PRIORITIES`.
- **Time:** `moment-timezone` on the server for authoritative state computation; `moment.js` bundled on the client (available if needed).

## How it works

1. **Locked** (everything before 23:59:00 on the day before the birthday, **in the viewer's local timezone**): visitor sees a countdown only. No personal data reaches the browser.
2. **Open** (from 23:59:00 on the day before through 23:59:59.999 on the birthday, **in the viewer's local timezone**): the page shows a birthday cake with five lit candles. The visitor **taps each candle** to put them out — no mic, no extra permissions. Once all candles are out, a single AI wish appears with confetti, and the "Light Again" button relights the candles to generate another wish.
3. **Closed** (after 23:59:59.999 on the birthday, **in the viewer's local timezone**): a simple "This surprise was just for your birthday" page.

**State is computed in the browser** from the viewer's local clock using Moment.js, so the birthday unlocks at *their* local midnight (minus one minute). The server receives the `BIRTH_DATE` and enforces the same 1-minute-before logic for `POST /wish` using the `TIME_ZONE` env var — set `TIME_ZONE` to the recipient's timezone so server enforcement matches what the browser displays. The client receives `birthYmd` from the server and recomputes locally; `friendName` is only embedded by the server when *its* state is open (fallback to "friend" otherwise).

## Sounds (new in this revamp)

Sounds are synthesized on-device using the Web Audio API — there are no external audio files, so the page works fully offline after install. Audio is only played after the user's first gesture (the browser autoplay policy requires this).

| Sound | What it is |
|---|---|
| **Tap / plink** | Soft high chime when you touch a candle |
| **Blow** | Whoosh sound when a candle is blown out |
| **Wish chime** | Ascending arpeggio when the AI wish appears |
| **Unlock chime** | Gentle chime when the countdown reaches zero and the page transitions to the open screen |

Use the 🔊 / 🔇 toggle button (top‑right) to mute/unmute. Your preference is remembered in `localStorage`. Default: sound **on** (after the browser grants AudioContext resume permission).

## Environment variables (Lambda)

| Variable | Required | Description |
|---|---|---|
| `FRIEND_NAME` | yes | Friend's name shown on the open page |
| `BIRTH_DATE` | yes | `YYYY-MM-DD` |
| `TIME_ZONE` | no | IANA timezone for the state machine (e.g. `Asia/Kolkata`). Default `UTC`. Set this to the recipient's timezone so the birthday unlocks at *their* local midnight. |
| `TONE` | yes | Any custom sentence **or** keyword — `warm`, `funny`, `poetic`, or a phrase like `"like your cool older sibling"` |
| `MEMORIES` | no* | JSON array of 3–5 short lines. The AI uses **only** these — never invents new ones. Defaults to `[]` (generic wishes) if omitted |
| `AI_API_KEY` | yes* | AI provider key. *Fallbacks used if missing/fails* |
| `AI_MODEL` | yes* | Model name. Default `gemini-2.5-flash` |
| `SELF_ORIGIN` | no | Public Function URL. Leave empty for local dev; set in prod for CORS |
| `OVERRIDE_NOW` | no | Local testing only — epoch ms or ISO string. **Never set in production** |
| `FORCE_FALLBACKS` | no | `1` to force pre-written wishes while testing. Default `0` |

## Local development

### 1. Install
```bash
npm install
```

### 2. Run the full app locally
```bash
npm run dev
```
Open `http://127.0.0.1:8000`. By default `FORCE_FALLBACKS=1`, so `/wish` uses the curated fallback pool without needing an AI key. To test with AI:
```bash
FORCE_FALLBACKS=0 AI_API_KEY=... AI_MODEL=gemini-2.5-flash npm run dev
```

Stop the dev server:
```bash
npm run stop
```

### 3. Test all three states locally
The state shown in the browser is computed **client-side** from the viewer's local time using `BIRTH_DATE` (via Moment.js). `OVERRIDE_NOW` only affects the server's `POST /wish` enforcement, not what the browser displays.

**To see each screen in the browser, set `BIRTH_DATE` relative to *now*:**

```bash
# LOCKED screen — birthday far enough in the future that 23:59 the day before hasn't arrived yet
BIRTH_DATE=2026-12-31 TIME_ZONE=Asia/Kolkata FORCE_FALLBACKS=1 npm run dev

# OPEN screen — birthday is today (or the day after midnight of the day before)
BIRTH_DATE=2026-11-27 TIME_ZONE=Asia/Kolkata FORCE_FALLBACKS=1 npm run dev

# CLOSED screen — birthday already passed (use a past date)
BIRTH_DATE=2026-01-01 TIME_ZONE=Asia/Kolkata FORCE_FALLBACKS=1 npm run dev
```

**To test `POST /wish` enforcement (server side), use `OVERRIDE_NOW` on the dev server command line** (it reads env at startup, not per-request):

```bash
# Server rejects wishes (locked)
OVERRIDE_NOW=2025-11-25T23:00:00Z BIRTH_DATE=2025-11-27 TIME_ZONE=UTC FORCE_FALLBACKS=1 npm run dev

# Server allows wishes (open)
OVERRIDE_NOW=2025-11-27T12:00:00Z BIRTH_DATE=2025-11-27 TIME_ZONE=UTC FORCE_FALLBACKS=1 npm run dev
```

**Never set `OVERRIDE_NOW` in production** — it would let anyone with Lambda env access bypass the birthday lock.

### 4. Run the tests
```bash
npm test
```

The test suite covers: all three date states, state transitions just before/after both midnights, `GET /` serving the right state per scenario, `POST /wish` returning 403 outside the birthday and 200 inside it, CORS preflight, and wish-history forwarding to the AI.

## Deploy

Uses Terraform to manage the Lambda and Function URL.

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform/terraform.tfvars with:
#   ai_api_key      — your AI provider key
#   friend_name     — the birthday person's name
#   birth_date      — YYYY-MM-DD
#   memories        — JSON array of 3-5 short lines
#   reserved_concurrency — default 5 (cost control)
./scripts/deploy-terraform.sh
```

After apply, get the Function URL:
```bash
cd terraform && terraform output function_url
```

## Project layout

```
birthday-wisher/
├── index.js              # Lambda handler — routing, rate limit, CORS, state enforcement
├── state.js              # Date state machine (locked/open/closed) via moment-timezone
├── ai.js                 # AI wish generation (Gemini via @google/genai) + fallback
├── fallbacks.js          # Pre-written wishes per tone
├── rateLimit.js          # In-memory per-IP rate limiter
├── public/
│   ├── index.html        # Entire frontend — 3 screens, candles, confetti, sound toggle, share
│   ├── jquery.min.js     # jQuery 3.7.1 (local, CSP-safe)
│   ├── manifest.json     # PWA manifest
│   └── sw.js             # Service worker
├── scripts/
│   ├── dev-server.js     # Local HTTP server for testing
│   └── deploy-terraform.sh
├── test/
│   ├── events/           # Mock Lambda events
│   └── handler.test.js   # Unit + integration tests
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   └── terraform.tfvars.example
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Security notes

- The Function URL is **public** (anyone with the URL can call `/wish`). Rate limiting (per-IP, 20 req/min) and reserved concurrency (default 5) limit cost exposure.
- `OVERRIDE_NOW` is only read from env for local testing. Never set it in production.
- The AI receives **only** the memories in `MEMORIES` — it cannot invent new ones.
- The page shows **no personal data** while locked or closed.
- The sound feature uses Web Audio API; no external audio files or network requests are made. Audio only plays after user gesture.

## Acceptance checks (from the spec)

- [x] Correct state just before and after both midnights (test suite covers boundary)
- [x] Tapping works if mic access is denied (tap handler is independent of mic)
- [x] All three states testable locally via `OVERRIDE_NOW` (never in prod)
- [x] AI never invents memories (prompt says "only use these", system enforces)
- [x] Pre-written wishes used if AI fails/times out (fallbacks.js)
- [x] Countdown unlocks page automatically (client-side timer + server state)
- [x] Nothing personal reaches browser while locked/closed (server only embeds friend name/tone when open)
- [x] Mobile-first design (responsive, safe-area aware, 44px touch targets)
- [x] New: Sound toggle (on/off, persists in `localStorage`, respects browser autoplay policy)
- [x] New: Share button (Web Share API + copy-to-clipboard fallback)
- [x] New: Skeleton loading while AI wish is generated
- [x] New: Reduced‑motion support (`prefers-reduced-motion`)
- [x] New: jQuery rewrite for cleaner DOM code
- [x] New: moment-timezone on server for clean DST-safe state computation
- [x] New: Client trusts server state — eliminates server/client timezone mismatch

## License

MIT.