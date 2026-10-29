# Rule the Empire

A branching, choose-your-path review game for **AP World History Unit 3: Land-Based Empires (1450–1750)**.
Students pick one of eight empires, make about 8 historically grounded decisions, see "what you chose vs. what actually happened" after each one, and compete on a shared, live class leaderboard.

**Play:** https://YOUR-GAME-LINK · **Leaderboard:** https://YOUR-GAME-LINK/#leaderboard

| Tier | Empires |
|---|---|
| Easy (0 to +5 per decision, 4 stability) | Mughal Empire · Ming & Qing China · Tokugawa Japan |
| Medium (−1 to +6, 3 stability) | Ottoman Empire · Russian Empire |
| Hard (−3 to +8, 2 stability, instant-collapse choices) | Spanish Empire · Safavid Empire · Songhai Empire |

## For teachers

- **[Teacher Guide](docs/TEACHER_GUIDE.md):** how students play, reading the leaderboard, teacher controls, changing the password.
- **[Content Review](docs/CONTENT_REVIEW.md):** every decision, option, point value, and explanation, with flagged facts at the top.
- **[Editing the content](docs/EDITING_CONTENT.md):** how to change the game's history content later.

## How it works

- **Content** lives in `content/` as JSON (one file per empire, plus shared key terms and tier rules), separate from the code.
- **`src/engine.js`** is the pure game logic: branching, flags (earlier choices change later framing and options), stability, collapse, scoring. The server, scripts, and tests all share it.
- **`src/api.js` + `src/worker.js`** run on Cloudflare Workers. The browser sends only the choices it made, as per-game option codes, and the server replays them, so scores can't be faked. Official first attempts are saved step by step, so students can't take back an answer. The teacher password is checked only on the server (a secret, never sent to the page).
- **`src/db.js`** stores the leaderboard in Cloudflare D1 (SQLite): first name, period, empire, score, outcome, plus a random game code and choice list for resuming and verifying.
- **`public/`** holds the game client: plain HTML, CSS, and JS with no framework, original SVG emblems, and self-hosted open-license fonts.

## Checks

```bash
npm run validate   # graph checks: no dead ends/broken links, 7–9 decision paths, tier point ranges…
npm run balance    # min/max/typical scores on every path for every empire → docs/BALANCE_REPORT.md
npm test           # unit + API tests (scoring, first-attempt logic, periods, teacher password…)
npm run test:e2e   # real-browser play-throughs: a full path and a collapse path for every empire
npm run check      # validate + balance + unit tests
```

Deployment and local development: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
