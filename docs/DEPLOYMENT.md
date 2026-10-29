# Deployment (for whoever maintains the site)

The game runs on **Cloudflare Workers** (the web pages and API) with a **Cloudflare D1** database (the leaderboard). Both are on Cloudflare's free plan, never sleep, and easily handle several classes at once.

## One-time setup

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up and verify the email.
2. Create an API token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template → Use template**, then under **Permissions** click **+ Add more** and add **Account · D1 · Edit**. Set **Account Resources** to your account, then **Continue to summary → Create Token**.
3. Store the token as the environment variable **`CLOUDFLARE_API_TOKEN`** wherever the deploy runs. For Claude Code on the web, that's the cloud environment's settings (environment menu → Edit → environment variables / network secrets). Never paste the token into a chat or commit it.

## Deploy (first time and every time after)

```bash
npm install
npm run deploy
```

`scripts/deploy.mjs` runs the content checks and tests, finds or creates the workers.dev subdomain and the `rule-the-empire` D1 database (and saves its id in `wrangler.jsonc`, so commit that change), applies `migrations/`, deploys, sets the `TEACHER_PASSWORD` and `GAME_SECRET` secrets the first time (printing a generated teacher password once), and smoke-tests the live URL.

To change the teacher password from the command line: `NEW_TEACHER_PASSWORD='new-pass-phrase' npm run deploy` (or use the Cloudflare dashboard as described in the Teacher Guide).

## Test the live site

```bash
BASE_URL=https://rule-the-empire.<subdomain>.workers.dev TEACHER_PASSWORD='…' npm run test:e2e
```

This plays a full game and an early-collapse game for every empire in a real browser against the live site, checks every score and the leaderboard, then deletes its test entries.

## Local development

```bash
npm install
npm run db:migrate:local
echo 'TEACHER_PASSWORD=local-teacher-pw' > .dev.vars
echo 'GAME_SECRET=local-game-secret' >> .dev.vars
npm run dev        # http://localhost:8787
npm run check      # validate + balance + unit/API tests
npm run test:e2e   # browser play-throughs against a fresh local server
```
