'use strict';

/**
 * Normalizează textul în română: litere mici, fără diacritice, fără
 * semne de punctuație inutile. Astfel „Mâine”, „maine” și „MÂINE”
 * sunt recunoscute la fel.
 */
function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ă â î ș ț ş ţ → a a i s t s t
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9:.\-/+@\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Terminații uzuale în română (articol, plural): albire → albirea, card → cardul
const SUFFIX = '(?:a|ul|ului|le|lor|ei|i|ii|ile|ilor|uri|urile|urilor|e|ea|ua)?';

/** Verifică dacă textul normalizat conține cuvântul / expresia (inclusiv forma articulată). */
function hasPhrase(normText, phrase) {
  const p = normalize(phrase);
  if (!p) return false;
  // cuvintele foarte scurte („da”, „nu”, „pa”) trebuie să apară exact
  const suffix = p.length <= 3 ? '' : SUFFIX;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(p)}${suffix}([^a-z0-9]|$)`).test(normText);
}

/** Câte expresii din listă apar în text. Expresiile lungi contează mai mult. */
function scorePhrases(normText, phrases = []) {
  let score = 0;
  for (const ph of phrases) {
    if (hasPhrase(normText, ph)) score += normalize(ph).split(' ').length;
  }
  return score;
}

/** Înlocuiește {cheie} cu valorile din obiect. */
function fillTemplate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m));
}

function capitalizeName(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => w.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-'))
    .join(' ');
}

/** Normalizează un număr de telefon românesc. Întoarce null dacă e invalid. */
function parsePhone(raw = '') {
  let p = String(raw).replace(/[\s.\-()/]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^\+?40\d{9}$/.test(p)) p = '0' + p.replace(/^\+?40/, '');
  if (/^0[237]\d{8}$/.test(p)) return p;
  // numere internaționale (turiști / pacienți din diaspora)
  if (/^\+\d{10,15}$/.test(p)) return p;
  return null;
}

function formatPhone(p) {
  if (/^0\d{9}$/.test(p)) return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`;
  return p;
}

/** Caută un număr de telefon într-un text liber. */
function findPhone(text = '') {
  const m = String(text).match(/(\+?\d[\d\s.\-()]{8,16}\d)/);
  return m ? parsePhone(m[1]) : null;
}

module.exports = {
  normalize,
  hasPhrase,
  scorePhrases,
  fillTemplate,
  capitalizeName,
  parsePhone,
  formatPhone,
  findPhone,
};
