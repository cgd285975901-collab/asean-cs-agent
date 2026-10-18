'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $('loginView'),
  adminView: $('adminView'),
  loginForm: $('loginForm'),
  tokenInput: $('tokenInput'),
  loginError: $('loginError'),
  adminTokenInput: $('adminTokenInput'),
  refreshBtn: $('refreshBtn'),
  logoutBtn: $('logoutBtn'),
  sessionRows: $('sessionRows'),
  emptyState: $('emptyState'),
  statTotal: $('statTotal'),
  statEnded: $('statEnded'),
  statRisk: $('statRisk'),
  statScore: $('statScore'),
  lastRefresh: $('lastRefresh'),
  drawer: $('drawer'),
  closeDrawer: $('closeDrawer'),
  drawerTitle: $('drawerTitle'),
  drawerMeta: $('drawerMeta'),
  drawerFlags: $('drawerFlags'),
  drawerMetrics: $('drawerMetrics'),
  drawerTranscript: $('drawerTranscript'),
  drawerNote: $('drawerNote'),
  drawerCsv: $('drawerCsv'),
  exportAll: $('exportAll'),
  toast: $('adminToast'),
};

let token = '';
let refreshTimer = null;
let toastTimer = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
  const params = new URLSearchParams(location.search);
  const urlToken = params.get('token') || '';
  token = urlToken || sessionStorage.getItem('asean.adminToken') || '';
  if (token) {
    els.tokenInput.value = token;
    els.adminTokenInput.value = token;
    loadSessions();
  } else {
    showLogin();
  }

  els.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = els.tokenInput.value.trim();
    if (!value) return;
    token = value;
    sessionStorage.setItem('asean.adminToken', token);
    loadSessions();
  });

  els.refreshBtn.addEventListener('click', () => {
    const value = els.adminTokenInput.value.trim();
    if (value && value !== token) {
      token = value;
      sessionStorage.setItem('asean.adminToken', token);
    }
    loadSessions();
  });

  els.logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('asean.adminToken');
    token = '';
    if (refreshTimer) clearInterval(refreshTimer);
    showLogin();
  });

  els.closeDrawer.addEventListener('click', closeDrawer);
  els.drawer.addEventListener('click', (e) => {
    if (e.target === els.drawer) closeDrawer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
}

function showLogin() {
  els.loginView.classList.remove('hidden');
  els.adminView.classList.add('hidden');
  els.logoutBtn.classList.add('hidden');
  els.tokenInput.focus();
}

function showAdmin() {
  els.loginView.classList.add('hidden');
  els.adminView.classList.remove('hidden');
  els.logoutBtn.classList.remove('hidden');
  els.exportAll.href = `/api/admin/sessions.csv?token=${encodeURIComponent(token)}`;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadSessions, 20000);
}

async function loadSessions() {
  try {
    const data = await fetchJSON('/api/admin/sessions');
    showAdmin();
    renderSessions(data.sessions || []);
    els.lastRefresh.textContent = `最后刷新：${new Date().toLocaleTimeString('zh-CN')}`;
  } catch (err) {
    if (err.status === 401) {
      if (refreshTimer) clearInterval(refreshTimer);
      showLogin();
      els.loginError.textContent = '口令不正确，请重新输入。';
      els.loginError.classList.remove('hidden');
    } else {
      showToast(err.message || '加载失败');
    }
  }
}

