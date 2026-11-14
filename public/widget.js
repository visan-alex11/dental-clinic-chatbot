/*!
 * Widget de chat pentru clinica dentară.
 * Se adaugă pe orice site cu o singură linie, înainte de </body>:
 *
 *   <script src="https://adresa-serverului-dvs/widget.js" defer></script>
 *
 * Opțional:  data-color="#0f766e"   culoarea principală
 *            data-position="left"   colțul din stânga
 *            data-open="true"       deschis automat
 */
(function () {
  'use strict';
  if (window.__dentalChatLoaded) return;
  window.__dentalChatLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var SERVER = (script && script.dataset.server) || (script ? new URL(script.src, location.href).origin : location.origin);
  var COLOR = (script && script.dataset.color) || '#0f766e';
  var LEFT = script && script.dataset.position === 'left';
  var AUTO_OPEN = script && script.dataset.open === 'true';

  // ── stocare (poate lipsi în modul privat) ──
  function store(kind) {
    try {
      var s = window[kind];
      var k = '__t';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;
    }
  }
  var local = store('localStorage');
  var session = store('sessionStorage');
  function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(s, k, v) { try { s && s.setItem(k, v); } catch (e) {} }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  var sessionId = get(local, 'dcb-session') || uid();
  set(local, 'dcb-session', sessionId);

  var info = { name: 'Clinica dentară', botName: 'Asistent', phone: '' };

  // nuanțe derivate din culoarea principală (funcționează în toate browserele)
  function mix(hex, other, amount) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var a = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
    var b = other === 'white' ? [255, 255, 255] : [0, 0, 0];
    return '#' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0'); }).join('');
  }
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(COLOR)) COLOR = '#0f766e';
  var C_DARK = mix(COLOR, 'black', 0.22), C_SOFT = mix(COLOR, 'white', 0.9), C_LINE = mix(COLOR, 'white', 0.78);

  // ── stiluri (izolate în Shadow DOM, nu afectează site-ul) ──
  var css = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.root {
  --c: ${COLOR};
  --c-dark: ${C_DARK};
  --c-soft: ${C_SOFT};
  --c-line: ${C_LINE};
  --ink: #0f1f1d; --muted: #5b6b69; --bg: #f5f8f7; --white: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px; line-height: 1.45; color: var(--ink);
  position: fixed; bottom: 20px; ${LEFT ? 'left' : 'right'}: 20px; z-index: 2147483000;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; }

/* lansator */
.launcher {
  width: 62px; height: 62px; border-radius: 50%; background: var(--c); color: #fff;
  display: grid; place-items: center; box-shadow: 0 10px 30px rgba(15,31,29,.28), 0 2px 6px rgba(15,31,29,.18);
  transition: transform .25s cubic-bezier(.2,.9,.3,1.3), box-shadow .2s; position: relative;
}
.launcher:hover { transform: translateY(-2px) scale(1.04); }
.launcher:focus-visible { outline: 3px solid var(--c-line); outline-offset: 3px; }
.launcher svg { width: 28px; height: 28px; transition: transform .3s, opacity .2s; position: absolute; }
.launcher .ic-close { opacity: 0; transform: rotate(-90deg) scale(.6); }
.open .launcher .ic-chat { opacity: 0; transform: rotate(90deg) scale(.6); }
.open .launcher .ic-close { opacity: 1; transform: none; }
.badge {
  position: absolute; top: -2px; ${LEFT ? 'left' : 'right'}: -2px; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 10px; background: #e11d48; color: #fff; font-size: 12px; font-weight: 700;
  display: grid; place-items: center; border: 2px solid #fff;
}
.pulse::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--c);
  animation: pulse 2.2s ease-out infinite;
}
@keyframes pulse { from { transform: scale(1); opacity: .6; } to { transform: scale(1.6); opacity: 0; } }

