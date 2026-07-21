const state = {
  boot: null,
  active: 'dashboard',
  subfeature: '',
  selected: null,
  query: '',
  status: 'all',
  formMode: 'view',
  form: {},
  user: null,
  token: sessionStorage.getItem('alz_token') || ''
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[ch]);
}

function initial(label) {
  return label.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json;
}

async function login(event) {
  event.preventDefault();
  window.location.assign('/api/auth/sso');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  sessionStorage.removeItem('alz_token');
  state.user = null;
  state.token = '';
  state.boot = null;
  renderLogin();
}

function setActive(id) {
  state.active = id;
  state.subfeature = '';
  state.selected = null;
  state.query = '';
  state.status = 'all';
  state.formMode = 'view';
  state.form = {};
  render();
}

function setSubfeature(name) {
  state.subfeature = name;
  render();
}

function selectRow(id) {
  state.selected = id;
  state.formMode = 'view';
  state.form = {};
  render();
}

function moduleById(id) {
  return state.boot.modules.find((m) => m.id === id);
}

function getRows(module) {
  if (!module) return [];
  let rows = state.boot.data[module.table] || [];
  if (state.query) {
    const q = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(q)));
  }
  if (state.status !== 'all') {
    rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(state.status)));
  }
  return rows;
}

function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('escalate') || text.includes('high') || text.includes('risk') || text.includes('failed') || text.includes('blocked')) return 'risk high escalate';
  if (text.includes('review') || text.includes('watch') || text.includes('medium') || text.includes('pending') || text.includes('needs') || text.includes('open')) return 'review medium watch';
  if (text.includes('stable') || text.includes('ready') || text.includes('low') || text.includes('compliant') || text.includes('complete') || text.includes('resolved') || text.includes('active') || text.includes('sent')) return 'stable ready low compliant';
  return '';
}

function renderLogin() {
  document.getElementById('app').className = 'auth-screen';
  document.getElementById('app').innerHTML = `
    <main class="login-panel">
      <div class="brand-mark">AD</div>
      <h1>Alzheimer's Research & Care Hub</h1>
      <p class="muted">Sign in to manage registry, trials, documents, care operations, and AI review workflows.</p>
      <form onsubmit="login(event)" class="login-form">
        <button class="button" type="submit">Continue with organization SSO</button>
        <div class="login-error">MFA and your assigned least-privilege role are required.</div>
      </form>
    </main>
  `;
}