function renderSessions(sessions) {
  els.sessionRows.textContent = '';
  els.emptyState.classList.toggle('hidden', sessions.length > 0);

  const ended = sessions.filter((s) => s.ended).length;
  const risk = sessions.filter((s) => s.flags && s.flags.length).length;
  const scores = sessions.filter((s) => typeof s.score === 'number').map((s) => s.score);
  els.statTotal.textContent = String(sessions.length);
  els.statEnded.textContent = String(ended);
  els.statRisk.textContent = String(risk);
  els.statScore.textContent = scores.length ? String(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)) : '—';

  sessions.forEach((s) => {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    const nameStrong = document.createElement('div');
    nameStrong.className = 'name';
    nameStrong.textContent = s.studentName || '未填写';
    const classDiv = document.createElement('div');
    classDiv.className = 'muted';
    classDiv.textContent = s.className || '未填写班级';
    name.appendChild(nameStrong);
    name.appendChild(classDiv);
    tr.appendChild(name);

    const started = document.createElement('td');
    started.textContent = formatDateTime(s.createdAt);
    tr.appendChild(started);

    const turns = document.createElement('td');
    turns.textContent = String(s.turns || 0);
    tr.appendChild(turns);

    const status = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill ${s.ended ? 'green' : 'sand'}`;
    pill.textContent = s.ended ? (s.deal ? '已结束 · 有意向' : '已提交') : s.stage === 'closing' ? '收口中' : '进行中';
    status.appendChild(pill);
    tr.appendChild(status);

    const score = document.createElement('td');
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'score';
    if (typeof s.score === 'number') {
      scoreSpan.textContent = `${s.grade || ''} · ${s.score}`;
      if (s.score < 60) scoreSpan.classList.add('low');
      else if (s.score < 75) scoreSpan.classList.add('mid');
    } else {
      scoreSpan.textContent = '—';
    }
    score.appendChild(scoreSpan);
    tr.appendChild(score);

    const flags = document.createElement('td');
    if (s.flags && s.flags.length) {
      s.flags.slice(0, 3).forEach((f, i) => {
        const fp = document.createElement('span');
        fp.className = 'pill red';
        fp.textContent = (s.flagLabels && s.flagLabels[i]) || f;
        flags.appendChild(fp);
      });
      if (s.flags.length > 3) {
        const more = document.createElement('span');
        more.className = 'pill';
        more.textContent = `+${s.flags.length - 3}`;
        flags.appendChild(more);
      }
    } else {
      const none = document.createElement('span');
      none.className = 'pill green';
      none.textContent = '无';
      flags.appendChild(none);
    }
    tr.appendChild(flags);

    const actions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'ghost';
    viewBtn.type = 'button';
    viewBtn.textContent = '查看';
    viewBtn.addEventListener('click', () => openDrawer(s.id));
    const csv = document.createElement('a');
    csv.className = 'ghost';
    csv.textContent = 'CSV';
    csv.href = `/api/admin/session/${s.id}/export.csv?token=${encodeURIComponent(token)}`;
    csv.download = `asean-cs-${s.id}.csv`;
    wrap.appendChild(viewBtn);
    wrap.appendChild(csv);
    actions.appendChild(wrap);
    tr.appendChild(actions);

    els.sessionRows.appendChild(tr);
  });
}

async function openDrawer(id) {
  try {
    const data = await fetchJSON(`/api/admin/session/${id}`);
    els.drawerTitle.textContent = `${data.meta.studentName || '学生'} · 对话回放`;
    els.drawerMeta.textContent = `${data.meta.className || '未填写班级'} · 开始于 ${formatDateTime(data.meta.createdAt)} · ${data.turns.length} 条消息`;
    els.drawerFlags.textContent = '';
    if (data.flags && data.flags.length) {
      data.flags.forEach((f, i) => {
        const pill = document.createElement('span');
        pill.className = 'pill red';
        pill.textContent = (data.flagLabels && data.flagLabels[i]) || f;
        els.drawerFlags.appendChild(pill);
      });
    } else {
      const pill = document.createElement('span');
      pill.className = 'pill green';
      pill.textContent = '无风险标记';
      els.drawerFlags.appendChild(pill);
    }

    els.drawerMetrics.textContent = '';
    const metrics = data.metrics || {};
    [
      ['对话轮次', data.state.turn || 0],
      ['报价完整度', `${metrics.found || 0} / 8`],
      ['系统预估', metrics.score != null ? `${metrics.grade || ''} · ${metrics.score}` : '—'],
      ['风险标记', data.flags ? data.flags.length : 0],
    ].forEach(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'admin-stat';
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = String(value);
      box.appendChild(span);
      box.appendChild(strong);
      els.drawerMetrics.appendChild(box);
    });

    els.drawerTranscript.textContent = '';
    data.turns.forEach((t) => {
      const row = document.createElement('div');
      row.className = `admin-turn ${t.role === 'student' ? 'student' : 'buyer'}`;
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = t.role === 'student' ? '学生' : 'Rizky';
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = t.content;
      row.appendChild(who);
      row.appendChild(body);
      els.drawerTranscript.appendChild(row);
    });

    els.drawerNote.textContent = data.summary
      ? data.summary.veto
        ? '存在一票否决项，建议重做。'
        : data.summary.deal
          ? '已达成初步意向，建议检查 PI 与样品跟进。'
          : '尚未形成成交条件，建议复盘报价缺口。'
      : '会话仍在进行中。';

    els.drawerCsv.href = `/api/admin/session/${id}/export.csv?token=${encodeURIComponent(token)}`;
    els.drawerCsv.download = `asean-cs-${id}.csv`;
    els.drawer.classList.remove('hidden');
  } catch (err) {
    if (err.status === 401) {
      showLogin();
      showToast('登录已失效，请重新输入口令。');
    } else {
      showToast(err.message || '加载会话失败');
    }
  }
}

function closeDrawer() {
  els.drawer.classList.add('hidden');
}

function formatDateTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'x-admin-token': token },
    cache: 'no-store',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.message || data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}
