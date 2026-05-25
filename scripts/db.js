#!/usr/bin/env node
// scripts/db.js — Supabase database tool (REST API, zero deps).
// Usage: node scripts/db.js <status|migrate|seed|sql>

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function loadEnv() {
  const env = {};
  const p = resolve(ROOT, '.env');
  if (!existsSync(p)) { console.error('.env not found'); process.exit(1); }
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_KEY;
const SVC  = env.SUPABASE_SERVICE_KEY;

if (!URL || !ANON) { console.error('Need SUPABASE_URL + SUPABASE_KEY in .env'); process.exit(1); }

async function rest(method, path, { headers, body, key } = {}) {
  const k = key || ANON;
  const opts = { method, headers: { apikey: k, Authorization: 'Bearer ' + k, ...headers } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(URL + path, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function managementSql(sql) {
  if (!SVC) throw new Error('Need SUPABASE_SERVICE_KEY in .env');
  // Use Supabase Management API to execute SQL
  const res = await fetch(`https://api.supabase.com/v1/projects/dkwqvenghjjjzceucjov/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SVC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SQL ${res.status}: ${t}`);
  }
  return res.json();
}

// ─── Commands ────────────────────────────────────────────────────

async function cmdStatus() {
  const tables = ['teams','team_schemas','team_api_configs','weekly_data','user_profiles','sources','hotspots','templates','template_uses'];
  console.log('Table                 Rows');
  for (const t of tables) {
    const r = await rest('GET', '/rest/v1/' + t + '?select=count', { headers: { Prefer: 'count=exact' } });
    if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
      // PostgREST returns count in content-range header, but easier: just select with limit 0
      const r2 = await rest('GET', '/rest/v1/' + t + '?select=id&limit=1000', {});
      const count = Array.isArray(r2.data) ? r2.data.length : '?';
      console.log(t.padEnd(22), count);
    } else {
      console.log(t.padEnd(22), Array.isArray(r.data) ? r.data.length : 'ERR');
    }
  }
}

async function cmdMigrate() {
  const sqlFile = resolve(ROOT, 'src/db/migration_v3.sql');
  if (!existsSync(sqlFile)) { console.error('migration_v3.sql not found'); process.exit(1); }
  const sql = readFileSync(sqlFile, 'utf-8');

  if (!SVC) {
    console.log('No SUPABASE_SERVICE_KEY in .env.');
    console.log('Get it from Supabase Dashboard → Settings → API → service_role secret');
    console.log('Then: echo SUPABASE_SERVICE_KEY=eyJ... >> .env');
    process.exit(1);
  }

  try {
    await managementSql(sql);
    console.log('Migration applied successfully.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    console.log('Fallback: copy-paste src/db/migration_v3.sql into SQL Editor');
    process.exit(1);
  }
}

async function cmdSeed() {
  console.log('Seeding not available via API. Run seed SQL manually:');
  console.log('  src/db/seed_hotspots.sql');
  console.log('  src/db/seed_user_profiles.sql');
}

const cmd = process.argv[2];
switch (cmd) {
  case 'status': await cmdStatus(); break;
  case 'migrate': await cmdMigrate(); break;
  case 'seed': await cmdSeed(); break;
  default:
    console.log('Usage: node scripts/db.js <status|migrate|seed>');
    console.log('  status   Show table row counts');
    console.log('  migrate  Run migration_v3.sql (needs SUPABASE_SERVICE_KEY)');
    console.log('  seed     Seed data hint');
}
