// AI wish generation via the configured provider (default: Google Gemini).
// Mirrors the proven pattern from the spin-the-question project:
//   - client cached + keyed off AI_API_KEY
//   - AI_MODEL priority list (comma-separated) with round-robin fallback
//   - JSON response mode, thinking budget 0, max output tokens (cost control)
//   - retryable error detection → pre-written fallback wishes

const fallbacks = require("./fallbacks.js");

let cachedClient = null;
let modelIndex = 0;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) throw new Error("AI_API_KEY is not set");
    const { GoogleGenAI } = require("@google/genai");
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

function getModelList() {
  const envList = process.env.AI_MODEL_PRIORITIES || process.env.AI_MODEL || "gemini-2.5-flash";
  return envList.split(",").map((m) => m.trim()).filter(Boolean);
}

function getNextModelName() {
  const models = getModelList();
  if (!models.length) return "gemini-2.5-flash";
  const name = models[modelIndex % models.length];
  modelIndex++;
  return name;
}

const MAX_WISH_TOKENS = Number(process.env.AI_MAX_TOKENS || 200);

function buildWishPrompt({ friendName, tone, memories, wishes, birthday, count }) {
  const n = Math.max(1, Math.min(5, count || 1));
  const memoryBlock = Array.isArray(memories) && memories.length
    ? memories.map((mm, i) => `Memory ${i + 1}: ${mm}`).join("\n")
    : "No memories provided — keep it warm and generic.";
  const wishBlock = Array.isArray(wishes) && wishes.length
    ? `Wishes already given this visit (DO NOT repeat or near-repeat these):\n${wishes.map((w, i) => `- ${w}`).join("\n")}`
    : "No wishes yet this visit.";

  return `You are the birthday wish AI for a very special friend.
You are writing ${n === 1 ? "a" : n} personal birthday ${n === 1 ? "wish" : "wishes"}.

Friend's name: ${friendName}
Birthday: ${birthday || ""}
Tone: ${tone || "warm"}
Number of wishes to write: ${n}

True memories about this friend (only use these — never invent new ones):
${memoryBlock}

${wishBlock}

Write ${n} distinct birthday ${n === 1 ? "wish" : "wishes"} in the requested tone.
Rules:
- Use only the true memories above; never invent facts, stories, or events.
- Be personal, warm, celebratory, and kind.
- Each wish must be distinct (not a reword of another).
- Keep each under 60 words.
- Total output under 400 words.

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "wishes": ["wish one", "wish two", ...]
}`;
}

// Parse the model response as JSON.
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // Strip stray code fences just in case.
    const clean = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  }
}

async function generateWish({ friendName, tone, memories = [], wishes = [], birthday, count = 1, correlationId }) {
  const prompt = buildWishPrompt({ friendName, tone, memories, wishes, birthday, count });
  const t0 = Date.now();
  let geminiMs = 0;

  let lastError = null;
  const models = getModelList();
  const maxAttempts = models.length || 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let currentModel;
    if (attempt === 0) {
      currentModel = getNextModelName();
    } else {
      currentModel = models[(modelIndex - 1 + attempt) % models.length];
    }

    try {
      if (process.env.FORCE_FALLBACKS === "1") {
        throw new Error("FORCE_FALLBACKS is enabled");
      }

      const ai = getClient();
      const t1 = Date.now();
      const result = await ai.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: {
          maxOutputTokens: MAX_WISH_TOKENS,
          temperature: 0.9,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: {
            type: "OBJECT",
            properties: {
              wishes: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
            },
            required: ["wishes"],
            propertyOrdering: ["wishes"],
          },
        },
      });
      geminiMs = Date.now() - t1;

      const parsed = result.parsed;
      const text = typeof result.text === "function" ? result.text() : typeof result.text === "string" ? result.text : result.text?.text || "";
      const payload = parsed && Array.isArray(parsed.wishes) ? parsed : safeJsonParse(text);
      const wishList = payload && Array.isArray(payload.wishes)
        ? payload.wishes.map(function (w) { return (typeof w === "string" ? w.trim() : ""); }).filter(Boolean)
        : [];

      if (wishList.length > 0) {
        return { wishes: wishList, source: "ai", latencyMs: Date.now() - t0, geminiMs };
      }
      throw new Error("AI returned invalid response");
    } catch (err) {
      lastError = err;
      const errorStr = String(err && err.message || err).toLowerCase();
      const isRetryableError =
        errorStr.includes("quota") ||
        errorStr.includes("429") ||
        errorStr.includes("resource_exhausted") ||
        errorStr.includes("rate limit") ||
        errorStr.includes("not found") ||
        errorStr.includes("404") ||
        errorStr.includes("503") ||
        errorStr.includes("unavailable") ||
        errorStr.includes("service unavailable") ||
        errorStr.includes("high demand") ||
        errorStr.includes("temporarily") ||
        errorStr.includes("try again");

      if (!isRetryableError) break;
    }
  }

  const out = {
    type: "wish_ai_error",
    ts: Date.now(),
    error: String(lastError && lastError.message || lastError || "All models exhausted or failed"),
    stack: lastError && lastError.stack,
  };
  if (correlationId) out.correlationId = correlationId;
  console.error(JSON.stringify(out));
  const fb = fallbacks.get(process.env.TONE || "warm", count);
  return { wishes: fb, source: "fallback", latencyMs: Date.now() - t0, geminiMs };
}

module.exports = { generateWish };
