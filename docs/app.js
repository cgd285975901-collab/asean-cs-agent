'use strict';

/*
 * Static GitHub Pages client.
 * No server: the buyer engine runs in the browser and every session is saved
 * in localStorage. Students can export a CSV at any time or after submitting.
 */

const $ = (id) => document.getElementById(id);
const ENGINE = window.BuyerEngine;
const STORAGE_KEY = 'asean.static.sessions.v1';

const els = {
  startScreen: $('startScreen'),
  chatScreen: $('chatScreen'),
  startForm: $('startForm'),
  startBtn: $('startBtn'),
  startError: $('startError'),
  nameInput: $('nameInput'),
  classInput: $('classInput'),
  studentIdInput: $('studentIdInput'),
  codeField: $('codeField'),
  codeInput: $('codeInput'),
  messages: $('messages'),
  messageInput: $('messageInput'),
  sendBtn: $('sendBtn'),
  endBtn: $('endBtn'),
  exportBtn: $('exportBtn'),
  timer: $('timer'),
  turnCount: $('turnCount'),
  quoteChecklist: $('quoteChecklist'),
  quoteProgress: $('quoteProgress'),
  quoteMissing: $('quoteMissing'),
  calcQty: $('calcQty'),
  calcPrice: $('calcPrice'),
  calcIncoterm: $('calcIncoterm'),
  calcTotal: $('calcTotal'),
  insertQuoteBtn: $('insertQuoteBtn'),
  sidebar: $('sidebar'),
  sidebarBackdrop: $('sidebarBackdrop'),
  mobileSidebarBtn: $('mobileSidebarBtn'),
  helpModal: $('helpModal'),
  closeHelp: $('closeHelp'),
  helpStart: $('helpStart'),
  summaryModal: $('summaryModal'),
  closeSummary: $('closeSummary'),
  sumTurns: $('sumTurns'),
  sumQuote: $('sumQuote'),
  sumScore: $('sumScore'),
  sumFlags: $('sumFlags'),
  sumNext: $('sumNext'),
  downloadLink: $('downloadLink'),
  toast: $('toast'),
  statusText: $('statusText'),
  composerHint: $('composerHint'),
};

const QUOTE_FIELDS = ['product', 'price', 'incoterm', 'currency', 'moq', 'lead', 'payment', 'validity'];
const MISSING_LABELS = {
  'unit price': '单价',
  Incoterm: '贸易术语',
  currency: '币种',
  MOQ: 'MOQ',
  'lead time': '交期',
  'payment terms': '付款方式',
  'quotation validity': '有效期',
};

let current = null;
let state = null;
let ended = false;
let sending = false;
let timerId = null;
let endAt = 0;
let toastTimer = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
  if (!ENGINE) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Arial">engine.js 加载失败，请刷新页面。</div>';
    return;
  }
  bindEvents();
  detectEmbed();
  els.codeField.classList.add('hidden');
  let savedName = '';
  let savedClass = '';
  try {
    savedName = localStorage.getItem('asean.name') || '';
    savedClass = localStorage.getItem('asean.class') || '';
  } catch {
    // file:// or strict privacy mode may block localStorage; the page still works,
    // but the student must export the CSV before closing.
  }
  if (savedName) els.nameInput.value = savedName;
  if (savedClass) els.classInput.value = savedClass;

  const sid = new URLSearchParams(location.search).get('session');
  if (sid) resumeSession(sid);
  else showStart();
  updateCalc();
}

function detectEmbed() {
  if (new URLSearchParams(location.search).get('embed') === '1') {
    document.body.classList.add('embed');
  }
}

function bindEvents() {
  els.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    createSession();
  });
  els.sendBtn.addEventListener('click', sendMessage);
  els.endBtn.addEventListener('click', () => submitSession('student_submitted', false));
  els.exportBtn.addEventListener('click', downloadCsv);
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  els.messageInput.addEventListener('input', autoGrow);
  els.insertQuoteBtn.addEventListener('click', insertQuote);
  [els.calcQty, els.calcPrice, els.calcIncoterm].forEach((el) => {
    el.addEventListener('input', updateCalc);
    el.addEventListener('change', updateCalc);
  });

  $('btnHelp').addEventListener('click', () => openModal(els.helpModal));
  els.closeHelp.addEventListener('click', () => closeModal(els.helpModal));
  els.helpStart.addEventListener('click', () => closeModal(els.helpModal));
  els.closeSummary.addEventListener('click', () => closeModal(els.summaryModal));
  els.downloadLink.addEventListener('click', (e) => {
    e.preventDefault();
    downloadCsv();
  });
  els.helpModal.addEventListener('click', (e) => {
    if (e.target === els.helpModal) closeModal(els.helpModal);
  });
  els.summaryModal.addEventListener('click', (e) => {
    if (e.target === els.summaryModal) closeModal(els.summaryModal);
  });

  els.mobileSidebarBtn.addEventListener('click', toggleSidebar);
  els.sidebarBackdrop.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal(els.helpModal);
      closeModal(els.summaryModal);
      closeSidebar();
    }
  });
}

