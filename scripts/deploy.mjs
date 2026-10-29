#!/usr/bin/env node
// One-command deploy to Cloudflare (Workers + D1). Safe to run again: it only
// creates what is missing.
//
//   CLOUDFLARE_API_TOKEN=... npm run deploy
//
// Optional:
//   CLOUDFLARE_ACCOUNT_ID   pick an account if the token can see several
//   NEW_TEACHER_PASSWORD    set the teacher password (otherwise one is generated
//                           the first time and printed once)
//
// Steps: check the content and tests, find or create the workers.dev subdomain
// and the D1 database, apply database migrations, deploy, set the secrets the
// first time, and smoke-test the live site.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import { ROOT } from './lib/load-content.mjs';

const WORKER = 'rule-the-empire';
const DATABASE = 'rule-the-empire';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API = 'https://api.cloudflare.com/client/v4';

const step = (msg) => console.log(`\n▶ ${msg}`);
const die = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

function sh(cmd, args, { input, quiet } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, input, encoding: 'utf8', env: process.env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (!quiet) process.stdout.write(out);
  if (r.status !== 0) die(`${cmd} ${args.join(' ')} failed.`);
  return out;
}

async function cf(apiPath, opts = {}) {
  const res = await fetch(API + apiPath, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.success !== false, status: res.status, body };
}

const WORDS = 'sultan janissary silver galleon caravan shogun samurai daimyo tsar boyar cossack shah ghulam askia timbuktu niger jizya mughal rajput akbar taj ming qing kangxi jesuit sakoku dejima edo osaka potosi armada lepanto vienna isfahan tabriz chaldiran tondibi songhai kremlin volga siberia ottoman mehmed suleiman sinan abbas babur humayun deccan maratha manila canton beijing kyoto nagasaki seville gao jenne'.split(' ');
const newPassword = () => `${Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-')}-${randomInt(10, 100)}`;

async function main() {
  if (!TOKEN) die('CLOUDFLARE_API_TOKEN is not set. See docs/DEPLOYMENT.md.');

  step('Checking content, balance, and tests');
  sh('npm', ['run', 'check']);

  step('Checking the Cloudflare token');
  const verify = await cf('/user/tokens/verify');
  if (!verify.ok) die(`The Cloudflare token was not accepted: ${JSON.stringify(verify.body.errors || verify.body)}`);
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const accounts = await cf('/accounts');
    if (!accounts.ok || !accounts.body.result?.length) die('Could not list Cloudflare accounts. Does the token include "Account Settings: Read"?');
    accountId = accounts.body.result[0].id;
    console.log(`Using account "${accounts.body.result[0].name}"`);
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;

  step('Making sure the account has a workers.dev address');
  let sub = await cf(`/accounts/${accountId}/workers/subdomain`);
  if (!sub.ok || !sub.body.result?.subdomain) {
    const name = `rule-empire-${randomBytes(3).toString('hex')}`;
    sub = await cf(`/accounts/${accountId}/workers/subdomain`, { method: 'PUT', body: JSON.stringify({ subdomain: name }) });
    if (!sub.ok) die(`Could not create a workers.dev subdomain: ${JSON.stringify(sub.body.errors)}`);
  }
  const subdomain = sub.body.result.subdomain;
  console.log(`workers.dev subdomain: ${subdomain}`);

  step('Finding or creating the leaderboard database');
  const list = await cf(`/accounts/${accountId}/d1/database?name=${DATABASE}`);
  if (!list.ok) die(`Could not list D1 databases. Does the token include "D1: Edit"? ${JSON.stringify(list.body.errors)}`);
  let db = (list.body.result || []).find((d) => d.name === DATABASE);
  if (!db) {
    const created = await cf(`/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name: DATABASE }) });
    if (!created.ok) die(`Could not create the database: ${JSON.stringify(created.body.errors)}`);
    db = created.body.result;
    console.log('Created a new database.');
  }
  const configPath = path.join(ROOT, 'wrangler.jsonc');
  const config = readFileSync(configPath, 'utf8');
  const updated = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.uuid}"`);
  if (updated !== config) {
    writeFileSync(configPath, updated);
    console.log(`Saved database id ${db.uuid} in wrangler.jsonc (commit this change).`);
  }

  step('Applying database migrations');
  sh('npx', ['wrangler', 'd1', 'migrations', 'apply', DATABASE, '--remote']);

  step('Deploying the site');
  const out = sh('npx', ['wrangler', 'deploy']);
  const url = (out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [`https://${WORKER}.${subdomain}.workers.dev`])[0];

  step('Setting secrets (only the first time)');
  const secrets = await cf(`/accounts/${accountId}/workers/scripts/${WORKER}/secrets`);
  const have = new Set((secrets.body.result || []).map((s) => s.name));
  let generated = null;
  if (process.env.NEW_TEACHER_PASSWORD || !have.has('TEACHER_PASSWORD')) {
    const pw = process.env.NEW_TEACHER_PASSWORD || (generated = newPassword());
    sh('npx', ['wrangler', 'secret', 'put', 'TEACHER_PASSWORD'], { input: pw, quiet: true });
    console.log('Teacher password set.');
  } else console.log('Teacher password already set (unchanged).');
  if (!have.has('GAME_SECRET')) {
    sh('npx', ['wrangler', 'secret', 'put', 'GAME_SECRET'], { input: randomBytes(32).toString('hex'), quiet: true });
    console.log('Game secret set.');
  }

  step(`Smoke test: ${url}`);
  let health = null;
  for (let i = 0; i < 20 && !health; i++) {
    try {
      const r = await fetch(`${url}/api/config`);
      if (r.ok) health = await r.json();
    } catch { /* DNS for a brand-new subdomain can take a moment */ }
    if (!health) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!health) die(`The site did not answer at ${url} yet. New workers.dev addresses can take a few minutes; try again shortly.`);
  console.log(`Site is up: ${health.empires.length} empires, teacher controls ${health.teacherEnabled ? 'enabled' : 'NOT enabled yet'}.`);

  // Put the real link into the docs (they ship with a placeholder).
  for (const doc of ['docs/TEACHER_GUIDE.md', 'README.md']) {
    const p = path.join(ROOT, doc);
    const text = readFileSync(p, 'utf8');
    if (text.includes('https://YOUR-GAME-LINK')) writeFileSync(p, text.replaceAll('https://YOUR-GAME-LINK', url));
  }

  console.log(`\n✔ Deployed: ${url}`);
  console.log(`  Leaderboard for a projector: ${url}/#leaderboard`);
  if (generated) {
    writeFileSync(path.join(ROOT, '.teacher-password.txt'), `${generated}\n`);
    console.log(`\n  Teacher password (shown once, also saved to .teacher-password.txt, which is not committed):\n  ${generated}`);
  }
}

main().catch((err) => die(err.stack || String(err)));