function renderShell(inner) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard' },
    ...state.boot.modules,
    { id: 'ai-center', label: 'AI Center' },
    { id: 'reports', label: 'Reports' }
  ];

  const app = document.getElementById('app');
  app.className = 'shell';
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">AD</div>
        <h1>Alzheimer's Research & Care Hub</h1>
        <p>Research operations, trial matching, cognitive tracking, monitoring, documents, consent, and caregiver coordination.</p>
      </div>
      <div class="user-box">
        <strong>${esc(state.user.email || state.user.subject)}</strong>
        <span>${esc(state.user.role)} · tenant scoped</span>
        <button onclick="logout()">Sign out</button>
      </div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">
        ${nav.map((item) => `
          <button class="${state.active === item.id ? 'active' : ''}" onclick="setActive('${item.id}')">
            <span class="nav-initial">${esc(initial(item.label))}</span>
            <span>${esc(item.label)}</span>
          </button>
        `).join('')}
      </nav>
    </aside>
    <main class="main">${inner}</main>
  `;
}

function topbar(title, description, eyebrow = 'Operations Hub') {
  return `
    <section class="topbar">
      <div class="topbar-grid">
        <div>
          <p class="eyebrow">${esc(eyebrow)}</p>
          <h2>${esc(title)}</h2>
          <p>${esc(description)}</p>
        </div>
        <div class="notice">Clinical safety boundary: AI output is workflow support only. Licensed clinician review is required before diagnosis, treatment, enrollment, or medication changes.</div>
      </div>
    </section>
  `;
}

function renderDashboard() {
  const summary = state.boot.summary;
  const recent = state.boot.data.trialMatches.slice(0, 5);
  const risks = state.boot.data.tasks.filter((x) => x.priority === 'High' || x.priority === 'Escalate').slice(0, 5);
  const docs = state.boot.data.documents.filter((x) => String(x.status).includes('Missing') || String(x.status).includes('Needs')).slice(0, 5);
  return `
    ${topbar('Dashboard', "A unified command center for Alzheimer's research, care coordination, and clinical-trial operations.")}
    <section class="content grid">
      <div class="grid columns-5">
        ${summary.metrics.map((m) => `
          <article class="metric">
            <div class="label">${esc(m.label)}</div>
            <div class="value">${esc(m.value)}</div>
            <div class="detail">${esc(m.detail)}</div>
          </article>
        `).join('')}
      </div>
      <div class="grid columns-3">
        <article class="panel">
          <h3>Priority Work Queue</h3>
          <ul class="work-list">${summary.workQueue.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </article>
        <article class="panel">
          <h3>Trial Candidates</h3>
          <ul class="work-list">${recent.map((r) => `<li><strong>${esc(r.patient)}</strong><br><span class="muted">${esc(r.study)} - ${esc(r.status)}</span></li>`).join('')}</ul>
        </article>
        <article class="panel">
          <h3>Open Tasks</h3>
          <ul class="work-list">${risks.map((r) => `<li><strong>${esc(r.patient)}</strong><br><span class="muted">${esc(r.task)} - ${esc(r.priority)}</span></li>`).join('')}</ul>
        </article>
      </div>
      <div class="grid columns-2">
        <article class="panel">
          <h3>Document Gaps</h3>
          <ul class="work-list">${docs.map((r) => `<li><strong>${esc(r.patient)}</strong><br><span class="muted">${esc(r.documentType)} - ${esc(r.status)}</span></li>`).join('')}</ul>
        </article>
        <article class="panel">
          <h3>Production Features Added</h3>
          <p class="muted">OIDC/SAML gateway identity with MFA, tenant and role boundaries, encrypted PostgreSQL records, purpose-scoped consent, immutable audit, durable provider retries, monitored exports, and independent clinical AI approval are active.</p>
        </article>
      </div>
    </section>
  `;
}

function makeBlankRow(module) {
  const sample = (state.boot.data[module.table] || [])[0] || {};
  const templates = {
    patients: { patient: '', dateOfBirth: '', stage: '', ageBand: '', sourceSystem: '', sourcePatientId: '' },
    consentRecords: { patientId: '', purpose: 'care-operations', validUntil: '', source: '' },
    documents: { patientId: '', fileName: '', documentType: '', contentSha256: '', retentionUntil: '' },
    tasks: { patientId: '', task: '', owner: '', dueDate: '', priority: 'Medium', status: 'Open' }
  };
  if (!Object.keys(sample).length && templates[module.table]) return { ...templates[module.table] };
  const blank = {};
  Object.keys(sample).forEach((key) => {
    if (key === 'id') return;
    blank[key] = key.toLowerCase().includes('date') ? new Date().toISOString().slice(0, 10) : '';
  });
  return blank;
}

function editSelected(module, row) {
  state.formMode = 'edit';
  state.form = { ...row };
  render();
}

function addNew(moduleId) {
  const module = moduleById(moduleId);
  state.formMode = 'new';
  state.selected = null;
  state.form = makeBlankRow(module);
  render();
}

function updateForm(key, value) {
  state.form[key] = value;
}

async function saveForm(table) {
  const body = { ...state.form };
  if (table === 'patients') {
    const { id, version, sourceSystem, sourcePatientId, ...profile } = body;
    if (state.formMode === 'new') await api('/api/patients', { method: 'POST', body: JSON.stringify({ sourceSystem, sourcePatientId, profile }) });
    else {
      const correctionReason = prompt('Reason for this patient correction:');
      if (!correctionReason) return;
      await api(`/api/patients/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ version, profile, correctionReason }) });
    }
    state.formMode = 'view'; state.form = {}; await refresh(); return;
  }
  if (table === 'consentRecords') {
    if (state.formMode !== 'new') throw new Error('Consent is immutable; revoke it and record a new consent instead.');
    await api('/api/consents', { method: 'POST', body: JSON.stringify(body) });
    state.formMode = 'view'; state.form = {}; await refresh(); return;
  }
  if (table === 'documents') {
    if (state.formMode !== 'new') throw new Error('Document metadata is immutable after reservation.');
    await api('/api/documents', { method: 'POST', body: JSON.stringify(body) });
    state.formMode = 'view'; state.form = {}; await refresh(); return;
  }
  if (state.formMode === 'new') {
    await api(`/api/table/${table}`, { method: 'POST', body: JSON.stringify(body) });
  } else {
    body.correctionReason = prompt('Reason for this clinical correction:');
    if (!body.correctionReason) return;
    await api(`/api/table/${table}/${encodeURIComponent(state.form.id)}`, { method: 'PUT', body: JSON.stringify(body) });
  }
  state.formMode = 'view';
  state.form = {};
  await refresh();
}

