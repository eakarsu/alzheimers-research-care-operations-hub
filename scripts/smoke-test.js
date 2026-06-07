const { spawn } = require('child_process');

const port = 5399;
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { text };
  }
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text}`);
  return json;
}

async function main() {
  await wait(800);
  const health = await request('/api/health');
  if (!health.ok || health.records.patients < 15) throw new Error('Health check did not return seeded records');

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@alzheimers.local', password: 'admin123' })
  });
  if (!login.user || login.user.role !== 'Admin') throw new Error('Login failed');

  const created = await request('/api/table/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient: 'Smoke Test', task: 'Verify CRUD', owner: 'QA', dueDate: '2026-06-07', priority: 'Low', status: 'Open', actor: login.user.email })
  });
  if (!created.row.id) throw new Error('Task create failed');

  const updated = await request(`/api/table/tasks/${encodeURIComponent(created.row.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Complete', actor: login.user.email })
  });
  if (updated.row.status !== 'Complete') throw new Error('Task update failed');

  await request('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient: 'Smoke Test', documentType: 'MRI report', fileName: 'smoke.pdf', reviewer: 'QA', actor: login.user.email })
  });

  const exported = await fetch(`${base}/api/export/tasks`);
  if (!exported.ok || !(await exported.text()).includes('Smoke Test')) throw new Error('CSV export failed');

  await request(`/api/table/tasks/${encodeURIComponent(created.row.id)}?actor=${encodeURIComponent(login.user.email)}`, { method: 'DELETE' });
  console.log('Smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  child.kill();
});
