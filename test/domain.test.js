const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { assertConsent, assertAiDraft, assertApproval } = require('../src/domain');
const { authenticate, can, encryptJson, decryptJson, signCallback, safeEqualHex } = require('../src/security');
const { loadConfig } = require('../src/config');
const { createProvider } = require('../src/provider');
const { hashLocalPassword, verifyLocalPassword } = require('../src/local-auth');

function keys() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }

test('OIDC token requires RS256, issuer, audience, tenant, role, and MFA', () => {
  const pair = keys();
  const config = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), oidcIssuer: 'https://id.test/', oidcAudience: 'hub' };
  const token = jwt.sign({ tenant_id: crypto.randomUUID(), role: 'clinician', amr: ['pwd', 'mfa'] }, pair.privateKey, { algorithm: 'RS256', subject: 'doctor-1', issuer: config.oidcIssuer, audience: config.oidcAudience, expiresIn: '5m' });
  assert.equal(authenticate(token, config).role, 'clinician');
  const weak = jwt.sign({ tenant_id: crypto.randomUUID(), role: 'clinician', amr: ['pwd'] }, pair.privateKey, { algorithm: 'RS256', subject: 'doctor-1', issuer: config.oidcIssuer, audience: config.oidcAudience, expiresIn: '5m' });
  assert.throws(() => authenticate(weak, config), /Multi-factor/);
});

test('local acceptance passwords use scrypt and never weaken production MFA', () => {
  const digest = hashLocalPassword('RuntimeAcceptance123!');
  assert.match(digest, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(verifyLocalPassword('RuntimeAcceptance123!', digest), true);
  assert.equal(verifyLocalPassword('wrong-password', digest), false);
  const pair = keys();
  const config = {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    oidcIssuer: 'https://id.test/', oidcAudience: 'hub', allowLocalPasswordAuth: true
  };
  const local = jwt.sign(
    { tenant_id: crypto.randomUUID(), role: 'administrator', amr: ['pwd'], auth_context: 'local-development' },
    pair.privateKey,
    { algorithm: 'RS256', subject: 'local-admin', issuer: config.oidcIssuer, audience: config.oidcAudience, expiresIn: '5m' }
  );
  assert.equal(authenticate(local, config).role, 'administrator');
  assert.throws(() => authenticate(local, { ...config, allowLocalPasswordAuth: false }), /Multi-factor/);
});

test('least privilege distinguishes clinical, research, caregiver, and admin capabilities', () => {
  assert.equal(can({ role: 'clinician' }, 'ai:approve'), true);
  assert.equal(can({ role: 'researcher' }, 'export:identified'), false);
  assert.equal(can({ role: 'caregiver' }, 'patient:write'), false);
  assert.equal(can({ role: 'administrator' }, 'restore:anything'), true);
});

test('clinical payload encryption authenticates and round trips', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptJson({ patient: 'private', score: 18 }, key);
  assert.equal(encrypted.includes('private'), false);
  assert.deepEqual(decryptJson(encrypted, key), { patient: 'private', score: 18 });
  assert.throws(() => decryptJson(`${encrypted.slice(0, -2)}aa`, key));
});

test('consent validation rejects expired and unknown purposes', () => {
  assert.throws(() => assertConsent({ patientId: 'p', purpose: 'marketing', validUntil: '2099-01-01' }), /Unsupported/);
  assert.throws(() => assertConsent({ patientId: 'p', purpose: 'care-operations', validUntil: '2020-01-01' }), /future/);
  assert.equal(assertConsent({ patientId: 'p', purpose: 'trial-outreach', validUntil: '2099-01-01' }).purpose, 'trial-outreach');
});

test('AI drafts require grounded citations, model lineage, and uncertainty', () => {
  const valid = { patientId: 'p', intendedUse: 'review', model: 'm', modelVersion: '1', output: 'draft', uncertainty: 'high', evidence: [{ title: 'Study', uri: 'https://example.test/study', excerpt: 'Relevant result' }] };
  assert.equal(assertAiDraft(valid), valid);
  assert.throws(() => assertAiDraft({ ...valid, evidence: [] }), /citation/);
});

test('AI decisions require a different clinician and are single-use', () => {
  const review = { created_by: 'doctor-1', status: 'draft' };
  assert.throws(() => assertApproval(review, { subject: 'doctor-1', role: 'clinician' }, 'approved'), /Independent/);
  assert.doesNotThrow(() => assertApproval(review, { subject: 'doctor-2', role: 'clinician' }, 'approved'));
  assert.throws(() => assertApproval({ ...review, status: 'approved' }, { subject: 'doctor-2', role: 'clinician' }, 'approved'), /draft/);
});

test('callback signatures reject malformed and changed bodies', () => {
  const signature = signCallback('{"ok":true}', 'a'.repeat(32));
  assert.equal(safeEqualHex(signature, signCallback('{"ok":true}', 'a'.repeat(32))), true);
  assert.equal(safeEqualHex(signature, signCallback('{"ok":false}', 'a'.repeat(32))), false);
  assert.equal(safeEqualHex('bad', signature), false);
});

test('provider adapters classify retryable and terminal failure', async () => {
  const provider = createProvider({ fhirEnabled: true, fhirBaseUrl: 'https://fhir.test', fhirToken: 'token' }, async () => ({ ok: false, status: 503 }));
  await assert.rejects(provider.fhir({ resourceType: 'Patient', resource: {} }, 'key'), (error) => error.retryable && error.code === 'FHIR_503');
  const disabled = createProvider({ fhirEnabled: false });
  await assert.rejects(disabled.fhir({}, 'key'), (error) => !error.retryable && error.code === 'PROVIDER_DISABLED');
});

test('production configuration rejects placeholders, weak keys, and non-TLS database mode', () => {
  const pair = keys();
  const base = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://service:secret@db.internal/hub', DATABASE_SSL: 'require',
    OIDC_ISSUER: 'https://id.internal/', OIDC_AUDIENCE: 'hub', OIDC_LOGIN_URL: 'https://id.internal/login',
    AUTH_PUBLIC_KEY_BASE64: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
    DATA_ENCRYPTION_KEY_BASE64: crypto.randomBytes(32).toString('base64'), CALLBACK_SIGNING_SECRET: 's'.repeat(32)
  };
  assert.equal(loadConfig(base).production, true);
  assert.throws(() => loadConfig({ ...base, DATABASE_SSL: 'disable' }), /mandatory/);
  assert.throws(() => loadConfig({ ...base, CALLBACK_SIGNING_SECRET: 'short' }), /at least 32/);
});
