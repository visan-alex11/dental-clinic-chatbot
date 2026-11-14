'use strict';

const T = require('../utils/time');
const txt = require('../utils/text');
const nlu = require('./nlu');
const ai = require('./ai');

const SESSION_TTL_MS = 30 * 60 * 1000; // conversația se resetează după 30 min de inactivitate
const TIMES_PER_PAGE = 8;

const S = {
  IDLE: 'idle',
  SERVICE: 'ask_service',
  PATIENT: 'ask_patient',
  DATE: 'ask_date',
  TIME: 'ask_time',
  NAME: 'ask_name',
  PHONE: 'ask_phone',
  CONFIRM: 'confirm',
  EDIT: 'edit',
  CANCEL_LOOKUP: 'cancel_lookup',
  CANCEL_PICK: 'cancel_pick',
  CANCEL_CONFIRM: 'cancel_confirm',
  MSG_TEXT: 'msg_text',
  MSG_PHONE: 'msg_phone',
};
const BOOKING_STATES = [S.SERVICE, S.PATIENT, S.DATE, S.TIME, S.NAME, S.PHONE, S.CONFIRM, S.EDIT];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** Data în mijlocul propoziției: „joi, 15 octombrie” */
const dateMid = (d, withYear) => lc(T.formatDateLong(d, withYear));
const opt = (label, value, description) => (description ? { label, value, description } : { label, value });
const reply = (messages, options = []) => ({ messages: [].concat(messages).filter(Boolean), options });

/**
 * Motorul conversației. Același cod deservește site-ul și WhatsApp-ul:
 * primește un mesaj text și întoarce { messages: [...], options: [...] }.
 * Textul folosește *bold* (stil WhatsApp); widget-ul web îl afișează îngroșat.
 */
class BotEngine {
  constructor({ getConfig, storage, scheduler, onBooking, onCancel, onMessage }) {
    this.getConfig = getConfig;
    this.storage = storage;
    this.scheduler = scheduler;
    this.onBooking = onBooking || (() => {});
    this.onCancel = onCancel || (() => {});
    this.onMessage = onMessage || (() => {});
    this.sessions = new Map();
    setInterval(() => this._cleanup(), 10 * 60 * 1000).unref();
  }

  get cfg() {
    return this.getConfig();
  }

  get clinic() {
    return this.cfg.clinic;
  }

  activeServices() {
    return this.cfg.services.filter((s) => s.active !== false);
  }

  service(id) {
    return this.cfg.services.find((s) => s.id === id);
  }

  // ───────────────────────── Sesiuni ─────────────────────────

  _newSession(key, channel, userId) {
    return { key, channel, userId, state: S.IDLE, booking: {}, options: [], history: [], fails: 0, meta: {}, myBookingIds: [] };
  }

  _session(channel, userId, meta) {
    const key = `${channel}:${userId}`;
    let s = this.sessions.get(key);
    if (!s || Date.now() - s.lastActive > SESSION_TTL_MS) {
      const keepBookings = s ? s.myBookingIds : [];
      s = this._newSession(key, channel, userId);
      s.myBookingIds = keepBookings;
      this.sessions.set(key, s);
    }
    s.lastActive = Date.now();
    Object.assign(s.meta, meta || {});
    return s;
  }

  _cleanup() {
    const now = Date.now();
    for (const [k, s] of this.sessions) if (now - s.lastActive > SESSION_TTL_MS * 4) this.sessions.delete(k);
  }

  _resetFlow(s) {
    s.state = S.IDLE;
    s.booking = {};
    s.editing = false;
    s.rescheduleId = null;
    s.cancelId = null;
    s.timePage = 0;
    s.msgText = null;
  }

  // ───────────────────────── Punct de intrare ─────────────────────────

  /**
   * @param {{channel:'web'|'whatsapp', userId:string, text:string, meta?:object}} p
   */
  async handle({ channel, userId, text, meta }) {
    const s = this._session(channel, userId, meta);
    const raw = String(text || '').slice(0, 1000).trim();
    let input = raw;

    // „2” sau „opțiunea 2” → a doua opțiune afișată
    const n = nlu.parseChoiceNumber(raw);
    const timeStepHour = s.state === S.TIME && n !== null && n >= 7; // în pasul orei, „10” = ora 10
    if (n !== null && !timeStepHour && n >= 1 && n <= s.options.length) input = s.options[n - 1].value;

    // textul exact al unei opțiuni (ex. utilizatorul a tastat eticheta)
    const byLabel = s.options.find((o) => txt.normalize(o.label) === txt.normalize(raw) && txt.normalize(raw));
    if (byLabel) input = byLabel.value;

    const chosen = s.options.find((o) => o.value === input);
    if (raw !== '__start__') s.history.push({ role: 'user', content: chosen ? chosen.label : raw });

    let res;
    try {
      res = await this._route(s, input);
    } catch (e) {
      console.error('Eroare în conversație:', e);
      this._resetFlow(s);
      res = reply(`Îmi pare rău, a apărut o eroare tehnică. 🙏 Vă rog încercați din nou sau sunați-ne la *${this.clinic.phone}*.`, this.mainMenu());
    }

    s.options = res.options || [];
    s.history.push({ role: 'assistant', content: res.messages.join('\n') });
    if (s.history.length > 30) s.history.splice(0, s.history.length - 30);
    return res;
  }

  async _route(s, input) {
    if (input === '__start__') {
      this._resetFlow(s);
      return this.welcome();
    }

    // Valori trimise de butoane
    const [kind, ...rest] = input.split(':');
    const arg = rest.join(':');
    if (/^(act|svc|date|time|ptype|edit|pick|book|urgent)$/.test(kind) && rest.length) {
      const r = await this._handleValue(s, kind, arg);
      if (r) return r;
      // buton vechi, apăsat într-un alt pas al conversației
      return s.state === S.IDLE ? reply('Cu ce vă pot ajuta? 😊', this.mainMenu()) : this._reprompt(s);
    }

    const { norm, found } = nlu.detectIntents(input);
    const words = norm.split(' ').filter(Boolean).length;

    // Ieșire din orice proces în desfășurare
    if (s.state !== S.IDLE) {
      const wantsOut = found.abort || ((found.menu || (found.cancel && BOOKING_STATES.includes(s.state))) && words <= 3);
      if (wantsOut) {
        const wasBooking = BOOKING_STATES.includes(s.state);
        this._resetFlow(s);
        return reply(
          [wasBooking ? 'Am oprit procesul de programare. 👍' : 'Am revenit la meniul principal. 👍', 'Cu ce altceva vă pot ajuta?'],
          this.mainMenu()
        );
      }
    }

    const step = this._stepHandlers()[s.state];
    if (step) {
      const r = await step(s, input, { norm, found, words });
      if (r) return r;
      // Pasul nu a înțeles — poate e o întrebare generală (preț, adresă etc.)
      const info = this._infoAnswer(input, norm, found);
      const again = this._reprompt(s);
      if (info) return reply([...info.messages, '↩️ Revenind la pasul anterior:', ...again.messages], again.options);
      return reply([this._stepHint(s.state), ...again.messages], again.options);
    }

    return this._free(s, input, norm, found);
  }

