const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name, env = process.env) {
  const value = env[name];
  if (!value || /change-me|replace-with|example\.org|base64-encoded/i.test(value)) {
    throw new Error(`${name} must be configured with a non-placeholder value`);
  }
  return value;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const allowLocalPasswordAuth = !production && env.ENABLE_LOCAL_PASSWORD_AUTH === 'true';
  const databaseUrl = required('DATABASE_URL', env);
  const localPair = allowLocalPasswordAuth ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) : null;
  const publicKey = localPair
    ? localPair.publicKey.export({ type: 'spki', format: 'pem' })
    : Buffer.from(required('AUTH_PUBLIC_KEY_BASE64', env), 'base64').toString('utf8');
  if (!publicKey.includes('BEGIN PUBLIC KEY')) throw new Error('AUTH_PUBLIC_KEY_BASE64 must contain an RS256 public key');
  const localSecret = allowLocalPasswordAuth ? required('JWT_SECRET', env) : '';
  const encryptionKey = allowLocalPasswordAuth && !env.DATA_ENCRYPTION_KEY_BASE64
    ? crypto.createHash('sha256').update(`alz-local-encryption:${localSecret}`).digest()
    : Buffer.from(required('DATA_ENCRYPTION_KEY_BASE64', env), 'base64');
  if (encryptionKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes');
  const callbackSecret = allowLocalPasswordAuth && !env.CALLBACK_SIGNING_SECRET
    ? crypto.createHash('sha256').update(`alz-local-callback:${localSecret}`).digest('hex')
    : required('CALLBACK_SIGNING_SECRET', env);
  if (callbackSecret.length < 32) throw new Error('CALLBACK_SIGNING_SECRET must be at least 32 characters');
  const fhirEnabled = env.FHIR_ENABLED === 'true';
  const objectStoreEnabled = env.OBJECT_STORE_ENABLED === 'true';
  const config = {
    env: env.NODE_ENV || 'development', production,
    host: env.HOST || '127.0.0.1', port: Number(env.PORT || 5311), databaseUrl,
    databaseSsl: env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false,
    oidcIssuer: allowLocalPasswordAuth ? (env.OIDC_ISSUER || 'http://127.0.0.1/local-identity') : required('OIDC_ISSUER', env),
    oidcAudience: allowLocalPasswordAuth ? (env.OIDC_AUDIENCE || 'alzheimers-care-hub-local') : required('OIDC_AUDIENCE', env),
    oidcLoginUrl: allowLocalPasswordAuth ? (env.OIDC_LOGIN_URL || '/login') : required('OIDC_LOGIN_URL', env),
    publicKey, privateKey: localPair?.privateKey, encryptionKey, callbackSecret, allowLocalPasswordAuth,
    fhirEnabled, fhirBaseUrl: env.FHIR_BASE_URL, fhirToken: env.FHIR_BEARER_TOKEN,
    objectStoreEnabled, objectStoreBaseUrl: env.OBJECT_STORE_BASE_URL,
    objectStoreToken: env.OBJECT_STORE_BEARER_TOKEN, objectStoreBucket: env.OBJECT_STORE_BUCKET,
    allowMigration: env.ALLOW_SCHEMA_MIGRATION === '1'
  };
  if (fhirEnabled) {
    required('FHIR_BASE_URL', env); required('FHIR_BEARER_TOKEN', env);
  }
  if (objectStoreEnabled) {
    required('OBJECT_STORE_BASE_URL', env); required('OBJECT_STORE_BEARER_TOKEN', env); required('OBJECT_STORE_BUCKET', env);
  }
  if (production && !config.databaseSsl) throw new Error('DATABASE_SSL=require is mandatory in production');
  if (!Number.isInteger(config.port) || config.port < 1) throw new Error('PORT must be a valid TCP port');
  return config;
}

module.exports = { loadConfig };
