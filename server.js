'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const {
  PRODUCT,
  createSession,
  respond,
  endSession,
  buildSummary,
  publicState,
  FLAG_LABELS,
} = require('./engine');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');

const PORT = Number(process.env.PORT || 8792);
const HOST = process.env.HOST || '0.0.0.0';
const CLASS_CODE = String(process.env.CLASS_CODE || '').trim();
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim() || crypto.randomBytes(6).toString('hex');
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const APP_NAME = '东盟批量采购询价与议价';

fs.mkdirSync(SESSION_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const activeLocks = new Set();

function now() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function adminTokenFrom(req, url) {
  return req.headers['x-admin-token'] || url.searchParams.get('token') || '';
}

function requireAdmin(req, res, url) {
  const token = adminTokenFrom(req, url);
  if (!token || !safeEqual(token, ADMIN_TOKEN)) {
    json(res, 401, { error: 'unauthorized', message: '教师后台口令不正确。' });
    return false;
  }
  return true;
}

function sessionPath(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return path.join(SESSION_DIR, `${id}.jsonl`);
}

async function append(id, obj) {
  const file = sessionPath(id);
  if (!file) throw new Error('invalid_session');
  await fsp.appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}

async function readSession(id) {
  const file = sessionPath(id);
  if (!file) return null;
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  let meta = null;
  let state = null;
  let end = null;
  const turns = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === 'meta') {
      meta = obj.meta;
      state = obj.state || null;
    } else if (obj.type === 'meta_update') {
      meta = { ...(meta || {}), ...(obj.meta || {}) };
    } else if (obj.type === 'turn') {
      turns.push(obj);
    } else if (obj.type === 'snapshot') {
      state = obj.state || state;
    } else if (obj.type === 'end') {
      end = obj;
    }
  }
  if (!meta || !state) return null;
  if (end) state.ended = true;
  return { id, meta, state, turns, end };
}

function publicSession(rec) {
  return {
    id: rec.id,
    meta: {
      studentName: rec.meta.studentName,
      className: rec.meta.className,
      studentIdHash: rec.meta.studentIdHash,
      createdAt: rec.meta.createdAt,
      endedAt: rec.meta.endedAt || (rec.end && rec.end.at) || null,
    },
    turns: rec.turns.map((t) => ({ turn: t.turn, role: t.role, content: t.content, at: t.at })),
    state: publicState(rec.state),
    summary: rec.end ? rec.end.summary : rec.state.ended ? buildSummary(rec.state) : null,
  };
}

