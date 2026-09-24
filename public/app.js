const app = document.getElementById("app");

// ---------- Identity & API ----------
function userId() {
  try {
    let id = localStorage.getItem("noi-user");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("noi-user", id); }
    return id;
  } catch {
    return (window.__noiId ||= crypto.randomUUID());
  }
}
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-User-Id": userId(), "X-Local-Day": localDay() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't reach the server. Check your connection and try again.");
  return data;
}

// Tiny element helper: h("div", {class: "x"}, "text", child)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // only used for trusted static SVG
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const mark = () => h("span", {}, "Nói", h("span", { class: "dot" }, "."));
function showError(msg, where = app) {
  where.querySelector(".error")?.remove();
  where.prepend(h("div", { class: "error", role: "alert" }, msg));
}

// ---------- Speech ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let viVoice = null;
function loadVoices() {
  viVoice = speechSynthesis?.getVoices().find((v) => v.lang?.toLowerCase().startsWith("vi")) || null;
}
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text) {
  if (!viVoice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = viVoice; u.lang = viVoice.lang; u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ---------- Screens ----------
const LEVEL_COPY = {
  freeze: ["I understand, but I freeze", "I follow family conversations but can't get words out."],
  simple: ["I can say simple things", "I get by with short sentences and some English."],
  comfortable: ["I'm pretty comfortable", "I want to sound more natural and polite."],
};

async function boot() {
  try {
    const state = await api("state");
    if (!state.level) return renderWelcome();
    renderHome(state);
  } catch (e) {
    app.replaceChildren();
    showError(e.message);
  }
}

function renderWelcome() {
  const choices = Object.entries(LEVEL_COPY).map(([level, [title, sub]]) =>
    h("button", {
      class: "choice",
      onclick: async () => {
        try { await api("level", { level }); boot(); } catch (e) { showError(e.message, wrap); }
      },
    }, h("strong", {}, title), h("span", {}, sub)),
  );
  const wrap = h("section", { class: "welcome" },
    h("h1", { class: "wordmark" }, mark()),
    h("p", { class: "lede" }, "Practice speaking Vietnamese with family, before the real conversation."),
    h("h2", {}, "How do you feel speaking Vietnamese?"),
    choices,
  );
  app.replaceChildren(wrap);
}

function renderHome(state) {
  const days = state.daysPracticed;
  const people = state.scenarios.map((s) =>
    h("li", {},
      h("button", { class: `person${s.completed ? " done" : ""}`, onclick: () => startScenario(s.id) },
        h("span", { class: "initial", "aria-hidden": "true" }, s.badge),
        h("span", {},
          h("span", { class: "title" }, s.title),
          h("span", { class: "who" }, s.who),
          h("span", { class: "goal" }, s.goal),
          s.completed ? h("span", { class: "count" }, s.completed === 1 ? "Done" : `Done ${s.completed} times`) : null,
        ),
      ),
    ),
  );
  app.replaceChildren(h("section", { class: "home" },
    h("header", { class: "top" },
      h("span", { class: "mark" }, mark()),
      h("span", { class: "days" }, days ? `${days} ${days === 1 ? "day" : "days"} practiced${state.practicedToday ? ", including today" : ""}` : ""),
    ),
    h("h1", {}, "Who do you want to talk to?"),
    h("p", { class: "sub" }, "Each conversation takes about five minutes. Speak or type, and you'll get a gentle correction after every message."),
    state.activeSession
      ? h("button", { class: "resume", onclick: () => renderChat(state.activeSession) }, `Continue: ${state.activeSession.scenario.title}`)
      : null,
    h("ul", { class: "people" }, people),
  ));
}

async function startScenario(id) {
  try { renderChat(await api("start", { scenarioId: id })); }
  catch (e) { showError(e.message); }
}

function renderChat(session) {
  let usedVoice = false;
  let busy = false;
  const thread = h("div", { class: "thread", role: "log" });
  const goal = h("div", { class: `goal-line${session.goalMet ? " met" : ""}` },
    session.goalMet ? `Goal reached: ${session.scenario.goal}` : `Your goal: ${session.scenario.goal}`);

  const input = h("textarea", { rows: 1, placeholder: "Nói gì đó…", "aria-label": "Your message in Vietnamese" });
  const send = h("button", { class: "send", disabled: true, onclick: submit }, "Send");
  const micIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const mic = h("button", { class: "mic", "aria-label": "Speak your answer", html: micIcon });
  const status = h("span", {}, Recognition ? "Tap the mic and speak, then check the text and send." : "Voice isn't supported in this browser. Type instead, or try Chrome.");

  input.addEventListener("input", () => {
    send.disabled = !input.value.trim() || busy;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!send.disabled) submit(); }
  });

  // Voice input: fills the text box so the learner can review before sending.
  let rec = null;
  if (Recognition) {
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = "vi-VN"; rec.interimResults = true; rec.continuous = false;
      const before = input.value;
      rec.onresult = (e) => {
        const text = [...e.results].map((r) => r[0].transcript).join(" ");
        input.value = (before ? before + " " : "") + text;
        input.dispatchEvent(new Event("input"));
        usedVoice = true;
      };
      rec.onerror = (e) => {
        status.textContent = e.error === "not-allowed" ? "Allow microphone access to speak, or type instead." : "Didn't catch that. Try again.";
      };
      rec.onend = () => { mic.classList.remove("listening"); mic.setAttribute("aria-label", "Speak your answer"); rec = null; };
      mic.classList.add("listening");
      mic.setAttribute("aria-label", "Stop listening");
      status.textContent = "Listening…";
      rec.start();
    });
  } else {
    mic.disabled = true;
    mic.style.opacity = ".35";
  }

  function themMsg(t) {
    const en = h("p", { class: "en", hidden: true }, t.en || "");
    return h("div", { class: "msg them" },
      h("div", { class: "bubble", lang: "vi" }, t.vi),
      h("div", { class: "tools" },
        viVoice ? h("button", { onclick: () => speak(t.vi) }, "Play") : null,
        t.en ? h("button", {
          onclick: (e) => { en.hidden = !en.hidden; e.currentTarget.textContent = en.hidden ? "English" : "Hide English"; },
        }, "English") : null,
      ),
      en,
    );
  }
  function feedbackEl(fb) {
    const verdict = { great: "Nói hay lắm! Sounds natural.", small_fix: "Almost. A native speaker would say:", try_again: "Let's try that again." }[fb.status];
    return h("div", { class: `fb ${fb.status}` },
      h("span", { class: "verdict" }, verdict),
      fb.better ? h("span", { class: "better", lang: "vi" }, fb.better) : null,
      fb.note_en ? h("span", { class: "note" }, fb.note_en) : null,
    );
  }
  function meMsg(t) {
    return h("div", { class: "msg me" },
      h("div", { class: "bubble", lang: "vi" }, t.text),
      t.feedback ? h("div", {}, feedbackEl(t.feedback)) : null,
    );
  }
  const scrollDown = () => (thread.scrollTop = thread.scrollHeight);

  for (const t of session.turns) thread.append(t.role === "them" ? themMsg(t) : meMsg(t));

  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    const mode = usedVoice ? "voice" : "text";
    usedVoice = false;
    input.value = ""; input.style.height = "auto";
    const mine = h("div", { class: "msg me" }, h("div", { class: "bubble", lang: "vi" }, text));
    const typing = h("div", { class: "typing" }, `${session.scenario.who.split(",")[0]} is replying…`);
    thread.append(mine, typing); scrollDown();
    try {
      const r = await api("message", { text, mode });
      mine.append(h("div", {}, feedbackEl(r.feedback)));
      typing.replaceWith(themMsg(r.reply));
      if (r.goalMet) { goal.className = "goal-line met"; goal.textContent = `Goal reached: ${session.scenario.goal}. Keep chatting or tap Finish.`; }
      if (viVoice) speak(r.reply.vi);
    } catch (e) {
      typing.remove(); mine.remove();
      input.value = text;
      showError(e.message, thread);
    } finally {
      busy = false; send.disabled = !input.value.trim();
      scrollDown(); input.focus();
    }
  }

  async function getHint() {
    try {
      const hint = await api("hint", {});
      const card = h("div", { class: "hint-card" },
        h("div", { class: "vi", lang: "vi" }, hint.vi),
        h("div", { class: "en" }, hint.en),
        h("button", { class: "use", onclick: () => { input.value = hint.vi; input.dispatchEvent(new Event("input")); card.remove(); input.focus(); } }, "Use this"),
      );
      thread.append(card); scrollDown();
    } catch (e) { showError(e.message, thread); }
  }

  async function finish() {
    try { renderSummary(await api("finish", {})); }
    catch (e) { showError(e.message, thread); }
  }

  app.replaceChildren(h("section", { class: "chat" },
    h("header", { class: "bar" },
      h("button", { class: "back", onclick: boot, "aria-label": "Back to all conversations" }, "Back"),
      h("div", { class: "who" }, session.scenario.title),
      h("button", { class: "finish", onclick: finish }, "Finish"),
    ),
    goal,
    thread,
    h("div", { class: "composer" },
      h("div", { class: "row" }, mic, input, send),
      h("div", { class: "under" }, status, h("button", { onclick: getHint }, "Stuck? Get a hint")),
    ),
  ));
  scrollDown();
}

