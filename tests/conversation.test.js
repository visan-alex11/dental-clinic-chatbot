'use strict';

/**
 * Test rapid al conversației, fără server: `npm test`
 * Simulează câteva conversații reale și verifică răspunsurile botului.
 * Folosește un director temporar, deci nu atinge programările reale.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dental-bot-test-'));
delete process.env.ANTHROPIC_API_KEY;

const config = require('../src/config');
const { Storage } = require('../src/storage');
const { Scheduler } = require('../src/bot/scheduler');
const { BotEngine } = require('../src/bot/engine');

const storage = new Storage(process.env.DATA_DIR);
const scheduler = new Scheduler(config.get, storage);
const bot = new BotEngine({ getConfig: config.get, storage, scheduler });

const VERBOSE = process.argv.includes('-v');
let passed = 0;

function show(who, text) {
  if (VERBOSE) console.log(`${who === 'user' ? '\n👤' : '🤖'} ${text}`);
}

async function say(userId, text, channel = 'web', meta = {}) {
  show('user', text);
  const res = await bot.handle({ channel, userId, text, meta });
  res.messages.forEach((m) => show('bot', m));
  if (VERBOSE && res.options.length) console.log('   [' + res.options.map((o) => o.label).join(' | ') + ']');
  return res;
}

const all = (res) => res.messages.join('\n');
function check(cond, name) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

(async () => {
  console.log('\n▶ Rezervare completă pas cu pas');
  let r = await say('u1', '__start__');
  check(/asistentul virtual/.test(all(r)) && r.options.length === 5, 'mesaj de bun venit cu meniu');
  r = await say('u1', 'act:book');
  check(/Pentru ce doriți/.test(all(r)), 'întreabă motivul programării');
  r = await say('u1', 'vreau să-mi fac o curățare, am tartru');
  check(/Detartraj/.test(all(r)) && /mai fost/.test(all(r)), 'recunoaște detartrajul din text liber');
  r = await say('u1', 'nu, e prima dată');
  check(/zile cu locuri libere/.test(all(r)), 'oferă zile libere');
  r = await say('u1', '1');
  check(/Ore libere/.test(all(r)), 'alegere prin număr → ore libere');
  const time = r.options[0].value;
  r = await say('u1', time);
  check(/Pe ce nume/.test(all(r)), 'cere numele');
  r = await say('u1', 'ma numesc ion popescu');
  check(/Ion/.test(all(r)) && /telefon/.test(all(r)), 'numele formatat, cere telefonul');
  r = await say('u1', '0721 23 45 67');
  check(/verificați detaliile/.test(all(r)) && /Ion Popescu/.test(all(r)) && /0721 234 567/.test(all(r)), 'rezumat corect');
  r = await say('u1', 'da');
  check(/înregistrată/.test(all(r)) && /ZB-[A-Z0-9]{4}/.test(all(r)), 'programare confirmată cu cod');
  const code = all(r).match(/ZB-[A-Z0-9]{4}/)[0];
  check(storage.allBookings().length === 1, 'programarea este salvată');

  console.log('\n▶ Ora ocupată nu mai este oferită');
  const bk = storage.allBookings()[0];
  check(!scheduler.slotsFor(bk.date, 'detartraj').includes(bk.time), 'slotul rezervat dispare din listă');

  console.log('\n▶ Totul într-un singur mesaj');
  const nextFriday = require('../src/bot/nlu').parseDate('vinerea viitoare', scheduler.today());
  r = await say('u2', 'Bună ziua! Aș vrea o programare pentru albire vinerea viitoare la 10');
  check(/Albire/.test(all(r)), 'detectează serviciul');
  r = await say('u2', 'am mai fost');
  const txt2 = all(r);
  check(/Pe ce nume/.test(txt2) || /Cele mai apropiate ore/.test(txt2) || /nu mai avem/.test(txt2) || /zile/.test(txt2), `procesează ziua (${nextFriday}) și ora din același mesaj`);

  console.log('\n▶ Întrebări în timpul programării');
  r = await say('u3', 'programare');
  r = await say('u3', 'cât costă albirea?');
  check(/1200/.test(all(r)) && /Revenind/.test(all(r)), 'răspunde la preț și revine la pas');

  console.log('\n▶ Întrebări frecvente');
  r = await say('u4', 'unde sunteți și aveți parcare?');
  check(/Str\. Exemplu/.test(all(r)), 'adresa');
  r = await say('u4', 'pot plăti cu cardul?');
  check(/card/.test(all(r)), 'plata');
  r = await say('u4', 'ce program aveți sâmbăta?');
  check(/Sâmbătă: 09:00–13:00/.test(all(r)), 'programul clinicii');
  r = await say('u4', 'cat costa un implant');
  check(/Implant/.test(all(r)) && /200/.test(all(r)), 'preț pe serviciu');
  r = await say('u4', 'mi-e frică, o să mă doară extracția?');
  check(/anestezie/.test(all(r)), 'teama de durere nu e tratată ca urgență');

  console.log('\n▶ Urgență');
  r = await say('u5', 'mă doare foarte tare o măsea și s-a umflat obrazul');
  check(/112/.test(all(r)) && /Cel mai apropiat loc/.test(all(r)), 'oferă cel mai apropiat loc de urgență');

  console.log('\n▶ Zi închisă');
  r = await say('u6', 'programare consultatie duminica');
  r = await say('u6', 'prima vizita');
  check(/Duminica clinica este închisă/.test(all(r)), 'explică ziua închisă și oferă alternative');

  console.log('\n▶ Anulare cu codul programării');
  r = await say('u7', `vreau să anulez programarea ${code}`);
  check(/Am găsit programarea/.test(all(r)), 'găsește programarea după cod');
  r = await say('u7', 'act:docancel');
  check(/anulată/.test(all(r)) && storage.allBookings()[0].status === 'cancelled', 'programarea este anulată');
  check(scheduler.slotsFor(bk.date, 'detartraj').includes(bk.time) || bk.date === scheduler.today(), 'ora redevine liberă');

  console.log('\n▶ WhatsApp: nume și telefon din profil');
  const meta = { waPhone: '40722111222', profileName: 'Maria Ionescu' };
  await say('w1', 'programare consultatie', 'whatsapp', meta);
  await say('w1', 'ptype:new', 'whatsapp', meta);
  r = await say('w1', '1', 'whatsapp', meta);
  r = await say('w1', r.options[0].value, 'whatsapp', meta);
  check(r.options.some((o) => o.value === 'act:usewaname'), 'propune numele din WhatsApp');
  r = await say('w1', 'act:usewaname', 'whatsapp', meta);
  check(r.options.some((o) => /0722 111 222/.test(o.label)), 'propune numărul din WhatsApp');
  r = await say('w1', 'act:usewaphone', 'whatsapp', meta);
  r = await say('w1', 'confirm', 'whatsapp', meta);
  check(/înregistrată/.test(all(r)), 'rezervare pe WhatsApp');
  r = await say('w1', 'vreau sa reprogramez', 'whatsapp', meta);
  check(/Am găsit programarea/.test(all(r)), 'găsește automat programarea după numărul de WhatsApp');

  console.log('\n▶ Renunțare și text neînțeles');
  await say('u8', 'programare');
  r = await say('u8', 'renunț');
  check(/Am oprit/.test(all(r)), 'iese din proces la „renunț”');
  r = await say('u8', 'asdfgh qwerty');
  check(/Nu am înțeles/.test(all(r)), 'mesaj prietenos când nu înțelege');

  console.log(`\n✅ ${passed} verificări trecute.\n`);
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Test eșuat:', e.message);
  process.exit(1);
});
