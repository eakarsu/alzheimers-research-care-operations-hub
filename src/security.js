const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const ROLES = new Set(['administrator', 'clinician', 'coordinator', 'researcher', 'caregiver']);
const PERMISSIONS = {
  administrator: ['*'],
  clinician: ['patient:read', 'patient:write', 'consent:write', 'document:write', 'ai:draft', 'ai:approve', 'export:identified'],
  coordinator: ['patient:read', 'patient:write', 'consent:write', 'document:write', 'provider:write', 'export:identified'],
  researcher: ['patient:deidentified', 'export:deidentified'],
  caregiver: ['patient:assigned']
};

function authenticate(token, config) {
  const claims = jwt.verify(token, config.publicKey, {
    algorithms: ['RS256'], issuer: config.oidcIssuer, audience: config.oidcAudience,
    clockTolerance: 5, maxAge: '15m'
  });
  const role = String(claims.role || '').toLowerCase();
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  if (!claims.sub || !claims.tenant_id || !ROLES.has(role)) throw new Error('Identity is missing required subject, tenant, or role claims');
  const localDevelopmentSession = config.allowLocalPasswordAuth && claims.auth_context === 'local-development';
  if (!localDevelopmentSession && !amr.some((value) => ['mfa', 'otp', 'hwk'].includes(value))) throw new Error('Multi-factor authentication is required');
  return { subject: claims.sub, tenantId: claims.tenant_id, role, patientIds: claims.patient_ids || [], email: claims.email || null };
}

function can(principal, permission) {
  const allowed = PERMISSIONS[principal.role] || [];
  return allowed.includes('*') || allowed.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => can(req.principal, permission) ? next() : res.status(403).json({ error: 'Forbidden', permission });
}

function encryptJson(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
}

function decryptJson(value, key) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function signCallback(body, secret) { return crypto.createHmac('sha256', secret).update(body).digest('hex'); }
function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

module.exports = { authenticate, can, requirePermission, encryptJson, decryptJson, digest, signCallback, safeEqualHex };