function renderSummary(s) {
  const heading = s.completed ? "Nice work. That conversation counts." : "Good start.";
  const detail = s.completed
    ? `You sent ${s.messages} ${s.messages === 1 ? "message" : "messages"}${s.goalMet ? " and reached the goal" : ""}.`
    : `You sent ${s.messages} ${s.messages === 1 ? "message" : "messages"}. Send at least 4, or reach the goal, to complete a conversation.`;

  const rateBox = h("div", { class: "rate" },
    ...[["Yes", true], ["Not really", false]].map(([label, helpful]) =>
      h("button", { class: "btn", onclick: async () => {
        try { await api("rate", { helpful }); rateBox.replaceChildren(h("p", {}, "Thanks. That helps make the corrections better.")); }
        catch (e) { showError(e.message); }
      } }, label)),
  );

  app.replaceChildren(h("section", { class: "summary" },
    h("span", { class: "mark", style: "font-weight:800;font-size:28px;letter-spacing:-0.04em" }, mark()),
    h("h1", {}, heading),
    h("p", { class: "stat" }, `${detail} ${s.daysPracticed} ${s.daysPracticed === 1 ? "day" : "days"} practiced so far.`),
    s.phrases.length ? [
      h("h2", {}, "Phrases to remember"),
      s.phrases.map((p) => h("div", { class: "phrase" },
        h("div", { class: "better", lang: "vi" }, p.better),
        h("div", { class: "said", lang: "vi" }, p.said),
        p.note ? h("div", { class: "note" }, p.note) : null,
      )),
    ] : h("p", {}, "No corrections this time. Everything you said sounded natural."),
    h("h2", {}, "Were the corrections helpful?"),
    rateBox,
    h("div", { class: "actions" },
      s.next ? h("button", { class: "btn primary", onclick: () => startScenario(s.next.id) }, `Next: ${s.next.title}`) : null,
      h("button", { class: "btn", onclick: boot }, "All conversations"),
    ),
  ));
}

boot();
