const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { authenticate, can, requirePermission, encryptJson, decryptJson, digest, signCallback, safeEqualHex } = require('./security');
const { verifyLocalPassword } = require('./local-auth');
const { assertConsent, assertAiDraft, assertApproval, visiblePatient } = require('./domain');
const { transaction, audit, registerActor } = require('./db');

const TABLE_TYPES = new Set(['cognitiveTimeline','trialMatches','biomarkers','visitNotes','monitoring','caregiverTasks','medicationSafety','evidence','tasks','notifications']);

function httpError(status, message, code) { return Object.assign(new Error(message), { status, code }); }
function bearer(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const match = (req.get('cookie') || '').match(/(?:^|;\s*)alz_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function activeConsent(client, tenantId, patientId, purpose) {
  const result = await client.query(
    `SELECT id FROM consents WHERE tenant_id=$1 AND patient_id=$2 AND purpose=$3
     AND status='active' AND valid_until > now() ORDER BY created_at DESC LIMIT 1`,
    [tenantId, patientId, purpose]
  );
  return result.rows[0];
}

function createApp({ config, pool, provider }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
  app.use((_req, res, next) => {
    res.set({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
    next();
  });

  app.get('/api/health', async (_req, res, next) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, app: 'alzheimers-research-care-operations-hub', database: 'reachable' }); }
    catch (error) { next(Object.assign(error, { status: 503 })); }
  });
  app.get('/api/auth/demo-credentials', (_req, res) => {
    if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
    const email = process.env.PROVISION_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
    const password = process.env.PROVISION_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
    if (!email || !password) return res.status(503).json({ error: 'Demo credentials unavailable' });
    res.set('cache-control', 'no-store');
    return res.json({ email, password });
  });
  app.get('/api/runtime-config', (_req, res) => res.json({ loginUrl: '/api/auth/sso', auth: 'OIDC/SAML gateway with MFA', sessionStorage: 'secure HttpOnly cookie' }));
  app.get('/api/auth/sso', (_req, res) => res.redirect(303, config.oidcLoginUrl));
  app.post('/api/auth/logout', (_req, res) => { res.clearCookie('alz_session', { httpOnly: true, secure: config.production, sameSite: 'strict' }); res.status(204).end(); });
  app.post('/api/auth/login', async (req, res, next) => {
    if (!config.allowLocalPasswordAuth) return res.status(410).json({ error: 'Password login is disabled; use organization SSO with MFA' });
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const result = await pool.query(
        `SELECT tenant_id,subject,email,password_digest,role,active
         FROM local_auth_accounts WHERE email=$1`,
        [email]
      );
      const account = result.rows[0];
      if (!account?.active || !verifyLocalPassword(password, account.password_digest)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        { tenant_id: account.tenant_id, role: account.role, email: account.email, amr: ['pwd'], auth_context: 'local-development' },
        config.privateKey,
        { algorithm: 'RS256', subject: account.subject, issuer: config.oidcIssuer, audience: config.oidcAudience, expiresIn: '15m' }
      );
      return res.json({ token, user: { email: account.email, role: account.role, tenantId: account.tenant_id, subject: account.subject } });
    } catch (error) { return next(error); }
  });

  app.post('/api/callbacks/:provider', async (req, res, next) => {
    try {
      const tenantId = req.get('x-tenant-id');
      const deliveryId = req.get('x-delivery-id');
      const expected = signCallback(req.rawBody || '', config.callbackSecret);
      if (!tenantId || !deliveryId || !safeEqualHex(req.get('x-signature'), expected)) throw httpError(401, 'Invalid callback signature');
      const result = await pool.query(
        `INSERT INTO callback_receipts(tenant_id,provider,delivery_id,body_sha256)
         VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,provider,delivery_id) DO NOTHING RETURNING id`,
        [tenantId, req.params.provider, deliveryId, digest(req.rawBody || '')]
      );
      res.status(result.rowCount ? 202 : 200).json({ accepted: true, duplicate: !result.rowCount });
    } catch (error) { next(error); }
  });

  app.use('/api', async (req, res, next) => {
    try {
      const token = bearer(req);
      if (!token) throw httpError(401, 'Authentication required');
      req.principal = authenticate(token, config);
      await transaction(pool, req.principal, async (client) => registerActor(client, req.principal));
      next();
    } catch (error) { next(Object.assign(error, { status: 401 })); }
  });

  app.get('/api/session', (req, res) => res.json({ user: req.principal }));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.principal }));

  app.post('/api/application-ai/clinical-operations-review', requirePermission('*'), async (req, res, next) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      if (prompt.length < 20 || prompt.length > 12000) throw httpError(400, 'prompt must contain 20 to 12000 characters');
      const apiKey = process.env.OPENROUTER_API_KEY;
      const model = process.env.OPENROUTER_MODEL;
      const baseUrl = process.env.OPENROUTER_BASE_URL;
      if (!apiKey || !model || baseUrl !== 'https://openrouter.ai/api/v1') throw httpError(503, 'OpenRouter is not configured');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(process.env.OPENROUTER_TIMEOUT_MS || 180000));
      let providerResponse;
      try {
        providerResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'http-referer': `http://${config.host}:${config.port}`,
            'x-title': "Alzheimer's Research & Care Operations Hub",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You support bounded clinical operations review. Do not diagnose, prescribe, enroll, or change care. Require licensed human review, grounded evidence, and explicit uncertainty.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 1800,
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!providerResponse.ok) throw httpError(502, `OpenRouter returned ${providerResponse.status}`);
      const payload = await providerResponse.json();
      const result = payload?.choices?.[0]?.message?.content;
      const providerReceipt = providerResponse.headers.get('x-request-id') || payload?.id;
      if (typeof result !== 'string' || !result.trim() || !providerReceipt) throw httpError(502, 'OpenRouter returned an incomplete response');

      const saved = await transaction(pool, req.principal, async (client) => {
        const inserted = await client.query(
          `INSERT INTO runtime_ai_results(tenant_id,actor_subject,prompt_sha256,model,provider_receipt,result,usage)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id,created_at`,
          [req.principal.tenantId, req.principal.subject, digest(prompt), payload.model || model, providerReceipt, result, JSON.stringify(payload.usage || {})]
        );
        await audit(client, req.principal, 'runtime-ai.generated', 'runtime-ai-result', inserted.rows[0].id, 'clinical-operations-review', { model: payload.model || model, providerReceipt });
        return inserted.rows[0];
      });
      res.json({ id: saved.id, createdAt: saved.created_at, model: payload.model || model, result, usage: payload.usage || {}, actionable: false });
    } catch (error) { next(error); }
  });

  app.get('/api/bootstrap', async (req, res, next) => {
    try {
      const output = await transaction(pool, req.principal, async (client) => {
        let patientSql = `SELECT * FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`;
        const params = [req.principal.tenantId];
        if (req.principal.role === 'caregiver') {
          patientSql = `SELECT p.* FROM patients p JOIN caregiver_assignments ca ON ca.patient_id=p.id AND ca.tenant_id=p.tenant_id
                        WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND ca.caregiver_subject=$2 AND ca.valid_until > now() ORDER BY p.created_at DESC`;
          params.push(req.principal.subject);
        }
        const patientsResult = await client.query(patientSql, params);
        const recordsResult = await client.query(`SELECT * FROM clinical_records WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`, [req.principal.tenantId]);
        const consentsResult = await client.query(`SELECT * FROM consents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500`, [req.principal.tenantId]);
        const documentsResult = await client.query(`SELECT * FROM document_objects WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.principal.tenantId]);
        const aiResult = await client.query(`SELECT id,patient_id,intended_use,model,model_version,evidence,uncertainty,status,created_by,decided_by,decision_reason,created_at,decided_at FROM ai_reviews WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.principal.tenantId]);
        const modelsResult = await client.query(`SELECT id,model,model_version,intended_use,status,created_by,approved_by,created_at,approved_at FROM model_releases WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.principal.tenantId]);
        const jobsResult = can(req.principal, 'provider:write') ? await client.query(`SELECT id,patient_id,provider,operation,status,attempts,last_error_code,created_at,updated_at FROM provider_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.principal.tenantId]) : { rows: [] };
        const auditsResult = req.principal.role === 'administrator' ? await client.query(`SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 200`, [req.principal.tenantId]) : { rows: [] };
        const patientIds = new Set(patientsResult.rows.map((row) => row.id));
        const patients = patientsResult.rows.map((row) => {
          const profile = decryptJson(row.encrypted_profile, config.encryptionKey);
          if (req.principal.role === 'researcher') return { id: row.id, sourceSystem: row.source_system, stage: profile.stage, ageBand: profile.ageBand, version: row.version, patient: `Study participant ${digest(row.id).slice(0, 8)}` };
          return { id: row.id, ...profile, sourceSystem: row.source_system, sourcePatientId: row.source_patient_id, version: row.version };
        });
        const records = Object.fromEntries([...TABLE_TYPES].map((type) => [type, []]));
        recordsResult.rows.filter((row) => !row.patient_id || patientIds.has(row.patient_id)).forEach((row) => {
          if (records[row.record_type]) {
            const payload = decryptJson(row.encrypted_payload, config.encryptionKey);
            records[row.record_type].push({ id: row.id, patientId: row.patient_id, ...(req.principal.role === 'researcher' ? deidentify(payload) : payload), version: row.version, provenance: `${row.source_system}:${row.source_resource_id || 'local'}` });
          }
        });
        await audit(client, req.principal, 'workspace.viewed', 'workspace', null, 'care-operations', { minimumNecessary: true });
        return {
          modules: modules(),
          data: {
            patients, ...records,
            consentRecords: consentsResult.rows.filter((r) => patientIds.has(r.patient_id)).map((r) => ({ id: r.id, patientId: r.patient_id, purpose: r.purpose, status: r.status, validUntil: r.valid_until, source: r.source, version: r.version })),
            documents: documentsResult.rows.filter((r) => patientIds.has(r.patient_id)).map((r) => ({ id: r.id, patientId: r.patient_id, ...decryptJson(r.encrypted_metadata, config.encryptionKey), status: r.status, retentionUntil: r.retention_until, legalHold: r.legal_hold })),
            aiReviews: aiResult.rows.filter((r) => patientIds.has(r.patient_id)), aiModels: modelsResult.rows, providerJobs: jobsResult.rows, auditRecords: auditsResult.rows
          },
          summary: makeSummary(patients, consentsResult.rows, jobsResult.rows),
          aiCenter: { mode: 'Governed draft and independent clinician approval', model: 'Recorded per review', disclaimer: 'No AI output is actionable until a different licensed clinician approves it.' },
          user: req.principal
        };
      });
      res.json(output);
    } catch (error) { next(error); }
  });

  app.post('/api/patients', requirePermission('patient:write'), async (req, res, next) => {
    try {
      const { sourceSystem, sourcePatientId, profile } = req.body;
      if (!sourceSystem || !sourcePatientId || !profile?.patient || !profile?.dateOfBirth) throw httpError(400, 'sourceSystem, sourcePatientId, patient, and dateOfBirth are required');
      const identityDigest = digest(`${String(profile.patient).trim().toLowerCase()}|${profile.dateOfBirth}`);
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(
          `INSERT INTO patients(tenant_id,source_system,source_patient_id,identity_digest,encrypted_profile)
           VALUES($1,$2,$3,$4,$5) RETURNING id,version,created_at`,
          [req.principal.tenantId, sourceSystem, sourcePatientId, identityDigest, encryptJson(profile, config.encryptionKey)]
        );
        await audit(client, req.principal, 'patient.created', 'patient', result.rows[0].id, 'care-operations', { sourceSystem });
        return result.rows[0];
      });
      res.status(201).json({ patient: { ...row, ...profile } });
    } catch (error) { next(error.code === '23505' ? httpError(409, 'Patient already exists or identity match needs review') : error); }
  });

  app.put('/api/patients/:id', requirePermission('patient:write'), async (req, res, next) => {
    try {
      const { version, profile, correctionReason } = req.body;
      if (!Number.isInteger(version) || !profile || !correctionReason) throw httpError(400, 'version, profile, and correctionReason are required');
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(
          `UPDATE patients SET encrypted_profile=$1,identity_digest=$2,version=version+1,updated_at=now()
           WHERE tenant_id=$3 AND id=$4 AND version=$5 AND deleted_at IS NULL RETURNING id,version`,
          [encryptJson(profile, config.encryptionKey), digest(`${String(profile.patient).trim().toLowerCase()}|${profile.dateOfBirth}`), req.principal.tenantId, req.params.id, version]
        );
        if (!result.rowCount) throw httpError(409, 'Patient changed concurrently; reload before retrying');
        await audit(client, req.principal, 'patient.corrected', 'patient', req.params.id, 'care-operations', { correctionReason, priorVersion: version });
        return result.rows[0];
      });
      res.json({ patient: row });
    } catch (error) { next(error); }
  });

  app.post('/api/consents', requirePermission('consent:write'), async (req, res, next) => {
    try {
      const consent = assertConsent(req.body);
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(
          `INSERT INTO consents(tenant_id,patient_id,purpose,source,valid_until,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.principal.tenantId, consent.patientId, consent.purpose, consent.source, consent.validUntil, req.principal.subject]
        );
        await audit(client, req.principal, 'consent.recorded', 'consent', result.rows[0].id, consent.purpose);
        return result.rows[0];
      });
      res.status(201).json({ consent: row });
    } catch (error) { next(error); }
  });

  app.post('/api/consents/:id/revoke', requirePermission('consent:write'), async (req, res, next) => {
    try {
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(
          `UPDATE consents SET status='revoked',revoked_at=now(),version=version+1
           WHERE tenant_id=$1 AND id=$2 AND status='active' AND version=$3 RETURNING *`,
          [req.principal.tenantId, req.params.id, req.body.version]
        );
        if (!result.rowCount) throw httpError(409, 'Consent is no longer active or changed concurrently');
        await client.query(`UPDATE provider_jobs SET status='dead-letter',last_error_code='CONSENT_REVOKED',updated_at=now() WHERE tenant_id=$1 AND patient_id=$2 AND status IN ('queued','retryable')`, [req.principal.tenantId, result.rows[0].patient_id]);
        await audit(client, req.principal, 'consent.revoked', 'consent', req.params.id, result.rows[0].purpose, { propagation: 'queued-provider-jobs-cancelled' });
        return result.rows[0];
      });
      res.json({ consent: row });
    } catch (error) { next(error); }
  });

  app.post('/api/records', requirePermission('patient:write'), async (req, res, next) => {
    try {
      if (!TABLE_TYPES.has(req.body.recordType) || !req.body.payload) throw httpError(400, 'Known recordType and payload are required');
      const row = await transaction(pool, req.principal, async (client) => {
        if (req.body.patientId && !(await activeConsent(client, req.principal.tenantId, req.body.patientId, req.body.purpose || 'care-operations'))) throw httpError(409, 'Active purpose-specific consent is required');
        const result = await client.query(
          `INSERT INTO clinical_records(tenant_id,patient_id,record_type,encrypted_payload,source_system,source_resource_id,source_version,source_updated_at,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,source_system,source_resource_id,source_version)
           WHERE source_resource_id IS NOT NULL DO UPDATE SET updated_at=clinical_records.updated_at RETURNING id,version`,
          [req.principal.tenantId, req.body.patientId || null, req.body.recordType, encryptJson(req.body.payload, config.encryptionKey), req.body.sourceSystem || 'manual', req.body.sourceResourceId || null, req.body.sourceVersion || null, req.body.sourceUpdatedAt || null, req.principal.subject]
        );
        await audit(client, req.principal, 'clinical-record.ingested', req.body.recordType, result.rows[0].id, req.body.purpose || 'care-operations', { sourceSystem: req.body.sourceSystem || 'manual' });
        return result.rows[0];
      });
      res.status(201).json({ record: row });
    } catch (error) { next(error); }
  });

  app.all(['/api/table/:table', '/api/table/:table/:id'], requirePermission('patient:write'), async (req, res, next) => {
    try {
      const table = req.params.table;
      if (!TABLE_TYPES.has(table)) throw httpError(404, 'Unknown governed record table');
      if (req.method === 'GET') {
        const rows = await transaction(pool, req.principal, async (client) => {
          const result = await client.query(`SELECT * FROM clinical_records WHERE tenant_id=$1 AND record_type=$2 AND deleted_at IS NULL ORDER BY created_at DESC`, [req.principal.tenantId, table]);
          return result.rows.filter((row) => !row.patient_id || visiblePatient(req.principal, row.patient_id)).map((row) => ({ id: row.id, patientId: row.patient_id, ...decryptJson(row.encrypted_payload, config.encryptionKey), version: row.version }));
        });
        return res.json({ table, rows });
      }
      if (req.method === 'POST') {
        const payload = { ...req.body }; delete payload.actor; delete payload.id; delete payload.version;
        const created = await transaction(pool, req.principal, async (client) => {
          if (req.body.patientId && !(await activeConsent(client, req.principal.tenantId, req.body.patientId, 'care-operations'))) throw httpError(409, 'Active care-operations consent is required');
          const result = await client.query(`INSERT INTO clinical_records(tenant_id,patient_id,record_type,encrypted_payload,source_system,created_by) VALUES($1,$2,$3,$4,'manual-ui',$5) RETURNING id,version`, [req.principal.tenantId, req.body.patientId || null, table, encryptJson(payload, config.encryptionKey), req.principal.subject]);
          await audit(client, req.principal, 'clinical-record.created', table, result.rows[0].id, 'care-operations');
          return { ...result.rows[0], ...payload };
        });
        return res.status(201).json({ row: created });
      }
      if (!req.params.id) throw httpError(400, 'Record id is required');
      if (req.method === 'PUT') {
        const payload = { ...req.body }; delete payload.actor; delete payload.id; delete payload.version; delete payload.correctionReason;
        if (!Number.isInteger(req.body.version) || !req.body.correctionReason) throw httpError(400, 'version and correctionReason are required');
        const corrected = await transaction(pool, req.principal, async (client) => {
          const previous = await client.query(`SELECT * FROM clinical_records WHERE tenant_id=$1 AND id=$2 AND record_type=$3 AND version=$4 AND deleted_at IS NULL FOR UPDATE`, [req.principal.tenantId, req.params.id, table, req.body.version]);
          if (!previous.rowCount) throw httpError(409, 'Record changed concurrently; reload before retrying');
          await client.query(`UPDATE clinical_records SET deleted_at=now(),updated_at=now() WHERE id=$1`, [req.params.id]);
          const result = await client.query(`INSERT INTO clinical_records(tenant_id,patient_id,record_type,encrypted_payload,source_system,correction_of,version,created_by) VALUES($1,$2,$3,$4,'manual-correction',$5,$6,$7) RETURNING id,version`, [req.principal.tenantId, previous.rows[0].patient_id, table, encryptJson(payload, config.encryptionKey), req.params.id, req.body.version + 1, req.principal.subject]);
          await audit(client, req.principal, 'clinical-record.corrected', table, result.rows[0].id, 'care-operations', { correctionOf: req.params.id, reason: req.body.correctionReason });
          return { ...result.rows[0], ...payload };
        });
        return res.json({ row: corrected });
      }
      if (req.method === 'DELETE') {
        if (!req.query.reason) throw httpError(400, 'Deletion/correction propagation reason is required');
        const removed = await transaction(pool, req.principal, async (client) => {
          const result = await client.query(`UPDATE clinical_records SET deleted_at=now(),updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 AND record_type=$3 AND deleted_at IS NULL RETURNING id,patient_id`, [req.principal.tenantId, req.params.id, table]);
          if (!result.rowCount) throw httpError(404, 'Record not found');
          await client.query(`INSERT INTO provider_jobs(tenant_id,patient_id,provider,operation,idempotency_key,encrypted_request,created_by) VALUES($1,$2,'fhir','delete-propagation',$3,$4,$5) ON CONFLICT DO NOTHING`, [req.principal.tenantId, result.rows[0].patient_id, `delete:${req.params.id}`, encryptJson({ recordId: req.params.id, reason: req.query.reason }, config.encryptionKey), req.principal.subject]);
          await audit(client, req.principal, 'clinical-record.deleted', table, req.params.id, 'care-operations', { reason: req.query.reason, propagationQueued: true });
          return result.rows[0];
        });
        return res.json({ row: removed });
      }
      throw httpError(405, 'Method not allowed');
    } catch (error) { next(error); }
  });

  app.get('/api/export/:table', async (req, res, next) => {
    try {
      const table = req.params.table;
      if (!TABLE_TYPES.has(table) && table !== 'patients') throw httpError(404, 'Unknown export');
      const identified = can(req.principal, 'export:identified');
      if (!identified && !can(req.principal, 'export:deidentified')) throw httpError(403, 'Export permission is required');
      const rows = await transaction(pool, req.principal, async (client) => {
        let output;
        if (table === 'patients') {
          const result = await client.query(`SELECT id,encrypted_profile,version FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL`, [req.principal.tenantId]);
          output = result.rows.map((row) => identified ? { id: row.id, ...decryptJson(row.encrypted_profile, config.encryptionKey), version: row.version } : { participant: digest(row.id).slice(0, 12), version: row.version });
        } else {
          const result = await client.query(`SELECT id,patient_id,encrypted_payload,version FROM clinical_records WHERE tenant_id=$1 AND record_type=$2 AND deleted_at IS NULL`, [req.principal.tenantId, table]);
          output = result.rows.map((row) => identified ? { id: row.id, patientId: row.patient_id, ...decryptJson(row.encrypted_payload, config.encryptionKey), version: row.version } : { record: digest(row.id).slice(0, 12), participant: row.patient_id ? digest(row.patient_id).slice(0, 12) : '', ...deidentify(decryptJson(row.encrypted_payload, config.encryptionKey)), version: row.version });
        }
        await client.query(`INSERT INTO export_events(tenant_id,actor_subject,purpose,scope,identified,row_count) VALUES($1,$2,$3,$4,$5,$6)`, [req.principal.tenantId, req.principal.subject, req.query.purpose || 'authorized-operations', JSON.stringify({ table }), identified, output.length]);
        await audit(client, req.principal, 'export.created', 'export', null, req.query.purpose || 'authorized-operations', { table, identified, rowCount: output.length });
        return output;
      });
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n');
      res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${table}.csv"` }).send(csv);
    } catch (error) { next(error); }
  });

  app.post('/api/provider/jobs', requirePermission('provider:write'), async (req, res, next) => {
    try {
      if (!['fhir','object-store'].includes(req.body.provider) || !req.body.idempotencyKey || !req.body.request) throw httpError(400, 'provider, idempotencyKey, and request are required');
      const row = await transaction(pool, req.principal, async (client) => {
        if (req.body.patientId && !(await activeConsent(client, req.principal.tenantId, req.body.patientId, req.body.purpose || 'care-operations'))) throw httpError(409, 'Active purpose-specific consent is required');
        const result = await client.query(
          `INSERT INTO provider_jobs(tenant_id,patient_id,provider,operation,idempotency_key,encrypted_request,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,provider,idempotency_key) DO UPDATE SET updated_at=provider_jobs.updated_at RETURNING id,status,attempts`,
          [req.principal.tenantId, req.body.patientId || null, req.body.provider, req.body.operation || 'sync', req.body.idempotencyKey, encryptJson(req.body.request, config.encryptionKey), req.principal.subject]
        );
        await audit(client, req.principal, 'provider-job.queued', 'provider-job', result.rows[0].id, req.body.purpose || 'care-operations', { provider: req.body.provider });
        return result.rows[0];
      });
      res.status(202).json({ job: row });
    } catch (error) { next(error); }
  });

  app.post('/api/provider/jobs/:id/execute', requirePermission('provider:write'), async (req, res, next) => {
    let job;
    try {
      job = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(
          `UPDATE provider_jobs SET status='running',attempts=attempts+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','retryable') AND next_attempt_at <= now() RETURNING *`,
          [req.principal.tenantId, req.params.id]
        );
        if (!result.rowCount) throw httpError(409, 'Job is not executable');
        return result.rows[0];
      });
      const request = decryptJson(job.encrypted_request, config.encryptionKey);
      const response = job.provider === 'fhir' ? await provider.fhir(request, job.idempotency_key) : await provider.reserveObject(request, job.idempotency_key);
      const completed = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(`UPDATE provider_jobs SET status='succeeded',encrypted_response=$1,last_error_code=NULL,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING id,status,attempts`, [encryptJson(response, config.encryptionKey), req.principal.tenantId, job.id]);
        if (job.provider === 'object-store' && request.documentId) await client.query(`UPDATE document_objects SET status='stored' WHERE tenant_id=$1 AND id=$2 AND status='pending-upload'`, [req.principal.tenantId, request.documentId]);
        await audit(client, req.principal, 'provider-job.succeeded', 'provider-job', job.id, 'care-operations', { provider: job.provider, attempts: job.attempts });
        return result.rows[0];
      });
      res.json({ job: completed });
    } catch (error) {
      if (!job) return next(error);
      try {
        const failed = await transaction(pool, req.principal, async (client) => {
          const retry = error.retryable && job.attempts < 5;
          const result = await client.query(
            `UPDATE provider_jobs SET status=$1,last_error_code=$2,next_attempt_at=now() + ($3 * interval '1 minute'),updated_at=now()
             WHERE tenant_id=$4 AND id=$5 RETURNING id,status,attempts,last_error_code`,
            [retry ? 'retryable' : 'dead-letter', error.code || 'PROVIDER_ERROR', 2 ** job.attempts, req.principal.tenantId, job.id]
          );
          await audit(client, req.principal, 'provider-job.failed', 'provider-job', job.id, 'care-operations', { code: error.code || 'PROVIDER_ERROR', retry });
          return result.rows[0];
        });
        res.status(502).json({ error: 'Provider operation failed', job: failed });
      } catch (persistError) { next(persistError); }
    }
  });

  app.post('/api/documents', requirePermission('document:write'), async (req, res, next) => {
    try {
      const { patientId, fileName, contentSha256, retentionUntil } = req.body;
      if (!patientId || !fileName || !/^[a-f0-9]{64}$/i.test(contentSha256 || '') || new Date(retentionUntil) <= new Date()) throw httpError(400, 'patientId, fileName, SHA-256 checksum, and future retentionUntil are required');
      const row = await transaction(pool, req.principal, async (client) => {
        if (!(await activeConsent(client, req.principal.tenantId, patientId, 'care-operations'))) throw httpError(409, 'Active care-operations consent is required');
        const id = crypto.randomUUID();
        const objectKey = `${req.principal.tenantId}/${patientId}/${id}`;
        const result = await client.query(
          `INSERT INTO document_objects(id,tenant_id,patient_id,encrypted_metadata,object_key,content_sha256,retention_until,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,object_key,status`,
          [id, req.principal.tenantId, patientId, encryptJson({ fileName, documentType: req.body.documentType || 'clinical-document' }, config.encryptionKey), objectKey, contentSha256.toLowerCase(), retentionUntil, req.principal.subject]
        );
        const job = await client.query(
          `INSERT INTO provider_jobs(tenant_id,patient_id,provider,operation,idempotency_key,encrypted_request,created_by)
           VALUES($1,$2,'object-store','reserve-upload',$3,$4,$5) RETURNING id`,
          [req.principal.tenantId, patientId, `document:${id}`, encryptJson({ documentId: id, objectKey, contentSha256: contentSha256.toLowerCase(), contentType: req.body.contentType || 'application/octet-stream' }, config.encryptionKey), req.principal.subject]
        );
        await audit(client, req.principal, 'document.reserved', 'document', id, 'care-operations', { checksum: contentSha256.toLowerCase() });
        return { ...result.rows[0], providerJobId: job.rows[0].id };
      });
      res.status(201).json({ document: row });
    } catch (error) { next(error); }
  });

  app.post('/api/documents/:id/legal-hold', requirePermission('*'), async (req, res, next) => {
    try {
      if (typeof req.body.enabled !== 'boolean') throw httpError(400, 'enabled boolean is required');
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(`UPDATE document_objects SET legal_hold=$1 WHERE tenant_id=$2 AND id=$3 AND status <> 'deleted' RETURNING id,legal_hold`, [req.body.enabled, req.principal.tenantId, req.params.id]);
        if (!result.rowCount) throw httpError(404, 'Document not found');
        await audit(client, req.principal, req.body.enabled ? 'document.legal-hold-enabled' : 'document.legal-hold-disabled', 'document', req.params.id, 'records-retention');
        return result.rows[0];
      });
      res.json({ document: row });
    } catch (error) { next(error); }
  });

  app.delete('/api/documents/:id', requirePermission('*'), async (req, res, next) => {
    try {
      const row = await transaction(pool, req.principal, async (client) => {
        const current = await client.query(`SELECT * FROM document_objects WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [req.principal.tenantId, req.params.id]);
        if (!current.rowCount) throw httpError(404, 'Document not found');
        if (current.rows[0].legal_hold) throw httpError(409, 'Legal hold prevents deletion');
        if (new Date(current.rows[0].retention_until) > new Date()) throw httpError(409, 'Retention period has not elapsed');
        const result = await client.query(`UPDATE document_objects SET status='deleted' WHERE id=$1 RETURNING id,status`, [req.params.id]);
        await audit(client, req.principal, 'document.deletion-authorized', 'document', req.params.id, 'records-retention', { objectDeletionMustBeConfirmedByProvider: true });
        return result.rows[0];
      });
      res.json({ document: row });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/reviews', requirePermission('ai:draft'), async (req, res, next) => {
    try {
      const draft = assertAiDraft(req.body);
      const row = await transaction(pool, req.principal, async (client) => {
        if (!(await activeConsent(client, req.principal.tenantId, draft.patientId, 'care-operations'))) throw httpError(409, 'Active care-operations consent is required');
        const release = await client.query(
          `SELECT mr.id FROM model_releases mr WHERE mr.tenant_id=$1 AND mr.model=$2 AND mr.model_version=$3 AND mr.status='approved'
           AND EXISTS (SELECT 1 FROM ai_evaluation_runs er WHERE er.model_release_id=mr.id AND er.passed=true)`,
          [req.principal.tenantId, draft.model, draft.modelVersion]
        );
        if (!release.rowCount) throw httpError(409, 'Model version lacks an approved release and passing clinical evaluation');
        const result = await client.query(
          `INSERT INTO ai_reviews(tenant_id,patient_id,intended_use,model,model_version,prompt_sha256,encrypted_output,evidence,uncertainty,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status,created_at`,
          [req.principal.tenantId, draft.patientId, draft.intendedUse, draft.model, draft.modelVersion, digest(draft.prompt || ''), encryptJson(draft.output, config.encryptionKey), JSON.stringify(draft.evidence), draft.uncertainty, req.principal.subject]
        );
        await audit(client, req.principal, 'ai-review.drafted', 'ai-review', result.rows[0].id, 'care-operations', { model: draft.model, modelVersion: draft.modelVersion, uncertainty: draft.uncertainty });
        return result.rows[0];
      });
      res.status(201).json({ review: row, actionable: false });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/models', requirePermission('*'), async (req, res, next) => {
    try {
      if (!req.body.model || !req.body.modelVersion || !req.body.intendedUse) throw httpError(400, 'model, modelVersion, and intendedUse are required');
      const row = await transaction(pool, req.principal, async (client) => {
        const result = await client.query(`INSERT INTO model_releases(tenant_id,model,model_version,intended_use,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.principal.tenantId, req.body.model, req.body.modelVersion, req.body.intendedUse, req.principal.subject]);
        await audit(client, req.principal, 'model-release.registered', 'model-release', result.rows[0].id, 'clinical-ai-governance', { model: req.body.model, modelVersion: req.body.modelVersion });
        return result.rows[0];
      });
      res.status(201).json({ release: row });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/models/:id/evaluations', requirePermission('ai:approve'), async (req, res, next) => {
    try {
      if (!/^[a-f0-9]{64}$/i.test(req.body.evaluationSetSha256 || '') || !req.body.metrics || !req.body.thresholds || typeof req.body.passed !== 'boolean' || !/^https:\/\//.test(req.body.evidenceUri || '')) throw httpError(400, 'evaluation set digest, metrics, thresholds, pass decision, and HTTPS evidence URI are required');
      const row = await transaction(pool, req.principal, async (client) => {
        const release = await client.query(`SELECT * FROM model_releases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [req.principal.tenantId, req.params.id]);
        if (!release.rowCount) throw httpError(404, 'Model release not found');
        if (release.rows[0].created_by === req.principal.subject) throw httpError(409, 'Independent model evaluation is required');
        const result = await client.query(`INSERT INTO ai_evaluation_runs(tenant_id,model_release_id,evaluation_set_sha256,metrics,thresholds,passed,evidence_uri,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.principal.tenantId, req.params.id, req.body.evaluationSetSha256.toLowerCase(), req.body.metrics, req.body.thresholds, req.body.passed, req.body.evidenceUri, req.principal.subject]);
        await client.query(`UPDATE model_releases SET status=$1,approved_by=$2,approved_at=CASE WHEN $1='approved' THEN now() ELSE NULL END WHERE id=$3`, [req.body.passed ? 'approved' : 'pending', req.body.passed ? req.principal.subject : null, req.params.id]);
        await audit(client, req.principal, 'model-release.evaluated', 'model-release', req.params.id, 'clinical-ai-governance', { passed: req.body.passed, evaluationSetSha256: req.body.evaluationSetSha256.toLowerCase() });
        return result.rows[0];
      });
      res.status(201).json({ evaluation: row });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/reviews/:id/decision', requirePermission('ai:approve'), async (req, res, next) => {
    try {
      const row = await transaction(pool, req.principal, async (client) => {
        const current = await client.query(`SELECT * FROM ai_reviews WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [req.principal.tenantId, req.params.id]);
        if (!current.rowCount) throw httpError(404, 'AI review not found');
        assertApproval(current.rows[0], req.principal, req.body.decision);
        if (!req.body.reason) throw httpError(400, 'A clinical decision reason is required');
        const result = await client.query(`UPDATE ai_reviews SET status=$1,decided_by=$2,decision_reason=$3,decided_at=now() WHERE tenant_id=$4 AND id=$5 RETURNING id,status,decided_by,decided_at`, [req.body.decision, req.principal.subject, req.body.reason, req.principal.tenantId, req.params.id]);
        await audit(client, req.principal, `ai-review.${req.body.decision}`, 'ai-review', req.params.id, 'care-operations', { independentReview: true });
        return result.rows[0];
      });
      res.json({ review: row, actionable: row.status === 'approved' });
    } catch (error) { next(error); }
  });

  app.post('/api/restore-drills', requirePermission('*'), async (req, res, next) => {
    try {
      const result = await transaction(pool, req.principal, async (client) => {
        if (!req.body.backupReference || !['scheduled','passed','failed'].includes(req.body.status)) throw httpError(400, 'backupReference and valid status are required');
        const inserted = await client.query(`INSERT INTO restore_drills(tenant_id,backup_reference,status,evidence_uri,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.principal.tenantId, req.body.backupReference, req.body.status, req.body.evidenceUri || null, req.principal.subject]);
        await audit(client, req.principal, 'restore-drill.recorded', 'restore-drill', inserted.rows[0].id, 'disaster-recovery', { status: req.body.status });
        return inserted.rows[0];
      });
      res.status(201).json({ drill: result });
    } catch (error) { next(error); }
  });

  app.post('/api/incidents', requirePermission('*'), async (req, res, next) => {
    try {
      if (!['low','medium','high','critical'].includes(req.body.severity) || !req.body.summary) throw httpError(400, 'severity and summary are required');
      const result = await transaction(pool, req.principal, async (client) => {
        const inserted = await client.query(`INSERT INTO incidents(tenant_id,severity,summary,recorded_by) VALUES($1,$2,$3,$4) RETURNING id,severity,status,created_at`, [req.principal.tenantId, req.body.severity, req.body.summary, req.principal.subject]);
        await audit(client, req.principal, 'incident.opened', 'incident', inserted.rows[0].id, 'incident-response', { severity: req.body.severity });
        return inserted.rows[0];
      });
      res.status(201).json({ incident: result });
    } catch (error) { next(error); }
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, maxAge: config.production ? '1h' : 0 }));
  app.use((error, _req, res, _next) => {
    const known = error.status || ({ '23503': 409, '23505': 409, '22P02': 400 }[error.code]);
    const status = known || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message, code: error.code || undefined });
  });
  return app;
}

