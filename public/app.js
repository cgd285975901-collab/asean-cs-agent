'use strict';

const $ = (id) => document.getElementById(id);

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
  embedBadge: $('embedBadge'),
  statusText: $('statusText'),
  composerHint: $('composerHint'),
};

let config = null;
let sessionId = null;
let sessionMeta = null;
let currentState = null;
let ended = false;
let sending = false;
let timerId = null;
let endAt = 0;
let toastTimer = null;

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

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  detectEmbed();
  try {
    config = await fetchJSON('/api/config');
  } catch {
    config = { classCodeRequired: false, product: {} };
  }
  if (config.classCodeRequired) els.codeField.classList.remove('hidden');

  const params = new URLSearchParams(location.search);
  const code = params.get('code') || '';
  if (code) els.codeInput.value = code;

  const savedName = localStorage.getItem('asean.name') || '';
  const savedClass = localStorage.getItem('asean.class') || '';
  if (savedName) els.nameInput.value = savedName;
  if (savedClass) els.classInput.value = savedClass;

  const sid = params.get('session');
  if (sid) {
    await resumeSession(sid);
  } else {
    showStart();
  }
  updateCalc();
}

function detectEmbed() {
  const isEmbed = location.pathname.replace(/\/+$/, '') === '/embed' || new URLSearchParams(location.search).get('embed') === '1';
  if (isEmbed) {
    document.body.classList.add('embed');
    els.embedBadge.classList.remove('hidden');
  }
}

function bindEvents() {
  els.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    createSession();
  });
  els.sendBtn.addEventListener('click', sendMessage);
  els.endBtn.addEventListener('click', () => submitSession('student_submitted', false));
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

async function createSession() {
  const name = els.nameInput.value.trim();
  const className = els.classInput.value.trim();
  const studentId = els.studentIdInput.value.trim();
  const code = els.codeInput.value.trim();
  if (!name) {
    showStartError('请先填写姓名。');
    els.nameInput.focus();
    return;
  }
  if (config && config.classCodeRequired && !code) {
    showStartError('请输入教师提供的班级访问码。');
    els.codeInput.focus();
    return;
  }
  hideStartError();
  els.startBtn.disabled = true;
  els.startBtn.querySelector('span').textContent = '正在进入…';
  try {
    const data = await fetchJSON('/api/session', {
      method: 'POST',
      body: JSON.stringify({ name, className, studentId, code }),
    });
    sessionId = data.sessionId;
    sessionMeta = {
      studentName: name,
      className,
      createdAt: new Date().toISOString(),
    };
    currentState = data.state;
    ended = false;
    localStorage.setItem('asean.name', name);
    localStorage.setItem('asean.class', className);
    clearMessages();
    appendSystem('实训开始 · 20 分钟 · 请用英文完成接待与报价');
    appendMessage('buyer', data.opening, new Date().toISOString());
    showChat();
    updateUI(data.state);
    startTimer(data.state.timerSeconds || 1200);
    setUrlSession(sessionId);
  } catch (err) {
    showStartError(err.message || '无法创建会话，请稍后再试。');
    els.startBtn.disabled = false;
    els.startBtn.querySelector('span').textContent = '进入对话';
  }
}

async function resumeSession(id) {
  try {
    const data = await fetchJSON(`/api/session/${id}`);
    sessionId = id;
    sessionMeta = data.meta;
    currentState = data.state;
    ended = !!data.summary || !!data.state.ended;
    clearMessages();
    appendSystem('已恢复本次对话记录');
    (data.turns || []).forEach((t) => appendMessage(t.role, t.content, t.at));
    showChat();
    updateUI(data.state);
    if (ended) {
      disableComposer();
      if (data.summary) showSummary(data.summary);
    } else {
      startTimerFromMeta(data.meta);
    }
  } catch (err) {
    showStart();
    showToast('会话不存在或已过期，请重新开始。');
  }
}

