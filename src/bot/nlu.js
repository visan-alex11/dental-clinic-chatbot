'use strict';

const { normalize, hasPhrase, scorePhrases } = require('../utils/text');
const T = require('../utils/time');

/**
 * Înțelegerea limbajului natural (NLU) pentru română.
 * Recunoaște intenția, serviciul, data și ora din mesaje libere precum:
 *   „Bună, aș vrea o programare la detartraj vineri pe la 10”
 */

const INTENTS = {
  greeting: ['buna', 'buna ziua', 'buna seara', 'buna dimineata', 'salut', 'salutare', 'hello', 'hi', 'hey', 'neata', 'servus', 'sarut mana', 'ziua buna'],
  thanks: ['multumesc', 'multumim', 'mersi', 'multam', 'thanks', 'thank you', 'mulțumesc frumos'],
  bye: ['la revedere', 'pa', 'pa pa', 'o zi buna', 'o seara buna', 'noapte buna', 'numai bine', 'bye'],
  book: [
    'programare', 'programari', 'programez', 'programa', 'programeze', 'programati', 'ma programez', 'fac o programare',
    'rezervare', 'rezerv', 'rezerva', 'loc liber', 'locuri libere', 'liber', 'disponibil', 'disponibilitate',
    'cand pot veni', 'pot veni', 'vreau sa vin', 'as vrea sa vin', 'cand aveti loc', 'aveti loc', 'appointment',
  ],
  cancel: [
    'anulez', 'anulare', 'anulati', 'anuleaza', 'anula', 'sa anulez', 'reprogramez', 'reprogramare', 'reprograma',
    'mut programarea', 'schimb programarea', 'schimba programarea', 'muta programarea', 'nu mai pot veni', 'nu mai vin',
  ],
  hours: ['program', 'programul', 'orar', 'orarul', 'deschis', 'deschisi', 'inchis', 'inchisi', 'cand sunteti', 'ce ore', 'pana la ce ora', 'pana cand', 'lucrati', 'la ce ora deschideti', 'sambata', 'duminica'],
  prices: ['pret', 'preturi', 'pretul', 'cost', 'costa', 'costul', 'costuri', 'tarif', 'tarife', 'cat e', 'cat este', 'cat ar fi', 'cati bani', 'onorariu', 'lista de preturi'],
  contact: ['telefon', 'contact', 'numar de telefon', 'numarul', 'email', 'e-mail', 'mail', 'va pot suna', 'sun'],
  human: ['operator', 'om', 'persoana', 'vorbesc cu cineva', 'receptie', 'receptia', 'agent', 'un om', 'om real', 'mesaj pentru'],
  services: ['servicii', 'serviciile', 'ce tratamente', 'ce faceti', 'ce oferiti', 'tratamente'],
  menu: ['meniu', 'meniul', 'start', 'optiuni', 'ajutor', 'help', 'inceput', 'de la inceput', 'restart'],
  abort: ['renunt', 'stop', 'iesire', 'anuleaza procesul', 'opreste', 'las balta', 'nu mai vreau'],
  yes: ['da', 'sigur', 'confirm', 'confirma', 'ok', 'okay', 'e ok', 'corect', 'exact', 'perfect', 'bine', 'de acord', 'yes', 'desigur', 'asa e'],
  no: ['nu', 'nu e bine', 'gresit', 'nu este corect', 'no', 'nicidecum'],
};

// Simptome care indică o urgență dentară
const URGENT_PATTERNS = [
  /\bma doare\b/, /\bdoare (rau|tare|foarte)\b/, /\bdurer(e|i)\b/, /\bumfla(t|ta|tura|t obrazul)\b/, /\bumfl/,
  /\babces\b/, /\bsanger(eaza|are)\b/, /\bdinte (spart|rupt|fracturat)\b/, /\b(s-a|mi-a|mi s-a) (spart|rupt)\b/,
  /\burgent(a|e)?\b/, /\bpuroi\b/, /\bfebra\b/, /\bnu pot (manca|dormi)\b/, /\baccident\b/, /\bcazut un dinte\b/,
];
// Întrebări despre durere în timpul tratamentului — NU sunt urgențe
const NOT_URGENT_PATTERNS = [/anestez/, /\bo sa (ma )?doara\b/, /\bdureros\b/, /\bdoare (tratamentul|extractia|detartrajul|albirea|implantul|plomba)\b/, /\bva durea\b/];

function isUrgent(norm) {
  if (NOT_URGENT_PATTERNS.some((r) => r.test(norm))) return false;
  return URGENT_PATTERNS.some((r) => r.test(norm));
}

/** Toate intențiile găsite în mesaj, cu scor. */
function detectIntents(text) {
  const norm = normalize(text);
  const found = {};
  for (const [intent, phrases] of Object.entries(INTENTS)) {
    const s = scorePhrases(norm, phrases);
    if (s > 0) found[intent] = s;
  }
  if (isUrgent(norm)) found.urgent = 5;
  return { norm, found };
}

