# 🦷 Chatbot pentru clinica dentară — site web + WhatsApp

Asistent virtual în limba română care răspunde pacienților 24/7, face programări, anulează sau reprogramează, răspunde la întrebări despre prețuri, program, adresă, plată, asigurări și recunoaște urgențele.

**Nu are nevoie de nicio bibliotecă externă** — doar Node.js. Nu trebuie rulat `npm install`.

---

## ✨ Ce face botul

| Funcție | Detalii |
|---|---|
| 📅 **Programări** | Întreabă **pentru ce** este programarea → dacă e pacient nou → ziua → ora → nume → telefon → rezumat și confirmare. Primește un cod (ex. `ZB-7K2M`). |
| 🧠 **Înțelege text liber** | „Aș vrea o programare la detartraj vinerea viitoare pe la 10” → completează singur serviciul, ziua și ora. Înțelege „mâine”, „poimâine”, „joi”, „24.10”, „3 noiembrie”, „după 15”, „dimineața”, cu sau fără diacritice. |
| 🕘 **Program configurabil** | Program săptămânal, pauză de prânz, zile închise (sărbători, concedii), program special pe anumite zile, sau **doar anumite date**. Totul din panoul de administrare. |
| 🔒 **Fără suprapuneri** | Nu oferă orele ocupate, ține cont de durata fiecărui serviciu și de câți medici lucrează simultan. Verifică din nou la confirmare. |
| 🚑 **Urgențe** | La „mă doare tare”, „s-a umflat”, „sângerează” → dă telefonul de urgență, avertizează pentru 112 și oferă cel mai apropiat loc liber. |
| 🔁 **Anulare / reprogramare** | După codul programării, numărul de telefon sau automat după numărul de WhatsApp. |
| 💬 **Întrebări frecvente** | Adresă, parcare, plată, rate, asigurări, anestezie, radiografii, garanție etc. — editabile din admin. |
| ✍️ **Mesaje pentru recepție** | Pacientul poate lăsa un mesaj; apare în panoul de administrare. |
| 🤖 **AI opțional** | Cu o cheie API, răspunde inteligent și la întrebări neprevăzute (fără diagnostice, doar pe baza informațiilor clinicii). |

---

## 🚀 Pornire în VS Code (5 minute)

1. **Instalați Node.js** (versiunea 18 sau mai nouă) de pe <https://nodejs.org> — alegeți varianta „LTS”.
2. **Dezarhivați** folderul și deschideți-l în VS Code: *File → Open Folder…*
3. **Copiați fișierul `.env.example` și redenumiți copia în `.env`.** Schimbați parola de admin din el:
   ```
   ADMIN_PASSWORD=parola-mea-sigura
   ```
4. **Apăsați F5** (sau, în terminal: `npm start`).
5. Deschideți în browser:
   - **<http://localhost:3000>** — pagina demo, cu chatul în colțul din dreapta jos
   - **<http://localhost:3000/admin>** — panoul de administrare

Pentru a verifica rapid că totul merge: `npm test` (sau din VS Code: *Run → 🧪 Testează conversațiile*).

---

## 🗓️ Cum schimbați programul și zilele

### Varianta 1 — din panoul de administrare (recomandat)
Deschideți `/admin` → **🕘 Program și zile**:

- **Setări generale** — intervalul dintre programări (ex. 30 min), câți pacienți în paralel, cu câte zile înainte se pot face programări, preaviz minim.
- **Programul săptămânal** — porniți/opriți fiecare zi și setați orele. Folosiți „+ interval” pentru pauza de prânz.
- **Zile închise** — o zi sau o perioadă întreagă (concediu, sărbători).
- **Program special** — o zi cu alt program (ex. 24 decembrie 09:00–12:00 sau o duminică în care lucrați).
- **Doar anumite zile** — dacă adăugați date aici, botul oferă **numai** acele date. Util dacă un medic vine doar în anumite zile.

Apăsați **💾 Salvează programul** și verificați tabelul **Previzualizare** de dedesubt — arată exact ce zile și ore vede pacientul.

### Varianta 2 — direct în fișier
Editați `config/clinic.json` în VS Code. Modificările se aplică automat, fără restart:

```jsonc
"schedule": {
  "slotMinutes": 30,          // la câte minute se oferă orele
  "capacity": 1,              // câți pacienți în același timp
  "bookingWindowDays": 30,    // cu câte zile înainte
  "minNoticeMinutes": 120,    // preaviz minim
  "weekly": {
    "luni":   ["09:00-13:00", "14:00-19:00"],
    "sambata": ["09:00-13:00"],
    "duminica": []            // listă goală = închis
  },
  "closedDates":  ["2026-12-25", "2026-12-26"],
  "specialDates": { "2026-12-24": ["09:00-12:00"] },
  "onlyDates": []             // gol = se folosește programul săptămânal
}
```

