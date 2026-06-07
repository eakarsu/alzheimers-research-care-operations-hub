# Alzheimer's Research & Care Operations Hub

A standalone sidebar app for Alzheimer's research operations, clinical trial matching, neurology care coordination, biomarker tracking, remote monitoring, caregiver support, medication safety, evidence review, compliance, and AI-assisted workflow drafting.

This app is designed as an operational and research-support platform. It is not a diagnostic device and does not replace licensed clinical judgment.

## Run

```bash
cd /Users/erolakarsu/external/projects/alzheimers-research-care-operations-hub
chmod +x start.sh
./start.sh
```

Open:

```text
http://localhost:5311
```

## Implemented Features

- Sidebar app shell with dashboard and feature navigation
- Feature/subfeature drill-downs
- Seeded datasets with at least 15 records per major operational table
- Patient registry and longitudinal cognitive timeline
- Trial matching and recruitment operations
- Biomarker, imaging, lab, and report workspace
- Neurology scribe and cognitive assessment documentation
- Remote patient monitoring and safety events
- Caregiver support and care-plan tasks
- Medication reconciliation, interactions, and adverse-event tracking
- Research evidence and study tracker
- Professional AI Center view that summarizes AI outputs instead of showing raw JSON
- Consent, audit, governance, and compliance workflows
- Reports and export-ready operational summaries
- Login with demo users and role labels
- Persistent local JSON store in `data/store.local.json`
- Create, edit, and delete records from the UI
- CSV export endpoints for every operational table
- Document upload metadata workflow
- Task queue and notification management
- Real-AI-ready OpenRouter endpoint with local fallback
- Smoke test covering login, CRUD, upload, and export

## Demo Logins

```text
admin@alzheimers.local / admin123
clinician@alzheimers.local / clinician123
coordinator@alzheimers.local / coordinator123
```

## Test

```bash
npm test
```

The test starts a temporary local server and checks health, login, CRUD, upload, and CSV export.

## Source Apps To Reuse Later

The app is intentionally separated, but it can later integrate modules or data models from:

- `AIClinicalTrialMatching`
- `AIPharmaTrialDesigner`
- `AIAcceleratedrug`
- `AIRemotePatientMonitoring`
- `AIElderCareCompanion`
- `AIHealthcareCompanion`
- `AIDrugInteractionChecker`
- `ai-medical-scribe-practice-suite`
- `ai-personalized-medicine`
- `clinical-life-sciences-suite`
- `biotech-research-operations-suite`
- `medical-device-quality-suite`
- `patient-access-scheduling-suite`

## Safety Boundary

Use this app for workflow support, research operations, patient coordination, and documentation. Any diagnosis, risk score, treatment plan, medication change, or trial recommendation requires licensed clinical review, patient consent, and regulatory validation before production use.

## Remaining Production Hardening

The app now has a complete feature surface for local operations and demos. For a real clinical deployment, replace demo login with a production identity provider, move persistence from JSON to Postgres, add encrypted file storage, configure HIPAA infrastructure controls, and validate all AI workflows under clinical governance.
