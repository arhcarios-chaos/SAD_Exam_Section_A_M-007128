const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
window.sb = sb; // exposed so TC08 can be attempted from the browser console

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false, dateStyle: 'medium', timeStyle: 'medium' }) : '';
const YEARS = ['2025-2026', '2026-2027', '2027-2028'];

const state = { profile: null, programs: [], scholars: [], subs: [], history: [], selected: null,
  tab: 'dashboard', f: { year: '2026-2027', sem: '1', q: '', program: '', compliance: '' }, draft: null, authMode: 'in' };

function toast(msg, kind = 'ok') {
  const box = document.createElement('div');
  box.className = kind === 'ok' ? 't-ok' : 't-err';
  box.textContent = msg;
  $('#toast').appendChild(box);
  setTimeout(() => box.remove(), kind === 'ok' ? 3500 : 8000);
}

function badge(text) {
  const map = { Verified: 'ok', Compliant: 'ok', Approved: 'ok', Active: 'ok', Pending: 'info', Returned: 'warn', Held: 'warn',
    'With Deficiency': 'bad', 'Not Evaluated': 'none', Undecided: 'none', 'No submission': 'none' };
  return `<span class="badge b-${map[text] || 'none'}">${esc(text === 'Pending' ? 'Pending verification' : text)}</span>`;
}

// ---------- Boot and auth ----------
async function boot() {
  sb.auth.onAuthStateChange((event, session) => { if (!session) { state.profile = null; renderAuth(); } });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(session.user); else renderAuth();
}

async function enter(user) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error) { toast(error.message, 'err'); return renderAuth(); }
  state.profile = data;
  await refresh();
  render();
}

