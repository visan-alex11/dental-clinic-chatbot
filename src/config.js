'use strict';

const fs = require('fs');
const path = require('path');
const { DAY_KEYS, isValidISODate, parseInterval } = require('./utils/time');

const CONFIG_PATH = process.env.CLINIC_CONFIG || path.join(__dirname, '..', 'config', 'clinic.json');
const BACKUP_PATH = CONFIG_PATH.replace(/\.json$/, '.backup.json');

let current = null;

function load() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  const errors = validate(cfg);
  if (errors.length) {
    throw new Error(`Configurația din ${CONFIG_PATH} are erori:\n - ${errors.join('\n - ')}`);
  }
  current = cfg;
  return cfg;
}

function get() {
  if (!current) load();
  return current;
}

/** Verifică configurația și întoarce o listă de erori în română (goală = OK). */
function validate(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['Configurația lipsește.'];

  const c = cfg.clinic || {};
  if (!c.name) errors.push('clinic.name (numele clinicii) este obligatoriu.');
  if (c.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: c.timezone });
    } catch {
      errors.push(`Fusul orar „${c.timezone}” nu este valid.`);
    }
  }

  const s = cfg.schedule;
  if (!s) {
    errors.push('Lipsește secțiunea „schedule” (programul).');
  } else {
    const num = (v, name, min, max) => {
      if (!Number.isInteger(v) || v < min || v > max) errors.push(`schedule.${name} trebuie să fie un număr întreg între ${min} și ${max}.`);
    };
    num(s.slotMinutes, 'slotMinutes', 5, 240);
    num(s.capacity, 'capacity', 1, 50);
    num(s.bookingWindowDays, 'bookingWindowDays', 1, 365);
    num(s.minNoticeMinutes, 'minNoticeMinutes', 0, 10080);

    const checkIntervals = (list, where) => {
      if (!Array.isArray(list)) return errors.push(`${where} trebuie să fie o listă de intervale (ex: ["09:00-13:00"]).`);
      list.forEach((iv) => {
        if (!parseInterval(iv)) errors.push(`${where}: intervalul „${iv}” nu e valid. Folosiți formatul HH:MM-HH:MM.`);
      });
    };

    if (!s.weekly) errors.push('Lipsește programul săptămânal (schedule.weekly).');
    else DAY_KEYS.forEach((d) => checkIntervals(s.weekly[d] || [], `Programul de ${d}`));

    (s.closedDates || []).forEach((d) => {
      if (!isValidISODate(d)) errors.push(`Data închisă „${d}” nu e validă (format AAAA-LL-ZZ).`);
    });
    (s.onlyDates || []).forEach((d) => {
      if (!isValidISODate(d)) errors.push(`Data „${d}” din onlyDates nu e validă (format AAAA-LL-ZZ).`);
    });
    Object.entries(s.specialDates || {}).forEach(([d, list]) => {
      if (!isValidISODate(d)) errors.push(`Data specială „${d}” nu e validă (format AAAA-LL-ZZ).`);
      checkIntervals(list, `Programul special din ${d}`);
    });
  }

  if (!Array.isArray(cfg.services) || cfg.services.length === 0) {
    errors.push('Trebuie definit cel puțin un serviciu.');
  } else {
    const ids = new Set();
    cfg.services.forEach((sv, i) => {
      if (!sv.id || !/^[a-z0-9-]+$/.test(sv.id)) errors.push(`Serviciul #${i + 1}: „id” trebuie să conțină doar litere mici, cifre și cratimă.`);
      if (ids.has(sv.id)) errors.push(`Serviciul „${sv.id}” apare de două ori.`);
      ids.add(sv.id);
      if (!sv.name) errors.push(`Serviciul „${sv.id}”: lipsește numele.`);
      if (!Number.isInteger(sv.duration) || sv.duration < 5) errors.push(`Serviciul „${sv.id}”: durata trebuie să fie un număr de minute (minim 5).`);
    });
    if (!cfg.services.some((sv) => sv.active !== false)) errors.push('Cel puțin un serviciu trebuie să fie activ.');
  }

  if (cfg.faq && !Array.isArray(cfg.faq)) errors.push('„faq” trebuie să fie o listă.');
  return errors;
}

/** Salvează o configurație nouă (cu backup automat al celei vechi). */
function save(cfg) {
  const errors = validate(cfg);
  if (errors.length) {
    const err = new Error('Configurație invalidă');
    err.details = errors;
    throw err;
  }
  // sortăm datele ca să fie ușor de citit în fișier
  cfg.schedule.closedDates = [...new Set(cfg.schedule.closedDates || [])].sort();
  cfg.schedule.onlyDates = [...new Set(cfg.schedule.onlyDates || [])].sort();
  cfg.schedule.specialDates = Object.fromEntries(Object.entries(cfg.schedule.specialDates || {}).sort());

  if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  current = cfg;
  return cfg;
}

/** Dacă editați fișierul manual în VS Code, modificările se aplică fără restart. */
function watch(onChange) {
  let timer = null;
  try {
    fs.watch(CONFIG_PATH, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          load();
          console.log('🔄 Configurația clinicii a fost reîncărcată.');
          onChange && onChange(current);
        } catch (e) {
          console.error('⚠️  Nu am putut reîncărca configurația:', e.message);
        }
      }, 300);
    });
  } catch {
    /* unele sisteme nu suportă fs.watch — nu e critic */
  }
}

module.exports = { get, load, save, validate, watch, CONFIG_PATH };
