# Gestionale Interventi, Rapportini e Presenze – Fase 1

Gestionale per una sola azienda: presenze giornaliere con timer per cliente, interventi programmati con squadre, rapportini con foto e firme, imprevisti e ritorni, cartellino mensile con doppia approvazione. PWA pensata per tablet, offline dalla progettazione.

> **Prototipo con dati dimostrativi locali.** Nessun backend di produzione: i dati vivono in IndexedDB del browser e la sincronizzazione avviene verso un **server simulato** nel browser. L'accesso è simulato (password unica `demo`). Persone e aziende sono di fantasia.

## Avvio rapido del prototipo

Requisiti: Node.js 20+ (provato con 22) e npm.

```bash
cd prototype
npm install
npm run dev          # http://localhost:5173  (anche da tablet in rete: usare l'indirizzo IP mostrato)
```

Versione di produzione con Service Worker (installabile, funziona offline dopo la prima apertura):

```bash
npm run build
npm run preview      # http://localhost:4173
```

Accesso: nella schermata di login toccare un account.

| Account | Ruolo | Uso consigliato |
|---|---|---|
| Marco Rossi – `marco.rossi@demo.local` | Operaio | Non ha ancora timbrato oggi: simulare la giornata |
| Laura Bianchi – `laura.bianchi@demo.local` | Amministratrice | Dashboard, agenda, cartellini, report |
| Luca Ferri, Andrea Conti, Paolo Greco | Operai | Cartellini del mese scorso in stati diversi |

Password per l'accesso manuale: `demo`. Per ricominciare da capo: pagina **Sync → Ripristina dati demo**.

### Percorso dimostrativo suggerito

1. **Marco** → *Registra entrata* → *Avvia attività* → scheda *Cliente* → scegliere un cliente → *Avvia*.
2. *Ferma* → *Avvia attività* su un altro cliente (cambio cliente) → *Pausa* → *Riprendi*.
3. *Imprevisto* → *Rapportino rapido* → *Riepilogo giornata*: correggere/dividere un'attività → *Termina giornata*.
4. *Cartellino* → mese scorso → *Confermo, è corretto* (diventa "In attesa di approvazione" quando il server simulato la riceve).
5. Esci → **Laura** → dashboard → squadra di oggi → rapportini → *Ritorni* → *Cartellini* → Marco → *Approva*.
6. Pagina **Sync**: attivare "Dispositivo offline", lavorare, riattivare la rete e osservare la coda.

## Test

```bash
cd prototype
npm test             # 41 test Vitest: motore ore, servizi, cartellini, rapportini, sincronizzazione
npm run test:e2e     # 3 test Playwright nel browser (compila e avvia la preview se necessario)
npm run typecheck
```

Verifica dello schema SQL su PostgreSQL locale: `database/README.md`. Esiti dell'ultima esecuzione: `docs/10-piano-test-funzionali.md`.

## Struttura

```
.
├── README.md
├── docs/                          documentazione di progetto (12 documenti)
│   ├── 01-specifica-funzionale.md
│   ├── 02-flussi-operativi.md
│   ├── 03-architettura.md
│   ├── 04-modello-dati.md
│   ├── 05-dizionario-dati.md      generato dal catalogo del database
│   ├── 06-motore-calcolo-ore.md
│   ├── 07-cartellini-approvazioni.md
│   ├── 08-offline-sincronizzazione.md
│   ├── 09-report-documenti.md
│   ├── 10-piano-test-funzionali.md
│   ├── 11-decisioni-tecniche.md
│   └── 12-roadmap-sviluppo.md
├── database/
│   ├── migrations/0001…0007_*.sql migrazioni (solo preparate, mai applicate a DB remoti)
│   ├── schema.sql                 generato da build-schema.sh
│   ├── er-diagram.mmd
│   ├── tests/verifica_regole.sql
│   └── genera-dizionario.py
└── prototype/                     PWA React + TypeScript + Vite
    ├── src/domain/                logica pura (motore ore, workflow cartellino)
    ├── src/data/                  IndexedDB, UnitOfWork, dati demo
    ├── src/sync/                  sincronizzazione + server simulato
    ├── src/services/              casi d'uso
    ├── src/ui/, src/pages/        componenti e 25+ schermate
    └── tests/unit, tests/e2e
```

## Stato

Consulta `docs/01-specifica-funzionale.md §8` per la distinzione tra progettato, implementato, simulato, verificato e non ancora realizzato, e `docs/11-decisioni-tecniche.md` per le decisioni che richiedono approvazione.

Non sono state eseguite verifiche di sicurezza (escluse dalla Fase 1). Nel repository non ci sono credenziali; la configurazione futura di Supabase andrà in `prototype/.env.local` (ignorato da git).