function modules() {
  return [
    ['patient-registry','Patient Registry','patients'], ['cognitive-timeline','Cognitive Timeline','cognitiveTimeline'],
    ['trial-matching','Trial Matching','trialMatches'], ['biomarker-imaging','Biomarker & Imaging','biomarkers'],
    ['neurology-scribe','Neurology Scribe','visitNotes'], ['remote-monitoring','Remote Monitoring','monitoring'],
    ['caregiver-support','Caregiver Support','caregiverTasks'], ['medication-safety','Medication Safety','medicationSafety'],
    ['document-vault','Document Vault','documents'], ['tasks','Tasks','tasks'], ['notifications','Notifications','notifications'],
    ['research-evidence','Research Evidence','evidence'], ['consent-governance','Consent Governance','consentRecords'],
    ['compliance','Compliance','auditRecords']
  ].map(([id,label,table]) => ({ id,label,table,description:`Governed ${label.toLowerCase()} workflow with tenant, consent, provenance, and audit controls.`,subfeatures:['Operations','Review queue','Governance'] }));
}

function makeSummary(patients, consents, jobs) {
  return { metrics: [
    { label: 'Visible patients', value: patients.length, detail: 'Minimum-necessary scope' },
    { label: 'Active consents', value: consents.filter((r) => r.status === 'active' && new Date(r.valid_until) > new Date()).length, detail: 'Purpose-scoped' },
    { label: 'Consent reviews', value: consents.filter((r) => r.status !== 'active' || new Date(r.valid_until) <= new Date()).length, detail: 'Revoked or expired' },
    { label: 'Provider retries', value: jobs.filter((r) => r.status === 'retryable').length, detail: 'Durable retry queue' },
    { label: 'Dead letters', value: jobs.filter((r) => r.status === 'dead-letter').length, detail: 'Operations attention' }
  ], workQueue: ['Review expiring purpose-specific consent', 'Resolve provider retries and dead letters', 'Verify source provenance and identity matches', 'Review AI uncertainty and evidence', 'Record backup restoration evidence'] };
}

function deidentify(payload) {
  const blocked = /name|patient|email|phone|address|birth|dob|mrn|identifier|caregiver/i;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !blocked.test(key)));
}

module.exports = { createApp, activeConsent };
