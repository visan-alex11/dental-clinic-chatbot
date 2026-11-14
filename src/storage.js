'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Stocare simplă în fișiere JSON (data/bookings.json, data/messages.json).
 * Suficientă pentru o clinică; poate fi înlocuită ușor cu o bază de date.
 */
class JsonStore {
  constructor(file, fallback = []) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = fallback;
      this.flush();
    }
  }

  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

class Storage {
  constructor(dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')) {
    this.bookings = new JsonStore(path.join(dataDir, 'bookings.json'));
    this.messages = new JsonStore(path.join(dataDir, 'messages.json'));
  }

  // ── Programări ──────────────────────────────────────────────

  allBookings() {
    return this.bookings.data;
  }

  activeBookingsOn(date) {
    return this.bookings.data.filter((b) => b.date === date && b.status === 'confirmed');
  }

  findBooking(id) {
    return this.bookings.data.find((b) => b.id === id);
  }

  findByCode(code) {
    const c = String(code).toUpperCase().replace(/\s/g, '');
    return this.bookings.data.find((b) => b.code === c);
  }

  generateCode(prefix = 'PR') {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // fără caractere confuze (0/O, 1/I)
    let code;
    do {
      let s = '';
      for (let i = 0; i < 4; i++) s += alphabet[crypto.randomInt(alphabet.length)];
      code = `${prefix}-${s}`;
    } while (this.findByCode(code));
    return code;
  }

  addBooking(data, prefix) {
    const booking = {
      id: crypto.randomUUID(),
      code: this.generateCode(prefix),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.bookings.data.push(booking);
    this.bookings.flush();
    return booking;
  }

  updateBooking(id, patch) {
    const b = this.findBooking(id);
    if (!b) return null;
    Object.assign(b, patch, { updatedAt: new Date().toISOString() });
    this.bookings.flush();
    return b;
  }

  // ── Mesaje lăsate pentru recepție ───────────────────────────

  addMessage(data) {
    const msg = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), handled: false, ...data };
    this.messages.data.push(msg);
    this.messages.flush();
    return msg;
  }

  allMessages() {
    return this.messages.data;
  }

  updateMessage(id, patch) {
    const m = this.messages.data.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch);
    this.messages.flush();
    return m;
  }
}

module.exports = { Storage };
