const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createApp } = require('../src/app');
const { signCallback } = require('../src/security');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('real HTTP and PostgreSQL workflow enforces tenant, consent, role, provider, AI, concurrency, and audit controls', { skip: !databaseUrl, timeout: 30_000 }, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl });
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_governed_clinical_hub.sql'), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  await pool.query('TRUNCATE tenants RESTART IDENTITY CASCADE');
  const tenantA = (await pool.query(`INSERT INTO tenants(name) VALUES('Memory Health A') RETURNING id`)).rows[0].id;
  const tenantB = (await pool.query(`INSERT INTO tenants(name) VALUES('Memory Health B') RETURNING id`)).rows[0].id;
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = {
    production: false, encryptionKey: crypto.randomBytes(32), callbackSecret: 'c'.repeat(32),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), oidcIssuer: 'https://identity.test/', oidcAudience: 'alz-hub',
    oidcLoginUrl: 'https://identity.test/login'
  };
  let providerCalls = 0;
  const provider = {
    async fhir() { providerCalls += 1; throw Object.assign(new Error('temporary outage'), { code: 'FHIR_503', retryable: true }); },
    async reserveObject() { return { uploadUrl: 'https://objects.test/upload' }; }
  };
  const app = createApp({ config, pool, provider });
  const server = app.listen(Number(process.env.TEST_API_PORT || 0), '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.end(); });

  function token(subject, role, tenantId = tenantA, amr = ['pwd', 'mfa']) {
    return jwt.sign({ tenant_id: tenantId, role, amr, email: `${subject}@test.invalid` }, pair.privateKey, { algorithm: 'RS256', subject, issuer: config.oidcIssuer, audience: config.oidcAudience, expiresIn: '5m' });
  }
  const tokens = {
    admin: token('admin-1', 'administrator'), coordinator: token('coordinator-1', 'coordinator'),
    clinician1: token('doctor-1', 'clinician'), clinician2: token('doctor-2', 'clinician'),
    researcher: token('researcher-1', 'researcher'), caregiver: token('caregiver-1', 'caregiver'),
    otherTenant: token('admin-b', 'administrator', tenantB), noMfa: token('doctor-weak', 'clinician', tenantA, ['pwd'])
  };
  async function request(urlPath, auth, options = {}) {
    const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(options.headers || {}) };
    const response = await fetch(`${base}${urlPath}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }

  assert.deepEqual((await request('/api/health')).data, { ok: true, app: 'alzheimers-research-care-operations-hub', database: 'reachable' });
  assert.equal((await request('/api/session', tokens.noMfa)).status, 401);
  assert.equal((await request('/api/bootstrap')).status, 401);

  const created = await request('/api/patients', tokens.coordinator, { method: 'POST', body: { sourceSystem: 'ehr-a', sourcePatientId: 'MRN-100', profile: { patient: 'Ada Patient', dateOfBirth: '1947-02-03', stage: 'MCI', ageBand: '75-84', email: 'private@example.test' } } });
  assert.equal(created.status, 201);
  const patientId = created.data.patient.id;
  const duplicate = await request('/api/patients', tokens.coordinator, { method: 'POST', body: { sourceSystem: 'ehr-b', sourcePatientId: 'OTHER', profile: { patient: 'Ada Patient', dateOfBirth: '1947-02-03' } } });
  assert.equal(duplicate.status, 409);

  await request('/api/session', tokens.caregiver);
  await pool.query(`INSERT INTO caregiver_assignments(tenant_id,caregiver_subject,patient_id,valid_until) VALUES($1,'caregiver-1',$2,now()+interval '1 day')`, [tenantA, patientId]);
  const caregiverBoot = await request('/api/bootstrap', tokens.caregiver);
  assert.equal(caregiverBoot.status, 200);
  assert.equal(caregiverBoot.data.data.patients.length, 1);
  assert.equal((await request('/api/patients', tokens.caregiver, { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/bootstrap', tokens.otherTenant)).data.data.patients.length, 0);

  const consent = await request('/api/consents', tokens.clinician1, { method: 'POST', body: { patientId, purpose: 'care-operations', validUntil: '2099-01-01', source: 'signed-econsent-22' } });
  assert.equal(consent.status, 201);
  const consentId = consent.data.consent.id;

  const record = await request('/api/table/tasks', tokens.coordinator, { method: 'POST', body: { patientId, patient: 'Ada Patient', task: 'Review medication', priority: 'High', status: 'Open' } });
  assert.equal(record.status, 201);
  const recordId = record.data.row.id;
  const version = record.data.row.version;
  const corrected = await request(`/api/table/tasks/${recordId}`, tokens.coordinator, { method: 'PUT', body: { patientId, patient: 'Ada Patient', task: 'Review medication and MRI', priority: 'High', status: 'Open', version, correctionReason: 'Source chart correction' } });
  assert.equal(corrected.status, 200);
  const conflict = await request(`/api/table/tasks/${recordId}`, tokens.coordinator, { method: 'PUT', body: { patientId, task: 'stale update', version, correctionReason: 'Stale' } });
  assert.equal(conflict.status, 409);

  const document = await request('/api/documents', tokens.coordinator, { method: 'POST', body: { patientId, fileName: 'mri.pdf', documentType: 'MRI', contentSha256: 'a'.repeat(64), retentionUntil: '2099-01-01' } });
  assert.equal(document.status, 201);
  const stored = await request(`/api/provider/jobs/${document.data.document.providerJobId}/execute`, tokens.coordinator, { method: 'POST' });
  assert.equal(stored.status, 200);
  assert.equal((await pool.query(`SELECT status FROM document_objects WHERE id=$1`, [document.data.document.id])).rows[0].status, 'stored');
  assert.equal((await request(`/api/documents/${document.data.document.id}/legal-hold`, tokens.admin, { method: 'POST', body: { enabled: true } })).status, 200);
  assert.equal((await request(`/api/documents/${document.data.document.id}`, tokens.admin, { method: 'DELETE' })).status, 409);

  const model = await request('/api/ai/models', tokens.admin, { method: 'POST', body: { model: 'review-model', modelVersion: '2026-07', intendedUse: 'care-team case review' } });
  assert.equal(model.status, 201);
  const evaluation = await request(`/api/ai/models/${model.data.release.id}/evaluations`, tokens.clinician2, { method: 'POST', body: { evaluationSetSha256: 'e'.repeat(64), metrics: { groundedCitationRate: 1, unsafeRecommendationRate: 0 }, thresholds: { groundedCitationRate: 0.98, unsafeRecommendationRate: 0 }, passed: true, evidenceUri: 'https://evidence.test/model-evaluation-2026-07' } });
  assert.equal(evaluation.status, 201);

  const evidence = [{ title: 'Validated guideline', uri: 'https://evidence.test/guideline', excerpt: 'Clinician review remains required.' }];
  const ai = await request('/api/ai/reviews', tokens.clinician1, { method: 'POST', body: { patientId, intendedUse: 'case review', model: 'review-model', modelVersion: '2026-07', prompt: 'summarize', output: 'Possible workflow action', uncertainty: 'medium', evidence } });
  assert.equal(ai.status, 201);
  assert.equal(ai.data.actionable, false);
  const reviewId = ai.data.review.id;
  assert.equal((await request(`/api/ai/reviews/${reviewId}/decision`, tokens.clinician1, { method: 'POST', body: { decision: 'approved', reason: 'self approval' } })).status, 409);
  const approved = await request(`/api/ai/reviews/${reviewId}/decision`, tokens.clinician2, { method: 'POST', body: { decision: 'approved', reason: 'Evidence and source data checked' } });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.actionable, true);
  assert.equal((await request(`/api/ai/reviews/${reviewId}/decision`, tokens.clinician2, { method: 'POST', body: { decision: 'rejected', reason: 'second decision' } })).status, 409);

  const researchBoot = await request('/api/bootstrap', tokens.researcher);
  assert.equal(researchBoot.status, 200);
  assert.equal('email' in researchBoot.data.data.patients[0], false);
  assert.match(researchBoot.data.data.patients[0].patient, /^Study participant/);
  assert.equal((await request('/api/ai/reviews', tokens.researcher, { method: 'POST', body: {} })).status, 403);
  const researchExport = await request('/api/export/patients?purpose=approved-study', tokens.researcher);
  assert.equal(researchExport.status, 200);
  assert.equal(String(researchExport.data).includes('Ada Patient'), false);

  const queued = await request('/api/provider/jobs', tokens.coordinator, { method: 'POST', body: { patientId, provider: 'fhir', operation: 'sync-observation', idempotencyKey: 'ehr-event-100-v1', purpose: 'care-operations', request: { resourceType: 'Observation', resource: { status: 'final' } } } });
  assert.equal(queued.status, 202);
  const replay = await request('/api/provider/jobs', tokens.coordinator, { method: 'POST', body: { patientId, provider: 'fhir', idempotencyKey: 'ehr-event-100-v1', request: { resourceType: 'Observation', resource: {} } } });
  assert.equal(replay.data.job.id, queued.data.job.id);
  const failed = await request(`/api/provider/jobs/${queued.data.job.id}/execute`, tokens.coordinator, { method: 'POST' });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.job.status, 'retryable');
  assert.equal(providerCalls, 1);

  const callbackBody = JSON.stringify({ status: 'received' });
  const callbackHeaders = { 'content-type': 'application/json', 'x-tenant-id': tenantA, 'x-delivery-id': 'delivery-1', 'x-signature': signCallback(callbackBody, config.callbackSecret) };
  assert.equal((await request('/api/callbacks/fhir', null, { method: 'POST', headers: callbackHeaders, body: callbackBody })).status, 202);
  const replayedCallback = await request('/api/callbacks/fhir', null, { method: 'POST', headers: callbackHeaders, body: callbackBody });
  assert.equal(replayedCallback.status, 200);
  assert.equal(replayedCallback.data.duplicate, true);
  assert.equal((await request('/api/callbacks/fhir', null, { method: 'POST', headers: { ...callbackHeaders, 'x-signature': '0'.repeat(64) }, body: callbackBody })).status, 401);

  const revoked = await request(`/api/consents/${consentId}/revoke`, tokens.clinician1, { method: 'POST', body: { version: consent.data.consent.version } });
  assert.equal(revoked.status, 200);
  assert.equal((await request('/api/table/tasks', tokens.coordinator, { method: 'POST', body: { patientId, task: 'Must be blocked' } })).status, 409);
  assert.equal((await pool.query(`SELECT status FROM provider_jobs WHERE id=$1`, [queued.data.job.id])).rows[0].status, 'dead-letter');

  const drill = await request('/api/restore-drills', tokens.admin, { method: 'POST', body: { backupReference: 'vault://backup/2026-07-19', status: 'passed', evidenceUri: 'https://evidence.test/restore-2026-07-19' } });
  assert.equal(drill.status, 201);
  assert.equal((await request('/api/incidents', tokens.admin, { method: 'POST', body: { severity: 'high', summary: 'Simulated export-monitoring alert for response drill' } })).status, 201);
  await assert.rejects(async () => pool.query(`UPDATE audit_events SET action='tampered' WHERE tenant_id=$1`, [tenantA]), /append-only/);
  assert.ok(Number((await pool.query(`SELECT count(*) FROM audit_events WHERE tenant_id=$1`, [tenantA])).rows[0].count) >= 10);
});