function renderAuth() {
  $('#who').innerHTML = '';
  const up = state.authMode === 'up';
  $('#root').innerHTML = `<section class="auth"><h2>${up ? 'Create a scholar login' : 'Sign in'}</h2>
    <form id="authForm">
      ${up ? '<label>Full name</label><input id="aName" required><br><br>' : ''}
      <label>Email</label><input id="aEmail" type="email" required autocomplete="username"><br><br>
      <label>Password</label><input id="aPass" type="password" required minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}"><br><br>
      <button>${up ? 'Create account' : 'Sign in'}</button>
      <button type="button" class="ghost" id="swap">${up ? 'I have an account' : 'Create a scholar login'}</button>
    </form>
    ${up ? '<p class="muted">Staff must link your login to your scholar record before you can submit.</p>' : ''}</section>`;
  $('#swap').onclick = () => { state.authMode = up ? 'in' : 'up'; renderAuth(); };
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#aEmail').value.trim(), password = $('#aPass').value;
    const res = up
      ? await sb.auth.signUp({ email, password, options: { data: { full_name: $('#aName').value.trim() } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (res.error) return toast(res.error.message, 'err');
    if (!res.data.session) return toast('Account created. Confirm your email if required, then sign in.');
    await enter(res.data.session.user);
  };
}

async function signOut() { await sb.auth.signOut(); state.selected = null; state.authMode = 'in'; }

// ---------- Data ----------
async function refresh() {
  const [pr, sc, su] = await Promise.all([
    sb.from('programs').select('*').order('id'),
    sb.from('scholars').select('*, programs(code,name)').order('student_id'),
    sb.from('submissions').select('*, scholars(student_id, full_name, award_status, program_id, programs(code,name))').order('submitted_at', { ascending: false })
  ]);
  for (const r of [pr, sc, su]) if (r.error) toast(r.error.message, 'err');
  state.programs = pr.data || []; state.scholars = sc.data || []; state.subs = su.data || [];
  if (state.selected) {
    const h = await sb.from('history').select('*').eq('submission_id', state.selected).order('created_at', { ascending: false }).order('id', { ascending: false });
    state.history = h.data || [];
  } else state.history = [];
}

async function call(fn, args, okMsg) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { toast(error.message, 'err'); return { ok: false }; }
  toast(okMsg); await refresh(); render(); return { ok: true, data };
}

const isStaff = () => state.profile?.role === 'staff';
const sel = () => state.subs.find(s => s.id === state.selected);
const progOf = s => state.programs.find(p => p.id === s.scholars?.program_id);

// ---------- Render ----------
function render() {
  $('#who').innerHTML = `${esc(state.profile.full_name || state.profile.email)} (${esc(state.profile.role)}) <button id="out">Sign out</button>`;
  $('#out').onclick = signOut;
  $('#root').innerHTML = isStaff() ? staffView() : scholarView();
  isStaff() ? bindStaff() : bindScholar();
}

function detailView() {
  const s = sel(); if (!s) return '';
  const p = progOf(s), staff = isStaff();
  const checks = (s.policy_checks || []).map(c =>
    `<tr><td>${esc(c.check)}</td><td>${esc(c.rule)}</td><td>${esc(c.actual)}</td><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'Pass' : 'Fail'}</td></tr>`).join('');
  return `<section id="detail"><h2>${esc(s.scholars.student_id)} · ${esc(s.scholars.full_name)} · AY ${esc(s.academic_year)} Sem ${s.semester}</h2>
    <div class="kv">
      <div><span>Program</span>${esc(s.scholars.programs?.name)}</div>
      <div><span>Submission status</span>${badge(s.verification_status)}</div>
      <div><span>Academic compliance</span>${badge(s.compliance_result)}</div>
      <div><span>Renewal decision</span>${badge(s.renewal_decision)}</div>
      <div><span>Award status</span>${badge(s.scholars.award_status)}</div>
      <div><span>Submitted (Asia/Manila)</span>${esc(fmt(s.submitted_at))}</div>
      <div><span>GWA</span>${Number(s.gwa).toFixed(2)}</div><div><span>Enrolled units</span>${s.units}</div>
      <div><span>Failed / INC / Dropped</span>${s.failed_count} / ${s.incomplete_count} / ${s.dropped_count}</div>
      <div><span>Grade-document reference</span>${esc(s.evidence_ref)}</div>
      ${p ? `<div><span>Deadline</span>${esc(fmt(p.deadline))}</div>` : ''}</div>
    ${s.verification_status === 'Returned' ? `<p class="fail">Returned: ${esc(s.verification_reason)}</p>` : ''}
    ${s.decision_note ? `<p><b>Decision note:</b> ${esc(s.decision_note)}</p>` : ''}
    ${checks ? `<h3>Policy checks</h3><div class="tablewrap"><table><tr><th>Check</th><th>Rule</th><th>Actual</th><th>Result</th></tr>${checks}</table></div>` : ''}
    ${s.deficiency_reasons?.length ? `<h3>Deficiency reasons</h3><ul class="reasons">${s.deficiency_reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${staff ? `<h3>Staff actions</h3><label>Reason or note (required to return evidence or hold renewal)</label><textarea id="note" rows="2"></textarea>
      <div class="actions">
        <button class="ok" data-act="verify">Mark Verified</button>
        <button class="bad" data-act="return">Return for correction</button>
        <button data-act="evaluate">Evaluate compliance</button>
        <button class="ok" data-act="approve">Approve renewal</button>
        <button class="bad" data-act="hold">Hold renewal</button></div>` : ''}
    <h3>History</h3>
    ${state.history.length ? `<div class="tablewrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Change</th><th>Note</th></tr>${state.history.map(h =>
      `<tr><td>${esc(fmt(h.created_at))}</td><td>${esc(h.actor_name)}</td><td>${esc(h.action)}</td><td>${esc(h.from_value || '')}${h.from_value ? ' → ' : ''}${esc(h.to_value || '')}</td><td>${esc(h.note || '')}</td></tr>`).join('')}</table></div>` : '<p class="muted">No history yet.</p>'}
  </section>`;
}

// ----- Staff -----
function staffView() {
  const f = state.f;
  const term = state.subs.filter(s => s.academic_year === f.year && String(s.semester) === f.sem);
  const count = fn => term.filter(fn).length;
  const q = f.q.trim().toLowerCase();
  const rows = state.scholars.map(sc => ({ sc, sub: term.find(s => s.scholar_id === sc.id) }))
    .filter(r => !q || r.sc.student_id.toLowerCase().includes(q) || r.sc.full_name.toLowerCase().includes(q))
    .filter(r => !f.program || String(r.sc.program_id) === f.program)
    .filter(r => !f.compliance || r.sub?.compliance_result === f.compliance);
  const tabs = `<div class="tabs"><button data-tab="dashboard" class="${state.tab === 'dashboard' ? 'on' : ''}">Dashboard</button><button data-tab="scholars" class="${state.tab === 'scholars' ? 'on' : ''}">Scholars and policies</button></div>`;
  if (state.tab === 'scholars') return tabs + scholarsTab();
  return tabs + `<div class="stats">
      <div class="stat"><b>${state.scholars.length}</b><span>Assigned scholars</span></div>
      <div class="stat"><b>${count(s => s.verification_status === 'Pending')}</b><span>Pending verification</span></div>
      <div class="stat"><b>${count(s => s.compliance_result === 'Compliant')}</b><span>Compliant</span></div>
      <div class="stat"><b>${count(s => s.compliance_result === 'With Deficiency')}</b><span>With deficiency</span></div></div>
    <section><div class="grid">
      <div><label>Academic year</label><select id="fYear">${YEARS.map(y => `<option ${y === f.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div><label>Semester</label><select id="fSem"><option value="1" ${f.sem === '1' ? 'selected' : ''}>1</option><option value="2" ${f.sem === '2' ? 'selected' : ''}>2</option></select></div>
      <div><label>Search student ID or name</label><input id="fQ" value="${esc(f.q)}"></div>
      <div><label>Program</label><select id="fProg"><option value="">All</option>${state.programs.map(p => `<option value="${p.id}" ${String(p.id) === f.program ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div><label>Compliance</label><select id="fComp">${['', 'Not Evaluated', 'Compliant', 'With Deficiency'].map(c => `<option value="${c}" ${c === f.compliance ? 'selected' : ''}>${c || 'All'}</option>`).join('')}</select></div>
    </div></section>
    <section><h2>Submissions for AY ${esc(f.year)} Semester ${esc(f.sem)}</h2><div class="tablewrap"><table>
      <tr><th>Student ID</th><th>Name</th><th>Program</th><th>Submission</th><th>Compliance</th><th>Renewal</th></tr>
      ${rows.map(({ sc, sub }) => `<tr class="row ${sub && sub.id === state.selected ? 'sel' : ''}" ${sub ? `data-sub="${sub.id}"` : ''}>
        <td>${esc(sc.student_id)}</td><td>${esc(sc.full_name)}</td><td>${esc(sc.programs?.name)}</td>
        <td>${sub ? badge(sub.verification_status) : badge('No submission')}</td><td>${sub ? badge(sub.compliance_result) : ''}</td><td>${sub ? badge(sub.renewal_decision) : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No scholars match these filters.</td></tr>'}
    </table></div></section>${detailView()}`;
}

function scholarsTab() {
  const opts = state.programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  return `<section><h2>Register a scholar</h2><form id="regForm"><div class="grid">
      <div><label>Student ID</label><input id="rId" required></div><div><label>Full name</label><input id="rName" required></div>
      <div><label>Program</label><select id="rProg">${opts}</select></div>
      <div><label>Login email (optional)</label><input id="rEmail" type="email"></div>
      <div><button>Register scholar</button></div></div></form></section>
    <section><h2>Scholars</h2><div class="tablewrap"><table><tr><th>Student ID</th><th>Name</th><th>Program</th><th>Login linked</th><th>Award</th></tr>
      ${state.scholars.map(sc => `<tr><td>${esc(sc.student_id)}</td><td>${esc(sc.full_name)}</td>
        <td><select data-prog="${sc.id}">${state.programs.map(p => `<option value="${p.id}" ${p.id === sc.program_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
        <td>${sc.user_id ? 'Yes' : 'No'}</td><td>${badge(sc.award_status)}</td></tr>`).join('')}</table></div></section>
    <section><h2>Policy records (read from the database)</h2><div class="tablewrap"><table>
      <tr><th>Program</th><th>Max GWA</th><th>Min units</th><th>Failed</th><th>INC</th><th>Dropped</th><th>Deadline</th></tr>
      ${state.programs.map(p => `<tr><td>${esc(p.name)}</td><td>${Number(p.max_gwa).toFixed(2)}</td><td>${p.min_units}</td><td>${p.max_failed}</td><td>${p.max_incomplete}</td><td>${p.max_dropped}</td><td>${esc(fmt(p.deadline))}</td></tr>`).join('')}</table></div></section>`;
}

function bindStaff() {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); });
  document.querySelectorAll('[data-sub]').forEach(r => r.onclick = async () => { state.selected = r.dataset.sub; await refresh(); render(); $('#detail')?.scrollIntoView({ behavior: 'smooth' }); });
  const bindF = (id, key) => { const el = $(id); if (el) el.onchange = el.oninput = () => {
    state.f[key] = el.value; const pos = el.selectionStart; render(); const n = $(id); if (n && key === 'q') { n.focus(); n.setSelectionRange(pos, pos); } }; };
  bindF('#fYear', 'year'); bindF('#fSem', 'sem'); bindF('#fQ', 'q'); bindF('#fProg', 'program'); bindF('#fComp', 'compliance');
  if ($('#regForm')) $('#regForm').onsubmit = async e => { e.preventDefault();
    const r = await call('register_scholar', { p_student_id: $('#rId').value, p_name: $('#rName').value, p_program_id: Number($('#rProg').value), p_login_email: $('#rEmail').value || null }, 'Scholar registered.');
    if (r.ok) { state.tab = 'scholars'; render(); } };
  document.querySelectorAll('[data-prog]').forEach(s => s.onchange = () =>
    call('set_scholar_program', { p_scholar_id: s.dataset.prog, p_program_id: Number(s.value) }, 'Program updated. Earlier evaluations were reset.'));
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const id = state.selected, note = $('#note').value, a = b.dataset.act;
    if (a === 'verify') return call('verify_submission', { p_id: id, p_status: 'Verified', p_reason: note || null }, 'Marked Verified.');
    if (a === 'return') return call('verify_submission', { p_id: id, p_status: 'Returned', p_reason: note }, 'Returned to the scholar.');
    if (a === 'evaluate') return call('evaluate_submission', { p_id: id }, 'Compliance evaluated.');
    if (a === 'approve') return call('decide_renewal', { p_id: id, p_decision: 'Approved', p_note: note || null }, 'Renewal approved.');
    if (a === 'hold') return call('decide_renewal', { p_id: id, p_decision: 'Held', p_note: note }, 'Renewal held.');
  });
}

// ----- Scholar -----
function scholarView() {
  const me = state.scholars[0];
  if (!me) return `<section><h2>No scholar record linked</h2><p>Ask Scholarship Staff to link this login to your scholar record.</p></section>`;
  const d = state.draft || { year: '2026-2027', sem: '1', gwa: '', units: '', failed: '', inc: '', drop: '', evidence: '' };
  const resub = state.draft?.resubmit;
  const num = (id, label, val, extra = '') => `<div><label>${label}</label><input id="${id}" type="number" value="${esc(val)}" ${extra} required></div>`;
  return `<section><h2>${esc(me.full_name)} · ${esc(me.student_id)} · ${esc(me.programs?.name)}</h2>
    <h3>${resub ? 'Correct and resubmit' : 'Submit semester grades'}</h3>
    <form id="subForm" novalidate><div class="grid">
      <div><label>Academic year</label><select id="sYear" ${resub ? 'disabled' : ''}>${YEARS.map(y => `<option ${y === d.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div><label>Semester</label><select id="sSem" ${resub ? 'disabled' : ''}><option value="1" ${d.sem === '1' ? 'selected' : ''}>1</option><option value="2" ${d.sem === '2' ? 'selected' : ''}>2</option></select></div>
      ${num('sGwa', 'GWA (1.00 best, 5.00 failing)', d.gwa, 'step="0.01"')}${num('sUnits', 'Enrolled units', d.units, 'step="1"')}
      ${num('sFailed', 'Failed subjects', d.failed, 'step="1"')}${num('sInc', 'Incomplete grades', d.inc, 'step="1"')}${num('sDrop', 'Dropped subjects', d.drop, 'step="1"')}
      <div><label>Grade-document reference</label><input id="sEv" value="${esc(d.evidence)}" required></div>
    </div><div class="actions"><button>${resub ? 'Resubmit for verification' : 'Submit grades'}</button>${resub ? '<button type="button" class="ghost" id="cancel">Cancel</button>' : ''}</div></form>
    <p class="muted">Your academic summary is checked by Scholarship Staff against the Registrar's records. This system does not change official grades.</p></section>
    <section><h2>My submissions</h2><div class="tablewrap"><table><tr><th>Term</th><th>GWA</th><th>Submitted</th><th>Submission</th><th>Compliance</th><th>Renewal</th><th></th></tr>
      ${state.subs.map(s => `<tr class="row ${s.id === state.selected ? 'sel' : ''}" data-sub="${s.id}"><td>AY ${esc(s.academic_year)} Sem ${s.semester}</td><td>${Number(s.gwa).toFixed(2)}</td><td>${esc(fmt(s.submitted_at))}</td>
        <td>${badge(s.verification_status)}</td><td>${badge(s.compliance_result)}</td><td>${badge(s.renewal_decision)}</td>
        <td>${s.verification_status === 'Returned' ? `<button data-fix="${s.id}">Correct</button>` : ''}</td></tr>
        ${s.verification_status === 'Returned' ? `<tr><td colspan="7" class="fail">Returned: ${esc(s.verification_reason)}</td></tr>` : ''}`).join('')
        || '<tr><td colspan="7" class="muted">You have not submitted any semester yet.</td></tr>'}</table></div></section>${detailView()}`;
}

function bindScholar() {
  document.querySelectorAll('[data-sub]').forEach(r => r.onclick = async () => { state.selected = r.dataset.sub; await refresh(); render(); });
  document.querySelectorAll('[data-fix]').forEach(b => b.onclick = e => { e.stopPropagation();
    const s = state.subs.find(x => x.id === b.dataset.fix);
    state.draft = { resubmit: true, year: s.academic_year, sem: String(s.semester), gwa: s.gwa, units: s.units, failed: s.failed_count, inc: s.incomplete_count, drop: s.dropped_count, evidence: s.evidence_ref };
    render(); window.scrollTo(0, 0); });
  if ($('#cancel')) $('#cancel').onclick = () => { state.draft = null; render(); };
  if (!$('#subForm')) return;
  $('#subForm').onsubmit = async e => {
    e.preventDefault();
    const v = { year: $('#sYear').value, sem: Number($('#sSem').value), gwa: $('#sGwa').value, units: $('#sUnits').value,
      failed: $('#sFailed').value, inc: $('#sInc').value, drop: $('#sDrop').value, ev: $('#sEv').value.trim() };
    const errs = [], gwa = Number(v.gwa);
    if (v.gwa === '' || !(gwa >= 1 && gwa <= 5)) errs.push('GWA must be between 1.00 and 5.00.');
    [['units', 'Enrolled units'], ['failed', 'Failed subjects'], ['inc', 'Incomplete grades'], ['drop', 'Dropped subjects']].forEach(([k, n]) => {
      const x = Number(v[k]); if (v[k] === '' || !Number.isInteger(x) || x < 0) errs.push(`${n} must be a non-negative whole number.`); });
    if (!v.ev) errs.push('A grade-document reference is required.');
    if (errs.length) return toast(errs.join(' '), 'err');
    const r = await call('submit_grades', { p_year: v.year, p_sem: v.sem, p_gwa: gwa, p_units: Number(v.units), p_failed: Number(v.failed),
      p_inc: Number(v.inc), p_drop: Number(v.drop), p_evidence: v.ev }, state.draft?.resubmit ? 'Resubmitted. Status is Pending verification.' : 'Grades submitted.');
    if (r.ok) { state.draft = null; render(); }
  };
}

boot();
