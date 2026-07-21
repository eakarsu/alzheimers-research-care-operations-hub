# Completeness Review: alzheimers-research-care-operations-hub

**Review date:** 2026-07-18

## Assessment basis

Static inspection of project-owned source, configuration, and smoke tests only; no dependency installation, build, database migration, external-service call, or runtime launch was performed.

## Classification

**Complete local scope**

The repository implements a coherent local workflow for patient/caregiver records, trials, appointments, documents, consent, audit events, and AI-assisted review. The smoke script exercises login, health, record creation, upload metadata, and AI review. It is complete as a local operational demo, not as a clinical or HIPAA production system.

## Why it is not production-ready

- Authentication compares seeded plaintext demo passwords and returns an unsigned base64 token; protected API authorization is not enforced.
- Persistence is a seeded JSON file, so transactions, concurrent edits, backups, retention, and durable audit guarantees are absent.
- Patient, consent, trial, and document data are synthetic/local rather than synchronized with authoritative EHR, registry, payer, or identity sources.
- AI review can use OpenRouter but has no clinical evaluation set, grounded citation requirement, model-change control, or mandatory clinician approval gate.
- The smoke test proves only a happy-path local workflow; it does not cover access boundaries, consent expiration, data corruption, concurrency, or recovery.

## Needed features

1. Replace demo login with OIDC/SAML, MFA, signed sessions, and enforced least-privilege roles for clinicians, coordinators, researchers, caregivers, and administrators.
2. Move records and immutable audit events to a transactional database and encrypted object store with migrations, backups, retention, legal hold, and tested restoration.
3. Add FHIR/registry connectors, patient identity matching, consent-purpose enforcement, source provenance, and deletion/correction propagation.
4. Put all clinical AI output behind grounded evidence, safety/quality evaluations, model/version records, uncertainty handling, and licensed-clinician approval.
5. Add regulated-data controls: encryption/key management, minimum-necessary access, export monitoring, incident response, and HIPAA deployment documentation.
6. Expand automated coverage to authorization, consent revocation, adverse/missing data, concurrent updates, provider failure, audit immutability, and disaster recovery.

## Risks or launch blockers

- Demo credentials and unsigned tokens make the current API unsuitable for sensitive data.
- The bootstrap endpoint exposes the full local dataset, and mutation routes do not establish production-grade authorization boundaries.
- JSON persistence and mutable in-process auditing cannot support clinical record integrity or reliable recovery.
- AI recommendations could be mistaken for clinical guidance without a hard human-review boundary and validated intended-use statement.

## Evidence inspected

- `README.md:82`
- `server.js:229`
- `server.js:250`
- `server.js:519`
- `server.js:440`
- `scripts/smoke-test.js:28`

## Recommended next action

Keep this as a local demo while building a security-first clinical foundation: production identity, transactional storage, consent-aware FHIR ingestion, and an authorization test suite should land before any additional care or AI feature.

## Implementation progress (2026-07-19)

Implemented the source-actionable production foundation. The API now verifies short-lived RS256 OIDC/SAML-gateway tokens with issuer, audience, tenant, role, and MFA claims; removes password login and unsigned sessions; enforces administrator, clinician, coordinator, researcher, and assigned-caregiver boundaries; and serves a role-aware SSO UI. PostgreSQL migrations add encrypted tenant-scoped patient and clinical records, identity collision detection, optimistic concurrency and correction lineage, purpose-specific consent with revocation propagation, encrypted document metadata with checksums/retention/legal hold, monitored de-identified or identified exports, incidents, restoration evidence, durable provider jobs, replay-safe signed callbacks, and database-enforced append-only audit events.

FHIR/object-store adapters carry idempotency keys and persist success, retryable failure with backoff, or dead-letter outcomes. AI drafts now require an approved model/version, an independently recorded passing clinical evaluation set and thresholds, grounded evidence citations, uncertainty and prompt lineage; drafts remain non-actionable until a different licensed clinician makes a single approval/rejection decision. Startup validates configuration and schema without auto-migrating or killing processes; migrations require explicit opt-in. A non-root container, replay-safe migration, CI, example environment, and clinical runbook cover backups, restoration, retention, incident response, key/provider operations, and HIPAA responsibility boundaries.

Verification completed against disposable PostgreSQL database `clinical_codex_alzheimers_20260719`: the migration was applied twice; all 10 tests passed, including real HTTP/PostgreSQL coverage of MFA rejection, five roles, tenant and caregiver isolation, identity collision, consent revocation, concurrent correction conflict, encrypted object reservation, legal hold, provider idempotency/failure, callback replay protection, AI evaluation and independent approval, de-identified export, incident/restore evidence, and audit immutability. JavaScript and shell syntax checks, startup configuration/schema check, `npm audit` (zero vulnerabilities), and `git diff --check` passed.

External deployment dependencies remain explicit: production still requires the organization’s IdP/SAML gateway, authoritative FHIR/registry and patient-matching policy, approved object storage/KMS/backups, BAAs and HIPAA risk assessment, security monitoring, licensed-clinician governance, validated intended-use evaluation datasets, and a witnessed infrastructure restore exercise.

## Runtime verification — 2026-07-20

The launcher was verified with disposable PostgreSQL on port `55630` and the API on `6074`. The explicitly non-production local acceptance path persisted a scrypt-hashed administrator, issued a short-lived ephemeral-key RS256 token, and verified `/api/session`; production remains organization-SSO-only and still requires MFA. The validator recorded `API_VERIFIED / startup_login_session_api`. Ten isolated tests and the real HTTP/PostgreSQL regulated-data workflow passed, with the integration server pinned to `6074`. No assigned port remained open afterward.
