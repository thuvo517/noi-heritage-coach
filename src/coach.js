import { LANGUAGE, LEVELS } from "./scenarios.js";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const STATUSES = ["great", "small_fix", "try_again"];

export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    reply_en: { type: "string" },
    feedback: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES },
        better: { type: "string" },
        note_en: { type: "string" },
      },
      required: ["status", "better", "note_en"],
    },
    goal_met: { type: "boolean" },
  },
  required: ["reply", "reply_en", "feedback", "goal_met"],
};

export function buildMessages(scenario, level, turns) {
  const system = `${scenario.character}

Setting: ${scenario.situation}
The learner is a heritage speaker of ${LANGUAGE.name}: they grew up hearing it at home. ${LEVELS[level] || LEVELS.freeze}
Dialect: ${LANGUAGE.dialect}. Stay in character and speak only ${LANGUAGE.name} in "reply".
The learner's goal in this conversation: ${scenario.goal}

For every learner message, respond with ONLY a JSON object, no other text:
{
  "reply": "your in-character response in ${LANGUAGE.name}, 1-2 short sentences, ending with something that invites them to keep talking",
  "reply_en": "an English translation of reply",
  "feedback": {
    "status": "great" if their message was natural and correct, "small_fix" if it was understandable with mistakes or English words, "try_again" if you could not understand it,
    "better": "a more natural way a native speaker would say what THEY meant, in ${LANGUAGE.name}; empty string if status is great",
    "note_en": "one short, kind sentence in English explaining the fix or praising what worked"
  },
  "goal_met": true only once the learner has fully done the goal above
}
If they write in English, reply in character as if a relative heard them mix languages, and put the ${LANGUAGE.name} version in "better".
Never correct tone marks or spelling harshly: speech-to-text often drops them. Focus on word choice, grammar, and politeness (pronouns like con, cháu, em, ông, bà).`;

  const messages = [{ role: "system", content: system }];
  for (const t of turns) {
    if (t.role === "them") messages.push({ role: "assistant", content: JSON.stringify({ reply: t.vi, reply_en: t.en }) });
    else messages.push({ role: "user", content: t.text });
  }
  return messages;
}

export function buildHintMessages(scenario, turns) {
  const last = [...turns].reverse().find((t) => t.role === "them");
  return [
    {
      role: "system",
      content: `You help a heritage speaker of ${LANGUAGE.name} (${LANGUAGE.dialect}) who is stuck in a conversation.
Situation: ${scenario.situation} Their goal: ${scenario.goal}
Respond with ONLY JSON: {"vi": "one short, natural sentence they could say next", "en": "its English meaning"}`,
    },
    { role: "user", content: `The other person just said: "${last ? last.vi : scenario.opener.vi}"` },
  ];
}

// Workers AI can return an object (JSON mode) or a string that may contain extra text.
export function parseModelJSON(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Deterministic fallback: the conversation never breaks, even if the model fails or returns junk.
export const FALLBACK_REPLY = {
  reply: "Xin lỗi, nói lại được không?",
  reply_en: "Sorry, could you say that again?",
  feedback: { status: "try_again", better: "", note_en: "The coach couldn't respond just now. Try saying it again." },
  goal_met: false,
  fallback: true,
};

export function normalizeReply(parsed) {
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) return { ...FALLBACK_REPLY };
  const fb = parsed.feedback && typeof parsed.feedback === "object" ? parsed.feedback : {};
  const status = STATUSES.includes(fb.status) ? fb.status : "small_fix";
  return {
    reply: parsed.reply.trim().slice(0, 400),
    reply_en: typeof parsed.reply_en === "string" ? parsed.reply_en.trim().slice(0, 400) : "",
    feedback: {
      status,
      better: status === "great" ? "" : String(fb.better || "").trim().slice(0, 300),
      note_en: String(fb.note_en || "").trim().slice(0, 300),
    },
    goal_met: parsed.goal_met === true,
    fallback: false,
  };
}

export async function runModel(ai, messages, schema) {
  const base = { messages, max_tokens: 400, temperature: 0.6 };
  try {
    const out = await ai.run(MODEL, schema ? { ...base, response_format: { type: "json_schema", json_schema: schema } } : base);
    return parseModelJSON(out?.response);
  } catch (err) {
    if (!schema) throw err;
    // JSON mode can fail on some inputs; retry once as plain text and parse it ourselves.
    const out = await ai.run(MODEL, base);
    return parseModelJSON(out?.response);
  }
}
