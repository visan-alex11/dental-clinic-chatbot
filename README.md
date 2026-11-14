# 🦷 Dental Clinic Chatbot (website + WhatsApp)

A virtual assistant for a dental clinic that talks to patients **in Romanian**, 24/7. It books, cancels and reschedules appointments, answers common questions (prices, opening hours, address, payment, insurance) and recognises emergencies.

It runs on **plain Node.js with zero external dependencies**: no `npm install` needed.

> 📖 Detailed setup guide (Romanian): [README.ro.md](README.ro.md)
> The clinic in `config/clinic.json` ("Clinica Dentară Zâmbet") is a fictional demo clinic.

---

## ✨ Features

| Feature | What it does |
|---|---|
| 📅 **Appointment booking** | Guided flow: service → new or returning patient → day → time → name → phone → summary and confirmation. Each booking gets a code (e.g. `ZB-7K2M`). |
| 🧠 **Understands free text** | "Aș vrea o programare la detartraj vinerea viitoare pe la 10" → fills in the service, day and time by itself. Understands relative dates ("mâine", "joi"), exact dates ("24.10", "3 noiembrie"), time ranges ("după 15", "dimineața"), with or without Romanian diacritics. |
| 🔒 **No double bookings** | Only offers free slots, takes each service's duration and the number of doctors into account, and re-checks availability at confirmation. |
| 🕘 **Configurable schedule** | Weekly hours, lunch breaks, closed days (holidays), special hours on specific dates, or "only these dates" mode. Editable from the admin panel; changes apply without a restart. |
| 🚑 **Emergencies** | Messages like "mă doare tare" or "sângerează" get the emergency phone number, a 112 warning and the nearest free slot. |
| 🔁 **Cancel / reschedule** | By booking code, by phone number, or automatically by the patient's WhatsApp number. |
| 💬 **FAQ** | Address, parking, payment, instalments, insurance, anaesthesia, X-rays, warranty and more; editable from the admin panel. |
| ✍️ **Messages for reception** | Patients can leave a message that shows up in the admin panel. |
| 🤖 **Optional AI answers** | With an Anthropic API key, the bot can also answer unexpected questions, using only the clinic's own information and never giving diagnoses. Without a key, it works fully on rules. |

## 🧱 How it's built

```
src/
├── server.js          HTTP server: website widget API, admin API, WhatsApp webhook
├── config.js          Loads and validates config/clinic.json (hot reload)
├── storage.js         JSON file storage for bookings and messages
├── bot/
│   ├── engine.js      Conversation state machine (booking, cancel, FAQ, emergencies)
│   ├── nlu.js         Intent detection and date/time parsing for Romanian text
│   ├── scheduler.js   Free-slot calculation, capacity and overlap checks
│   └── ai.js          Optional AI fallback for open questions
├── channels/
│   └── whatsapp.js    WhatsApp Cloud API (Meta) integration
└── utils/             Text normalisation (diacritics) and time-zone helpers
public/
├── index.html         Demo page with the chat widget
├── widget.js          Embeddable chat widget (one <script> tag on any site)
└── admin.html         Admin panel: bookings, messages, schedule, FAQ
tests/
└── conversation.test.js   30 end-to-end conversation checks
```

**Tech:** Node.js 18+, vanilla JavaScript, HTML/CSS, JSON storage, WhatsApp Cloud API, Anthropic API (optional).

## 🚀 Run it locally

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. Copy `.env.example` to `.env` and set your own `ADMIN_PASSWORD`.
3. Start the server:
   ```bash
   npm start
   ```
4. Open:
   - <http://localhost:3000>: demo page with the chat in the bottom-right corner
   - <http://localhost:3000/admin>: admin panel

## 🧪 Tests

```bash
npm test
```

Runs 30 scripted conversations covering booking, free-text understanding, overlaps, cancellation, rescheduling, WhatsApp and edge cases.

## 🔐 Security notes

- `.env` (passwords and API keys) and `data/` (bookings and messages) are excluded by `.gitignore` and never committed.
- Change `ADMIN_PASSWORD` and restrict `ALLOWED_ORIGINS` before putting the bot online.
- WhatsApp webhook requests are verified with the Meta App Secret.

## 👤 Author

**Alexandru Robert Vișan**: built as a learning project with the help of AI tools.

## 📄 License

[MIT](LICENSE)
