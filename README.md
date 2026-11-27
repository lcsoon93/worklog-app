# Worklog – Gestionale interventi, rapportini e presenze

PWA per una sola azienda: presenze con pause e timer per cliente, interventi e squadre, rapporti di lavoro (anche autonomi) con materiali, foto e firme facoltative, imprevisti e ritorni, magazzino, cartellini mensili con approvazione, storico amministrativo, PDF/Excel/CSV. Pensata per iPhone e tablet, funziona offline.

## Stato

| Area | Stato reale |
|---|---|
| App (tutte le funzioni sopra) | Implementata e coperta da test automatici |
| Demo / GitHub Pages | Dati dimostrativi locali, server di sincronizzazione **simulato** nel browser |
| Versione pilota (`build:pilota`) | Accesso reale con nome utente + PIN (Supabase Auth) e sincronizzazione con Supabase (`sync_apply` / `sync_pull`) |
| Database Supabase "worklog" | Migrazioni 0001–0017 applicate; i dati sincronizzati sono nel registro `app.sync_record` |
| Non ancora realizzato | Tabelle normalizzate alimentate dal registro, Storage per foto e firme, creazione account dall'app, push con app chiusa |
| Non eseguito | Collaudo di sicurezza indipendente; prova documentata con due telefoni reali |

**Non pronto per la produzione**: vedi `docs/18-avvio-produzione.md` §7. Dettaglio per funzione: `docs/01-specifica-funzionale.md` §8.

## Requisiti

- Node.js 20+ (provato con 22) e npm
- Per i test E2E: Chromium per Playwright (`npx playwright install chromium` se non presente)
- Facoltativo: PostgreSQL 16 locale per verificare lo schema (`database/README.md`)

## Avvio

```bash
cd prototype
npm install
npm run dev            # http://localhost:5173 – dati demo, server simulato
```

Account demo (PIN `123456`): `marco.rossi@demo.local` (operaio), `laura.bianchi@demo.local` (amministratrice), Luca Ferri (operaio con gestione operativa). Pagina **Sync → Ripristina dati demo** per ricominciare.

Versione pilota con Supabase: copiare `prototype/.env.pilota.example` in `prototype/.env.pilota.local`, inserire URL e chiave pubblica (mai nel repository) e compilare con `npm run build:pilota`. Configurazione e ambienti: `docs/17-rilascio-e-configurazione.md`.

## Comandi (cartella `prototype/`)

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Server di sviluppo |
| `npm run typecheck` | TypeScript strict, senza compilare |
| `npm test` | Test Vitest (dominio, servizi, sincronizzazione, PDF) |
| `npm run test:e2e` | Test Playwright su tablet e iPhone (compila e avvia la preview) |
| `npm run build` / `npm run preview` | Build demo con Service Worker, anteprima su :4173 |
| `npm run build:pilota` / `build:produzione` | Build con variabili `.env.pilota*` / `.env.produzione*` |
| `TZ=Europe/Rome npx vite-node scripts/genera-esempi-pdf.ts esempi-pdf` | PDF di esempio dai dati demo |

## Struttura

```
.
├── database/            migrazioni SQL 0001–0017, schema.sql generato, test SQL, script di avvio
├── docs/                01–18: specifica, flussi, architettura, dati, motore ore, cartellini,
│                        sincronizzazione, PDF, test, decisioni (11), rilascio (17), produzione (18)
├── .github/workflows/   pubblicazione su GitHub Pages
└── prototype/           PWA React 18 + TypeScript + Vite
    └── src/
        ├── domain/      logica pura: tipi, motore ore, cartellino, magazzino
        ├── data/        IndexedDB, coda di scrittura, UnitOfWork, outbox, dati demo
        ├── sync/        motore di sincronizzazione, server simulato, client Supabase (dati e accesso)
        ├── services/    casi d'uso: unico punto d'accesso ai dati per la UI
        ├── reports/     modelli e generazione PDF, Excel, CSV
        ├── shared/      errori comuni
        ├── config/      ambiente, accesso, dati azienda
        ├── ui/          componenti riusabili e stili
        ├── pages/       schermate (operaio, admin, condivise)
        └── app/         router, layout, contesto, PWA
```

Le dipendenze tra moduli sono a senso unico (dominio → dati → sincronizzazione → servizi → interfaccia); le regole sono in `docs/03-architettura.md` §2.

## Regole del repository

- Nessuna credenziale o chiave nel repository: i valori reali vanno nei file `.env.*.local` (ignorati da git).
- Le migrazioni si applicano al progetto Supabase solo con autorizzazione esplicita.
- Decisioni tecniche e questioni aperte: `docs/11-decisioni-tecniche.md`. Piano ed esiti dei test: `docs/10-piano-test-funzionali.md`.