  // ───────────────────────── Butoane ─────────────────────────

  async _handleValue(s, kind, arg) {
    const b = s.booking;
    switch (kind) {
      case 'act':
        return this._action(s, arg);
      case 'svc': {
        const svc = this.service(arg);
        if (!svc) return null;
        if (s.state === S.IDLE) this._startBookingState(s);
        return this._setService(s, svc);
      }
      case 'book': {
        this._startBookingState(s);
        const svc = this.service(arg);
        return svc ? this._setService(s, svc) : this._advance(s);
      }
      case 'date':
        if (!BOOKING_STATES.includes(s.state)) return null;
        return this._setDate(s, arg);
      case 'time':
        if (!BOOKING_STATES.includes(s.state) || !b.date) return null;
        if (!this.scheduler.isAvailable(b.date, arg, b.serviceId)) {
          b.time = null;
          return this._askTime(s, ['😕 Ne pare rău, această oră tocmai s-a ocupat. Vă rog alegeți alta:']);
        }
        b.time = arg;
        return this._advance(s, [`Ora *${arg}* este liberă. ✅`]);
      case 'ptype':
        b.patientType = arg === 'existing' ? 'existing' : 'new';
        return this._advance(s, [b.patientType === 'new' ? 'Bine ați venit! Ne bucurăm că ne-ați ales. 😊' : 'Ne bucurăm să vă revedem! 😊']);
      case 'edit':
        return this._edit(s, arg);
      case 'pick': {
        const bk = this.storage.findBooking(arg);
        if (!bk) return null;
        return this._presentBookings(s, [bk]);
      }
      case 'urgent': {
        const [date, time] = arg.split('|');
        const svc = this._urgentService();
        this._startBookingState(s);
        Object.assign(s.booking, { serviceId: svc.id, patientType: 'unknown', date });
        if (!this.scheduler.isAvailable(date, time, svc.id)) return this._askTime(s, ['😕 Ora tocmai s-a ocupat. Iată alte ore libere:']);
        s.booking.time = time;
        return this._advance(s, [`Am notat: *${dateMid(date)}, ora ${time}*. ✅`]);
      }
      default:
        return null;
    }
  }

  async _action(s, a) {
    const b = s.booking;
    switch (a) {
      case 'menu':
        this._resetFlow(s);
        return reply('Cu ce vă mai pot ajuta? 😊', this.mainMenu());
      case 'book':
        this._resetFlow(s);
        this._startBookingState(s);
        return this._advance(s);
      case 'prices':
        return this.priceList();
      case 'hours':
        return reply([this.hoursText(true), `📍 *Adresa:* ${this.clinic.address}${this.clinic.mapsUrl ? `\n🗺️ ${this.clinic.mapsUrl}` : ''}`], [
          opt('📅 Fă o programare', 'act:book'),
          opt('🏠 Meniu principal', 'act:menu'),
        ]);
      case 'address':
        return reply(`📍 *${this.clinic.address}*${this.clinic.mapsUrl ? `\n🗺️ ${this.clinic.mapsUrl}` : ''}`, [opt('🏠 Meniu principal', 'act:menu')]);
      case 'cancel':
        this._resetFlow(s);
        return this._startCancel(s, '');
      case 'human':
        this._resetFlow(s);
        return this.humanHandoff();
      case 'services':
        return this.servicesList();
      case 'leavemsg':
        this._resetFlow(s);
        s.state = S.MSG_TEXT;
        return reply('Scrieți mesajul dumneavoastră pentru recepție ✍️ — un coleg vă va contacta cât mai curând.', [opt('↩️ Înapoi la meniu', 'act:menu')]);
      case 'otherdate':
        if (!BOOKING_STATES.includes(s.state)) return null;
        s.state = S.DATE;
        return reply('Scrieți ziua dorită — de exemplu *mâine*, *vineri*, *24.10* sau *3 noiembrie*. 📅', [opt('‹ Înapoi la zilele libere', 'act:changedate')]);
      case 'changedate':
        if (!BOOKING_STATES.includes(s.state)) return null;
        b.date = null;
        b.time = null;
        return this._askDate(s);
      case 'moretimes':
        if (!b.date) return null;
        s.timePage = (s.timePage || 0) + 1;
        return this._askTime(s);
      case 'alltimes':
        if (!b.date) return null;
        s.timePage = 0;
        delete b.pendingTime;
        return this._askTime(s);
      case 'usewaname':
        if (s.state !== S.NAME || !s.meta.profileName) return null;
        b.name = txt.capitalizeName(s.meta.profileName);
        return this._advance(s);
      case 'usewaphone':
        if (s.state !== S.PHONE || !s.meta.waPhone) return null;
        b.phone = txt.parsePhone('+' + String(s.meta.waPhone).replace(/^\+/, '')) || s.meta.waPhone;
        return this._advance(s);
      case 'confirm':
        if (s.state !== S.CONFIRM) return null;
        return this._finalize(s);
      case 'modify':
        if (s.state !== S.CONFIRM && s.state !== S.EDIT) return null;
        return this._askEdit(s);
      case 'abort':
        this._resetFlow(s);
        return reply(['Am renunțat la programare. Nicio problemă! 👍', 'Vă stau la dispoziție oricând aveți nevoie.'], this.mainMenu());
      case 'docancel':
        return this._doCancel(s);
      case 'reschedule':
        return this._reschedule(s);
      case 'keep':
        this._resetFlow(s);
        return reply('Perfect, programarea rămâne valabilă. Vă așteptăm cu drag! 😊', this.mainMenu());
      default:
        return null;
    }
  }

