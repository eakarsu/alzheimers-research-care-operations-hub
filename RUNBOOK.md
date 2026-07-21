# Clinical operations runbook

## Deployment boundary

The service handles regulated clinical data only when deployed inside an organization-approved HIPAA environment. The deployment owner must establish a BAA and configure an approved OIDC or SAML gateway, PostgreSQL, encrypted object storage, FHIR endpoint, centralized logs, alerting, backups, and key management. No demo credentials or unsigned sessions are supported.

The application encrypts clinical JSON before database storage with AES-256-GCM. Database, snapshot, transport, and object-store encryption remain infrastructure controls. Store `DATA_ENCRYPTION_KEY_BASE64`, provider credentials, and the callback secret in a managed secret store; rotate them through the organization change process. Never commit `.env`.

## Provisioning and startup

1. Create a tenant row through the controlled operations process and map the identity-provider `tenant_id` claim to its UUID.
2. Map IdP groups to exactly one role: `administrator`, `clinician`, `coordinator`, `researcher`, or `caregiver`. Tokens must be RS256, at most 15 minutes old, and contain an MFA `amr` value. Caregiver access also requires a current `caregiver_assignments` row.
3. Copy `.env.example` into the secret-managed runtime configuration and replace every placeholder.
4. Apply schema changes once from a controlled release job: `ALLOW_SCHEMA_MIGRATION=1 ./start.sh migrate`. Migrations are replay-safe, but the application never runs them automatically.
5. Run `./start.sh check`, then `./start.sh start`. The server refuses to start if configuration, database connectivity, or the schema is missing.

## Providers, consent, and clinical AI

FHIR and object-store writes enter `provider_jobs` with tenant-scoped idempotency keys. Transient 429/5xx failures move to `retryable` with exponential delay; terminal failures and the fifth failed attempt move to `dead-letter`. Signed callbacks require `X-Tenant-Id`, `X-Delivery-Id`, and an HMAC-SHA256 `X-Signature`; delivery IDs are replay protected.

Every patient operation checks an active, unexpired consent for its declared purpose. Revocation cancels queued/retryable provider work. Corrections create a new clinical record linked to the prior record, while deletion queues source propagation instead of erasing history.

An AI model/version cannot produce a draft until an independent clinician records a passing evaluation set, metrics, thresholds, and evidence URI. Every draft records model lineage, prompt digest, grounded citations, and uncertainty. A different licensed clinician must approve it once before it is actionable. High uncertainty remains visibly recorded for the reviewer.

## Backup, restore, retention, and incidents

- Run encrypted PostgreSQL point-in-time backups and object versioning under the infrastructure retention policy. Monitor both.
- Perform a restoration into an isolated account at least quarterly. Validate record counts, checksum samples, tenant isolation, audit continuity, and object retrieval. Record the result through `POST /api/restore-drills` with an immutable evidence URI.
- Document objects cannot be deleted before `retention_until` or while `legal_hold` is active. A database deletion authorization still requires confirmation that the object provider removed the object.
- Route high-volume identified exports, repeated authentication failures, provider dead letters, and integrity alerts to the security operations platform. Open incidents through `POST /api/incidents`; follow the organization’s breach assessment and notification procedure.

## Recovery checks

After restoration, run migrations twice, `npm test` with `TEST_DATABASE_URL`, `./start.sh check`, and tenant-isolation probes. Do not reconnect restored provider queues until duplicate and consent checks are complete.

## External production blockers

Production activation still requires real IdP/SAML gateway configuration, authoritative FHIR/registry endpoints and patient-match policy, approved object storage/KMS and backup platform, BAAs and HIPAA risk assessment, licensed-clinician ownership, a validated evaluation set for each intended AI use, security monitoring integration, and a witnessed restore exercise. These dependencies cannot be supplied by repository code.