function setUrlSession(id) {
  const url = new URL(location.href);
  url.searchParams.set('session', id);
  url.searchParams.delete('code');
  history.replaceState(null, '', url.toString());
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

function updateUI(state) {
  if (!state) return;
  currentState = state;
  els.turnCount.textContent = state.turn || 0;

  const q = state.quote || {};
  const done = [];
  QUOTE_FIELDS.forEach((field) => {
    const isDone = field === 'product' ? !!q.product : !!q[field];
    const li = els.quoteChecklist.querySelector(`[data-field="${field}"]`);
    if (li) li.classList.toggle('done', isDone);
    if (isDone) done.push(field);
  });
  els.quoteProgress.style.width = `${Math.round((done.length / QUOTE_FIELDS.length) * 100)}%`;

  const missing = (q.missing || []).map((m) => MISSING_LABELS[m] || m);
  els.quoteMissing.textContent = missing.length
    ? `还缺：${missing.join('、')}`
    : '8 项已齐全。记得用英文复述并推进样品 / PI。';

  if (state.ended) {
    disableComposer();
  }
}

function disableComposer() {
  ended = true;
  els.messageInput.disabled = true;
  els.sendBtn.disabled = true;
  els.endBtn.disabled = true;
  els.messageInput.placeholder = '本次对话已提交';
  els.composerHint.textContent = '本次对话已结束，记录已保存。';
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

async function sendMessage() {
  if (!sessionId || ended || sending) return;
  const text = els.messageInput.value.trim();
  if (!text) return;
  if (text.length > 2000) {
    showToast('单条消息不能超过 2000 个字符。');
    return;
  }
  appendMessage('student', text, new Date().toISOString());
  els.messageInput.value = '';
  autoGrow();
  sending = true;
  setSending(true);
  const typing = appendTyping();
  try {
    const data = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId, message: text }),
    });
    typing.remove();
    appendMessage('buyer', data.reply, new Date().toISOString());
    updateUI(data.state);
    if (data.ended) {
      disableComposer();
      appendSystem('本轮对话结束，记录已保存。');
      if (data.summary) showSummary(data.summary);
    }
  } catch (err) {
    typing.remove();
    if (err.status === 409 && err.data && err.data.summary) {
      disableComposer();
      showSummary(err.data.summary);
    } else {
      showToast(err.message || '发送失败，请检查网络后重试。');
      els.messageInput.value = text;
      autoGrow();
    }
  } finally {
    sending = false;
    setSending(false);
  }
}

function setSending(isSending) {
  els.sendBtn.disabled = isSending || ended;
  els.sendBtn.textContent = isSending ? '发送中…' : '发送';
  els.statusText.textContent = isSending ? 'Rizky 正在输入…' : ended ? '已提交' : '已连接';
  if (!ended) els.endBtn.disabled = isSending;
}

async function submitSession(reason, silent) {
  if (!sessionId || ended || sending) return;
  if (!silent && !window.confirm('确定结束并提交吗？提交后不能继续对话，教师将看到完整记录。')) return;
  sending = true;
  setSending(true);
  try {
    const data = await fetchJSON('/api/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId, reason }),
    });
    disableComposer();
    if (!silent) appendSystem('实训已提交，记录已保存。');
    if (data.summary) showSummary(data.summary);
  } catch (err) {
    showToast(err.message || '提交失败，请重试。');
    sending = false;
    setSending(false);
  }
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
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('i');
    bubble.appendChild(dot);
  }
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
  if (ended) {
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
  els.sumTurns.textContent = currentState ? currentState.turn : '—';
  els.sumQuote.textContent = `${metrics.found || 0} / 8`;
  els.sumScore.textContent = metrics.grade ? `${metrics.grade} · ${metrics.score}` : '—';
  els.sumFlags.textContent = summary.flags && summary.flags.length ? `${summary.flags.length} 项` : '无';
  els.sumNext.textContent = metrics.veto
    ? '本轮存在红线动作，请等待教师复盘；建议重做一局，先守住价格与合规边界。'
    : summary.deal
      ? '已达成初步意向。下一步：等待教师复盘，并准备 PI / 样品跟进。'
      : '尚未形成成交条件。下一步：复盘报价缺口，重做一局或按教师要求补交跟进邮件。';
  els.downloadLink.href = `/api/session/${sessionId}/export.csv`;
  openModal(els.summaryModal);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}

async function fetchJSON(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.message || data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