  // ───────────────────────── Conversație liberă ─────────────────────────

  async _free(s, input, norm, found) {
    const greet = found.greeting ? `${this._greetingWord()}! 😊` : null;

    if (found.urgent) return this.urgent(s, greet);
    if (found.cancel) return this._startCancel(s, input);
    if (found.book) return this._startBooking(s, input, greet);

    const info = this._infoAnswer(input, norm, found);
    if (info) {
      s.fails = 0;
      if (greet) info.messages.unshift(greet);
      return info;
    }

    if (found.human) return this.humanHandoff();
    if (found.services) return this.servicesList();

    // doar numele unui serviciu („albire”, „aparat dentar”)
    const svc = nlu.detectService(input, this.activeServices());
    if (svc) return this.serviceInfo(svc, greet);

    if (found.menu) return reply('Iată ce pot face pentru dumneavoastră:', this.mainMenu());
    if (found.thanks) return reply('Cu mare plăcere! 😊 Mai pot ajuta cu ceva?', [opt('📅 Programare nouă', 'act:book'), opt('🏠 Meniu principal', 'act:menu')]);
    if (found.bye) return reply(`O zi frumoasă! 🌸 Echipa ${this.clinic.name} vă așteaptă cu drag.`);
    if (found.greeting) return this.welcome();

    return this._fallback(s);
  }

  /** Răspunsuri informative (FAQ, prețuri, program, contact) — pot fi combinate. */
  _infoAnswer(input, norm, found) {
    const svc = nlu.detectService(input, this.activeServices());
    if (found.prices && svc) return this.serviceInfo(svc);

    const blocks = [];
    const faqs = nlu.detectFaqs(input, this.cfg.faq).slice(0, 3);
    const faq = faqs[0];
    faqs.forEach((f) => blocks.push(txt.fillTemplate(f.answer, this._vars())));
    if (found.hours) blocks.push(this.hoursText(true));
    if (found.prices) blocks.push(...this.priceList().messages);
    if (found.contact && !faq) blocks.push(this.contactText());
    if (!blocks.length) return null;
    return reply(blocks, [opt('📅 Fă o programare', 'act:book'), opt('🏠 Meniu principal', 'act:menu')]);
  }

  async _fallback(s) {
    s.fails += 1;
    if (ai.isEnabled()) {
      const answer = await ai.answer(this.cfg, this.hoursText(false), s.history);
      if (answer) {
        s.fails = 0;
        return reply(answer, [opt('📅 Fă o programare', 'act:book'), opt('🏠 Meniu principal', 'act:menu')]);
      }
    }
    if (s.fails >= 2) {
      return reply(
        [`Îmi pare rău, nu reușesc să înțeleg exact. 😔 Colegii de la recepție vă pot ajuta imediat la *${this.clinic.phone}*.`, 'Sau alegeți una dintre opțiuni:'],
        [...this.mainMenu().slice(0, 4), opt('✍️ Las un mesaj', 'act:leavemsg')]
      );
    }
    return reply(
      ['Nu am înțeles exact. 🤔 Puteți reformula sau alege una dintre opțiunile de mai jos.', 'De exemplu: _„vreau o programare vineri la 10”_ sau _„cât costă un detartraj?”_'],
      this.mainMenu()
    );
  }

  // ───────────────────────── Programare ─────────────────────────

  _startBookingState(s) {
    s.state = S.SERVICE;
    s.booking = {};
    s.editing = false;
    s.timePage = 0;
  }

  /** Pornește programarea, preluând din mesaj tot ce se poate (serviciu, zi, oră). */
  _startBooking(s, input, greet) {
    this._startBookingState(s);
    const b = s.booking;
    const pre = [greet];
    const svc = nlu.detectService(input, this.activeServices());
    const today = this.scheduler.today();
    const date = nlu.parseDate(input, today);
    const time = nlu.parseTime(input);
    if (date) b.date = date;
    if (time) b.pendingTime = time;
    if (svc) return this._setService(s, svc, pre);
    if (!date && !time) pre.push('Cu plăcere vă ajut cu o programare! 😊');
    return this._advance(s, pre);
  }

  /** Decide următorul pas în funcție de ce informații lipsesc. */
  _advance(s, pre = []) {
    const b = s.booking;
    if (!b.serviceId) return this._askService(s, pre);
    if (!b.patientType) return this._askPatient(s, pre);
    if (!b.date) return this._askDate(s, pre);
    if (!b.time) return this._askTime(s, pre);
    if (!b.name) return this._askName(s, pre);
    if (!b.phone) return this._askPhone(s, pre);
    return this._askConfirm(s, pre);
  }

  _priceText(svc) {
    const cur = this.clinic.currency || 'lei';
    if (svc.priceFrom == null) return 'la consultație';
    return svc.priceTo && svc.priceTo !== svc.priceFrom ? `${svc.priceFrom}–${svc.priceTo} ${cur}` : `${svc.priceFrom} ${cur}`;
  }

  _askService(s, pre = []) {
    s.state = S.SERVICE;
    return reply(
      [...pre, 'Pentru ce doriți să veniți la clinică? 🦷', 'Alegeți din listă sau descrieți pe scurt (ex: _„mă doare o măsea”_, _„vreau albire”_). Dacă nu știți sigur, alegeți *Consultație*.'],
      this.activeServices().slice(0, 10).map((svc) => opt(`${svc.emoji || '🦷'} ${svc.shortName || svc.name}`, `svc:${svc.id}`, `~${svc.duration} min · ${this._priceText(svc)}`))
    );
  }

  _setService(s, svc, pre = []) {
    const b = s.booking;
    b.serviceId = svc.id;
    b.time = null; // durata poate fi diferită, recalculăm orele
    s.timePage = 0;
    pre = [...pre, `Am notat: ${svc.emoji || '🦷'} *${svc.name}* — durată aprox. ${svc.duration} min, preț orientativ ${this._priceText(svc)}.`];
    if (svc.id === this._urgentService().id && !b.patientType) b.patientType = 'unknown';
    return this._advance(s, pre);
  }

  _askPatient(s, pre = []) {
    s.state = S.PATIENT;
    return reply([...pre, 'Ați mai fost până acum la noi în clinică?'], [opt('🆕 Prima vizită', 'ptype:new'), opt('🔁 Am mai fost', 'ptype:existing')]);
  }