/* bulă de invitație */
.teaser {
  position: absolute; bottom: 76px; ${LEFT ? 'left' : 'right'}: 0; width: 250px;
  background: #fff; border-radius: 16px; padding: 14px 34px 14px 16px; font-size: 14px;
  box-shadow: 0 12px 32px rgba(15,31,29,.18); cursor: pointer;
  animation: rise .35s cubic-bezier(.2,.9,.3,1.2);
}
.teaser b { display: block; margin-bottom: 2px; }
.teaser .x { position: absolute; top: 6px; ${LEFT ? 'left' : 'right'}: 8px; width: 24px; height: 24px; border-radius: 50%; color: var(--muted); font-size: 18px; line-height: 1; }
.teaser .x:hover { background: var(--bg); }

/* panou */
.panel {
  position: absolute; bottom: 78px; ${LEFT ? 'left' : 'right'}: 0;
  width: 390px; height: min(640px, calc(100vh - 110px));
  background: var(--bg); border-radius: 22px; overflow: hidden;
  box-shadow: 0 24px 60px rgba(15,31,29,.28), 0 4px 14px rgba(15,31,29,.12);
  display: flex; flex-direction: column;
  transform-origin: ${LEFT ? 'bottom left' : 'bottom right'};
  transform: translateY(12px) scale(.96); opacity: 0; pointer-events: none;
  transition: transform .28s cubic-bezier(.2,.9,.3,1.1), opacity .2s;
}
.open .panel { transform: none; opacity: 1; pointer-events: auto; }

