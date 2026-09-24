import { DurableObject } from "cloudflare:workers";
import { SCENARIOS, LEVELS, getScenario } from "./scenarios.js";
import { buildMessages, buildHintMessages, normalizeReply, runModel, REPLY_SCHEMA, FALLBACK_REPLY } from "./coach.js";
import { computeStats } from "./stats.js";

const MAX_MESSAGES_PER_DAY = 80;
const MAX_TEXT = 300;
const MIN_TURNS_TO_COMPLETE = 4; // finishing after this many messages counts even if the goal wasn't detected

// ---------- Router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

    try {
      if (url.pathname === "/api/stats" && request.method === "GET") return stats(request, url, env);

      const userId = request.headers.get("X-User-Id") || "";
      if (!/^[A-Za-z0-9-]{8,64}$/.test(userId)) return json({ error: "Missing or invalid user id." }, 400);
      const dayHeader = request.headers.get("X-Local-Day") || "";
      const day = /^\d{4}-\d{2}-\d{2}$/.test(dayHeader) ? dayHeader : new Date().toISOString().slice(0, 10);

      const user = env.USER.get(env.USER.idFromName(userId));
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const ctx = { userId, day };

      switch (`${request.method} ${url.pathname}`) {
        case "GET /api/state":
          return json(await user.getState(ctx));
        case "POST /api/level":
          return json(await user.setLevel(ctx, body.level));
        case "POST /api/start":
          return json(await user.start(ctx, body.scenarioId));
        case "POST /api/message":
          return json(await user.message(ctx, body.text, body.mode));
        case "POST /api/hint":
          return json(await user.hint(ctx));
        case "POST /api/finish":
          return json(await user.finish(ctx));
        case "POST /api/rate":
          return json(await user.rate(ctx, body.helpful));
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      const status = err instanceof UserError ? 400 : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 400 ? err.message : "Something went wrong. Try again." }, status);
    }
  },
};

