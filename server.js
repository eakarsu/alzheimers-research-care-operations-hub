const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

loadEnv();

const PORT = Number(process.env.PORT || 5311);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORE_FILE = path.join(__dirname, 'data', 'store.local.json');

const stages = ['Subjective Cognitive Decline', 'Mild Cognitive Impairment', 'Mild Dementia', 'Moderate Dementia'];
const statuses = ['Stable', 'Watch', 'Escalate', 'Review'];
const sites = ['North Memory Clinic', 'Riverbend Neurology', 'Cedar Trial Site', 'Metro Aging Center'];

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateBack(days) {
  const d = new Date(Date.UTC(2026, 5, 7));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function makePatients() {
  const lastNames = ['Aydin', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Farrell', 'Garcia', 'Hughes', 'Ivanov', 'Johnson', 'Kim', 'Lopez', 'Miller', 'Nair', 'Owens'];
  const firstNames = ['Maya', 'Noah', 'Aylin', 'Lena', 'Owen', 'Nora', 'Iris', 'Evan', 'Ada', 'Murat', 'Leyla', 'Sam', 'Mina', 'Arda', 'Elif'];
  return lastNames.map((last, i) => ({
    id: `ALZ-P-${pad(i + 1)}`,
    patient: `${firstNames[i]} ${last}`,
    age: 58 + (i % 18),
    stage: stages[i % stages.length],
    clinician: ['Dr. Demir', 'Dr. Patel', 'Dr. Nguyen', 'Dr. Morrison'][i % 4],
    caregiver: ['Spouse', 'Adult child', 'Sibling', 'Home aide'][i % 4],
    apoe: ['E3/E3', 'E3/E4', 'E2/E3', 'Pending'][i % 4],
    consent: ['Research consent active', 'Care consent active', 'Needs renewal'][i % 3],
    risk: statuses[i % statuses.length],
    nextVisit: dateBack(-7 - i),
    summary: ['Memory complaints with preserved ADLs', 'Progressive recall issues', 'Medication adherence concern', 'Trial-interest profile complete'][i % 4]
  }));
}

function makeCognitiveTimeline(patients) {
  return patients.map((p, i) => ({
    id: `COG-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    assessmentDate: dateBack(i * 11),
    mmse: 30 - (i % 9),
    moca: 28 - (i % 10),
    cdr: ['0.5', '1.0', '1.5', '2.0'][i % 4],
    trend: ['Improving documentation', 'Stable', 'Slow decline', 'Needs clinical review'][i % 4],
    signal: ['Word recall', 'Executive function', 'Orientation', 'Caregiver concern'][i % 4]
  }));
}

function makeTrialMatches(patients) {
  return patients.map((p, i) => ({
    id: `TRIAL-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    study: ['Anti-amyloid early AD study', 'Tau PET observational cohort', 'Digital cognitive biomarker study', 'Caregiver intervention trial'][i % 4],
    site: sites[i % sites.length],
    matchScore: 92 - (i % 12),
    stageFit: p.stage,
    blocker: ['None', 'APOE status pending', 'MRI report needed', 'Caregiver schedule'][i % 4],
    status: ['Ready for coordinator review', 'Needs document', 'Invite queued', 'Clinician approval needed'][i % 4]
  }));
}

function makeBiomarkers(patients) {
  return patients.map((p, i) => ({
    id: `BIO-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    modality: ['Amyloid PET', 'Tau PET', 'CSF panel', 'MRI volumetric report'][i % 4],
    result: ['Positive', 'Borderline', 'Negative', 'Pending interpretation'][i % 4],
    reportDate: dateBack(i * 17),
    hippocampalVolume: `${(4.1 - (i % 6) * 0.18).toFixed(2)} cc`,
    confidence: ['High', 'Medium', 'Needs source report'][i % 3],
    nextStep: ['Review with neurologist', 'Request source report', 'Coordinate lab follow-up', 'Discuss trial eligibility'][i % 4]
  }));
}

function makeVisitNotes(patients) {
  return patients.map((p, i) => ({
    id: `NOTE-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    visitType: ['Initial neurology consult', 'Follow-up', 'Caregiver conference', 'Trial screening visit'][i % 4],
    noteStatus: ['Draft ready', 'Needs clinician signature', 'Coding review', 'Finalized'][i % 4],
    chiefConcern: ['Short-term memory', 'Medication confusion', 'Driving safety', 'Trial options'][i % 4],
    cognitiveTest: ['MoCA', 'MMSE', 'CDR', 'AD8'][i % 4],
    documentationGap: ['None', 'Collateral history', 'Functional assessment', 'Medication list'][i % 4]
  }));
}

function makeMonitoring(patients) {
  return patients.map((p, i) => ({
    id: `RPM-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    adherence: `${86 + (i % 13)}%`,
    sleepChange: ['Normal', 'Fragmented', 'Late bedtime drift', 'Daytime sleep increase'][i % 4],
    activity: ['Baseline', 'Reduced walking', 'Missed check-ins', 'Improved routine'][i % 4],
    safetyEvent: ['None', 'Wander alert', 'Fall-risk flag', 'Stove-left-on report'][i % 4],
    action: ['No action', 'Call caregiver', 'Escalate to nurse', 'Schedule safety review'][i % 4]
  }));
}

function makeCaregiverTasks(patients) {
  return patients.map((p, i) => ({
    id: `CARE-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    owner: ['Caregiver', 'Nurse navigator', 'Social worker', 'Trial coordinator'][i % 4],
    task: ['Medication organizer setup', 'Home safety checklist', 'Advance care planning packet', 'Transportation plan'][i % 4],
    dueDate: dateBack(-3 - i),
    burdenLevel: ['Low', 'Medium', 'High'][i % 3],
    status: ['Open', 'In progress', 'Waiting on family', 'Complete'][i % 4]
  }));
}

function makeMedicationSafety(patients) {
  return patients.map((p, i) => ({
    id: `MED-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    medication: ['Donepezil', 'Memantine', 'Lecanemab review', 'Anticholinergic risk med'][i % 4],
    concern: ['Dose check', 'Interaction review', 'ARIA monitoring needed', 'Cognitive side-effect concern'][i % 4],
    severity: ['Low', 'Medium', 'High', 'Clinical review'][i % 4],
    status: ['Pharmacist review', 'Clinician review', 'Caregiver education', 'Resolved'][i % 4],
    nextStep: ['Confirm list', 'Schedule MRI monitoring', 'Call pharmacy', 'Document adverse event'][i % 4]
  }));
}

function makeEvidence() {
  return Array.from({ length: 15 }, (_, i) => ({
    id: `EVID-${pad(i + 1)}`,
    topic: ['Anti-amyloid therapy', 'Tau biomarker', 'Blood-based biomarkers', 'Lifestyle and prevention', 'Caregiver intervention'][i % 5],
    sourceType: ['Peer-reviewed paper', 'Clinical trial registry', 'Guideline update', 'Internal hypothesis'][i % 4],
    finding: ['Potential earlier-stage benefit', 'Requires safety monitoring', 'Useful for screening funnel', 'Needs replication'][i % 4],
    impact: ['Trial design', 'Care pathway', 'Patient matching', 'Monitoring workflow'][i % 4],
    owner: ['Research lead', 'Neurologist', 'Trial coordinator', 'Compliance reviewer'][i % 4],
    status: ['New', 'In review', 'Adopted into workflow', 'Parked'][i % 4]
  }));
}

function makeAuditRecords(patients) {
  return patients.map((p, i) => ({
    id: `AUD-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    event: ['Consent viewed', 'Trial match generated', 'AI draft reviewed', 'Report exported'][i % 4],
    actor: ['admin@alzheimers.local', 'clinician@alzheimers.local', 'coordinator@alzheimers.local'][i % 3],
    date: dateBack(i * 3),
    control: ['HIPAA minimum necessary', 'Research consent', 'Clinician attestation', 'Audit retained'][i % 4],
    status: ['Compliant', 'Review', 'Needs renewal'][i % 3]
  }));
}

function makeDocuments(patients) {
  return patients.map((p, i) => ({
    id: `DOC-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    documentType: ['MRI report', 'PET report', 'CSF lab', 'Consent packet', 'Medication list'][i % 5],
    fileName: `${p.id.toLowerCase()}-${['mri', 'pet', 'csf', 'consent', 'meds'][i % 5]}.pdf`,
    receivedDate: dateBack(i * 5),
    reviewer: ['Neurologist', 'Trial coordinator', 'Compliance reviewer', 'Pharmacist'][i % 4],
    status: ['Ready for review', 'Missing signature', 'Reviewed', 'Needs source document'][i % 4]
  }));
}

function makeConsentRecords(patients) {
  return patients.map((p, i) => ({
    id: `CONS-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    consentType: ['Care coordination', 'Research registry', 'Trial outreach', 'Remote monitoring'][i % 4],
    signedDate: dateBack(90 + i),
    expiresDate: dateBack(-120 + i),
    dataUse: ['Care operations', 'De-identified research', 'Trial pre-screening', 'Device monitoring'][i % 4],
    status: ['Active', 'Needs renewal', 'Active', 'Legal review'][i % 4]
  }));
}

function makeTasks(patients) {
  return patients.map((p, i) => ({
    id: `TASK-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    task: ['Schedule memory clinic follow-up', 'Collect source imaging report', 'Complete caregiver burden screen', 'Confirm medication list'][i % 4],
    owner: ['Nurse navigator', 'Trial coordinator', 'Social worker', 'Pharmacist'][i % 4],
    dueDate: dateBack(-2 - i),
    priority: ['Low', 'Medium', 'High', 'Escalate'][i % 4],
    status: ['Open', 'In progress', 'Blocked', 'Complete'][i % 4]
  }));
}

function makeNotifications(patients) {
  return patients.map((p, i) => ({
    id: `NTF-${pad(i + 1)}`,
    patientId: p.id,
    patient: p.patient,
    channel: ['Email', 'SMS', 'Portal', 'Phone call'][i % 4],
    audience: ['Caregiver', 'Clinician', 'Coordinator', 'Patient'][i % 4],
    subject: ['Upcoming visit', 'Missing document', 'Safety follow-up', 'Consent renewal'][i % 4],
    scheduledFor: dateBack(-1 - i),
    status: ['Queued', 'Sent', 'Needs approval', 'Failed'][i % 4]
  }));
}

function seedStore() {
  const patients = makePatients();
  const data = {
    patients,
    cognitiveTimeline: makeCognitiveTimeline(patients),
    trialMatches: makeTrialMatches(patients),
    biomarkers: makeBiomarkers(patients),
    visitNotes: makeVisitNotes(patients),
    monitoring: makeMonitoring(patients),
    caregiverTasks: makeCaregiverTasks(patients),
    medicationSafety: makeMedicationSafety(patients),
    evidence: makeEvidence(),
    documents: makeDocuments(patients),
    consentRecords: makeConsentRecords(patients),
    tasks: makeTasks(patients),
    notifications: makeNotifications(patients),
    auditRecords: makeAuditRecords(patients)
  };
  return {
    version: 2,
    users: [
      { id: 'USR-01', name: 'Admin User', email: 'admin@alzheimers.local', password: 'admin123', role: 'Admin' },
      { id: 'USR-02', name: 'Clinical Reviewer', email: 'clinician@alzheimers.local', password: 'clinician123', role: 'Clinician' },
      { id: 'USR-03', name: 'Trial Coordinator', email: 'coordinator@alzheimers.local', password: 'coordinator123', role: 'Coordinator' }
    ],
    data
  };
}

function loadStore() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const seeded = seedStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const stored = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  const seeded = seedStore();
  stored.version = 2;
  stored.users = stored.users || seeded.users;
  stored.data = stored.data || {};
  Object.entries(seeded.data).forEach(([table, rows]) => {
    if (!Array.isArray(stored.data[table])) stored.data[table] = rows;
  });
  saveStore(stored);
  return stored;
}

function saveStore(nextStore = store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(nextStore, null, 2));
}

let store = loadStore();

const modules = [
  { id: 'patient-registry', label: 'Patient Registry', description: 'Longitudinal registry for consented patients, caregivers, clinicians, risk status, and care-team ownership.', table: 'patients', subfeatures: ['Longitudinal profiles', 'Care-team panel', 'Risk stratification'] },
  { id: 'cognitive-timeline', label: 'Cognitive Timeline', description: 'MoCA, MMSE, CDR, caregiver observations, and progression alerts across visits.', table: 'cognitiveTimeline', subfeatures: ['Assessment history', 'Daily function signals', 'Progression alerts'] },
  { id: 'trial-matching', label: 'Trial Matching', description: 'Clinical trial fit, missing eligibility documents, site coordination, and recruitment status.', table: 'trialMatches', subfeatures: ['Eligibility scoring', 'Recruitment pipeline', 'Site feasibility'] },
  { id: 'biomarker-imaging', label: 'Biomarker & Imaging', description: 'Amyloid, tau, CSF, MRI/PET report tracking, source-document needs, and neurologist review status.', table: 'biomarkers', subfeatures: ['Amyloid and tau', 'MRI/PET reports', 'Lab trend review'] },
  { id: 'neurology-scribe', label: 'Neurology Scribe', description: 'Visit documentation, cognitive tests, caregiver collateral, note gaps, and clinician sign-off.', table: 'visitNotes', subfeatures: ['Visit notes', 'Cognitive tests', 'Caregiver history'] },
  { id: 'remote-monitoring', label: 'Remote Monitoring', description: 'Medication adherence, sleep/activity signals, safety events, and escalation work queues.', table: 'monitoring', subfeatures: ['Adherence', 'Sleep and activity', 'Safety events'] },
  { id: 'caregiver-support', label: 'Caregiver Support', description: 'Care-plan tasks, burden level, home safety actions, respite coordination, and education handoffs.', table: 'caregiverTasks', subfeatures: ['Care plans', 'Home safety', 'Respite and education'] },
  { id: 'medication-safety', label: 'Medication Safety', description: 'Medication reconciliation, interaction concerns, adverse-event review, and monitoring requirements.', table: 'medicationSafety', subfeatures: ['Reconciliation', 'Interaction review', 'Adverse events'] },
  { id: 'document-vault', label: 'Document Vault', description: 'MRI/PET/lab reports, consent files, medication lists, reviewer status, and upload metadata.', table: 'documents', subfeatures: ['Report intake', 'Review status', 'Upload tracking'] },
  { id: 'tasks', label: 'Tasks', description: 'Operational work queue with owners, due dates, priorities, blocked items, and completion status.', table: 'tasks', subfeatures: ['Due work', 'Blocked items', 'Owner load'] },
  { id: 'notifications', label: 'Notifications', description: 'Caregiver, clinician, coordinator, and patient message queue with approval status.', table: 'notifications', subfeatures: ['Message queue', 'Approvals', 'Failed sends'] },
  { id: 'research-evidence', label: 'Research Evidence', description: 'Research intelligence board for evidence, studies, hypotheses, and workflow adoption decisions.', table: 'evidence', subfeatures: ['Literature watch', 'Study tracker', 'Hypothesis board'] },
  { id: 'consent-governance', label: 'Consent Governance', description: 'Consent document lifecycle, data-use permissions, expiration queue, and review status.', table: 'consentRecords', subfeatures: ['Consent lifecycle', 'Data-use rights', 'Renewal queue'] },
  { id: 'compliance', label: 'Compliance', description: 'Consent, audit log, HIPAA minimum-necessary review, research governance, and clinician attestation.', table: 'auditRecords', subfeatures: ['Consent', 'Audit trail', 'Data governance'] }
];

function data() {
  return store.data;
}

function summary() {
  const d = data();
  const escalations = d.monitoring.filter((r) => r.action.includes('Escalate')).length + d.tasks.filter((r) => r.priority === 'Escalate').length;
  const trialReady = d.trialMatches.filter((r) => r.status.includes('Ready')).length;
  const missingDocs = d.trialMatches.filter((r) => r.blocker !== 'None').length + d.documents.filter((r) => String(r.status).includes('Missing')).length;
  const consentIssues = d.consentRecords.filter((p) => String(p.status).includes('renewal') || String(p.status).includes('review')).length;
  return {
    metrics: [
      { label: 'Registry patients', value: d.patients.length, detail: 'Persisted patient records' },
      { label: 'Trial-ready matches', value: trialReady, detail: 'Ready for coordinator review' },
      { label: 'Open escalations', value: escalations, detail: 'Clinical or operations review' },
      { label: 'Document gaps', value: missingDocs, detail: 'Eligibility, imaging, or source reports' },
      { label: 'Consent reviews', value: consentIssues, detail: 'Governance queue' }
    ],
    workQueue: [
      'Review high-risk remote monitoring events',
      'Resolve trial blockers for MRI/APOE/source documents',
      'Route medication safety items to pharmacist or neurologist',
      'Prepare caregiver home-safety tasks due this week',
      'Attest AI-generated drafts before clinical use'
    ]
  };
}

function aiCenter() {
  const d = data();
  const patient = d.patients.find((p) => p.risk === 'Escalate') || d.patients[0];
  const trial = d.trialMatches.find((t) => t.patientId === patient.id) || d.trialMatches[0];
  return {
    generatedAt: new Date().toISOString(),
    model: process.env.OPENROUTER_MODEL || 'local-rule-based-demo',
    mode: hasOpenRouter() ? 'OpenRouter ready' : 'Local safety fallback',
    disclaimer: 'Operational support only. Clinician review is required before diagnosis, treatment, trial enrollment, or medication changes.',
    caseReview: {
      patient: patient.patient,
      headline: 'Coordinated review needed across trial, documentation, and safety workflows',
      summary: `${patient.patient} is in ${patient.stage} with ${patient.risk.toLowerCase()} status. The workflow should prioritize consent status, document completeness, medication safety, and caregiver coordination before trial outreach.`,
      confidence: 'Medium',
      riskFlags: ['Clinical attestation required', 'Source documents must be verified', 'Medication and caregiver plans require review'],
      nextActions: ['Review patient registry detail', 'Confirm document-vault status', 'Route medication safety task', 'Capture clinician attestation']
    },
    trialFit: {
      study: trial.study,
      score: trial.matchScore,
      explanation: `The current trial match is ${trial.status.toLowerCase()} with blocker: ${trial.blocker}.`,
      blockers: [trial.blocker, 'Safety monitoring schedule must be confirmed'],
      readyWhen: ['Consent is current', 'Required source reports are reviewed', 'Coordinator records outreach decision']
    },
    carePlanDraft: {
      focus: 'Adherence, home safety, and caregiver load',
      tasks: ['Weekly medication organizer verification', 'Nighttime safety checklist', 'Caregiver burden screen', 'Follow-up in memory clinic'],
      ownerRouting: ['Nurse navigator', 'Caregiver', 'Social worker', 'Neurologist']
    }
  };
}

function hasOpenRouter() {
  return Boolean(process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.includes('changeme'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendCsv(res, table, rows) {
  const keys = rows[0] ? Object.keys(rows[0]) : ['id'];
  const escCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [keys.join(','), ...rows.map((row) => keys.map((k) => escCsv(row[k])).join(','))].join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${table}.csv"`
  });
  res.end(csv);
}

function audit(actor, event, patient = 'System', status = 'Compliant') {
  const row = {
    id: `AUD-${Date.now()}`,
    patientId: '',
    patient,
    event,
    actor: actor || 'system',
    date: today(),
    control: 'Application audit event',
    status
  };
  store.data.auditRecords.unshift(row);
  saveStore();
}

function nextId(table) {
  const prefix = {
    patients: 'ALZ-P',
    cognitiveTimeline: 'COG',
    trialMatches: 'TRIAL',
    biomarkers: 'BIO',
    visitNotes: 'NOTE',
    monitoring: 'RPM',
    caregiverTasks: 'CARE',
    medicationSafety: 'MED',
    evidence: 'EVID',
    documents: 'DOC',
    consentRecords: 'CONS',
    tasks: 'TASK',
    notifications: 'NTF',
    auditRecords: 'AUD'
  }[table] || table.toUpperCase().slice(0, 4);
  return `${prefix}-${Date.now()}`;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function generateAiReview(payload) {
  if (!hasOpenRouter()) {
    return { source: 'local-fallback', review: aiCenter(), note: 'Set OPENROUTER_API_KEY in .env to use live AI generation.' };
  }
  const requestBody = JSON.stringify({
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a clinical operations assistant. Provide concise workflow support only, with a clear clinician-review warning.' },
      { role: 'user', content: JSON.stringify(payload).slice(0, 12000) }
    ]
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 12000
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ source: 'openrouter', text: parsed.choices?.[0]?.message?.content || body });
        } catch {
          resolve({ source: 'openrouter', text: body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ source: 'local-fallback', review: aiCenter(), note: 'OpenRouter request timed out; local fallback returned.' });
    });
    req.on('error', () => resolve({ source: 'local-fallback', review: aiCenter(), note: 'OpenRouter request failed; local fallback returned.' }));
    req.write(requestBody);
    req.end();
  });
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(safePath, (err, file) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(safePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (parsed.pathname === '/api/health') {
      return sendJson(res, { ok: true, app: 'alzheimers-research-care-operations-hub', persisted: fs.existsSync(STORE_FILE), records: Object.fromEntries(Object.entries(data()).map(([k, v]) => [k, v.length])) });
    }
    if (parsed.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const user = store.users.find((u) => u.email === body.email && u.password === body.password);
      if (!user) return sendJson(res, { error: 'Invalid login' }, 401);
      audit(user.email, 'User login');
      return sendJson(res, { user: publicUser(user), token: Buffer.from(`${user.email}:${Date.now()}`).toString('base64') });
    }
    if (parsed.pathname === '/api/bootstrap') {
      return sendJson(res, { modules, summary: summary(), data: data(), aiCenter: aiCenter(), users: store.users.map(publicUser) });
    }
    if (parsed.pathname === '/api/summary') return sendJson(res, summary());
    if (parsed.pathname === '/api/ai-center' && req.method === 'GET') return sendJson(res, aiCenter());
    if (parsed.pathname === '/api/ai-center' && req.method === 'POST') return sendJson(res, await generateAiReview(await readBody(req)));
    if (parts[0] === 'api' && parts[1] === 'export' && req.method === 'GET') {
      const table = parts[2];
      if (!data()[table]) return sendJson(res, { error: 'Unknown table' }, 404);
      return sendCsv(res, table, data()[table]);
    }
    if (parsed.pathname === '/api/upload' && req.method === 'POST') {
      const body = await readBody(req);
      const row = {
        id: nextId('documents'),
        patientId: body.patientId || '',
        patient: body.patient || 'Unassigned',
        documentType: body.documentType || 'Uploaded document',
        fileName: body.fileName || 'uploaded-file',
        receivedDate: today(),
        reviewer: body.reviewer || 'Coordinator',
        status: 'Ready for review'
      };
      store.data.documents.unshift(row);
      audit(body.actor, `Uploaded document ${row.fileName}`, row.patient, 'Review');
      saveStore();
      return sendJson(res, { row });
    }
    if (parts[0] === 'api' && parts[1] === 'table') {
      const table = parts[2];
      const id = decodeURIComponent(parts[3] || '');
      if (!data()[table]) return sendJson(res, { error: 'Unknown table' }, 404);
      if (req.method === 'GET') return sendJson(res, { table, rows: data()[table] });
      const body = await readBody(req);
      if (req.method === 'POST') {
        const row = { ...body, id: body.id || nextId(table) };
        data()[table].unshift(row);
        audit(body.actor, `Created ${table} record`, body.patient || row.patient || 'System');
        saveStore();
        return sendJson(res, { row }, 201);
      }
      const index = data()[table].findIndex((row) => row.id === id);
      if (index < 0) return sendJson(res, { error: 'Record not found' }, 404);
      if (req.method === 'PUT') {
        const row = { ...data()[table][index], ...body, id };
        data()[table][index] = row;
        audit(body.actor, `Updated ${table} record`, body.patient || row.patient || 'System');
        saveStore();
        return sendJson(res, { row });
      }
      if (req.method === 'DELETE') {
        const [row] = data()[table].splice(index, 1);
        audit(parsed.searchParams.get('actor'), `Deleted ${table} record`, row.patient || 'System', 'Review');
        saveStore();
        return sendJson(res, { row });
      }
    }
    return serveStatic(req, res);
  } catch (err) {
    return sendJson(res, { error: err.message || 'Server error' }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Alzheimer's Research & Care Operations Hub running at http://${HOST}:${PORT}`);
});