  _setDate(s, date, pre = []) {
    const b = s.booking;
    const status = this.scheduler.dayStatus(date, b.serviceId);
    if (status === 'open') {
      b.date = date;
      b.time = null;
      s.timePage = 0;
      return this._advance(s, pre);
    }
    b.date = null;
    b.time = null;
    return this._askDate(s, [...pre, this._explainDay(date, status, b.serviceId)], date);
  }

  _explainDay(date, status, serviceId) {
    const d = dateMid(date);
    const svc = this.service(serviceId);
    switch (status) {
      case 'past':
        return `Data de ${T.formatDayMonth(date)} a trecut deja. 🙂`;
      case 'too-far':
        return `Momentan facem programări cu cel mult ${this.cfg.schedule.bookingWindowDays} zile înainte (până pe ${T.formatDayMonth(this.scheduler.lastBookableDate())}). Pentru date mai îndepărtate, sunați-ne la *${this.clinic.phone}*.`;
      case 'holiday':
        return `Pe *${d}* clinica este închisă. 🎄`;
      case 'closed': {
        const dayArt = ['Duminica', 'Lunea', 'Marțea', 'Miercurea', 'Joia', 'Vinerea', 'Sâmbăta'][T.weekdayIndex(date)];
        return (this.cfg.schedule.onlyDates || []).length || this.cfg.schedule.specialDates?.[date]
          ? `Pe *${d}* clinica nu are program.`
          : `${dayArt} clinica este închisă.`;
      }
      case 'not-offered':
        return `Pe *${d}* nu avem programări disponibile.`;
      case 'full':
        return `Pe *${d}* nu mai avem locuri libere${svc ? ` pentru ${svc.shortName || svc.name}` : ''}. 😕`;
      default:
        return '';
    }
  }

  _askDate(s, pre = [], near = null) {
    s.state = S.DATE;
    const b = s.booking;
    let dates = this.scheduler.availableDates(b.serviceId, { limit: 6, from: near ? T.addDays(near, -2) : null });
    if (near && dates.length < 3) dates = this.scheduler.availableDates(b.serviceId, { limit: 6 });
    if (!dates.length) {
      this._resetFlow(s);
      return reply(
        [...pre, `Ne pare rău, în următoarele ${this.cfg.schedule.bookingWindowDays} zile nu mai avem locuri libere online. 😔`, `Vă rugăm să ne sunați la *${this.clinic.phone}* — colegii vor încerca să vă găsească un loc sau vă trec pe lista de așteptare.`],
        [opt('✍️ Las un mesaj', 'act:leavemsg'), opt('🏠 Meniu principal', 'act:menu')]
      );
    }
    const head = near ? 'Iată cele mai apropiate zile cu locuri libere:' : 'În ce zi v-ar conveni? 📅 Iată primele zile cu locuri libere:';
    return reply(
      [...pre, head],
      [
        ...dates.map((d) => opt(this._dayLabel(d.date), `date:${d.date}`, d.count === 1 ? 'o oră liberă' : `${d.count} ore libere`)),
        opt('📆 Altă zi', 'act:otherdate'),
      ]
    );
  }

  /** „Azi, 14 oct”, „Mâine, 15 oct”, „Vineri, 16 oct” */
  _dayLabel(date) {
    const today = this.scheduler.today();
    const short = T.formatDateShort(date);
    if (date === today) return short.replace(/^[^,]+/, 'Azi');
    if (date === T.addDays(today, 1)) return short.replace(/^[^,]+/, 'Mâine');
    return short;
  }

  _askTime(s, pre = []) {
    s.state = S.TIME;
    const b = s.booking;
    const slots = this.scheduler.slotsFor(b.date, b.serviceId);
    if (!slots.length) {
      const date = b.date;
      b.date = null;
      return this._askDate(s, [...pre, this._explainDay(date, this.scheduler.dayStatus(date, b.serviceId), b.serviceId)], date);
    }
    const dateTxt = dateMid(b.date);

    // ora sau intervalul cerut în mesaj („la 10”, „după 15”)
    if (b.pendingTime) {
      const p = b.pendingTime;
      delete b.pendingTime;
      if (p.time) {
        if (slots.includes(p.time)) {
          b.time = p.time;
          return this._advance(s, [...pre, `Intervalul *${dateTxt}, ora ${p.time}* este liber. ✅`]);
        }
        const target = T.toMin(p.time);
        const nearest = [...slots].sort((a, c) => Math.abs(T.toMin(a) - target) - Math.abs(T.toMin(c) - target)).slice(0, 4).sort();
        return reply(
          [...pre, `La ora ${p.time} nu avem loc în ${dateTxt}. Cele mai apropiate ore libere sunt:`],
          [...nearest.map((t) => opt(t, `time:${t}`)), opt('🕘 Toate orele', 'act:alltimes'), opt('‹ Altă zi', 'act:changedate')]
        );
      }
      if (p.range) {
        const inRange = slots.filter((t) => T.toMin(t) >= p.range.from && T.toMin(t) < p.range.to);
        if (inRange.length) return this._timeOptions(s, inRange, [...pre, `Ore libere *${p.range.label}* în ${dateTxt}:`], true);
        pre = [...pre, `${cap(p.range.label)} nu mai avem ore libere în ${dateTxt}, dar iată ce avem:`];
      }
    }
    return this._timeOptions(s, slots, [...pre, `Ore libere pentru *${dateTxt}* 🕘`, 'Alegeți ora sau scrieți-o (ex: *10:30*, *după 15*, *dimineața*).']);
  }

  _timeOptions(s, slots, messages, filtered = false) {
    const pages = Math.ceil(slots.length / TIMES_PER_PAGE);
    const page = (s.timePage || 0) % pages;
    s.timePage = page;
    const shown = slots.slice(page * TIMES_PER_PAGE, (page + 1) * TIMES_PER_PAGE);
    const options = shown.map((t) => opt(t, `time:${t}`));
    if (pages > 1) options.push(opt(page + 1 < pages ? 'Mai multe ore ›' : '‹ Primele ore', 'act:moretimes'));
    if (filtered) options.push(opt('🕘 Toate orele', 'act:alltimes'));
    options.push(opt('‹ Altă zi', 'act:changedate'));
    return reply(messages, options);
  }

  _askName(s, pre = []) {
    s.state = S.NAME;
    const options = [];
    if (s.channel === 'whatsapp' && s.meta.profileName && /\p{L}{2}/u.test(s.meta.profileName)) {
      options.push(opt(`👤 ${s.meta.profileName}`.slice(0, 24), 'act:usewaname'));
    }
    return reply([...pre, 'Pe ce nume să fac programarea? ✍️ (nume și prenume)'], options);
  }

