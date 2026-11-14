'use strict';

/**
 * Răspunsuri AI opționale (Claude, prin API-ul Anthropic).
 * Se folosesc DOAR când botul nu recunoaște întrebarea din regulile lui.
 * Fără ANTHROPIC_API_KEY în .env, modulul este dezactivat și botul
 * funcționează complet pe reguli.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

function isEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildSystemPrompt(cfg, hoursText) {
  const c = cfg.clinic;
  const services = cfg.services
    .filter((s) => s.active !== false)
    .map((s) => `- ${s.name}: ${s.description} (durată ~${s.duration} min, preț orientativ ${s.priceFrom === s.priceTo ? s.priceFrom : `${s.priceFrom}–${s.priceTo}`} ${c.currency || 'lei'})`)
    .join('\n');
  const faq = (cfg.faq || []).map((f) => `- ${f.answer.replace(/\{(\w+)\}/g, (m, k) => c[k] || m)}`).join('\n');

  return `Ești ${c.botName || 'asistentul virtual'}, asistentul virtual al clinicii „${c.name}”. Vorbești DOAR în limba română, politicos, cald și profesionist, folosind „dumneavoastră”.

Reguli:
- Răspunde scurt (maxim 3-4 propoziții), clar, potrivit pentru chat / WhatsApp.
- Folosește DOAR informațiile de mai jos. Dacă nu știi ceva, spune sincer și recomandă un telefon la recepție: ${c.phone}.
- NU pune diagnostice și NU recomanda medicamente sau doze. Pentru probleme medicale recomandă o consultație.
- Pentru durere puternică, umflătură, febră sau sângerare abundentă recomandă să sune imediat la ${c.urgentPhone || c.phone}; pentru urgențe vitale, 112.
- NU confirma programări tu. Dacă pacientul vrea programare, spune-i să scrie „programare”.
- Pentru formatare folosește doar *text* pentru îngroșat. Fără titluri sau tabele.

Informații clinică:
Nume: ${c.name}
Adresă: ${c.address}
Telefon: ${c.phone}
Email: ${c.email}
Program:
${hoursText}

Servicii și prețuri orientative:
${services}

Informații utile:
${faq}`;
}

/**
 * @param {object} cfg       configurația clinicii
 * @param {string} hoursText programul formatat
 * @param {Array}  history   [{ role: 'user'|'assistant', content }]
 */
async function answer(cfg, hoursText, history) {
  if (!isEnabled()) return null;

  // API-ul cere ca primul mesaj să fie de la utilizator și rolurile să alterneze
  const messages = [];
  for (const m of history.slice(-10)) {
    if (!m.content) continue;
    if (messages.length && messages[messages.length - 1].role === m.role) {
      messages[messages.length - 1].content += '\n' + m.content;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-5-5',
        max_tokens: 400,
        system: buildSystemPrompt(cfg, hoursText),
        messages,
      }),
    });
    if (!res.ok) {
      console.error('⚠️  Eroare AI:', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  } catch (e) {
    console.error('⚠️  AI indisponibil:', e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { isEnabled, answer };
