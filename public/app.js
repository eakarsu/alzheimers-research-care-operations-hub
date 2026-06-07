const state = {
  boot: null,
  active: 'dashboard',
  subfeature: '',
  selected: null,
  query: '',
  status: 'all',
  formMode: 'view',
  form: {},
  user: JSON.parse(localStorage.getItem('alz_user') || 'null'),
  token: localStorage.getItem('alz_token') || ''
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
  const form = new FormData(event.target);
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    });
    state.user = result.user;
    state.token = result.token;
    localStorage.setItem('alz_user', JSON.stringify(result.user));
    localStorage.setItem('alz_token', result.token);
    await load();
  } catch (err) {
    document.querySelector('.login-error').textContent = err.message;
  }
}

function logout() {
  localStorage.removeItem('alz_user');
  localStorage.removeItem('alz_token');
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
        <label>Email<input name="email" value="admin@alzheimers.local" autocomplete="username"></label>
        <label>Password<input name="password" type="password" value="admin123" autocomplete="current-password"></label>
        <button class="button" type="submit">Sign In</button>
        <div class="login-error"></div>
      </form>
      <p class="muted small">Demo users: admin@alzheimers.local / admin123, clinician@alzheimers.local / clinician123, coordinator@alzheimers.local / coordinator123</p>
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
        <strong>${esc(state.user.name)}</strong>
        <span>${esc(state.user.role)}</span>
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
          <p class="muted">Login, role-aware users, persistent JSON storage, CRUD editing, CSV export, document upload metadata, consent governance, task queues, notifications, audit logging, and real-AI-ready endpoints are now implemented.</p>
        </article>
      </div>
    </section>
  `;
}

function makeBlankRow(module) {
  const sample = (state.boot.data[module.table] || [])[0] || {};
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
  const body = { ...state.form, actor: state.user.email };
  if (state.formMode === 'new') {
    await api(`/api/table/${table}`, { method: 'POST', body: JSON.stringify(body) });
  } else {
    await api(`/api/table/${table}/${encodeURIComponent(state.form.id)}`, { method: 'PUT', body: JSON.stringify(body) });
  }
  state.formMode = 'view';
  state.form = {};
  await refresh();
}

async function deleteSelected(table, row) {
  if (!row || !confirm(`Delete ${row.id}?`)) return;
  await api(`/api/table/${table}/${encodeURIComponent(row.id)}?actor=${encodeURIComponent(state.user.email)}`, { method: 'DELETE' });
  state.selected = null;
  await refresh();
}

async function uploadDocument(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  await api('/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      actor: state.user.email,
      patientId: form.get('patientId'),
      patient: form.get('patient'),
      documentType: form.get('documentType'),
      fileName: form.get('fileName'),
      reviewer: form.get('reviewer')
    })
  });
  event.target.reset();
  await refresh();
}

function renderForm(module, selected) {
  if (state.formMode === 'view') {
    return `
      <div class="button-row">
        <button class="button" onclick="addNew('${module.id}')">Add Record</button>
        <button class="button secondary" onclick="editSelected(moduleById('${module.id}'), ${selected ? `state.boot.data['${module.table}'].find(r=>r.id==='${selected.id}')` : 'null'})" ${selected ? '' : 'disabled'}>Edit</button>
        <button class="button danger" onclick="deleteSelected('${module.table}', ${selected ? `state.boot.data['${module.table}'].find(r=>r.id==='${selected.id}')` : 'null'})" ${selected ? '' : 'disabled'}>Delete</button>
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
        <label>Patient<input name="patient" placeholder="Patient name"></label>
        <label>Document Type<input name="documentType" placeholder="MRI report"></label>
        <label>File Name<input name="fileName" placeholder="report.pdf"></label>
        <label>Reviewer<input name="reviewer" placeholder="Neurologist"></label>
        <button class="button" type="submit">Add Upload</button>
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
          <button class="button" onclick="addNew('${module.id}')">Add</button>
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

async function generateAiReview() {
  const result = await api('/api/ai-center', {
    method: 'POST',
    body: JSON.stringify({ user: state.user, data: state.boot.data })
  });
  alert(result.text || result.note || 'AI review generated with local fallback.');
}

function renderAiCenter() {
  const ai = state.boot.aiCenter;
  return `
    ${topbar('AI Center', 'Professional AI summaries for case review, trial-fit explanation, and care-plan drafting. Raw JSON is converted into reviewable clinical operations sections.', 'AI Review')}
    <section class="content">
      <div class="button-row ai-actions">
        <button class="button" onclick="generateAiReview()">Generate Review</button>
        <span class="pill">${esc(ai.mode)}</span>
        <span class="muted">Model: ${esc(ai.model)}</span>
      </div>
      <div class="ai-layout">
        <article class="ai-section">
          <h3>Case Review</h3>
          <p class="eyebrow">${esc(ai.caseReview.patient)}</p>
          <h2>${esc(ai.caseReview.headline)}</h2>
          <p>${esc(ai.caseReview.summary)}</p>
          <p><span class="pill ${statusClass(ai.caseReview.confidence)}">Confidence: ${esc(ai.caseReview.confidence)}</span></p>
          <h3>Risk Flags</h3>
          <ul class="ai-list">${ai.caseReview.riskFlags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </article>
        <article class="ai-section">
          <h3>Next Actions</h3>
          <ul class="ai-list">${ai.caseReview.nextActions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="muted">${esc(ai.disclaimer)}</p>
        </article>
        <article class="ai-section">
          <h3>Trial Fit Explanation</h3>
          <p><strong>${esc(ai.trialFit.study)}</strong></p>
          <p>Match score: <span class="pill ready">${esc(ai.trialFit.score)}</span></p>
          <p>${esc(ai.trialFit.explanation)}</p>
          <h3>Blockers</h3>
          <ul class="ai-list">${ai.trialFit.blockers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </article>
        <article class="ai-section">
          <h3>Care Plan Draft</h3>
          <p>${esc(ai.carePlanDraft.focus)}</p>
          <ul class="ai-list">${ai.carePlanDraft.tasks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="muted">Owner routing: ${esc(ai.carePlanDraft.ownerRouting.join(', '))}</p>
        </article>
      </div>
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
  if (!state.user) return renderLogin();
  await refresh();
}

load().catch((error) => {
  document.getElementById('app').innerHTML = `<div class="loading">Failed to load app: ${esc(error.message)}</div>`;
});
