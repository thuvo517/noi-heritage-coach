# Nói: speaking practice for heritage speakers

Nói ("speak" in Vietnamese) helps heritage speakers, people who understand their family's language but freeze when speaking it, practice real family conversations. Learners pick a person (Grandma, an auntie, a server at a phở restaurant), speak or type, and get a gentle correction after every message plus a list of phrases to remember.

**Stack:** Cloudflare Workers, Workers AI (Llama 3.3 70B), Durable Objects (SQLite), vanilla JS frontend, browser speech recognition and text-to-speech.

## How it works

- **One Durable Object per learner** (`UserDO`) stores their level, current conversation, completed scenarios, and days practiced. Learners are anonymous: the browser generates an ID and keeps it in localStorage, so there are no accounts or passwords.
- **One global Durable Object** (`StatsDO`) stores product events in SQLite and computes the metrics at `/stats`.
- **Every message makes one model call** that returns the character's reply, an English translation, and feedback on what the learner said, as JSON.
- **Deterministic fallback:** if the model errors or returns something unparseable, the character says "Xin lỗi, nói lại được không?" (Sorry, could you say that again?) and the conversation keeps going. It never shows a broken screen.
- **Voice** uses the browser's built-in speech recognition (`vi-VN`), which works best in Chrome. The transcript lands in the text box so learners can check it before sending. If the device has a Vietnamese voice, replies are read aloud.

## Run it

You need Node 18+ and a free Cloudflare account.

```bash
npm install
npx wrangler login
npx wrangler secret put STATS_KEY   # any password; protects your metrics page
npm run deploy
```

Wrangler prints your live URL. Your metrics page is at `<your-url>/stats`; enter the `STATS_KEY` there.

For local development with the real model, run `npm run dev` (it uses `--remote` because Workers AI runs on Cloudflare). For local dev, put `STATS_KEY=anything` in a `.dev.vars` file.

Run the tests with `npm test`.

**Cost:** Workers AI has a free daily allowance, and each learner is capped at 80 messages per day (`MAX_MESSAGES_PER_DAY` in `src/index.js`). A few dozen testers should stay within or near the free tier, but check your usage in the Cloudflare dashboard.

## Metrics

All from `/stats`. Days use the learner's local date.

| Metric | Definition |
|---|---|
| Users | Anyone who opened the app |
| Completion rate | Completed scenarios ÷ started scenarios. A scenario completes when the model says the goal was met, or the learner taps Finish after at least 4 messages |
| Returned within 7 days | Users active on a later day, within 7 days of their first day |
| Second scenario within 7 days | Of users who completed a scenario, the share who completed another within 7 days. The "mature users" version only counts people whose first completion was 7+ days ago, so brand-new users don't drag the number down |
| Voice share | Messages sent after using the mic ÷ all messages |
| Feedback mix | How often feedback was great / small fix / try again |
| Fallback rate | Messages where the model failed and the fallback reply was used |
| Helpful % | End-of-conversation "Were the corrections helpful?" answers |

When you report numbers, say exactly how you define them, and note the sample size.

## Customize

- **Scenarios** live in `src/scenarios.js`. Replace them with the moments your user interviews surface. The `opener` is shown instantly without a model call.
- **Language:** change `LANGUAGE` in `src/scenarios.js` and the `rec.lang` value in `public/app.js`, then rewrite the openers and characters. Each language deserves its own interviews, so launch with one.
- **Tone of corrections:** edit the system prompt in `src/coach.js`.

## Project structure

```
src/index.js      Router, UserDO (per-learner state), StatsDO (events + metrics)
src/coach.js      Prompts, model call with JSON mode, parsing, fallback
src/scenarios.js  Scenarios, levels, language settings
src/stats.js      Metric definitions (pure function, unit tested)
public/           Frontend (index.html, app.js, styles.css) and the /stats page
test/             Unit tests for parsing, fallback, and metrics
```
