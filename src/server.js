'use strict';

/**
 * Serverul chatbot-ului — fără dependențe externe (doar Node.js 18+).
 * Pornire:  npm start   (sau F5 în VS Code)
 *
 *   http://localhost:3000          → pagina demo cu widget-ul de chat
 *   http://localhost:3000/admin    → panoul de administrare (program, programări)
 *   POST /api/chat                 → API-ul folosit de widget
 *   /webhook/whatsapp              → webhook pentru WhatsApp Cloud API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv(path.join(__dirname, '..', '.env'));

const config = require('./config');
const { Storage } = require('./storage');
const { Scheduler } = require('./bot/scheduler');
const { BotEngine } = require('./bot/engine');
const whatsapp = require('./channels/whatsapp');
const ai = require('./bot/ai');
const T = require('./utils/time');
const txt = require('./utils/text');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

config.load();
config.watch();
const storage = new Storage();
const scheduler = new Scheduler(config.get, storage);
const engine = new BotEngine({
  getConfig: config.get,
  storage,
  scheduler,
  onBooking: (b) => console.log(`🆕 Programare nouă ${b.code}: ${b.name} · ${b.serviceName} · ${b.date} ${b.time} · ${b.phone} (${b.channel})`),
  onCancel: (b) => console.log(`❌ Programare anulată ${b.code}: ${b.name} · ${b.date} ${b.time}`),
  onMessage: (m) => console.log(`✉️  Mesaj nou pentru recepție de la ${m.phone || m.userId}: ${m.text}`),
});

// ───────────────────────── Securitate ─────────────────────────

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.warn(`⚠️  ADMIN_PASSWORD nu este setată în .env. Parolă temporară pentru acum: ${ADMIN_PASSWORD}`);
} else if (ADMIN_PASSWORD === 'schimba-ma') {
  console.warn('⚠️  Folosiți parola implicită „schimba-ma”. Schimbați ADMIN_PASSWORD în .env înainte de a pune botul online!');
}
const adminTokens = new Map(); // token → expirare
const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;

const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const b = rateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) {
    b.count = 0;
    b.reset = now + windowMs;
  }
  b.count++;
  rateBuckets.set(key, b);
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now > b.reset) rateBuckets.delete(k);
  for (const [t, exp] of adminTokens) if (now > exp) adminTokens.delete(t);
}, 60 * 1000).unref();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (allowedOrigins.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  if (allowedOrigins.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return {};
}

function isAdmin(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  const exp = m && adminTokens.get(m[1]);
  return Boolean(exp && exp > Date.now());
}

// ───────────────────────── Utilitare HTTP ─────────────────────────

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Cerere prea mare'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({ raw, json: {} });
      try {
        resolve({ raw, json: JSON.parse(raw.toString('utf8')) });
      } catch {
        reject(Object.assign(new Error('JSON invalid'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Interzis');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Pagina nu a fost găsită');
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (pathname === '/widget.js') headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// ───────────────────────── Rute ─────────────────────────

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  // ── Chat (widget site) ──
  if (p === '/api/chat') {
    const cors = { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (method === 'OPTIONS') return send(res, 204, '', cors);
    if (method !== 'POST') return send(res, 405, { error: 'Metodă nepermisă' }, cors);
    if (rateLimited(`chat:${clientIp(req)}`, 40, 60 * 1000)) {
      return send(res, 429, { messages: ['Ați trimis prea multe mesaje într-un timp scurt. Vă rog așteptați un minut. 🙏'], options: [] }, cors);
    }
    const { json } = await readBody(req, 20 * 1024);
    const sessionId = String(json.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const message = String(json.message || '').slice(0, 1000);
    if (!sessionId || !message) return send(res, 400, { error: 'Lipsește sessionId sau message' }, cors);
    const result = await engine.handle({ channel: 'web', userId: sessionId, text: message });
    return send(res, 200, result, cors);
  }

  if (p === '/api/widget-config') {
    const c = config.get().clinic;
    return send(res, 200, { name: c.name, botName: c.botName, phone: c.phone, urgentPhone: c.urgentPhone }, { 'Access-Control-Allow-Origin': '*' });
  }

  if (p === '/api/health') {
    return send(res, 200, { ok: true, clinic: config.get().clinic.name, whatsapp: whatsapp.isConfigured(), ai: ai.isEnabled() });
  }

  // ── WhatsApp ──
  if (p === '/webhook/whatsapp') {
    if (method === 'GET') {
      const challenge = whatsapp.verify(Object.fromEntries(url.searchParams));
      return challenge ? send(res, 200, String(challenge)) : send(res, 403, 'Token de verificare invalid');
    }
    if (method === 'POST') {
      const { raw, json } = await readBody(req, 1024 * 1024);
      if (!whatsapp.validSignature(raw, req.headers['x-hub-signature-256'])) return send(res, 401, 'Semnătură invalidă');
      send(res, 200, 'OK'); // răspundem imediat; Meta retrimite dacă așteptăm prea mult
      if (whatsapp.isConfigured()) whatsapp.handleWebhook(json, engine);
      else console.warn('⚠️  Mesaj WhatsApp primit, dar WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID nu sunt setate în .env');
      return;
    }
  }

  // ── Administrare ──
  if (p === '/api/admin/login' && method === 'POST') {
    if (rateLimited(`login:${clientIp(req)}`, 8, 5 * 60 * 1000)) return send(res, 429, { error: 'Prea multe încercări. Reîncercați peste câteva minute.' });
    const { json } = await readBody(req);
    const a = Buffer.from(String(json.password || ''));
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: 'Parolă greșită' });
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
    return send(res, 200, { token });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Neautorizat' });
    return adminRoutes(req, res, p, method, url);
  }

  // ── Pagini ──
  if (method === 'GET') {
    if (p === '/') return serveStatic(req, res, '/index.html');
    if (p === '/admin') return serveStatic(req, res, '/admin.html');
    return serveStatic(req, res, p);
  }
  return send(res, 404, { error: 'Nu există' });
}

async function adminRoutes(req, res, p, method, url) {
  if (p === '/api/admin/config') {
    if (method === 'GET') return send(res, 200, config.get());
    if (method === 'PUT') {
      const { json } = await readBody(req);
      try {
        config.save(json);
        return send(res, 200, { ok: true, config: config.get() });
      } catch (e) {
        return send(res, 400, { error: e.message, details: e.details || [] });
      }
    }
  }

  if (p === '/api/admin/bookings') {
    if (method === 'GET') {
      const list = [...storage.allBookings()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return send(res, 200, list);
    }
    if (method === 'POST') {
      const { json } = await readBody(req);
      const svc = config.get().services.find((s) => s.id === json.serviceId);
      const phone = txt.parsePhone(json.phone || '');
      if (!svc) return send(res, 400, { error: 'Serviciu invalid' });
      if (!T.isValidISODate(json.date || '') || !/^\d{2}:\d{2}$/.test(json.time || '')) return send(res, 400, { error: 'Data sau ora nu sunt valide' });
      if (!json.name || json.name.trim().length < 2) return send(res, 400, { error: 'Completați numele pacientului' });
      if (!phone) return send(res, 400, { error: 'Număr de telefon invalid' });
      if (!json.force && !scheduler.isAvailable(json.date, json.time, svc.id)) {
        return send(res, 409, { error: 'Intervalul nu este liber în program. Bifați „Forțează” dacă doriți totuși programarea.' });
      }
      const b = storage.addBooking(
        { serviceId: svc.id, serviceName: svc.name, date: json.date, time: json.time, duration: svc.duration, name: txt.capitalizeName(json.name), phone, patientType: json.patientType || 'unknown', channel: 'admin', userId: 'admin', notes: json.notes || '' },
        config.get().clinic.bookingCodePrefix || 'PR'
      );
      return send(res, 200, b);
    }
  }

  let m = p.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
  if (m && method === 'PATCH') {
    const { json } = await readBody(req);
    const patch = {};
    if (['confirmed', 'cancelled', 'completed', 'no-show'].includes(json.status)) patch.status = json.status;
    if (json.status === 'cancelled') Object.assign(patch, { cancelledBy: 'clinic', cancelledAt: new Date().toISOString() });
    if (typeof json.notes === 'string') patch.notes = json.notes.slice(0, 1000);
    const b = storage.updateBooking(m[1], patch);
    return b ? send(res, 200, b) : send(res, 404, { error: 'Programarea nu există' });
  }

  if (p === '/api/admin/messages' && method === 'GET') {
    return send(res, 200, [...storage.allMessages()].reverse());
  }
  m = p.match(/^\/api\/admin\/messages\/([\w-]+)$/);
  if (m && method === 'PATCH') {
    const { json } = await readBody(req);
    const msg = storage.updateMessage(m[1], { handled: Boolean(json.handled) });
    return msg ? send(res, 200, msg) : send(res, 404, { error: 'Mesajul nu există' });
  }

  // Previzualizare: cum arată disponibilitatea în următoarele zile
  if (p === '/api/admin/preview' && method === 'GET') {
    const cfg = config.get();
    const serviceId = url.searchParams.get('service') || cfg.services[0].id;
    const days = Math.min(Number(url.searchParams.get('days')) || 14, 60);
    const today = scheduler.today();
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = T.addDays(today, i);
      const intervals = scheduler.intervalsFor(d).map((iv) => `${T.fromMin(iv.start)}-${T.fromMin(iv.end)}`);
      const slots = scheduler.slotsFor(d, serviceId);
      out.push({ date: d, label: T.formatDateShort(d), status: scheduler.dayStatus(d, serviceId), intervals, slots, booked: storage.activeBookingsOn(d).length });
    }
    return send(res, 200, out);
  }

  if (p === '/api/admin/status' && method === 'GET') {
    return send(res, 200, { whatsapp: whatsapp.isConfigured(), ai: ai.isEnabled(), today: scheduler.today() });
  }

  return send(res, 404, { error: 'Nu există' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error('Eroare server:', e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Eroare internă' });
  });
});

server.listen(PORT, () => {
  const c = config.get().clinic;
  console.log(`\n🦷  Chatbot „${c.name}” pornit`);
  console.log(`   ➜ Demo site:      http://localhost:${PORT}`);
  console.log(`   ➜ Administrare:   http://localhost:${PORT}/admin`);
  console.log(`   ➜ WhatsApp:       ${whatsapp.isConfigured() ? 'configurat ✅' : 'neconfigurat (vezi README)'}`);
  console.log(`   ➜ Răspunsuri AI:  ${ai.isEnabled() ? 'active ✅' : 'dezactivate (opțional)'}\n`);
});

// ───────────────────────── .env ─────────────────────────

/** Citește fișierul .env (fără pachete externe). */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

module.exports = server;