Datele se scriu ca `AAAA-LL-ZZ`. Dacă greșiți formatul, serverul vă spune exact unde e greșeala.

### Servicii, prețuri, întrebări frecvente
Tot din admin (**🦷 Servicii și prețuri**, **💬 Întrebări frecvente**) sau din același fișier. **Cuvintele cheie** ajută botul să recunoască serviciul din mesaj (ex. „tartru”, „curățare” → Detartraj). Durata serviciului contează: unul de 60 min ocupă două intervale de 30 min.

---

## 🌐 Punerea chatului pe site-ul clinicii

După ce serverul este online (vezi mai jos), adăugați **o singură linie** înainte de `</body>` pe orice pagină:

```html
<script src="https://adresa-serverului-dvs.ro/widget.js" defer></script>
```

Opțiuni:
```html
<script src="https://.../widget.js" data-color="#1e6fd9" data-position="left" defer></script>
```

Merge cu WordPress (Appearance → Theme File Editor → `footer.php`, sau un plugin de tip „Insert Headers and Footers”), Wix (Custom Code), Webflow, HTML simplu etc.

În `.env`, la `ALLOWED_ORIGINS`, puneți adresa site-ului (ex. `https://clinica-mea.ro`).

---

## 🟢 Conectarea la WhatsApp

Botul folosește **WhatsApp Cloud API** oficial de la Meta. Opțiunile apar ca butoane și liste în WhatsApp.

1. Intrați pe <https://developers.facebook.com> → **My Apps → Create App** → tip **Business** → adăugați produsul **WhatsApp**.
2. În **WhatsApp → API Setup** copiați în `.env`:
   - `WHATSAPP_TOKEN` — tokenul de acces (pentru producție creați un *System User token* permanent în Business Settings)
   - `WHATSAPP_PHONE_NUMBER_ID` — ID-ul numărului de telefon
3. În **App Settings → Basic** copiați **App Secret** în `WHATSAPP_APP_SECRET`.
4. În `.env`, alegeți un text secret pentru `WHATSAPP_VERIFY_TOKEN`.
5. În **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://adresa-serverului-dvs.ro/webhook/whatsapp`
   - Verify token: același text de la pasul 4
   - Abonați-vă la câmpul **messages**
6. Reporniți serverul. Trimiteți „Bună” pe WhatsApp numărului clinicii.

> 💡 **Pentru teste pe calculatorul dvs.**, Meta are nevoie de o adresă publică. Folosiți [ngrok](https://ngrok.com): `ngrok http 3000` și puneți adresa `https://….ngrok-free.app/webhook/whatsapp` în Meta.

Pe WhatsApp botul propune automat numele și numărul pacientului, deci programarea se face și mai repede.

---

## 🤖 Răspunsuri AI (opțional)

Fără AI, botul funcționează complet pe reguli. Dacă doriți să răspundă natural și la întrebări neprevăzute („pot veni cu copilul de 3 ani?”, „ce înseamnă coroană zirconiu?”):

1. Creați o cheie pe <https://console.anthropic.com>
2. În `.env`: `ANTHROPIC_API_KEY=cheia-dvs`

AI-ul primește doar informațiile clinicii, nu pune diagnostice, nu confirmă programări și trimite la telefon când nu știe.

---

## ☁️ Punerea online (24/7)

Orice serviciu care rulează Node.js: **Render**, **Railway**, **Fly.io**, un VPS (DigitalOcean, Hetzner) sau găzduirea cu Node.js de la furnizorul site-ului.

- Comandă de pornire: `npm start`
- Setați variabilele din `.env` în panoul serviciului
- **Important:** programările se salvează în folderul `data/`. Pe serviciile cu disc temporar (ex. Render gratuit), adăugați un *persistent disk* montat pe `data/`, altfel se pierd la repornire.
- Folosiți HTTPS (toate serviciile de mai sus îl oferă automat).

---

## 📁 Structura proiectului

```
config/clinic.json        ← programul, serviciile, prețurile, întrebările frecvente
src/server.js             ← serverul web (API, WhatsApp, admin)
src/bot/engine.js         ← conversația și pașii programării
src/bot/nlu.js            ← înțelegerea textului în română (zile, ore, intenții)
src/bot/scheduler.js      ← calculul orelor libere
src/bot/ai.js             ← răspunsuri AI opționale
src/channels/whatsapp.js  ← integrarea WhatsApp
public/widget.js          ← chatul pentru site
public/admin.html         ← panoul de administrare
public/index.html         ← pagina demo
data/                     ← programări și mesaje (se creează automat)
tests/                    ← teste automate de conversație
```

---

## 🔐 Securitate și GDPR

- Schimbați `ADMIN_PASSWORD` înainte de a pune botul online.
- Botul cere doar datele necesare programării (nume, telefon) și informează pacientul despre scopul lor.
- Menționați chatbot-ul în politica de confidențialitate a clinicii.
- Faceți periodic o copie a folderului `data/`.