async function deleteSelected(table, row) {
  if (!row || !confirm(`Delete ${row.id}?`)) return;
  if (table === 'patients') return alert('Patient deletion requires the governed correction/deletion propagation process; direct deletion is disabled.');
  if (table === 'consentRecords') {
    await api(`/api/consents/${encodeURIComponent(row.id)}/revoke`, { method: 'POST', body: JSON.stringify({ version: row.version }) });
    state.selected = null; await refresh(); return;
  }
  if (table === 'documents') return alert('Document deletion is restricted by retention and legal hold and requires an administrator.');
  const reason = prompt('Reason for deletion and source-system propagation:');
  if (!reason) return;
  await api(`/api/table/${table}/${encodeURIComponent(row.id)}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' });
  state.selected = null;
  await refresh();
}

async function uploadDocument(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  await api('/api/documents', {
    method: 'POST',
    body: JSON.stringify({
      patientId: form.get('patientId'),
      documentType: form.get('documentType'),
      fileName: form.get('fileName'),
      contentSha256: form.get('contentSha256'),
      retentionUntil: form.get('retentionUntil')
    })
  });
  event.target.reset();
  await refresh();
}

function renderForm(module, selected) {
  const readOnlyRole = state.user.role === 'researcher' || state.user.role === 'caregiver';
  const immutableEdit = module.table === 'consentRecords' || module.table === 'documents';
  if (state.formMode === 'view') {
    return `
      <div class="button-row">
        <button class="button" onclick="addNew('${module.id}')" ${readOnlyRole || module.table === 'auditRecords' ? 'disabled' : ''}>Add Record</button>
        <button class="button secondary" onclick="editSelected(moduleById('${module.id}'), ${selected ? `state.boot.data['${module.table}'].find(r=>r.id==='${selected.id}')` : 'null'})" ${selected && !readOnlyRole && !immutableEdit && module.table !== 'auditRecords' ? '' : 'disabled'}>Edit</button>
        <button class="button danger" onclick="deleteSelected('${module.table}', ${selected ? `state.boot.data['${module.table}'].find(r=>r.id==='${selected.id}')` : 'null'})" ${selected && !readOnlyRole && module.table !== 'auditRecords' ? '' : 'disabled'}>${module.table === 'consentRecords' ? 'Revoke' : 'Delete'}</button>
        <a class="button secondary" href="/api/export/${module.table}">CSV Export</a>
      </div>
    `;
  }
  const keys = Object.keys(state.form).filter((key) => key !== 'actor');
  return `
    <div class="edit-form">
      <h3>${state.formMode === 'new' ? 'Add Record' : 'Edit Record'}</h3>
      <div class="form-grid">
        ${keys.map((key) => `
          <label>${esc(key.replace(/([A-Z])/g, ' $1'))}
            <input ${key === 'id' ? 'readonly' : ''} value="${esc(state.form[key])}" oninput="updateForm('${key}', this.value)">
          </label>
        `).join('')}
      </div>
      <div class="button-row">
        <button class="button" onclick="saveForm('${module.table}')">Save</button>
        <button class="button secondary" onclick="state.formMode='view'; state.form={}; render();">Cancel</button>
      </div>
    </div>
  `;
}

function renderUpload(module) {
  if (module.table !== 'documents') return '';
  return `
    <article class="panel">
      <h3>Upload Document Metadata</h3>
      <form class="form-grid compact" onsubmit="uploadDocument(event)">
        <label>Patient ID<input name="patientId" placeholder="ALZ-P-01"></label>
        <label>Document Type<input name="documentType" placeholder="MRI report"></label>
        <label>File Name<input name="fileName" placeholder="report.pdf"></label>
        <label>SHA-256 checksum<input name="contentSha256" minlength="64" maxlength="64" required></label>
        <label>Retain until<input name="retentionUntil" type="date" required></label>
        <button class="button" type="submit">Reserve encrypted upload</button>
      </form>
    </article>
  `;
}

function renderModule(module) {
  if (!state.subfeature) state.subfeature = module.subfeatures[0];
  const rows = getRows(module);
  const selected = rows.find((r) => r.id === state.selected) || rows[0];
  const keys = rows.length ? Object.keys(rows[0]).slice(0, 7) : [];
  const allKeys = selected ? Object.keys(selected) : [];

  return `
    ${topbar(module.label, module.description, 'Feature Workspace')}
    <section class="content grid">
      <div class="panel">
        <div class="subfeatures">
          ${module.subfeatures.map((sub) => `<button class="${state.subfeature === sub ? 'active' : ''}" onclick="setSubfeature('${esc(sub)}')">${esc(sub)}</button>`).join('')}
        </div>
        <div class="toolbar">
          <input placeholder="Search records" value="${esc(state.query)}" oninput="state.query=this.value; render();">
          <select onchange="state.status=this.value; render();">
            ${['all', 'review', 'pending', 'ready', 'high', 'stable', 'complete', 'open', 'blocked', 'active'].map((x) => `<option value="${x}" ${state.status === x ? 'selected' : ''}>${x === 'all' ? 'All statuses' : x}</option>`).join('')}
          </select>
          <button class="button" onclick="addNew('${module.id}')" ${state.user.role === 'researcher' || state.user.role === 'caregiver' || module.table === 'auditRecords' ? 'disabled' : ''}>Add</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>${keys.map((k) => `<th>${esc(k.replace(/([A-Z])/g, ' $1'))}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.map((row) => `
                <tr class="${selected && selected.id === row.id ? 'selected' : ''}" onclick="selectRow('${row.id}')">
                  ${keys.map((k) => {
                    const value = row[k];
                    const pill = /status|risk|severity|confidence|consent|priority/i.test(k);
                    return `<td>${pill ? `<span class="pill ${statusClass(value)}">${esc(value)}</span>` : esc(value)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ${renderUpload(module)}
      <div class="grid columns-2">
        <article class="panel">
          <h3>${esc(state.subfeature)} Detail</h3>
          <div class="detail-grid">
            ${allKeys.map((k) => `
              <div class="field">
                <span>${esc(k.replace(/([A-Z])/g, ' $1'))}</span>
                ${esc(selected[k])}
              </div>
            `).join('')}
          </div>
        </article>
        <article class="panel">
          ${renderForm(module, selected)}
        </article>
      </div>
    </section>
  `;
}

async function generateAiReview(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const result = await api('/api/ai/reviews', {
    method: 'POST',
    body: JSON.stringify({
      patientId: form.get('patientId'), intendedUse: form.get('intendedUse'),
      model: form.get('model'), modelVersion: form.get('modelVersion'),
      uncertainty: form.get('uncertainty'), prompt: form.get('prompt'), output: form.get('output'),
      evidence: [{ title: form.get('evidenceTitle'), uri: form.get('evidenceUri'), excerpt: form.get('evidenceExcerpt') }]
    })
  });
  alert(`Draft ${result.review.id} recorded. It is not actionable until independent clinician approval.`);
  await refresh();
}

async function decideAi(id, decision) {
  const reason = prompt(`Clinical reason to ${decision} this draft:`);
  if (!reason) return;
  await api(`/api/ai/reviews/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
  await refresh();
}

async function registerModel(event) {
  event.preventDefault(); const form = new FormData(event.target);
  await api('/api/ai/models', { method: 'POST', body: JSON.stringify({ model: form.get('model'), modelVersion: form.get('modelVersion'), intendedUse: form.get('intendedUse') }) });
  event.target.reset(); await refresh();
}

async function evaluateModel(event) {
  event.preventDefault(); const form = new FormData(event.target);
  await api(`/api/ai/models/${encodeURIComponent(form.get('releaseId'))}/evaluations`, { method: 'POST', body: JSON.stringify({
    evaluationSetSha256: form.get('evaluationSetSha256'), evidenceUri: form.get('evidenceUri'), passed: form.get('passed') === 'true',
    metrics: { groundedCitationRate: Number(form.get('groundedCitationRate')), unsafeRecommendationRate: Number(form.get('unsafeRecommendationRate')) },
    thresholds: { groundedCitationRate: Number(form.get('minimumGroundedRate')), unsafeRecommendationRate: Number(form.get('maximumUnsafeRate')) }
  }) });
  event.target.reset(); await refresh();
}

function renderAiCenter() {
  const ai = state.boot.aiCenter;
  const reviews = state.boot.data.aiReviews || [];
  const models = state.boot.data.aiModels || [];
  return `
    ${topbar('AI Center', 'Grounded drafts with model lineage, uncertainty, and a hard independent-clinician approval gate.', 'AI Governance')}
    <section class="content grid">
      <article class="panel"><strong>${esc(ai.mode)}</strong><p class="muted">${esc(ai.disclaimer)}</p></article>
      ${state.user.role === 'administrator' ? `<article class="panel"><h3>Register model release</h3><form class="form-grid compact" onsubmit="registerModel(event)"><label>Model<input name="model" required></label><label>Version<input name="modelVersion" required></label><label>Validated intended use<input name="intendedUse" required></label><button class="button">Register pending release</button></form></article>` : ''}
      ${state.user.role === 'clinician' ? `<article class="panel"><h3>Record independent evaluation</h3><form class="form-grid compact" onsubmit="evaluateModel(event)"><label>Release UUID<input name="releaseId" required></label><label>Evaluation set SHA-256<input name="evaluationSetSha256" minlength="64" maxlength="64" required></label><label>Grounded citation rate<input name="groundedCitationRate" type="number" min="0" max="1" step="0.01" required></label><label>Minimum grounded rate<input name="minimumGroundedRate" type="number" min="0" max="1" step="0.01" required></label><label>Unsafe recommendation rate<input name="unsafeRecommendationRate" type="number" min="0" max="1" step="0.01" required></label><label>Maximum unsafe rate<input name="maximumUnsafeRate" type="number" min="0" max="1" step="0.01" required></label><label>Evidence URI<input name="evidenceUri" type="url" required></label><label>Decision<select name="passed"><option value="true">Pass</option><option value="false">Fail</option></select></label><button class="button">Record evaluation</button></form></article>` : ''}
      <article class="panel"><h3>Model releases</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>Model/version</th><th>Intended use</th><th>Status</th></tr></thead><tbody>${models.map((model) => `<tr><td>${esc(model.id)}</td><td>${esc(model.model)} ${esc(model.model_version)}</td><td>${esc(model.intended_use)}</td><td>${esc(model.status)}</td></tr>`).join('')}</tbody></table></div></article>
      <article class="panel">
        <h3>Record grounded draft</h3>
        <form class="form-grid" onsubmit="generateAiReview(event)">
          <label>Patient UUID<input name="patientId" required></label><label>Intended use<input name="intendedUse" value="care-team case review" required></label>
          <label>Model<input name="model" required></label><label>Model version<input name="modelVersion" required></label>
          <label>Uncertainty<select name="uncertainty"><option>medium</option><option>low</option><option>high</option></select></label>
          <label>Prompt<input name="prompt" required></label><label>Output<input name="output" required></label>
          <label>Evidence title<input name="evidenceTitle" required></label><label>Evidence URI<input name="evidenceUri" type="url" required></label>
          <label>Supporting excerpt<input name="evidenceExcerpt" required></label><button class="button" type="submit">Record non-actionable draft</button>
        </form>
      </article>
      <article class="panel"><h3>Review queue</h3><div class="table-wrap"><table><thead><tr><th>Intended use</th><th>Model</th><th>Uncertainty</th><th>Status</th><th>Independent decision</th></tr></thead><tbody>
        ${reviews.map((review) => `<tr><td>${esc(review.intended_use)}</td><td>${esc(review.model)} ${esc(review.model_version)}</td><td><span class="pill ${statusClass(review.uncertainty)}">${esc(review.uncertainty)}</span></td><td>${esc(review.status)}</td><td>${review.status === 'draft' && state.user.role === 'clinician' && review.created_by !== state.user.subject ? `<button class="button" onclick="decideAi('${review.id}','approved')">Approve</button> <button class="button danger" onclick="decideAi('${review.id}','rejected')">Reject</button>` : 'Awaiting independent clinician'}</td></tr>`).join('')}
      </tbody></table></div></article>
    </section>
  `;
}

function renderReports() {
  const tables = Object.entries(state.boot.data);
  return `
    ${topbar('Reports', 'Export-ready operational reporting across registry, trials, monitoring, safety, evidence, documents, consent, and compliance.', 'Reporting')}
    <section class="content grid">
      <div class="grid columns-3">
        ${tables.map(([name, rows]) => `
          <article class="metric">
            <div class="label">${esc(name.replace(/([A-Z])/g, ' $1'))}</div>
            <div class="value">${rows.length}</div>
            <div class="detail"><a href="/api/export/${name}">Download CSV</a></div>
          </article>
        `).join('')}
      </div>
      <div class="panel">
        <h3>Readiness Summary</h3>
        <p class="muted">This hub now supports persistent data, editable workflows, document metadata, consent records, task queues, notifications, audit events, exports, and AI review generation with local fallback.</p>
        <button class="button" onclick="window.print()">Print Report</button>
      </div>
    </section>
  `;
}

function render() {
  if (!state.user) return renderLogin();
  if (!state.boot) return;
  let inner;
  if (state.active === 'dashboard') inner = renderDashboard();
  else if (state.active === 'ai-center') inner = renderAiCenter();
  else if (state.active === 'reports') inner = renderReports();
  else inner = renderModule(moduleById(state.active));
  renderShell(inner);
}

async function refresh() {
  state.boot = await api('/api/bootstrap');
  render();
}

async function load() {
  try {
    const session = await api('/api/session');
    state.user = session.user;
    await refresh();
  } catch (_error) {
    state.user = null;
    renderLogin();
  }
}

load().catch((error) => {
  document.getElementById('app').innerHTML = `<div class="loading">Failed to load app: ${esc(error.message)}</div>`;
});