  _askPhone(s, pre = []) {
    s.state = S.PHONE;
    const first = (s.booking.name || '').split(' ')[0];
    const options = [];
    if (s.channel === 'whatsapp' && s.meta.waPhone) {
      const p = txt.parsePhone('+' + String(s.meta.waPhone).replace(/^\+/, '')) || s.meta.waPhone;
      options.push(opt(`📱 ${txt.formatPhone(p)}`, 'act:usewaphone'));
    }
    return reply(
      [...pre, `Mulțumesc${first ? ', ' + first : ''}! 📞 La ce număr de telefon vă putem contacta pentru confirmare?`, '🔒 _Datele dumneavoastră sunt folosite exclusiv pentru gestionarea programării._'],
      options
    );
  }

  _summary(b) {
    const svc = this.service(b.serviceId);
    const lines = [
      `${svc.emoji || '🦷'} *Serviciu:* ${svc.name}`,
      `📅 *Data:* ${T.formatDateLong(b.date, true)}`,
      `🕘 *Ora:* ${b.time} (durată aprox. ${svc.duration} min)`,
      `👤 *Nume:* ${b.name}`,
      `📞 *Telefon:* ${txt.formatPhone(b.phone)}`,
    ];
    if (b.patientType === 'new') lines.push('🆕 *Pacient:* nou');
    if (b.patientType === 'existing') lines.push('🔁 *Pacient:* existent');
    return lines.join('\n');
  }

  _askConfirm(s, pre = []) {
    s.state = S.CONFIRM;
    s.editing = false;
    return reply([...pre, 'Vă rog să verificați detaliile programării:', this._summary(s.booking), 'Confirmați programarea?'], [
      opt('✅ Confirm', 'act:confirm'),
      opt('✏️ Modific', 'act:modify'),
      opt('✖️ Renunț', 'act:abort'),
    ]);
  }

  _askEdit(s, pre = []) {
    s.state = S.EDIT;
    return reply([...pre, 'Ce doriți să modificați?'], [
      opt('🦷 Serviciul', 'edit:service'),
      opt('📅 Data și ora', 'edit:datetime'),
      opt('👤 Numele', 'edit:name'),
      opt('📞 Telefonul', 'edit:phone'),
      opt('✖️ Renunț la programare', 'act:abort'),
    ]);
  }

  _edit(s, field) {
    const b = s.booking;
    s.editing = true;
    s.state = S.CONFIRM;
    if (field === 'service') {
      b.serviceId = null;
      b.time = null;
    } else if (field === 'datetime') {
      b.date = null;
      b.time = null;
    } else if (field === 'name') b.name = null;
    else if (field === 'phone') b.phone = null;
    else return null;
    return this._advance(s);
  }