/** Intenția principală, după prioritate. */
function primaryIntent(found) {
  const order = ['urgent', 'cancel', 'book', 'prices', 'hours', 'contact', 'human', 'services', 'menu', 'thanks', 'bye', 'greeting'];
  return order.find((i) => found[i]) || null;
}

function isOnly(norm, intent) {
  // „da”, „nu”, „ok”, „mersi” — mesaje scurte, fără altă informație
  return norm.split(' ').length <= 4 && INTENTS[intent].some((p) => hasPhrase(norm, p));
}

/** Găsește serviciul menționat în text (după cuvinte-cheie și nume). */
function detectService(text, services) {
  const norm = normalize(text);
  let best = null;
  let bestScore = 0;
  for (const s of services) {
    if (s.active === false) continue;
    const phrases = [...(s.keywords || []), s.name, s.shortName].filter(Boolean);
    const score = scorePhrases(norm, phrases);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Întrebările frecvente din config care se potrivesc mesajului (cele mai relevante primele). */
function detectFaqs(text, faq = []) {
  const norm = normalize(text);
  return faq
    .map((f) => ({ f, score: scorePhrases(norm, f.keywords || []) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.f);
}

const WEEKDAYS = {
  luni: 1, lunea: 1, marti: 2, martea: 2, miercuri: 3, miercurea: 3, joi: 4, joia: 4,
  vineri: 5, vinerea: 5, sambata: 6, duminica: 0,
};
const MONTH_LOOKUP = {};
T.MONTHS.forEach((m, i) => {
  MONTH_LOOKUP[m] = i + 1;
  MONTH_LOOKUP[T.MONTHS_SHORT[i]] = i + 1;
});
Object.assign(MONTH_LOOKUP, { ian: 1, febr: 2, sept: 9, noi: 11, noiem: 11, dec: 12 });

/**
 * Extrage o dată din text. Întoarce „AAAA-LL-ZZ” sau null.
 * Înțelege: azi, mâine, poimâine, luni…duminică, „lunea viitoare”,
 * „săptămâna viitoare”, 24.10, 24/10/2026, „24 octombrie”, 2026-10-24.
 */
function parseDate(text, today) {
  const norm = normalize(text);

  if (/\b(azi|astazi|acum|chiar azi)\b/.test(norm)) return today;
  if (/\bpoimaine\b|\bpoi maine\b/.test(norm)) return T.addDays(today, 2);
  if (/\bmaine\b/.test(norm)) return T.addDays(today, 1);

  let m = norm.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m && T.isValidISODate(m[0])) return m[0];

  m = norm.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m) {
    const r = buildDate(Number(m[1]), Number(m[2]), m[3], today);
    if (r) return r;
  }

  m = norm.match(/\b(\d{1,2})\s+(?:a\s+lui\s+)?([a-z]{3,10})\b(?:\s+(\d{4}))?/);
  if (m && MONTH_LOOKUP[m[2]] !== undefined) {
    const r = buildDate(Number(m[1]), MONTH_LOOKUP[m[2]], m[3], today);
    if (r) return r;
  }

  const todayIdx = T.weekdayIndex(today);
  const nextMonday = T.addDays(today, (8 - todayIdx) % 7 || 7);
  const nextWeek = /\b(viitoare|viitor|urmatoare|urmator)\b/.test(norm);
  for (const [word, idx] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) {
      // „vinerea viitoare” / „vineri săptămâna viitoare” = ziua din săptămâna următoare
      if (nextWeek) return T.addDays(nextMonday, (idx + 6) % 7);
      return T.addDays(today, (idx - todayIdx + 7) % 7);
    }
  }

  if (/\bsaptamana (viitoare|urmatoare)\b/.test(norm)) {
    return nextMonday;
  }

  return null;
}

function buildDate(day, month, yearRaw, today) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const [ty] = today.split('-').map(Number);
  let year = yearRaw ? Number(yearRaw) : ty;
  if (yearRaw && year < 100) year += 2000;
  let iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!T.isValidISODate(iso)) return null;
  if (!yearRaw && iso < today) {
    iso = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!T.isValidISODate(iso)) return null;
  }
  return iso;
}

const PERIODS = {
  morning: { label: 'dimineața', from: 0, to: 12 * 60 },
  midday: { label: 'la prânz', from: 11 * 60, to: 14 * 60 + 1 },
  afternoon: { label: 'după-amiaza', from: 12 * 60, to: 24 * 60 },
  evening: { label: 'seara', from: 16 * 60, to: 24 * 60 },
};

