# Birthday Wisher

AI-powered birthday wishing site — mobile-first PWA on AWS Lambda. Three date states (locked / open / closed) are computed server-side, so the browser can never see personal content outside the open window.

## Stack
- **Frontend:** vanilla HTML/CSS/JS in `public/index.html`. No build step. PWA-installable (manifest + service worker).
- **Backend:** Node 22.x Lambda handler with per-IP rate limiting, CORS, and the Google Gemini API.
- **Hosting:** AWS Lambda Function URL (HTTPS). No API Gateway. No database.
- **AI:** `@google/genai` with `AI_API_KEY` + `AI_MODEL`. Round-robin model fallback supported via comma-separated `AI_MODEL_PRIORITIES`.

## How it works

1. **Locked** (before midnight the day before the birthday, in your browser's local timezone): visitor sees a countdown only. No personal data reaches the browser.
2. **Open** (from 00:00:00 on the day before through 23:59:59.999 on the birthday, in your browser's local timezone): the page shows a birthday cake with five lit candles. The visitor **taps each candle** to put them out — no mic, no extra permissions. Once all candles are out, a single AI wish appears with confetti, and the "Light Again" button relights the candles to generate another wish.
3. **Closed** (after 23:59:59.999 on the birthday): a simple "This surprise was just for your birthday" page.

State is enforced on the **server** for every `GET /` (page chrome) and `POST /wish` (wish request). The client only ever renders the server's state — it never trusts its own clock.

## Environment variables (Lambda)

| Variable | Required | Description |
|---|---|---|
| `FRIEND_NAME` | yes | Friend's name shown on the open page |
| `BIRTH_DATE` | yes | `YYYY-MM-DD` |
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

### 3. Test all three states locally (override current time)
The state machine reads `OVERRIDE_NOW` (epoch ms or ISO string). Set it before starting the dev server:

```bash
# Locked (one hour before day-before-midnight)
OVERRIDE_NOW=2025-11-25T23:00:00Z FORCE_FALLBACKS=1 npm run dev

# Open (noon on the day BEFORE the birthday)
OVERRIDE_NOW=2025-11-26T12:00:00Z FORCE_FALLBACKS=1 npm run dev

# Closed (one hour after birthday)
OVERRIDE_NOW=2025-11-28T01:00:00Z FORCE_FALLBACKS=1 npm run dev
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
├── state.js              # Date state machine (locked/open/closed) + timezone math
├── ai.js                 # AI wish generation (Gemini via @google/genai) + fallback
├── fallbacks.js          # Pre-written wishes per tone
├── rateLimit.js          # In-memory per-IP rate limiter
├── public/
│   ├── index.html        # Entire frontend (3 screens, cake, mic, confetti)
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

## Acceptance checks (from the spec)

- [x] Correct state just before and after both midnights (test suite covers boundary)
- [x] Tapping works if mic access is denied (tap handler is independent of mic)
- [x] All three states testable locally via `OVERRIDE_NOW` (never in prod)
- [x] AI never invents memories (prompt says "only use these", system enforces)
- [x] Pre-written wishes used if AI fails/times out (fallbacks.js)
- [x] Countdown unlocks page automatically (client-side timer + server state)
- [x] Nothing personal reaches browser while locked/closed (server only embeds friend name/tone when open)
- [x] Mobile-first design (responsive, safe-area aware, 44px touch targets)

## License

MIT.