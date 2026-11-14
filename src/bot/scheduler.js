'use strict';

const T = require('../utils/time');

/**
 * Calculează zilele și orele libere pe baza programului din config/clinic.json
 * și a programărilor deja existente.
 *
 * Ordinea regulilor pentru o zi:
 *   1. closedDates   → zi închisă (sărbători, concedii)
 *   2. specialDates  → program special doar în acea zi
 *   3. onlyDates     → dacă lista nu e goală, DOAR aceste zile sunt disponibile
 *   4. weekly        → programul obișnuit pe zilele săptămânii
 */
class Scheduler {
  constructor(getConfig, storage) {
    this.getConfig = getConfig;
    this.storage = storage;
  }

  get cfg() {
    return this.getConfig();
  }

  now() {
    return T.nowInTz(this.cfg.clinic.timezone || 'Europe/Bucharest');
  }

  today() {
    return this.now().date;
  }

  service(id) {
    return this.cfg.services.find((s) => s.id === id);
  }

  /** Intervalele de lucru pentru o dată (lista goală = închis). */
  intervalsFor(date) {
    const s = this.cfg.schedule;
    if ((s.closedDates || []).includes(date)) return [];
    if (s.specialDates && s.specialDates[date]) return s.specialDates[date].map(T.parseInterval).filter(Boolean);
    if ((s.onlyDates || []).length && !s.onlyDates.includes(date)) return [];
    const key = T.DAY_KEYS[T.weekdayIndex(date)];
    return (s.weekly[key] || []).map(T.parseInterval).filter(Boolean);
  }

  lastBookableDate() {
    return T.addDays(this.today(), this.cfg.schedule.bookingWindowDays);
  }

  /** Orele libere (HH:MM) pentru o dată și un serviciu. */
  slotsFor(date, serviceId) {
    const s = this.cfg.schedule;
    const svc = this.service(serviceId);
    const duration = svc ? svc.duration : s.slotMinutes;
    const now = this.now();

    if (date < now.date || date > this.lastBookableDate()) return [];

    // preaviz minim: ora programării trebuie să fie la cel puțin minNoticeMinutes de acum
    const minStart = now.minutes + s.minNoticeMinutes - T.diffDays(now.date, date) * 1440;

    const bookings = this.storage.activeBookingsOn(date).map((b) => {
      const start = T.toMin(b.time);
      return { start, end: start + (b.duration || s.slotMinutes) };
    });

    const slots = [];
    for (const iv of this.intervalsFor(date)) {
      for (let start = iv.start; start + duration <= iv.end; start += s.slotMinutes) {
        if (start < minStart) continue;
        if (this._fits(start, start + duration, bookings, s.capacity)) slots.push(T.fromMin(start));
      }
    }
    return slots;
  }

  /** Verifică dacă intervalul [start, end) are loc, ținând cont de câte scaune / medici sunt. */
  _fits(start, end, bookings, capacity) {
    const overlapping = bookings.filter((b) => b.start < end && b.end > start);
    if (overlapping.length < capacity) return true;
    // verificăm numărul maxim de programări simultane în interval
    const points = [start, ...overlapping.map((b) => b.start).filter((p) => p > start && p < end)];
    return points.every((p) => overlapping.filter((b) => b.start <= p && b.end > p).length < capacity);
  }

  isAvailable(date, time, serviceId) {
    return this.slotsFor(date, serviceId).includes(time);
  }

  /** Primele zile cu locuri libere. */
  availableDates(serviceId, { limit = 6, from } = {}) {
    const start = from && from > this.today() ? from : this.today();
    const end = this.lastBookableDate();
    const out = [];
    for (let d = start; d <= end && out.length < limit; d = T.addDays(d, 1)) {
      const count = this.slotsFor(d, serviceId).length;
      if (count > 0) out.push({ date: d, count });
    }
    return out;
  }

  /** De ce nu se poate face programare într-o anumită zi (pentru mesaje clare). */
  dayStatus(date, serviceId) {
    const s = this.cfg.schedule;
    const today = this.today();
    if (date < today) return 'past';
    if (date > this.lastBookableDate()) return 'too-far';
    if ((s.closedDates || []).includes(date)) return 'holiday';
    if (!(s.specialDates && s.specialDates[date]) && (s.onlyDates || []).length && !s.onlyDates.includes(date)) {
      return 'not-offered';
    }
    if (this.intervalsFor(date).length === 0) return 'closed';
    if (this.slotsFor(date, serviceId).length === 0) return 'full';
    return 'open';
  }

  /** Clinica este deschisă acum? */
  openNow() {
    const now = this.now();
    return this.intervalsFor(now.date).some((iv) => now.minutes >= iv.start && now.minutes < iv.end);
  }

  /** Următorul moment de deschidere: { date, time } */
  nextOpening() {
    const now = this.now();
    for (let i = 0; i < 60; i++) {
      const d = T.addDays(now.date, i);
      for (const iv of this.intervalsFor(d)) {
        if (i > 0 || iv.start > now.minutes) return { date: d, time: T.fromMin(iv.start) };
      }
    }
    return null;
  }

  /** Zile închise excepțional în următoarele N zile (pentru a anunța pacienții). */
  upcomingClosures(days = 30) {
    const s = this.cfg.schedule;
    const today = this.today();
    const end = T.addDays(today, days);
    return (s.closedDates || []).filter((d) => d >= today && d <= end).sort();
  }

  upcomingSpecial(days = 30) {
    const s = this.cfg.schedule;
    const today = this.today();
    const end = T.addDays(today, days);
    return Object.entries(s.specialDates || {})
      .filter(([d]) => d >= today && d <= end)
      .sort(([a], [b]) => a.localeCompare(b));
  }
}

module.exports = { Scheduler };
