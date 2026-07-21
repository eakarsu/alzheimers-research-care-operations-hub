const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { createPool } = require('./db');

async function main() {
  const command = process.argv[2] || 'check';
  const config = command === 'migrate'
    ? {
        databaseUrl: process.env.DATABASE_URL,
        databaseSsl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false,
        allowMigration: process.env.ALLOW_SCHEMA_MIGRATION === '1'
      }
    : loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL must be configured with a non-placeholder value');
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    if (command === 'check') {
      const result = await pool.query(`SELECT to_regclass('public.audit_events') AS audit_events`);
      if (!result.rows[0].audit_events) throw new Error('Schema is not migrated; run with ALLOW_SCHEMA_MIGRATION=1 npm run migrate');
      console.log('Configuration, database connectivity, and schema check passed');
      return;
    }
    if (command === 'migrate') {
      if (!config.allowMigration) throw new Error('Refusing schema mutation unless ALLOW_SCHEMA_MIGRATION=1');
      const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_governed_clinical_hub.sql'), 'utf8');
      await pool.query(migration);
      console.log('Migration applied successfully');
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
