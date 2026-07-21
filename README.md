# Alzheimer's Research & Care Operations Hub

A tenant-scoped clinical and research operations service for patient records, cognitive timelines, trial coordination, biomarkers, remote monitoring, caregiver work, consent, documents, and governed AI review.

This software supports operations; it is not a diagnostic device. Diagnosis, treatment, enrollment, and medication decisions remain with licensed clinicians.

## Security and data architecture

- Organization OIDC/SAML gateway authentication using short-lived RS256 tokens, issuer/audience validation, and mandatory MFA.
- Least-privilege `administrator`, `clinician`, `coordinator`, `researcher`, and `caregiver` roles. Caregiver access is limited to current assignments; research views and exports are de-identified.
- Transactional PostgreSQL records scoped by tenant, encrypted clinical payloads, optimistic concurrency, correction lineage, and append-only audit events.
- Purpose-specific consent with expiration and revocation propagation.
- FHIR and object-store provider jobs with idempotency, retry/dead-letter state, signed callback verification, and replay protection.
- Document checksums, retention dates, legal holds, monitored exports, incident records, and restoration evidence.
- Clinical AI model release controls, recorded evaluation sets and thresholds, grounded citations, uncertainty, model/version lineage, and independent clinician approval.

## Local verification

Node.js 18+ and PostgreSQL are required.

```bash
npm ci
cp .env.example .env
# Replace every placeholder and point DATABASE_URL at a disposable database.
ALLOW_SCHEMA_MIGRATION=1 ./start.sh migrate
./start.sh check
npm test
./start.sh start
```

`npm test` always runs the unit, authorization, cryptography, consent, AI, callback, and provider-failure tests. Set `TEST_DATABASE_URL` to also run the real HTTP/PostgreSQL end-to-end test. That test applies the migration twice and covers MFA rejection, all five roles, tenant isolation, caregiver assignments, patient identity collision, consent revocation, correction conflicts, provider replay/failure, signed callback replay, AI evaluation/approval, de-identified exports, restore evidence, and audit immutability.

The app never auto-migrates and never kills another process. Startup fails closed when secrets, TLS database mode in production, database access, or schema state are invalid.

## API workflow

1. An authorized coordinator creates or identity-matches a patient.
2. A clinician or coordinator records purpose-scoped consent.
3. Clinical records, object reservations, and FHIR provider jobs require current consent and retain provenance.
4. An administrator registers an AI model release; a different clinician records its evaluation evidence and pass/fail decision.
5. Authorized users record grounded AI drafts. A different clinician approves or rejects each draft exactly once.
6. Administrators monitor immutable audit and exports, legal holds, incidents, dead letters, and restore drills.

See [RUNBOOK.md](RUNBOOK.md) for deployment, HIPAA responsibility boundaries, provider recovery, retention, legal hold, incident response, and remaining external production dependencies.
