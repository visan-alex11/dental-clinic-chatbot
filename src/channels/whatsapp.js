'use strict';

const crypto = require('crypto');

/**
 * Integrare WhatsApp Business (Meta WhatsApp Cloud API).
 * - GET  /webhook/whatsapp → verificarea webhook-ului de către Meta
 * - POST /webhook/whatsapp → mesajele primite de la pacienți
 *
 * Opțiunile botului devin butoane (max. 3) sau listă (max. 10) în WhatsApp.
 */

const env = () => ({
  token: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  version: process.env.WHATSAPP_API_VERSION || 'v23.0',
});

const isConfigured = () => Boolean(env().token && env().phoneNumberId);

const trunc = (s, n) => {
  const chars = Array.from(String(s)); // corect și pentru emoji
  return chars.length <= n ? String(s) : chars.slice(0, n - 1).join('') + '…';
};

/** Verificarea inițială făcută de Meta când configurați webhook-ul. */
function verify(query) {
  const { verifyToken } = env();
  if (query['hub.mode'] === 'subscribe' && verifyToken && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'];
  }
  return null;
}

/** Verifică semnătura X-Hub-Signature-256 (dovada că mesajul vine de la Meta). */
function validSignature(rawBody, header) {
  const { appSecret } = env();
  if (!appSecret) return true; // fără App Secret configurat, nu putem verifica
  if (!header || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function callApi(payload) {
  const { token, phoneNumberId, version } = env();
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

/** Marchează mesajul ca citit și afișează „scrie…” cât timp botul pregătește răspunsul. */
async function markRead(messageId) {
  try {
    await callApi({ status: 'read', message_id: messageId, typing_indicator: { type: 'text' } });
  } catch {
    try {
      await callApi({ status: 'read', message_id: messageId });
    } catch {
      /* nu este critic */
    }
  }
}

/** Transformă răspunsul botului în mesaje WhatsApp. */
function buildPayloads(to, { messages, options }) {
  const text = messages.join('\n\n').trim();
  const payloads = [];
  const plain = (body) => ({ to, type: 'text', text: { body: trunc(body, 4096), preview_url: /https?:\/\//.test(body) } });

  if (!options || !options.length) {
    payloads.push(plain(text));
    return payloads;
  }

  // corpul unui mesaj interactiv are max. 1024 caractere
  let body = text;
  if (body.length > 1024) {
    const last = messages[messages.length - 1];
    payloads.push(plain(messages.slice(0, -1).join('\n\n')));
    body = last.length > 1024 ? 'Alegeți o opțiune:' : last;
  }

  const fitsButtons = options.length <= 3 && options.every((o) => Array.from(o.label).length <= 20);
  if (fitsButtons) {
    payloads.push({
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: { buttons: options.map((o) => ({ type: 'reply', reply: { id: o.value.slice(0, 256), title: trunc(o.label, 20) } })) },
      },
    });
  } else if (options.length <= 10) {
    payloads.push({
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: 'Alege o opțiune',
          sections: [
            {
              title: 'Opțiuni',
              rows: options.map((o) => ({
                id: o.value.slice(0, 200),
                title: trunc(o.label, 24),
                ...(o.description ? { description: trunc(o.description, 72) } : {}),
              })),
            },
          ],
        },
      },
    });
  } else {
    const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
    payloads.push(plain(`${body}\n\n${list}\n\n_Răspundeți cu numărul opțiunii._`));
  }
  return payloads;
}

const seen = new Set();
const queues = new Map(); // mesajele fiecărui pacient sunt procesate în ordine

/** Procesează notificarea primită de la Meta. */
async function handleWebhook(body, engine) {
  const tasks = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        if (seen.has(msg.id)) continue; // Meta poate retrimite același mesaj
        seen.add(msg.id);
        if (seen.size > 5000) seen.delete(seen.values().next().value);

        const from = msg.from;
        const profileName = (contacts.find((c) => c.wa_id === from) || {}).profile?.name;
        let text = null;
        if (msg.type === 'text') text = msg.text.body;
        else if (msg.type === 'interactive') text = msg.interactive.button_reply?.id || msg.interactive.list_reply?.id;
        else if (msg.type === 'button') text = msg.button.payload || msg.button.text;

        const prev = queues.get(from) || Promise.resolve();
        const task = prev.then(async () => {
          markRead(msg.id);
          const res = text
            ? await engine.handle({ channel: 'whatsapp', userId: from, text, meta: { waPhone: from, profileName } })
            : { messages: ['Momentan pot citi doar mesaje text. 🙏 Vă rog scrieți-mi întrebarea sau alegeți din meniu.'], options: engine.mainMenu() };
          for (const p of buildPayloads(from, res)) await callApi(p);
        }).catch((e) => console.error('⚠️  Eroare WhatsApp:', e.message));
        queues.set(from, task);
        task.finally(() => queues.get(from) === task && queues.delete(from));
        tasks.push(task);
      }
    }
  }
  return Promise.all(tasks);
}

module.exports = { isConfigured, verify, validSignature, handleWebhook, buildPayloads };