function now() {
  return new Date().toISOString();
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function showStart() {
  els.startScreen.classList.remove('hidden');
  els.chatScreen.classList.add('hidden');
  els.startBtn.disabled = false;
  els.startBtn.querySelector('span').textContent = '进入对话';
}

function showChat() {
  els.startScreen.classList.add('hidden');
  els.chatScreen.classList.remove('hidden');
  setTimeout(() => els.messageInput.focus(), 80);
}

function createSession() {
  const name = els.nameInput.value.trim();
  const className = els.classInput.value.trim();
  const studentId = els.studentIdInput.value.trim();
  if (!name) {
    showStartError('请先填写姓名。');
    els.nameInput.focus();
    return;
  }
  hideStartError();
  const id = makeId();
  const meta = {
    studentName: name,
    className,
    studentIdHash: studentId ? hashShort(studentId) : '',
    createdAt: now(),
  };
  const st = ENGINE.createSession({ sessionId: id, student: meta });
  current = {
    id,
    meta,
    state: st,
    turns: [{ turn: 0, role: 'buyer', content: st.opening, at: now() }],
    summary: null,
    ended: false,
    endedAt: null,
  };
  state = st;
  ended = false;
  try {
    localStorage.setItem('asean.name', name);
    localStorage.setItem('asean.class', className);
  } catch {
    // ignore: export still works even if persistence is blocked
  }
  saveRecord();
  clearMessages();
  appendSystem('实训开始 · 20 分钟 · 请用英文完成接待与报价');
  appendMessage('buyer', st.opening, now());
  showChat();
  updateUI(st);
  startTimer(20 * 60);
  setUrlSession(id);
}

function resumeSession(id) {
  const record = loadRecord(id);
  if (!record) {
    showStart();
    showToast('没有找到这次记录，请重新开始。');
    return;
  }
  current = record;
  state = record.state;
  ended = !!record.ended;
  clearMessages();
  appendSystem('已恢复本次对话记录');
  (record.turns || []).forEach((t) => appendMessage(t.role, t.content, t.at));
  showChat();
  updateUI(state);
  if (ended) {
    disableComposer();
    if (current.summary) showSummary(current.summary);
  } else {
    startTimerFromMeta(current.meta);
  }
}

function setUrlSession(id) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('session', id);
    history.replaceState(null, '', url.toString());
  } catch {
    // file:// history updates can be blocked; the session is still saved locally.
  }
}

function startTimerFromMeta(meta) {
  const created = Date.parse(meta && meta.createdAt) || Date.now();
  const elapsed = Math.max(0, (Date.now() - created) / 1000);
  startTimer(Math.max(0, 1200 - elapsed));
}

function startTimer(seconds) {
  if (timerId) clearInterval(timerId);
  endAt = Date.now() + Math.max(0, seconds) * 1000;
  renderTimer();
  timerId = setInterval(() => {
    renderTimer();
    if (Date.now() >= endAt) {
      clearInterval(timerId);
      timerId = null;
      if (!ended) {
        appendSystem('时间到，系统已自动提交本次对话。');
        submitSession('timeout', true);
      }
    }
  }, 1000);
}

function renderTimer() {
  const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  els.timer.textContent = `${mm}:${ss}`;
  els.timer.style.color = remaining <= 120 ? 'var(--red)' : '';
}

function updateUI(st) {
  if (!st) return;
  state = st;
  els.turnCount.textContent = st.turn || 0;
  const q = st.quote || {};
  const done = [];
  QUOTE_FIELDS.forEach((field) => {
    const isDone = field === 'product' ? !!q.product : !!q[field];
    const li = els.quoteChecklist.querySelector(`[data-field="${field}"]`);
    if (li) li.classList.toggle('done', isDone);
    if (isDone) done.push(field);
  });
  els.quoteProgress.style.width = `${Math.round((done.length / QUOTE_FIELDS.length) * 100)}%`;
  const rawMissing = ENGINE.missingFields ? ENGINE.missingFields(st) : (q.missing || []);
  const missing = rawMissing.map((m) => MISSING_LABELS[m] || m);
  els.quoteMissing.textContent = missing.length
    ? `还缺：${missing.join('、')}`
    : '8 项已齐全。记得用英文复述并推进样品 / PI。';
  if (st.ended) disableComposer();
}

