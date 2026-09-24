// Turns raw events into the product metrics you'd report in an interview.
// Days are the user's local calendar day (sent by the browser), so "came back the next day" is accurate.

const DAY_MS = 86_400_000;
const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY_MS);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

export function computeStats(events, todayDay) {
  const users = new Map(); // id -> { days:Set, completions:[dayNum], started:bool }
  const perScenario = new Map();
  const sessions = new Map(); // session id -> { messages, hints }
  let starts = 0, completions = 0, messages = 0, voice = 0, fallbacks = 0, hints = 0;
  const feedback = { great: 0, small_fix: 0, try_again: 0 };
  const ratings = { helpful: 0, not_helpful: 0 };

  const scen = (id) => {
    if (!perScenario.has(id)) perScenario.set(id, { scenario: id, starts: 0, completions: 0 });
    return perScenario.get(id);
  };

  for (const e of events) {
    const meta = safeJSON(e.meta);
    if (!users.has(e.user_id)) users.set(e.user_id, { days: new Set(), completions: [], started: false });
    const u = users.get(e.user_id);
    u.days.add(dayNum(e.day));

    switch (e.type) {
      case "scenario_start":
        starts++;
        u.started = true;
        scen(e.scenario).starts++;
        bump(sessions, meta.session, "starts");
        break;
      case "scenario_complete":
        completions++;
        u.completions.push(dayNum(e.day));
        scen(e.scenario).completions++;
        break;
      case "message": {
        messages++;
        if (meta.mode === "voice") voice++;
        if (meta.fallback) fallbacks++;
        if (feedback[meta.status] !== undefined) feedback[meta.status]++;
        bump(sessions, meta.session, "messages");
        break;
      }
      case "hint":
        hints++;
        bump(sessions, meta.session, "hints");
        break;
      case "rating":
        meta.helpful ? ratings.helpful++ : ratings.not_helpful++;
        break;
    }
  }

  const today = dayNum(todayDay);
  let activated = 0, completedUsers = 0, returned7 = 0, second7 = 0, matureCompleters = 0, matureSecond7 = 0;
  for (const u of users.values()) {
    if (u.started) activated++;
    const days = [...u.days].sort((a, b) => a - b);
    const first = days[0];
    if (days.some((d) => d > first && d - first <= 7)) returned7++;

    if (u.completions.length) {
      completedUsers++;
      const c = u.completions.sort((a, b) => a - b);
      const hasSecond = c.length > 1 && c[1] - c[0] <= 7;
      if (hasSecond) second7++;
      // "Mature" users have had a full 7 days to come back, so their rate isn't dragged down by newcomers.
      if (today - c[0] >= 7) {
        matureCompleters++;
        if (hasSecond) matureSecond7++;
      }
    }
  }

  const sess = [...sessions.values()];
  const dau = [];
  for (let i = 13; i >= 0; i--) {
    const d = today - i;
    let n = 0;
    for (const u of users.values()) if (u.days.has(d)) n++;
    dau.push({ day: new Date(d * DAY_MS).toISOString().slice(0, 10), users: n });
  }

  return {
    users: {
      total: users.size,
      started_a_scenario: activated,
      completed_a_scenario: completedUsers,
      returned_within_7_days: returned7,
      returned_within_7_days_pct: pct(returned7, users.size),
    },
    funnel: {
      scenario_starts: starts,
      scenario_completions: completions,
      completion_rate_pct: pct(completions, starts),
    },
    second_scenario_within_7_days: {
      all_completers_pct: pct(second7, completedUsers),
      all_completers: `${second7} of ${completedUsers}`,
      mature_users_pct: pct(matureSecond7, matureCompleters),
      mature_users: `${matureSecond7} of ${matureCompleters} (first completion 7+ days ago)`,
    },
    conversation: {
      messages,
      avg_messages_per_session: sess.length ? round1(sess.reduce((a, s) => a + (s.messages || 0), 0) / sess.length) : null,
      hints_per_session: sess.length ? round1(hints / sess.length) : null,
      voice_share_pct: pct(voice, messages),
      fallback_rate_pct: pct(fallbacks, messages),
      feedback_mix: feedback,
    },
    ratings: { ...ratings, helpful_pct: pct(ratings.helpful, ratings.helpful + ratings.not_helpful) },
    per_scenario: [...perScenario.values()].map((s) => ({ ...s, completion_rate_pct: pct(s.completions, s.starts) })),
    daily_active_users: dau,
  };
}

function bump(map, key, field) {
  if (!key) return;
  if (!map.has(key)) map.set(key, {});
  const s = map.get(key);
  s[field] = (s[field] || 0) + 1;
}
function safeJSON(s) {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
const round1 = (n) => Math.round(n * 10) / 10;
