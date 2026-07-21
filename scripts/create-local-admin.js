'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { hashLocalPassword } = require('../src/local-auth');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local password accounts are disabled in production.');
  const email = String(process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const name = String(process.env.BOOTSTRAP_TENANT_NAME || 'Local Acceptance Tenant').trim().slice(0, 160);
  if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL must be a valid email address.');
  if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD must contain 12-128 characters.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM local_auth_accounts WHERE email=$1', [email])).rowCount) {
      await client.query('ROLLBACK');
      console.log(`Local administrator ${email} already exists; no changes made.`);
      return;
    }
    const tenantId = randomUUID();
    const subject = `local:${email}`;
    await client.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, name]);
    await client.query(
      `INSERT INTO actors(tenant_id,subject,role,email,licensed_clinician,active)
       VALUES($1,$2,'administrator',$3,false,true)`,
      [tenantId, subject, email]
    );
    await client.query(
      `INSERT INTO local_auth_accounts(tenant_id,subject,email,password_digest,role)
       VALUES($1,$2,$3,$4,'administrator')`,
      [tenantId, subject, email, hashLocalPassword(password)]
    );
    await client.query('COMMIT');
    console.log(`Created local administrator ${email}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
