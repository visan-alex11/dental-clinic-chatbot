'use strict';

const DAY_KEYS = ['duminica', 'luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata'];
const DAY_LABELS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const MONTHS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];
const MONTHS_SHORT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n) => String(n).padStart(2, '0');

/** Data și ora curente în fusul orar al clinicii (indiferent unde rulează serverul). */
function nowInTz(timeZone = 'Europe/Bucharest') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function parseISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDays(dateStr, n) {
  const { y, m, d } = parseISO(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function weekdayIndex(dateStr) {
  const { y, m, d } = parseISO(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function diffDays(a, b) {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMin(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** „09:00-13:00” → { start: 540, end: 780 } */
function parseInterval(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start >= end || end > 24 * 60) return null;
  return { start, end };
}

/** „Joi, 15 octombrie” (cu anul, opțional) */
function formatDateLong(dateStr, withYear = false) {
  const { y, m, d } = parseISO(dateStr);
  const base = `${DAY_LABELS[weekdayIndex(dateStr)]}, ${d} ${MONTHS[m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}

/** „Joi, 15 oct” */
function formatDateShort(dateStr) {
  const { m, d } = parseISO(dateStr);
  return `${DAY_LABELS[weekdayIndex(dateStr)]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** „15 octombrie” */
function formatDayMonth(dateStr) {
  const { m, d } = parseISO(dateStr);
  return `${d} ${MONTHS[m - 1]}`;
}

module.exports = {
  DAY_KEYS,
  DAY_LABELS,
  MONTHS,
  MONTHS_SHORT,
  nowInTz,
  isValidISODate,
  addDays,
  weekdayIndex,
  diffDays,
  toMin,
  fromMin,
  parseInterval,
  formatDateLong,
  formatDateShort,
  formatDayMonth,
};