function disableComposer() {
  ended = true;
  els.messageInput.disabled = true;
  els.sendBtn.disabled = true;
  els.endBtn.disabled = true;
  els.messageInput.placeholder = '本次对话已提交';
  els.composerHint.textContent = '本次对话已结束，记录已保存在本机。';
  els.statusText.textContent = '已提交';
}

function enableComposer() {
  ended = false;
  els.messageInput.disabled = false;
  els.sendBtn.disabled = false;
  els.endBtn.disabled = false;
  els.messageInput.placeholder = 'Type your reply in English...';
  els.composerHint.textContent = '用英文回复。Enter 发送，Shift + Enter 换行。';
  els.statusText.textContent = '已连接';
}

function sendMessage() {
  if (!current || ended || sending) return;
  const text = els.messageInput.value.trim();
  if (!text) return;
  if (text.length > 2000) {
    showToast('单条消息不能超过 2000 个字符。');
    return;
  }
  appendMessage('student', text, now());
  els.messageInput.value = '';
  autoGrow();
  sending = true;
  setSending(true);
  const typing = appendTyping();
  const turn = (state.turn || 0) + 1;

  // Small delay so the buyer feels like a person typing, not an instant script.
  setTimeout(() => {
    try {
      const result = ENGINE.respond(state, text);
      state = result.state;
      current.state = state;
      current.turns.push({ turn, role: 'student', content: text, at: now() });
      current.turns.push({ turn: state.turn, role: 'buyer', content: result.reply, at: now() });
      if (result.ended) {
        current.ended = true;
        current.summary = result.summary;
        current.endedAt = now();
      }
      saveRecord();
      typing.remove();
      appendMessage('buyer', result.reply, now());
      updateUI(state);
      if (result.ended) {
        disableComposer();
        appendSystem('本轮对话结束，记录已保存在本机。');
        if (result.summary) showSummary(result.summary);
      }
    } catch (err) {
      typing.remove();
      showToast('本地引擎出错，请刷新页面后重试。');
      console.error(err);
    } finally {
      sending = false;
      setSending(false);
    }
  }, 420);
}

function setSending(isSending) {
  els.sendBtn.disabled = isSending || ended;
  els.sendBtn.textContent = isSending ? '发送中…' : '发送';
  els.statusText.textContent = isSending ? 'Rizky 正在输入…' : ended ? '已提交' : '已连接';
  if (!ended) els.endBtn.disabled = isSending;
}

function submitSession(reason, silent) {
  if (!current || ended || sending) return;
  if (!silent && !window.confirm('确定结束并提交吗？提交后不能继续对话，请记得导出 CSV。')) return;
  const summary = ENGINE.endSession(state, reason || 'student_submitted');
  current.summary = summary;
  current.ended = true;
  current.endedAt = now();
  saveRecord();
  disableComposer();
  if (!silent) appendSystem('实训已提交，记录已保存在本机。');
  showSummary(summary);
}

function appendMessage(role, content, at) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (role === 'buyer') {
    const avatar = document.createElement('div');
    avatar.className = 'avatar small';
    avatar.textContent = 'R';
    wrap.appendChild(avatar);
  }
  const body = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  body.appendChild(bubble);
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const who = role === 'buyer' ? 'Rizky' : role === 'student' ? '你' : '';
  meta.textContent = `${who}${who ? ' · ' : ''}${formatClock(at)}`;
  body.appendChild(meta);
  wrap.appendChild(body);
  els.messages.appendChild(wrap);
  scrollMessages();
  return wrap;
}

function appendSystem(content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg system';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  scrollMessages();
}

function appendTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg buyer typing';
  const avatar = document.createElement('div');
  avatar.className = 'avatar small';
  avatar.textContent = 'R';
  wrap.appendChild(avatar);
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  for (let i = 0; i < 3; i += 1) bubble.appendChild(document.createElement('i'));
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  scrollMessages();
  return wrap;
}

function clearMessages() {
  els.messages.textContent = '';
}

