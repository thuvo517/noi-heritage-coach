import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJSON, normalizeReply, buildMessages, FALLBACK_REPLY } from "../src/coach.js";
import { computeStats } from "../src/stats.js";
import { SCENARIOS } from "../src/scenarios.js";

test("parses JSON wrapped in extra text", () => {
  const out = parseModelJSON('Sure! {"reply":"Dạ","reply_en":"Yes","feedback":{"status":"great","better":"","note_en":"Nice"},"goal_met":false} hope that helps');
  assert.equal(out.reply, "Dạ");
});

test("accepts an object from JSON mode", () => {
  assert.equal(parseModelJSON({ reply: "x" }).reply, "x");
});

test("garbage falls back deterministically", () => {
  assert.equal(parseModelJSON("no json here"), null);
  assert.deepEqual(normalizeReply(null), { ...FALLBACK_REPLY });
  assert.equal(normalizeReply({ reply: "   " }).fallback, true);
});

test("normalizes bad status and clears 'better' when great", () => {
  const a = normalizeReply({ reply: "Ừ", feedback: { status: "weird", better: "Dạ", note_en: "" } });
  assert.equal(a.feedback.status, "small_fix");
  const b = normalizeReply({ reply: "Ừ", feedback: { status: "great", better: "should drop" } });
  assert.equal(b.feedback.better, "");
  assert.equal(b.goal_met, false);
});

test("builds a conversation with system prompt and history", () => {
  const s = SCENARIOS[0];
  const msgs = buildMessages(s, "freeze", [{ role: "them", vi: s.opener.vi, en: s.opener.en }, { role: "me", text: "Dạ con khỏe" }]);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs.at(-1).content, "Dạ con khỏe");
  assert.equal(msgs[1].role, "assistant");
});

const ev = (user_id, type, day, scenario = null, meta = {}) => ({ user_id, type, day, scenario, meta: JSON.stringify(meta) });

test("computes funnel, retention, and second-scenario metrics", () => {
  const events = [
    // User A: completes day 1, second completion day 3, visits day 3
    ev("A", "visit", "2026-09-01"),
    ev("A", "scenario_start", "2026-09-01", "call-grandma", { session: "a1" }),
    ev("A", "message", "2026-09-01", "call-grandma", { session: "a1", mode: "voice", status: "great" }),
    ev("A", "scenario_complete", "2026-09-01", "call-grandma"),
    ev("A", "scenario_start", "2026-09-03", "order-pho", { session: "a2" }),
    ev("A", "message", "2026-09-03", "order-pho", { session: "a2", mode: "text", status: "small_fix" }),
    ev("A", "scenario_complete", "2026-09-03", "order-pho"),
    // User B: completes once, never returns
    ev("B", "scenario_start", "2026-09-02", "call-grandma", { session: "b1" }),
    ev("B", "scenario_complete", "2026-09-02", "call-grandma"),
    ev("B", "rating", "2026-09-02", null, { helpful: true }),
    // User C: only visits
    ev("C", "visit", "2026-09-20"),
  ];
  const s = computeStats(events, "2026-09-23");
  assert.equal(s.users.total, 3);
  assert.equal(s.users.started_a_scenario, 2);
  assert.equal(s.users.returned_within_7_days, 1);
  assert.equal(s.funnel.completion_rate_pct, 100);
  assert.equal(s.second_scenario_within_7_days.all_completers, "1 of 2");
  assert.equal(s.second_scenario_within_7_days.mature_users_pct, 50);
  assert.equal(s.conversation.voice_share_pct, 50);
  assert.equal(s.conversation.avg_messages_per_session, 0.7); // 2 messages over 3 sessions
  assert.equal(s.ratings.helpful_pct, 100);
  assert.equal(s.per_scenario.find((x) => x.scenario === "call-grandma").starts, 2);
  assert.equal(s.daily_active_users.length, 14);
});