header {
  background: linear-gradient(135deg, var(--c) 0%, var(--c-dark) 100%); color: #fff;
  padding: 16px 14px 16px 16px; display: flex; align-items: center; gap: 12px; flex-shrink: 0;
}
.avatar {
  width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,.18);
  display: grid; place-items: center; flex-shrink: 0; position: relative;
}
.avatar svg { width: 26px; height: 26px; }
.avatar::after {
  content: ""; position: absolute; bottom: 1px; right: 1px; width: 11px; height: 11px;
  border-radius: 50%; background: #4ade80; border: 2px solid var(--c-dark);
}
.who { flex: 1; min-width: 0; }
.who b { display: block; font-size: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who span { font-size: 12.5px; opacity: .85; }
.hbtn { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff; opacity: .85; }
.hbtn:hover { background: rgba(255,255,255,.14); opacity: 1; }
.hbtn svg { width: 18px; height: 18px; }

.log { flex: 1; overflow-y: auto; padding: 18px 14px 8px; scroll-behavior: smooth; overscroll-behavior: contain; }
.log::-webkit-scrollbar { width: 6px; }
.log::-webkit-scrollbar-thumb { background: #cfdcd9; border-radius: 3px; }
.day { text-align: center; font-size: 12px; color: var(--muted); margin: 0 0 14px; }

.row { display: flex; gap: 8px; margin-bottom: 6px; align-items: flex-end; animation: rise .28s ease-out; }
.row.user { justify-content: flex-end; }
.row .mini { width: 28px; height: 28px; border-radius: 50%; background: var(--c-soft); color: var(--c); display: grid; place-items: center; flex-shrink: 0; visibility: hidden; }
.row .mini svg { width: 17px; height: 17px; }
.row.last-bot .mini { visibility: visible; }
.bubble {
  max-width: 82%; padding: 10px 14px; border-radius: 18px; word-wrap: break-word; overflow-wrap: anywhere;
  font-size: 14.5px; white-space: normal;
}
.bot .bubble { background: #fff; border-bottom-left-radius: 6px; box-shadow: 0 1px 2px rgba(15,31,29,.06); }
.user .bubble { background: var(--c); color: #fff; border-bottom-right-radius: 6px; }
.bubble strong { font-weight: 650; }
.bubble a { color: var(--c-dark); text-decoration: underline; text-underline-offset: 2px; }
.user .bubble a { color: #fff; }
.time { font-size: 11px; color: var(--muted); margin: 0 0 12px 36px; }
.row.user + .time { text-align: right; margin: 0 2px 12px 0; }

.typing .bubble { display: flex; gap: 4px; padding: 14px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: #9fb3af; animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%,60%,100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }

.chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 14px 36px; animation: rise .3s ease-out; }
.chip {
  border: 1.5px solid var(--c-line); background: #fff; color: var(--c-dark);
  padding: 8px 13px; border-radius: 999px; font-size: 13.5px; font-weight: 550;
  transition: background .15s, border-color .15s, transform .1s; text-align: left; line-height: 1.25;
}
.chip small { display: block; font-weight: 400; color: var(--muted); font-size: 11.5px; margin-top: 1px; }
.chip:hover { background: var(--c-soft); border-color: var(--c); }
.chip:active { transform: scale(.97); }
.chip:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; }
.chips.times { display: grid; grid-template-columns: repeat(4, 1fr); }
.chips.times .chip { text-align: center; padding: 8px 4px; border-radius: 12px; font-variant-numeric: tabular-nums; }
.chips.times .chip.wide { grid-column: span 2; }
.chips.list .chip { border-radius: 14px; }

footer { background: #fff; border-top: 1px solid #e4ecea; padding: 10px 10px 8px 14px; flex-shrink: 0; }
form { display: flex; gap: 8px; align-items: flex-end; }
textarea {
  flex: 1; resize: none; border: 0; outline: 0; font: inherit; font-size: 15px; color: var(--ink);
  max-height: 110px; min-height: 24px; padding: 8px 0; background: transparent;
}
textarea::placeholder { color: #8a9b98; }
.send {
  width: 40px; height: 40px; border-radius: 12px; background: var(--c); color: #fff;
  display: grid; place-items: center; flex-shrink: 0; transition: opacity .2s, transform .1s;
}
.send:disabled { opacity: .35; cursor: default; }
.send:not(:disabled):active { transform: scale(.94); }
.send svg { width: 18px; height: 18px; }
.note { font-size: 11px; color: #8a9b98; text-align: center; padding-top: 6px; }
.note a { color: inherit; }

@media (max-width: 480px) {
  .root { bottom: 14px; ${LEFT ? 'left' : 'right'}: 14px; }
  .panel { position: fixed; inset: 0; width: 100%; height: 100%; border-radius: 0; bottom: auto; }
  .open .launcher { display: none; }
  .teaser { width: calc(100vw - 100px); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

  var ICON_CHAT = '<svg class="ic-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.6"/></svg>';
  var ICON_CLOSE = '<svg class="ic-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_TOOTH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 5.5C10.6 4.3 9 3.6 7.4 3.8 4.6 4.1 3.4 6.8 4 9.6c.4 2 1.4 3.3 1.8 5.2.5 2.3.6 5.4 2.2 5.4 1.7 0 1.7-3.6 2.4-5.2.4-.9 1-1.3 1.6-1.3s1.2.4 1.6 1.3c.7 1.6.7 5.2 2.4 5.2 1.6 0 1.7-3.1 2.2-5.4.4-1.9 1.4-3.2 1.8-5.2.6-2.8-.6-5.5-3.4-5.8-1.6-.2-3.2.5-4.6 1.7z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>';
  var ICON_RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  var ICON_MIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';

  // ── construire DOM ──
  var host = document.createElement('div');
  host.id = 'dental-chat-widget';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    '<style>' + css + '</style>' +
    '<div class="root" part="root">' +
    '  <div class="panel" role="dialog" aria-label="Chat cu clinica" aria-modal="false">' +
    '    <header>' +
    '      <div class="avatar">' + ICON_TOOTH + '</div>' +
    '      <div class="who"><b class="title">Asistent virtual</b><span>Online · răspundem imediat</span></div>' +
    '      <button class="hbtn restart" title="Conversație nouă" aria-label="Începe o conversație nouă">' + ICON_RESTART + '</button>' +
    '      <button class="hbtn minimize" title="Închide" aria-label="Închide chatul">' + ICON_MIN + '</button>' +
    '    </header>' +
    '    <div class="log" aria-live="polite"></div>' +
    '    <footer>' +
    '      <form><textarea rows="1" placeholder="Scrieți un mesaj…" aria-label="Mesajul dumneavoastră" maxlength="1000"></textarea>' +
    '      <button class="send" type="submit" aria-label="Trimite" disabled>' + ICON_SEND + '</button></form>' +
    '      <div class="note"></div>' +
    '    </footer>' +
    '  </div>' +
    '  <button class="launcher pulse" aria-label="Deschide chatul">' + ICON_CHAT + ICON_CLOSE + '<span class="badge">1</span></button>' +
    '</div>';

  var $ = function (sel) { return shadow.querySelector(sel); };
  var root = $('.root'), log = $('.log'), input = $('textarea'), sendBtn = $('.send'), launcher = $('.launcher'), badge = $('.badge');

  // ── formatare mesaje: *bold*, _italic_, linkuri, telefoane ──
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function format(text) {
    var h = esc(text);
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[\s(>*])((?:\+40|0)7\d{2}[\s.]?\d{3}[\s.]?\d{3}|(?:\+40|0)[23]\d{1,2}[\s.]?\d{3}[\s.]?\d{3,4})(?=$|[\s.,)<*])/g, function (m, pre, num) {
      return pre + '<a href="tel:' + num.replace(/[\s.]/g, '') + '">' + num + '</a>';
    });
    h = h.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[\s(„])_([^_\n]+)_(?=$|[\s.,!?)])/g, '$1<em>$2</em>');
    return h.replace(/\n/g, '<br>');
  }
  function clock() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ── istoric (rămâne la navigarea între paginile site-ului) ──
  var history = [];
  try { history = JSON.parse(get(session, 'dcb-history') || '[]'); } catch (e) { history = []; }
  function saveHistory() { set(session, 'dcb-history', JSON.stringify(history.slice(-60))); }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addBubble(who, text, time, record) {
    // bulele consecutive ale botului formează un grup: avatarul și ora apar doar la ultima
    var last = log.lastElementChild;
    if (who === 'bot' && last && last.classList.contains('time') && last.dataset.who === 'bot') {
      if (last.previousElementSibling) last.previousElementSibling.classList.remove('last-bot');
      last.remove();
    }
    var row = document.createElement('div');
    row.className = 'row ' + who + (who === 'bot' ? ' last-bot' : '');
    row.innerHTML = (who === 'bot' ? '<div class="mini">' + ICON_TOOTH + '</div>' : '') + '<div class="bubble">' + format(text) + '</div>';
    log.appendChild(row);
    var t = document.createElement('div');
    t.className = 'time';
    t.dataset.who = who;
    t.textContent = time || clock();
    log.appendChild(t);
    if (record !== false) {
      history.push({ who: who, text: text, time: t.textContent });
      saveHistory();
    }
    scrollDown();
  }

  function clearChips() {
    log.querySelectorAll('.chips').forEach(function (c) { c.remove(); });
  }

  function addChips(options, record) {
    clearChips();
    if (!options || !options.length) return;
    var isTime = function (o) { return /^\d{2}:\d{2}$/.test(o.label); };
    var times = options.filter(isTime).length >= 3;
    var wrap = document.createElement('div');
    wrap.className = 'chips' + (times ? ' times' : options.some(function (o) { return o.description; }) ? ' list' : '');
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (times && !isTime(o) ? ' wide' : '');
      b.innerHTML = esc(o.label) + (o.description && !times ? '<small>' + esc(o.description) + '</small>' : '');
      b.addEventListener('click', function () { sendMessage(o.value, o.label); });
      wrap.appendChild(b);
    });
    log.appendChild(wrap);
    if (record !== false) {
      history.push({ who: 'chips', options: options });
      saveHistory();
    }
    scrollDown();
  }

  var typingEl = null;
  function showTyping(on) {
    if (on && !typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'row bot typing last-bot';
      typingEl.innerHTML = '<div class="mini">' + ICON_TOOTH + '</div><div class="bubble"><i></i><i></i><i></i></div>';
      log.appendChild(typingEl);
      scrollDown();
    } else if (!on && typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var busy = false;

  function sendMessage(value, label) {
    if (busy) return;
    var shown = (label || value).trim();
    if (!shown) return;
    clearChips();
    history = history.filter(function (h) { return h.who !== 'chips'; });
    if (value !== '__start__') addBubble('user', shown);
    busy = true;
    sendBtn.disabled = true;
    showTyping(true);
    var started = Date.now();

    fetch(SERVER + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, message: value }),
    })
      .then(function (r) { return r.json(); })
      .then(async function (data) {
        var msgs = (data && data.messages) || ['Îmi pare rău, a apărut o eroare. Vă rog încercați din nou.'];
        var minWait = 450 - (Date.now() - started);
        if (minWait > 0) await wait(minWait);
        for (var i = 0; i < msgs.length; i++) {
          if (i > 0) {
            showTyping(true);
            await wait(Math.min(900, 250 + msgs[i].length * 4));
          }
          showTyping(false);
          addBubble('bot', msgs[i]);
        }
        addChips(data.options);
        if (!root.classList.contains('open')) badge.style.display = '';
      })
      .catch(function () {
        showTyping(false);
        addBubble('bot', 'Nu mă pot conecta momentan. 😔 Verificați conexiunea la internet sau sunați-ne' + (info.phone ? ' la *' + info.phone + '*' : '') + '.');
        addChips([{ label: '🔄 Încearcă din nou', value: value }]);
      })
      .finally(function () {
        busy = false;
        updateSend();
      });
  }

  // ── deschidere / închidere ──
  var started = history.length > 0;
  function openChat() {
    root.classList.add('open');
    launcher.classList.remove('pulse');
    launcher.setAttribute('aria-label', 'Închide chatul');
    badge.style.display = 'none';
    removeTeaser();
    set(session, 'dcb-open', '1');
    if (!started) {
      started = true;
      sendMessage('__start__');
    }
    setTimeout(function () { if (window.innerWidth > 480) input.focus(); }, 250);
  }
  function closeChat() {
    root.classList.remove('open');
    launcher.setAttribute('aria-label', 'Deschide chatul');
    set(session, 'dcb-open', '0');
  }
  launcher.addEventListener('click', function () { root.classList.contains('open') ? closeChat() : openChat(); });
  $('.minimize').addEventListener('click', closeChat);
  $('.restart').addEventListener('click', function () {
    history = [];
    saveHistory();
    log.innerHTML = '';
    sessionId = uid();
    set(local, 'dcb-session', sessionId);
    sendMessage('__start__');
  });
  shadow.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeChat(); });

  // ── input ──
  function updateSend() { sendBtn.disabled = busy || !input.value.trim(); }
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }
  input.addEventListener('input', function () { updateSend(); autosize(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('form').requestSubmit ? $('form').requestSubmit() : $('form').dispatchEvent(new Event('submit'));
    }
  });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v || busy) return;
    input.value = '';
    autosize();
    sendMessage(v);
  });

  // ── bulă de invitație ──
  var teaser = null;
  function removeTeaser() { if (teaser) { teaser.remove(); teaser = null; } }
  function showTeaser() {
    if (root.classList.contains('open') || get(session, 'dcb-teaser')) return;
    set(session, 'dcb-teaser', '1');
    teaser = document.createElement('div');
    teaser.className = 'teaser';
    teaser.innerHTML = '<button class="x" aria-label="Închide">×</button><b>👋 Bună ziua!</b>Doriți o programare? Vă ajut în mai puțin de un minut.';
    teaser.addEventListener('click', function (e) {
      if (e.target.classList.contains('x')) { e.stopPropagation(); removeTeaser(); return; }
      openChat();
    });
    root.appendChild(teaser);
  }

  // ── pornire ──
  fetch(SERVER + '/api/widget-config')
    .then(function (r) { return r.json(); })
    .then(function (c) {
      info = c;
      $('.title').textContent = (c.botName ? c.botName + ' · ' : '') + c.name;
      var urgent = c.urgentPhone || c.phone;
      if (urgent) $('.note').innerHTML = 'Asistent virtual · Urgențe: <a href="tel:' + esc(urgent.replace(/\s/g, '')) + '">' + esc(urgent) + '</a>';
    })
    .catch(function () {});

  if (history.length) {
    badge.style.display = 'none';
    var day = document.createElement('div');
    day.className = 'day';
    day.textContent = 'Conversația anterioară';
    log.appendChild(day);
    history.forEach(function (h) {
      if (h.who === 'chips') addChips(h.options, false);
      else addBubble(h.who, h.text, h.time, false);
    });
  }
  if (AUTO_OPEN || get(session, 'dcb-open') === '1') openChat();
  else setTimeout(showTeaser, 4000);
})();
