const { Pool } = require('pg');

function createPool(config) {
  return new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl, max: 12, idleTimeoutMillis: 10_000 });
}

async function transaction(pool, principal, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [principal.tenantId]);
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function audit(client, principal, action, resourceType, resourceId, purpose, metadata = {}) {
  await client.query(
    `INSERT INTO audit_events(tenant_id,actor_subject,action,resource_type,resource_id,purpose,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [principal.tenantId, principal.subject, action, resourceType, resourceId || null, purpose || null, metadata]
  );
}

async function registerActor(client, principal) {
  await client.query(
    `INSERT INTO actors(tenant_id,subject,role,email,licensed_clinician)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id,subject) DO UPDATE SET role=EXCLUDED.role,email=EXCLUDED.email,active=true`,
    [principal.tenantId, principal.subject, principal.role, principal.email, principal.role === 'clinician']
  );
}

module.exports = { createPool, transaction, audit, registerActor };