const MONTHS_RE = '(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|ian|feb|mar|apr|iun|iul|aug|sep|oct|nov|dec)\\b';
const followedByMonth = (norm, m) => new RegExp(`^\\s*${MONTHS_RE}`).test(norm.slice(m.index + m[0].length));

/**
 * Extrage ora sau un interval al zilei.
 * Întoarce { time: 'HH:MM' } sau { range: { from, to, label } } (minute) sau null.
 * `bareNumberIsHour` = un număr singur („10”) e interpretat ca oră.
 */
function parseTime(text, { bareNumberIsHour = false } = {}) {
  const norm = normalize(text);
  const pm = /\b(dupa[- ]?amiaza|dupa[- ]?masa|dupamasa|seara|pm)\b/.test(norm);
  const fix = (h) => (pm && h >= 1 && h <= 8 ? h + 12 : h);
  const out = (h, min = 0) =>
    h >= 0 && h <= 23 && min >= 0 && min < 60
      ? { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
      : null;
  const label = (h, mm) => `${h}${mm ? ':' + mm : ''}`;

  // „după 15”, „după ora 16:30” → interval
  let m = norm.match(/\bdupa (?:ora |orele )?([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\b/);
  if (m && !followedByMonth(norm, m)) {
    const from = fix(Number(m[1])) * 60 + Number(m[2] || 0);
    return { range: { from, to: 24 * 60, label: `după ora ${label(m[1], m[2])}` } };
  }
  // „înainte de 12”, „până la 11” → interval
  m = norm.match(/\b(?:inainte de(?: ora)?|pana (?:la|in)(?: ora)?)\s+([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\b/);
  if (m && !followedByMonth(norm, m)) {
    const to = fix(Number(m[1])) * 60 + Number(m[2] || 0);
    return { range: { from: 0, to, label: `înainte de ora ${label(m[1], m[2])}` } };
  }

  // „10:30”, „10h30”
  m = norm.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (m) return out(fix(Number(m[1])), Number(m[2]));

  // „la 10.30” — doar minute rotunde, ca să nu confundăm cu o dată (15.11)
  m = norm.match(/\b(?:ora|la|pe la|in jur de|catre)\s*([01]?\d|2[0-3])\.(00|15|30|45)\b/);
  if (m) return out(fix(Number(m[1])), Number(m[2]));

  // „la 10”, „ora 10 și jumătate”, „pe la 3 după-amiaza”
  m = norm.match(/\b(?:ora|orele|la ora|la|pe la|in jur de|catre|spre)\s+([01]?\d|2[0-3])(?:\s+si\s+(jumatate|un sfert|sfert|trei sferturi))?\b(?![./]\d)/);
  if (m && !followedByMonth(norm, m)) {
    const extra = { jumatate: 30, 'un sfert': 15, sfert: 15, 'trei sferturi': 45 }[m[2]] || 0;
    return out(fix(Number(m[1])), extra);
  }

  if (bareNumberIsHour) {
    m = norm.match(/^([01]?\d|2[0-3])(?:[.]([0-5]\d))?(?:\s+si\s+jumatate)?$/);
    if (m) return out(fix(Number(m[1])), m[2] ? Number(m[2]) : /jumatate/.test(norm) ? 30 : 0);
  }

  if (/\b(dimineata|devreme|prima ora)\b/.test(norm)) return { range: PERIODS.morning };
  if (/\b(pranz|amiaza)\b/.test(norm) && !/dupa[- ]?amiaza/.test(norm)) return { range: PERIODS.midday };
  if (/\b(dupa[- ]?amiaza|dupa[- ]?masa|dupamasa)\b/.test(norm)) return { range: PERIODS.afternoon };
  if (/\b(seara|tarziu|dupa program|dupa serviciu|dupa munca)\b/.test(norm)) return { range: PERIODS.evening };
  return null;
}

/** Un număr simplu („2”, „opțiunea 3”) pentru alegerea unei opțiuni din listă. */
function parseChoiceNumber(text) {
  const norm = normalize(text);
  const m = norm.match(/^(?:optiunea|varianta|nr\.?|numarul)?\s*(\d{1,2})\.?$/);
  return m ? Number(m[1]) : null;
}

/** Codul unei programări, ex. „ZB-7K2M” (prefixul vine din config). */
function parseBookingCode(text, prefix = 'PR') {
  const p = String(prefix).toUpperCase().replace(/[^A-Z]/g, '');
  const m = String(text).toUpperCase().match(new RegExp(`\\b${p}[\\s-]?([A-Z0-9]{4})\\b`));
  return m ? `${p}-${m[1]}` : null;
}

module.exports = {
  INTENTS,
  PERIODS,
  detectIntents,
  primaryIntent,
  isOnly,
  isUrgent,
  detectService,
  detectFaqs,
  parseDate,
  parseTime,
  parseChoiceNumber,
  parseBookingCode,
};