async function listSessions() {
  const names = await fsp.readdir(SESSION_DIR).catch(() => []);
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const rec = await readSession(name.replace(/\.jsonl$/, ''));
    if (!rec) continue;
    const lastTurn = rec.turns[rec.turns.length - 1];
    const summary = rec.end ? rec.end.summary : rec.state.ended ? buildSummary(rec.state) : null;
    out.push({
      id: rec.id,
      studentName: rec.meta.studentName || '未填写',
      className: rec.meta.className || '未填写',
      createdAt: rec.meta.createdAt,
      endedAt: rec.meta.endedAt || (rec.end && rec.end.at) || null,
      turns: rec.turns.length,
      ended: !!rec.state.ended,
      stage: rec.state.stage,
      deal: !!rec.state.deal,
      flags: rec.state.flags || [],
      flagLabels: (rec.state.flags || []).map((f) => FLAG_LABELS[f] || f),
      score: summary ? summary.metrics.score : null,
      grade: summary ? summary.metrics.grade : null,
      lastMessage: lastTurn ? lastTurn.content.slice(0, 120) : '',
      lastAt: lastTurn ? lastTurn.at : rec.meta.createdAt,
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return `"${s.replace(/"/g, '""')}"`;
}

function sessionsCsv(sessions) {
  const rows = [
    ['student', 'class', 'session_id', 'created_at', 'ended_at', 'turns', 'ended', 'deal', 'score', 'grade', 'flags'],
    ...sessions.map((s) => [
      s.studentName,
      s.className,
      s.id,
      s.createdAt,
      s.endedAt,
      s.turns,
      s.ended ? 'yes' : 'no',
      s.deal ? 'yes' : 'no',
      s.score,
      s.grade,
      (s.flagLabels || []).join('|'),
    ]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function sessionCsv(rec) {
  const rows = [
    ['turn', 'role', 'content', 'created_at', 'flags'],
    ...rec.turns.map((t) => [
      t.turn,
      t.role,
      t.content,
      t.at,
      t.role === 'student' && rec.state.flags ? rec.state.flags.join('|') : '',
    ]),
  ];
  const summary = rec.end ? rec.end.summary : rec.state.ended ? buildSummary(rec.state) : null;
  if (summary) {
    rows.push([]);
    rows.push(['summary', '', JSON.stringify(summary), now(), '']);
  }
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function baseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function handleCreateSession(req, res) {
  const body = await readBody(req);
  const name = String(body.name || '').trim();
  const className = String(body.className || '').trim();
  const studentId = String(body.studentId || '').trim();
  const code = String(body.code || '').trim();

  if (!name) return json(res, 400, { error: 'name_required', message: '请填写姓名。' });
  if (CLASS_CODE && code !== CLASS_CODE) {
    return json(res, 403, { error: 'invalid_code', message: '班级访问码不正确。' });
  }

  const id = crypto.randomUUID();
  const meta = {
    studentName: name.slice(0, 60),
    className: className.slice(0, 60),
    studentIdHash: studentId ? crypto.createHash('sha256').update(studentId).digest('hex').slice(0, 16) : '',
    createdAt: now(),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  };
  const state = createSession({ sessionId: id, student: meta });
  const opening = state.opening;
  await append(id, { type: 'meta', meta, state, at: now() });
  await append(id, { type: 'turn', turn: 0, role: 'buyer', content: opening, at: now() });
  await append(id, {
    type: 'snapshot',
    turn: 0,
    state,
    flags: state.flags,
    quote: state.quote,
    at: now(),
  });

  return json(res, 201, {
    sessionId: id,
    opening,
    buyerName: state.buyerName,
    product: PRODUCT,
    state: publicState(state),
    shareUrl: `${baseUrl(req)}/?session=${id}`,
  });
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const sessionId = String(body.sessionId || '');
  const message = String(body.message || '').trim();
  if (!sessionId) return json(res, 400, { error: 'session_required' });
  if (!message) return json(res, 400, { error: 'message_required', message: '请输入内容。' });
  if (message.length > 2000) return json(res, 400, { error: 'message_too_long' });

  if (activeLocks.has(sessionId)) {
    return json(res, 429, { error: 'busy', message: '上一条消息还在处理中，请稍候。' });
  }
  activeLocks.add(sessionId);
  try {
    const rec = await readSession(sessionId);
    if (!rec) return json(res, 404, { error: 'session_not_found' });
    if (rec.state.ended) {
      return json(res, 409, { error: 'session_ended', summary: buildSummary(rec.state) });
    }

    const turnNo = rec.state.turn + 1;
    const at = now();
    await append(sessionId, { type: 'turn', turn: turnNo, role: 'student', content: message, at });

    const result = respond(rec.state, message);
    await append(sessionId, {
      type: 'turn',
      turn: result.state.turn,
      role: 'buyer',
      content: result.reply,
      at: now(),
    });
    await append(sessionId, {
      type: 'snapshot',
      turn: result.state.turn,
      state: result.state,
      flags: result.state.flags,
      quote: result.state.quote,
      at: now(),
    });

    if (result.ended) {
      const summary = result.summary || buildSummary(result.state);
      await append(sessionId, { type: 'end', at: now(), summary });
      return json(res, 200, {
        reply: result.reply,
        state: publicState(result.state),
        ended: true,
        summary,
      });
    }

    return json(res, 200, {
      reply: result.reply,
      state: publicState(result.state),
      ended: false,
    });
  } finally {
    activeLocks.delete(sessionId);
  }
}

async function handleEnd(req, res) {
  const body = await readBody(req);
  const sessionId = String(body.sessionId || '');
  const rec = await readSession(sessionId);
  if (!rec) return json(res, 404, { error: 'session_not_found' });
  if (!rec.state.ended) {
    const summary = endSession(rec.state, 'student_submitted');
    const at = now();
    await append(sessionId, {
      type: 'snapshot',
      turn: rec.state.turn,
      state: rec.state,
      flags: rec.state.flags,
      quote: rec.state.quote,
      at,
    });
    await append(sessionId, { type: 'end', at, summary });
    const meta = { ...rec.meta, endedAt: at };
    await append(sessionId, { type: 'meta_update', meta, at });
    return json(res, 200, { ended: true, summary });
  }
  return json(res, 200, { ended: true, summary: rec.end ? rec.end.summary : buildSummary(rec.state) });
}

async function handleGetSession(req, res, id) {
  const rec = await readSession(id);
  if (!rec) return json(res, 404, { error: 'session_not_found' });
  return json(res, 200, publicSession(rec));
}

async function handleExport(req, res, id, isAdmin) {
  const rec = await readSession(id);
  if (!rec) return json(res, 404, { error: 'session_not_found' });
  if (isAdmin && !requireAdmin(req, res, new URL(req.url, 'http://localhost'))) return;
  const csv = sessionCsv(rec);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="asean-cs-${id}.csv"`,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(csv),
  });
  res.end(csv);
}

async function serveStatic(req, res, pathname) {
  let relative;
  if (pathname === '/' || pathname === '/embed') relative = 'index.html';
  else if (pathname === '/admin') relative = 'admin.html';
  else relative = pathname.replace(/^\/+/, '');

  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return text(res, 403, 'Forbidden');
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return text(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Length': stat.size,
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    text(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors *;");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, app: APP_NAME, time: now(), classCodeRequired: !!CLASS_CODE });
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        appName: APP_NAME,
        buyerName: 'Rizky',
        company: 'CV Sinar Jaya Grosir',
        classCodeRequired: !!CLASS_CODE,
        product: PRODUCT,
        embed: true,
        adminPath: '/admin',
      });
    }

    if (pathname === '/api/session' && req.method === 'POST') {
      return await handleCreateSession(req, res);
    }

    if (pathname === '/api/chat' && req.method === 'POST') {
      return await handleChat(req, res);
    }

    if (pathname === '/api/end' && req.method === 'POST') {
      return await handleEnd(req, res);
    }

    const sessionMatch = pathname.match(/^\/api\/session\/([a-f0-9-]{36})$/i);
    if (sessionMatch && req.method === 'GET') {
      return await handleGetSession(req, res, sessionMatch[1]);
    }

    const exportMatch = pathname.match(/^\/api\/session\/([a-f0-9-]{36})\/export\.csv$/i);
    if (exportMatch && req.method === 'GET') {
      return await handleExport(req, res, exportMatch[1], false);
    }

    if (pathname === '/api/admin/sessions' && req.method === 'GET') {
      if (!requireAdmin(req, res, url)) return;
      return json(res, 200, { sessions: await listSessions() });
    }

    if (pathname === '/api/admin/sessions.csv' && req.method === 'GET') {
      if (!requireAdmin(req, res, url)) return;
      const csv = sessionsCsv(await listSessions());
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="asean-cs-sessions.csv"',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(csv),
      });
      return res.end(csv);
    }

    const adminSessionMatch = pathname.match(/^\/api\/admin\/session\/([a-f0-9-]{36})$/i);
    if (adminSessionMatch && req.method === 'GET') {
      if (!requireAdmin(req, res, url)) return;
      const rec = await readSession(adminSessionMatch[1]);
      if (!rec) return json(res, 404, { error: 'session_not_found' });
      return json(res, 200, {
        ...publicSession(rec),
        flags: rec.state.flags,
        flagLabels: (rec.state.flags || []).map((f) => FLAG_LABELS[f] || f),
        notes: rec.state.notes,
        metrics: rec.state.ended ? buildSummary(rec.state).metrics : null,
      });
    }

    const adminExportMatch = pathname.match(/^\/api\/admin\/session\/([a-f0-9-]{36})\/export\.csv$/i);
    if (adminExportMatch && req.method === 'GET') {
      return await handleExport(req, res, adminExportMatch[1], true);
    }

    if (req.method === 'GET') {
      return await serveStatic(req, res, pathname);
    }

    json(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error('[request error]', err);
    if (err && err.message === 'body_too_large') {
      return json(res, 413, { error: 'body_too_large' });
    }
    if (err && err.message === 'invalid_json') {
      return json(res, 400, { error: 'invalid_json' });
    }
    json(res, 500, { error: 'server_error' });
  }
});

server.listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  console.log('');
  console.log(`  ${APP_NAME}`);
  console.log(`  Student : ${local}/`);
  console.log(`  Embed   : ${local}/embed`);
  console.log(`  Admin   : ${local}/admin?token=${ADMIN_TOKEN}`);
  console.log(`  Data    : ${DATA_DIR}`);
  if (CLASS_CODE) console.log('  Class code: required (set by CLASS_CODE)');
  if (!process.env.ADMIN_TOKEN) console.log('  ADMIN_TOKEN not set; a random token was generated for this run.');
  console.log('');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