async function stats(request, url, env) {
  if (!env.STATS_KEY) return json({ error: "Set STATS_KEY with `npx wrangler secret put STATS_KEY` first." }, 503);
  const key = url.searchParams.get("key") || (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (key !== env.STATS_KEY) return json({ error: "Wrong stats key." }, 401);
  const store = env.STATS.get(env.STATS.idFromName("global"));
  return json(await store.summary(new Date().toISOString().slice(0, 10)));
}

class UserError extends Error {}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// ---------- One Durable Object per learner: profile, current conversation, progress ----------
export class UserDO extends DurableObject {
  async load() {
    const s = this.ctx.storage;
    const [profile, session, progress] = await Promise.all([s.get("profile"), s.get("session"), s.get("progress")]);
    return {
      profile: profile || { level: null },
      session: session || null,
      progress: progress || { completed: {}, practiceDays: [] },
    };
  }

  async log(ctx, type, scenario = null, meta = {}) {
    const statsStore = this.env.STATS.get(this.env.STATS.idFromName("global"));
    await statsStore.log({ user_id: ctx.userId, type, scenario, day: ctx.day, meta });
  }

  async getState(ctx) {
    const { profile, session, progress } = await this.load();
    const lastVisit = await this.ctx.storage.get("lastVisitDay");
    if (lastVisit !== ctx.day) {
      await this.ctx.storage.put("lastVisitDay", ctx.day);
      await this.log(ctx, "visit");
    }
    return {
      level: profile.level,
      levels: Object.keys(LEVELS),
      scenarios: SCENARIOS.map(({ id, badge, title, who, situation, goal }) => ({
        id, badge, title, who, situation, goal, completed: progress.completed[id] || 0,
      })),
      daysPracticed: progress.practiceDays.length,
      practicedToday: progress.practiceDays.includes(ctx.day),
      activeSession: session && !session.finished ? publicSession(session) : null,
    };
  }

  async setLevel(ctx, level) {
    if (!LEVELS[level]) throw new UserError("Pick one of the listed levels.");
    const { profile } = await this.load();
    await this.ctx.storage.put("profile", { ...profile, level });
    await this.log(ctx, "set_level", null, { level });
    return { level };
  }

  async start(ctx, scenarioId) {
    const scenario = getScenario(scenarioId);
    if (!scenario) throw new UserError("That scenario doesn't exist.");
    const session = {
      id: crypto.randomUUID(),
      scenarioId,
      turns: [{ role: "them", vi: scenario.opener.vi, en: scenario.opener.en }],
      userTurns: 0,
      goalMet: false,
      completed: false,
      finished: false,
    };
    await this.ctx.storage.put("session", session);
    await this.log(ctx, "scenario_start", scenarioId, { session: session.id });
    return publicSession(session);
  }

  async message(ctx, text, mode) {
    text = String(text || "").trim().slice(0, MAX_TEXT);
    if (!text) throw new UserError("Say or type something first.");
    const { profile, session, progress } = await this.load();
    if (!session || session.finished) throw new UserError("Start a scenario first.");

    const countKey = `count:${ctx.day}`;
    const count = (await this.ctx.storage.get(countKey)) || 0;
    if (count >= MAX_MESSAGES_PER_DAY) throw new UserError("You've hit today's practice limit. Come back tomorrow!");
    await this.ctx.storage.put(countKey, count + 1);

    const scenario = getScenario(session.scenarioId);
    const history = [...session.turns, { role: "me", text }];
    let result;
    try {
      result = normalizeReply(await runModel(this.env.AI, buildMessages(scenario, profile.level, history), REPLY_SCHEMA));
    } catch (err) {
      console.error("AI error", err);
      result = { ...FALLBACK_REPLY };
    }

    session.turns = [
      ...history.slice(0, -1),
      { role: "me", text, mode: mode === "voice" ? "voice" : "text", feedback: result.feedback },
      { role: "them", vi: result.reply, en: result.reply_en },
    ];
    session.userTurns++;

    if (!progress.practiceDays.includes(ctx.day)) progress.practiceDays.push(ctx.day);
    const justMetGoal = result.goal_met && !session.goalMet;
    if (result.goal_met) session.goalMet = true;
    if (justMetGoal && !session.completed) {
      session.completed = true;
      progress.completed[scenario.id] = (progress.completed[scenario.id] || 0) + 1;
      await this.log(ctx, "scenario_complete", scenario.id, { session: session.id, via: "goal", turns: session.userTurns });
    }

    await this.ctx.storage.put({ session, progress });
    await this.log(ctx, "message", scenario.id, {
      session: session.id, mode: mode === "voice" ? "voice" : "text", status: result.feedback.status, fallback: !!result.fallback,
    });

    return {
      feedback: result.feedback,
      reply: { vi: result.reply, en: result.reply_en },
      goalMet: session.goalMet,
      justMetGoal,
    };
  }

  async hint(ctx) {
    const { session } = await this.load();
    if (!session || session.finished) throw new UserError("Start a scenario first.");
    const scenario = getScenario(session.scenarioId);
    let hint = null;
    try {
      hint = await runModel(this.env.AI, buildHintMessages(scenario, session.turns));
    } catch (err) {
      console.error("AI hint error", err);
    }
    if (!hint || typeof hint.vi !== "string") hint = { vi: "Dạ, con hiểu rồi.", en: "Yes, I understand." };
    await this.log(ctx, "hint", scenario.id, { session: session.id });
    return { vi: String(hint.vi).slice(0, 200), en: String(hint.en || "").slice(0, 200) };
  }

  async finish(ctx) {
    const { session, progress } = await this.load();
    if (!session || session.finished) throw new UserError("There's no conversation to finish.");
    const scenario = getScenario(session.scenarioId);

    if (!session.completed && session.userTurns >= MIN_TURNS_TO_COMPLETE) {
      session.completed = true;
      progress.completed[scenario.id] = (progress.completed[scenario.id] || 0) + 1;
      await this.log(ctx, "scenario_complete", scenario.id, { session: session.id, via: "finish", turns: session.userTurns });
    }
    session.finished = true;
    await this.ctx.storage.put({ session, progress });
    await this.log(ctx, "session_end", scenario.id, { session: session.id, turns: session.userTurns, completed: session.completed });

    // Phrases to remember: every correction the coach gave, so the summary costs no extra model call.
    const phrases = session.turns
      .filter((t) => t.role === "me" && t.feedback && t.feedback.better)
      .map((t) => ({ said: t.text, better: t.feedback.better, note: t.feedback.note_en }));
    const next = SCENARIOS.find((s) => !progress.completed[s.id] && s.id !== scenario.id) || null;

    return {
      title: scenario.title,
      completed: session.completed,
      goalMet: session.goalMet,
      messages: session.userTurns,
      phrases,
      daysPracticed: progress.practiceDays.length,
      next: next ? { id: next.id, title: next.title } : null,
    };
  }

  async rate(ctx, helpful) {
    await this.log(ctx, "rating", null, { helpful: !!helpful });
    return { ok: true };
  }
}

function publicSession(session) {
  const scenario = getScenario(session.scenarioId);
  return {
    scenario: { id: scenario.id, title: scenario.title, who: scenario.who, situation: scenario.situation, goal: scenario.goal },
    turns: session.turns,
    goalMet: session.goalMet,
    userTurns: session.userTurns,
  };
}

// ---------- One global Durable Object that stores events for metrics ----------
export class StatsDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      scenario TEXT,
      day TEXT NOT NULL,
      ts INTEGER NOT NULL,
      meta TEXT
    )`);
  }

  async log({ user_id, type, scenario, day, meta }) {
    this.ctx.storage.sql.exec(
      "INSERT INTO events (user_id, type, scenario, day, ts, meta) VALUES (?, ?, ?, ?, ?, ?)",
      user_id, type, scenario, day, Date.now(), JSON.stringify(meta || {}),
    );
  }

  async summary(today) {
    const rows = this.ctx.storage.sql.exec("SELECT user_id, type, scenario, day, meta FROM events ORDER BY ts").toArray();
    return computeStats(rows, today);
  }
}
