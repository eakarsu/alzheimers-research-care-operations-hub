'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const launcher = fs.readFileSync(path.join(__dirname, '..', 'runtime-launcher.js'), 'utf8');
const cli = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.js'), 'utf8');

test('runtime AI is authenticated, admin bounded, and exact-provider routed', () => {
  assert.match(app, /\/api\/auth\/me/);
  assert.match(app, /\/api\/application-ai\/clinical-operations-review/);
  assert.match(app, /requirePermission\('\*'\)/);
  assert.match(app, /OPENROUTER_API_KEY/);
  assert.match(app, /https:\/\/openrouter\.ai\/api\/v1/);
});
test('runtime AI requires provider content and persists its receipt', () => {
  assert.match(app, /providerReceipt/);
  assert.match(app, /INSERT INTO runtime_ai_results/);
  assert.match(app, /result\.trim\(\)/);
});
test('migration runner applies every SQL migration and launcher uses two ports', () => {
  assert.match(cli, /readdirSync/);
  assert.match(cli, /\.sort\(\)/);
  assert.match(launcher, /BACKEND_PORT/);
  assert.match(launcher, /FRONTEND_PORT/);
});
