const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { createProvider } = require('./provider');
const { createApp } = require('./app');

async function start() {
  const config = loadConfig();
  const pool = createPool(config);
  await pool.query('SELECT 1');
  const schema = await pool.query(`SELECT to_regclass('public.audit_events') AS audit_events`);
  if (!schema.rows[0].audit_events) throw new Error('Database schema is missing; run the explicit migration command first');
  const app = createApp({ config, pool, provider: createProvider(config) });
  const server = app.listen(config.port, config.host, () => console.log(`Alzheimer's Research & Care Operations Hub listening on http://${config.host}:${config.port}`));
  const shutdown = (signal) => server.close(async () => { await pool.end(); console.log(`${signal}: graceful shutdown complete`); process.exit(0); });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => { console.error(`Startup failed: ${error.message}`); process.exit(1); });