function scrollMessages() {
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function formatClock(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function autoGrow() {
  const el = els.messageInput;
  el.style.height = 'auto';
  el.style.height = `${Math.min(140, Math.max(46, el.scrollHeight))}px`;
}

function updateCalc() {
  const qty = Number(els.calcQty.value) || 0;
  const base = Number(els.calcPrice.value) || 0;
  const incoterm = els.calcIncoterm.value;
  const unit = incoterm === 'CIF' ? base + 0.18 : base;
  const total = Math.max(0, qty * unit);
  els.calcTotal.textContent = `USD ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function insertQuote() {
  if (ended || !current) {
    showToast('本次对话已结束。');
    return;
  }
  const qty = Math.max(1000, Number(els.calcQty.value) || 20000);
  const base = Math.max(0.5, Number(els.calcPrice.value) || 2.68);
  const incoterm = els.calcIncoterm.value;
  const unit = incoterm === 'CIF' ? base + 0.18 : base;
  const port = incoterm === 'FOB' ? 'Ningbo' : 'Jakarta';
  const text =
    `For ${qty.toLocaleString('en-US')} pcs, our ${incoterm} ${port} price is USD ${unit.toFixed(2)}/pc. ` +
    'MOQ 1,000 pcs; lead time 25-30 days; payment 30% T/T deposit, 70% before shipment; quotation valid 15 days.';
  els.messageInput.value = text;
  autoGrow();
  els.messageInput.focus();
  showToast('已插入报价，可修改后发送。');
}

function toggleSidebar() {
  const open = els.sidebar.classList.toggle('open');
  els.sidebarBackdrop.classList.toggle('hidden', !open);
}

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.sidebarBackdrop.classList.add('hidden');
}

function openModal(modal) {
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

function showStartError(message) {
  els.startError.textContent = message;
  els.startError.classList.remove('hidden');
}

function hideStartError() {
  els.startError.textContent = '';
  els.startError.classList.add('hidden');
}

function showSummary(summary) {
  if (!summary) return;
  const metrics = summary.metrics || {};
  els.sumTurns.textContent = state ? state.turn : '—';
  els.sumQuote.textContent = `${metrics.found || 0} / 8`;
  els.sumScore.textContent = metrics.grade ? `${metrics.grade} · ${metrics.score}` : '—';
  els.sumFlags.textContent = summary.flags && summary.flags.length ? `${summary.flags.length} 项` : '无';
  els.sumNext.textContent = metrics.veto
    ? '本轮存在红线动作。请导出 CSV 交给教师复盘；建议重做一局，先守住价格与合规边界。'
    : summary.deal
      ? '已达成初步意向。请导出 CSV 交给教师，并准备 PI / 样品跟进。'
      : '尚未形成成交条件。请导出 CSV 交给教师，复盘报价缺口。';
  openModal(els.summaryModal);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}

function allRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecord() {
  if (!current) return;
  const list = allRecords();
  const index = list.findIndex((r) => r.id === current.id);
  const copy = JSON.parse(JSON.stringify(current));
  if (index >= 0) list[index] = copy;
  else list.push(copy);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    showToast('浏览器未允许本地存储，请及时点“导出”保存 CSV。');
    console.error(err);
  }
}

function loadRecord(id) {
  return allRecords().find((r) => r.id === id) || null;
}

function hashShort(value) {
  // Tiny non-cryptographic hash for local display; the static version has no server.
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function downloadCsv() {
  if (!current) {
    showToast('还没有可导出的对话。');
    return;
  }
  const summary = current.summary || (ended ? ENGINE.buildSummary(state) : null);
  const flags = summary ? summary.flags.join('|') : '';
  const score = summary ? summary.metrics.score : '';
  const grade = summary ? summary.metrics.grade : '';
  const rows = [
    ['session_id', 'student', 'class', 'started_at', 'ended_at', 'score', 'grade', 'flags', 'turn', 'role', 'content', 'at'],
  ];
  (current.turns || []).forEach((t) => {
    rows.push([
      current.id,
      current.meta.studentName,
      current.meta.className,
      current.meta.createdAt,
      current.endedAt || '',
      score,
      grade,
      flags,
      t.turn,
      t.role,
      t.content,
      t.at,
    ]);
  });
  const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = `${current.meta.studentName || 'student'}-${current.id.slice(0, 8)}`;
  a.href = url;
  a.download = `asean-cs-${safe}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('CSV 已导出，请交给教师。');
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return `"${s.replace(/"/g, '""')}"`;
}