  _finalize(s) {
    const b = s.booking;
    const svc = this.service(b.serviceId);
    if (!this.scheduler.isAvailable(b.date, b.time, b.serviceId)) {
      b.time = null;
      s.timePage = 0;
      return this._askTime(s, ['😕 Ne pare rău, între timp ora aleasă a fost ocupată de alt pacient. Vă rog alegeți altă oră:']);
    }
    const booking = this.storage.addBooking(
      {
        serviceId: svc.id,
        serviceName: svc.name,
        date: b.date,
        time: b.time,
        duration: svc.duration,
        name: b.name,
        phone: b.phone,
        patientType: b.patientType,
        channel: s.channel,
        userId: s.userId,
        rescheduledFrom: s.rescheduleId || undefined,
      },
      this.clinic.bookingCodePrefix || 'PR'
    );
    let extra = '';
    if (s.rescheduleId) {
      const old = this.storage.updateBooking(s.rescheduleId, { status: 'cancelled', cancelledBy: 'patient', cancelReason: `reprogramată (${booking.code})` });
      if (old) {
        extra = `\n🔁 Programarea veche (${T.formatDayMonth(old.date)}, ora ${old.time}) a fost anulată automat.`;
        this.onCancel(old);
      }
    }
    s.myBookingIds.push(booking.id);
    this.onBooking(booking);
    this._resetFlow(s);

    return reply(
      [
        `✅ *Programarea a fost înregistrată!*\n🔖 Cod programare: *${booking.code}*${extra}`,
        `Vă așteptăm *${dateMid(booking.date)}, la ora ${booking.time}*, la ${this.clinic.address}.`,
        '📌 Vă rugăm să ajungeți cu 10 minute mai devreme și să aveți la dumneavoastră un act de identitate (și radiografii recente, dacă aveți).',
        `Dacă nu puteți ajunge, scrieți-ne „anulare” aici sau sunați la *${this.clinic.phone}*. Vă mulțumim! 😊`,
      ],
      [opt('📍 Cum ajung', 'act:address'), opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  _stepHandlers() {
    return {
      [S.SERVICE]: (s, input, { found }) => {
        if (found.urgent) return this._setService(s, this._urgentService(), ['Îmi pare rău că aveți dureri. 😟 Vă găsim cel mai apropiat loc liber.']);
        if (found.prices || input.includes('?')) return null; // e o întrebare, nu o alegere
        const svc = nlu.detectService(input, this.activeServices());
        if (svc) return this._setService(s, svc);
        return null;
      },
      [S.PATIENT]: (s, input, { norm, found }) => {
        if (/\b(prima|nou|noua|niciodata|n-am fost|nu am fost|prima data|prima oara)\b/.test(norm) || (found.no && !found.yes)) {
          return this._handleValue(s, 'ptype', 'new');
        }
        if (/\b(am mai fost|existent|deja|pacient|vin des|de mult)\b/.test(norm) || found.yes) return this._handleValue(s, 'ptype', 'existing');
        return null;
      },
      [S.DATE]: (s, input) => {
        const date = nlu.parseDate(input, this.scheduler.today());
        const time = nlu.parseTime(input);
        if (time) s.booking.pendingTime = time;
        if (date) return this._setDate(s, date);
        return null;
      },
      [S.TIME]: (s, input) => {
        const date = nlu.parseDate(input, this.scheduler.today());
        const time = nlu.parseTime(s, input, { bareNumberIsHour: true });
        if (time) s.booking.pendingTime = time;
        if (date && date !== s.booking.date) return this._setDate(s, date);
        if (time) return this._askTime(s);
        return null;
      },
      [S.NAME]: (s, input, { found }) => {
        if (input.includes('?') || found.prices || found.hours) return null;
        let name = input
          .replace(/^(ma numesc|numele meu (este|e)|sunt|pe numele|pe numele de|numele)\s+/i, '')
          .replace(/^(mă numesc|numele meu este)\s+/i, '')
          .replace(/[.,!]+$/g, '')
          .trim();
        if (/\d/.test(name)) return reply('Vă rog să scrieți doar numele și prenumele (fără cifre). ✍️');
        if (!/^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(name) || !/\p{L}{2}/u.test(name)) return null;
        if (name.split(/\s+/).length > 5) return null;
        s.booking.name = txt.capitalizeName(name);
        return this._advance(s);
      },
      [S.PHONE]: (s, input) => {
        const phone = txt.findPhone(input) || txt.parsePhone(input);
        if (phone) {
          s.booking.phone = phone;
          return this._advance(s);
        }
        if (/\d{3,}/.test(input)) return reply('Numărul nu pare valid. 🤔 Vă rog scrieți-l în formatul *07xx xxx xxx* (sau cu prefix internațional, ex. *+40…*).');
        return null;
      },
      [S.CONFIRM]: (s, input, { norm, found }) => {
        if (/\b(modific|schimb|corectez|gresit)\b/.test(norm)) return this._askEdit(s);
        if (found.yes && !found.no) return this._finalize(s);
        if (found.no) return this._askEdit(s, ['Nicio problemă!']);
        return null;
      },
      [S.EDIT]: (s, input, { norm }) => {
        if (/\b(data|ziua|ora|ore|alta zi|alta ora)\b/.test(norm)) return this._edit(s, 'datetime');
        if (/\b(nume|numele|prenume)\b/.test(norm)) return this._edit(s, 'name');
        if (/\b(telefon|numar|numarul)\b/.test(norm)) return this._edit(s, 'phone');
        if (/\b(serviciu|serviciul|motiv|tratament|procedura)\b/.test(norm)) return this._edit(s, 'service');
        return null;
      },
      [S.CANCEL_LOOKUP]: (s, input) => this._lookupBookings(s, input, true),
      [S.CANCEL_PICK]: () => null,
      [S.CANCEL_CONFIRM]: (s, input, { norm, found }) => {
        if (/\b(reprogram|mut|alta data|alta zi|schimb)\w*/.test(norm)) return this._reschedule(s);
        if (/\b(anuleaza|anulez|anulati|sterge)\b/.test(norm) || (found.yes && !found.no)) return this._doCancel(s);
        if (/\b(pastrez|raman|ramane|las)\b/.test(norm) || found.no) return this._action(s, 'keep');
        return null;
      },
      [S.MSG_TEXT]: (s, input) => {
        if (input.length < 3) return null;
        s.msgText = input;
        const phone = txt.findPhone(input);
        if (phone || (s.channel === 'whatsapp' && s.meta.waPhone)) return this._saveMessage(s, phone);
        s.state = S.MSG_PHONE;
        return reply('Mulțumesc! 📞 La ce număr de telefon vă poate contacta un coleg?');
      },
      [S.MSG_PHONE]: (s, input) => {
        const phone = txt.findPhone(input) || txt.parsePhone(input);
        if (!phone) return reply('Numărul nu pare valid. 🤔 Vă rog scrieți-l în formatul *07xx xxx xxx*.');
        return this._saveMessage(s, phone);
      },
    };
  }

  _reprompt(s) {
    const b = s.booking;
    switch (s.state) {
      case S.SERVICE: return this._askService(s);
      case S.PATIENT: return this._askPatient(s);
      case S.DATE: return this._askDate(s);
      case S.TIME: return b.date ? this._askTime(s) : this._askDate(s);
      case S.NAME: return this._askName(s);
      case S.PHONE: return this._askPhone(s);
      case S.CONFIRM: return this._askConfirm(s);
      case S.EDIT: return this._askEdit(s);
      case S.CANCEL_LOOKUP: return reply('Scrieți codul programării (ex: *' + (this.clinic.bookingCodePrefix || 'PR') + '-7K2M*) sau numărul de telefon folosit la programare.', [opt('🏠 Meniu principal', 'act:menu')]);
      case S.CANCEL_PICK: return reply('Vă rog alegeți programarea din listă:', s.options);
      case S.CANCEL_CONFIRM: return reply('Ce doriți să faceți cu programarea?', [opt('❌ Anulez', 'act:docancel'), opt('🔁 Reprogramez', 'act:reschedule'), opt('↩️ O păstrez', 'act:keep')]);
      case S.MSG_TEXT: return reply('Scrieți mesajul pentru recepție ✍️', [opt('↩️ Înapoi la meniu', 'act:menu')]);
      case S.MSG_PHONE: return reply('La ce număr de telefon vă putem contacta?');
      default: return reply('Cu ce vă pot ajuta?', this.mainMenu());
    }
  }

  _stepHint(state) {
    return {
      [S.SERVICE]: 'Nu am identificat serviciul. 🤔',
      [S.PATIENT]: 'Vă rog să-mi spuneți dacă este prima vizită.',
      [S.DATE]: 'Nu am înțeles data. 🤔',
      [S.TIME]: 'Nu am înțeles ora. 🤔',
      [S.NAME]: 'Am nevoie doar de numele și prenumele dumneavoastră.',
      [S.PHONE]: 'Am nevoie de un număr de telefon valid.',
      [S.CONFIRM]: 'Vă rog să confirmați sau să alegeți ce modificăm.',
      [S.EDIT]: 'Nu am înțeles ce doriți să modificați.',
      [S.CANCEL_LOOKUP]: 'Nu am găsit un cod sau un număr de telefon în mesaj.',
    }[state] || 'Nu am înțeles exact.';
  }

  // ───────────────────────── Anulare / reprogramare ─────────────────────────

  _futureBookings(list) {
    const now = this.scheduler.now();
    return list
      .filter((b) => b.status === 'confirmed' && (b.date > now.date || (b.date === now.date && T.toMin(b.time) > now.minutes)))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  _startCancel(s, input) {
    this._resetFlow(s);
    s.state = S.CANCEL_LOOKUP;
    // întâi căutăm după cod / telefon din mesaj, apoi după contul de WhatsApp sau sesiune
    const fromText = this._lookupBookings(s, input, false);
    if (fromText) return fromText;

    const all = this.storage.allBookings();
    const waPhone = s.meta.waPhone ? txt.parsePhone('+' + String(s.meta.waPhone).replace(/^\+/, '')) : null;
    const mine = this._futureBookings(
      all.filter((b) => s.myBookingIds.includes(b.id) || (s.channel === 'whatsapp' && (b.userId === s.userId || (waPhone && b.phone === waPhone))))
    );
    if (mine.length) return this._presentBookings(s, mine);

    return reply(
      ['Sigur, vă ajut. 🔎', `Vă rog să-mi scrieți *codul programării* (ex: *${this.clinic.bookingCodePrefix || 'PR'}-7K2M*, îl găsiți în mesajul de confirmare) sau *numărul de telefon* folosit la programare.`],
      [opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  _lookupBookings(s, input, reportMissing) {
    const code = nlu.parseBookingCode(input, this.clinic.bookingCodePrefix || 'PR');
    const phone = code ? null : txt.findPhone(input);
    if (!code && !phone) return null;
    const all = this.storage.allBookings();
    const found = this._futureBookings(code ? all.filter((b) => b.code === code) : all.filter((b) => b.phone === phone));
    if (found.length) return this._presentBookings(s, found);
    if (!reportMissing) return null;
    return reply(
      [`Nu am găsit nicio programare viitoare pentru ${code ? `codul *${code}*` : `numărul *${txt.formatPhone(phone)}*`}. 🤔`, `Verificați datele și încercați din nou, sau sunați-ne la *${this.clinic.phone}*.`],
      [opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  _presentBookings(s, list) {
    if (list.length === 1) {
      const bk = list[0];
      s.state = S.CANCEL_CONFIRM;
      s.cancelId = bk.id;
      return reply(
        ['Am găsit programarea:', `🦷 ${bk.serviceName}\n📅 ${T.formatDateLong(bk.date)}, ora ${bk.time}\n🔖 Cod: ${bk.code}`, 'Ce doriți să faceți?'],
        [opt('❌ Anulez programarea', 'act:docancel'), opt('🔁 Reprogramez', 'act:reschedule'), opt('↩️ O păstrez', 'act:keep')]
      );
    }
    s.state = S.CANCEL_PICK;
    return reply(
      `Am găsit ${list.length} programări viitoare. Pe care doriți să o modificați?`,
      list.slice(0, 10).map((bk) => opt(`${T.formatDateShort(bk.date)} · ${bk.time}`, `pick:${bk.id}`, bk.serviceName))
    );
  }

  _doCancel(s) {
    const bk = s.cancelId && this.storage.findBooking(s.cancelId);
    if (!bk || bk.status !== 'confirmed') {
      this._resetFlow(s);
      return reply('Nu mai găsesc această programare activă.', this.mainMenu());
    }
    this.storage.updateBooking(bk.id, { status: 'cancelled', cancelledBy: 'patient', cancelledAt: new Date().toISOString() });
    this.onCancel(bk);
    this._resetFlow(s);
    return reply(
      [`✅ Programarea din *${dateMid(bk.date)}, ora ${bk.time}* a fost anulată.`, 'Vă mulțumim că ne-ați anunțat! Dacă doriți, vă găsim oricând o altă dată. 😊'],
      [opt('📅 Programare nouă', 'act:book'), opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  _reschedule(s) {
    const bk = s.cancelId && this.storage.findBooking(s.cancelId);
    if (!bk || bk.status !== 'confirmed') {
      this._resetFlow(s);
      return reply('Nu mai găsesc această programare activă.', this.mainMenu());
    }
    this._startBookingState(s);
    s.rescheduleId = bk.id;
    const svc = this.service(bk.serviceId) && this.service(bk.serviceId).active !== false ? bk.serviceId : null;
    Object.assign(s.booking, { serviceId: svc, patientType: 'existing', name: bk.name, phone: bk.phone });
    return this._advance(s, ['Sigur! Să găsim o nouă dată. 📅 Programarea veche se anulează automat după ce o confirmați pe cea nouă.']);
  }

  // ───────────────────────── Mesaj pentru recepție ─────────────────────────

  _saveMessage(s, phone) {
    const waPhone = s.meta.waPhone ? txt.parsePhone('+' + String(s.meta.waPhone).replace(/^\+/, '')) : null;
    const msg = this.storage.addMessage({
      text: s.msgText,
      phone: phone || waPhone,
      name: s.meta.profileName || null,
      channel: s.channel,
      userId: s.userId,
    });
    this.onMessage(msg);
    this._resetFlow(s);
    const open = this.scheduler.openNow();
    return reply(
      [`✅ Mesajul a fost transmis! Un coleg de la recepție vă va contacta ${open ? 'cât mai curând' : 'imediat ce redeschidem'}.`, 'Mai pot ajuta cu ceva?'],
      this.mainMenu()
    );
  }

  // ───────────────────────── Răspunsuri informative ─────────────────────────

  _vars() {
    const c = this.clinic;
    return { ...c, clinicName: c.name };
  }

  _greetingWord() {
    const m = this.scheduler.now().minutes;
    if (m < 11 * 60) return 'Bună dimineața';
    if (m < 18 * 60) return 'Bună ziua';
    return 'Bună seara';
  }

  mainMenu() {
    return [
      opt('📅 Programare nouă', 'act:book'),
      opt('💰 Prețuri', 'act:prices'),
      opt('🕘 Program și adresă', 'act:hours'),
      opt('🔁 Anulare/reprogramare', 'act:cancel'),
      opt('💬 Vorbește cu recepția', 'act:human'),
    ];
  }

  welcome() {
    const c = this.clinic;
    return reply(
      [
        `${this._greetingWord()}! 👋 Sunt ${c.botName || 'asistentul virtual'}, asistentul virtual al *${c.name}*.`,
        'Vă pot ajuta să faceți o programare în mai puțin de un minut, să aflați prețurile, programul clinicii sau răspunsuri la întrebările frecvente.',
        'Cu ce vă pot ajuta astăzi?',
      ],
      this.mainMenu()
    );
  }

  hoursText(withStatus = true) {
    const sch = this.cfg.schedule;
    const order = ['luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata', 'duminica'];
    const labels = { luni: 'Luni', marti: 'Marți', miercuri: 'Miercuri', joi: 'Joi', vineri: 'Vineri', sambata: 'Sâmbătă', duminica: 'Duminică' };
    const fmt = (list) => (list && list.length ? list.map((i) => i.replace('-', '–')).join(', ') : 'închis');

    const lines = [];
    if ((sch.onlyDates || []).length) {
      const today = this.scheduler.today();
      const upcoming = sch.onlyDates.filter((d) => d >= today).slice(0, 10);
      lines.push('🗓️ *În perioada următoare avem program în zilele:*');
      upcoming.forEach((d) => lines.push(`• ${T.formatDateShort(d)}: ${fmt(this.scheduler.intervalsFor(d).map((iv) => `${T.fromMin(iv.start)}-${T.fromMin(iv.end)}`))}`));
      if (!upcoming.length) lines.push('• momentan nu sunt zile programate — sunați-ne pentru detalii');
    } else {
      lines.push('🕘 *Programul clinicii:*');
      let i = 0;
      while (i < order.length) {
        let j = i;
        const val = fmt(sch.weekly[order[i]]);
        while (j + 1 < order.length && fmt(sch.weekly[order[j + 1]]) === val) j++;
        lines.push(`• ${labels[order[i]]}${j > i ? ` – ${labels[order[j]]}` : ''}: ${val}`);
        i = j + 1;
      }
    }

    const closures = this.scheduler.upcomingClosures(45);
    if (closures.length) lines.push(`\n⚠️ *Închis:* ${closures.map((d) => T.formatDayMonth(d)).join(', ')}`);
    const special = this.scheduler.upcomingSpecial(45);
    if (special.length && !(sch.onlyDates || []).length) {
      lines.push(`📌 *Program special:* ${special.map(([d, l]) => `${T.formatDayMonth(d)} (${fmt(l)})`).join('; ')}`);
    }

    if (withStatus) {
      if (this.scheduler.openNow()) lines.push('\n🟢 Acum suntem deschiși.');
      else {
        const next = this.scheduler.nextOpening();
        if (next) {
          const today = this.scheduler.today();
          const when = next.date === today ? 'astăzi' : next.date === T.addDays(today, 1) ? 'mâine' : dateMid(next.date);
          lines.push(`\n🔴 Acum suntem închiși. Redeschidem ${when} la ora ${next.time}.`);
        }
      }
    }
    return lines.join('\n');
  }

  priceList() {
    const lines = this.activeServices().map((s) => `• ${s.emoji || '🦷'} ${s.name}: *${this._priceText(s)}*`);
    return reply(
      ['💰 *Prețuri orientative:*\n' + lines.join('\n'), 'ℹ️ Prețul final se stabilește de medic după consultație, în funcție de situația fiecărui pacient. Acceptăm plata cash, card și, pentru tratamentele ample, în rate.'],
      [opt('📅 Fă o programare', 'act:book'), opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  serviceInfo(svc, greet) {
    return reply(
      [
        greet,
        `${svc.emoji || '🦷'} *${svc.name}*\n${svc.description || ''}\n⏱️ Durată aprox.: ${svc.duration} min\n💰 Preț orientativ: *${this._priceText(svc)}*`,
        'Prețul final se stabilește după consultație. Doriți să faceți o programare?',
      ],
      [opt('📅 Programează-mă', `book:${svc.id}`), opt('💰 Toate prețurile', 'act:prices'), opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  servicesList() {
    const lines = this.activeServices().map((s) => `${s.emoji || '🦷'} *${s.name}* — ${s.description || ''}`);
    return reply(['Iată serviciile noastre:', lines.join('\n')], [opt('📅 Fă o programare', 'act:book'), opt('💰 Prețuri', 'act:prices'), opt('🏠 Meniu principal', 'act:menu')]);
  }

  contactText() {
    const c = this.clinic;
    return [
      '📇 *Date de contact:*',
      `📞 Telefon: *${c.phone}*`,
      c.urgentPhone && c.urgentPhone !== c.phone ? `🚑 Urgențe: *${c.urgentPhone}*` : null,
      c.email ? `✉️ Email: ${c.email}` : null,
      `📍 Adresă: ${c.address}`,
      c.website ? `🌐 ${c.website}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  humanHandoff() {
    const c = this.clinic;
    const status = this.scheduler.openNow() ? '🟢 Recepția este deschisă acum.' : '🔴 Recepția este închisă acum, dar vă putem suna noi imediat ce redeschidem.';
    return reply(
      [`Sigur! Puteți vorbi direct cu colegii de la recepție:\n📞 *${c.phone}*${c.email ? `\n✉️ ${c.email}` : ''}`, status, 'Sau lăsați-ne un mesaj aici și vă contactăm noi. 😊'],
      [opt('✍️ Las un mesaj', 'act:leavemsg'), opt('🏠 Meniu principal', 'act:menu')]
    );
  }

  _urgentService() {
    return this.service('urgenta') && this.service('urgenta').active !== false
      ? this.service('urgenta')
      : this.activeServices().find((s) => s.id === 'consultatie') || this.activeServices()[0];
  }

  urgent(s, greet) {
    this._resetFlow(s);
    const c = this.clinic;
    const svc = this._urgentService();
    const messages = [
      greet,
      'Îmi pare rău că aveți dureri. 😟',
      `Pentru urgențe dentare sunați-ne direct la *${c.urgentPhone || c.phone}* — facem tot posibilul să vă primim chiar astăzi.`,
      '⚠️ Dacă aveți umflătură care se extinde, febră mare sau dificultăți la respirație ori la înghițire, mergeți imediat la Urgențe sau sunați la *112*.',
    ];
    const first = this.scheduler.availableDates(svc.id, { limit: 1 })[0];
    if (!first) return reply(messages, [opt('💬 Vorbește cu recepția', 'act:human')]);
    const time = this.scheduler.slotsFor(first.date, svc.id)[0];
    const today = this.scheduler.today();
    const when = first.date === today ? 'astăzi' : first.date === T.addDays(today, 1) ? 'mâine' : dateMid(first.date);
    messages.push(`Cel mai apropiat loc liber este *${when}, la ora ${time}*. Doriți să îl rezerv?`);
    return reply(messages, [opt('✅ Da, rezervă-l', `urgent:${first.date}|${time}`), opt('📅 Altă oră', `book:${svc.id}`), opt('🏠 Meniu principal', 'act:menu')]);
  }
}

module.exports = { BotEngine, STATES: S };
