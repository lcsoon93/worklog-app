# Gestionale Interventi, Rapportini e Presenze – prototipo (Fasi 1–9)

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

### Gestione operativa (Fase 3)

- **Riprendi**: dopo *Ferma* la dashboard propone *Riprendi <ultima attività>*.
- **Riepilogo giornata** (*Oggi → Riepilogo giornata*): riquadro *Verifica della giornata* con sincronizzazione, stato del cartellino, *Richiedi correzione* e *PDF della giornata*.
- **Cartellino**: sezione *Dettaglio del mese* con attività, correzioni e richieste.
- **Amministratore**: le richieste aperte compaiono in dashboard (*Da fare → Gestisci*). Dettagli: `docs/14-gestione-operativa.md`.

### Report e analisi (Fase 6)

- **Amministratore**: menu *Analisi* → viste *Dashboard*, *Presenze e personale*, *Interventi e clienti*, *Economico*; filtri per periodo, lavoratore, cliente, sede, intervento, tipologia e stato; esportazione **PDF**, **Excel** (un foglio per tabella) e **CSV**. Dettagli: `docs/16-report-aziendali.md`.

### App installabile, notifiche e offline (Fase 7)

- Campanella in alto: notifiche e promemoria (interventi assegnati, modificati e imminenti, rapportini da completare, cartellini, scorte). *Notifiche → Attiva avvisi* abilita gli avvisi di sistema.
- Su smartphone la barra in basso ha la voce *Menu* con tutte le sezioni. Indicatore di sincronizzazione sempre visibile; banner per aggiornamenti, conflitti ed errori.
- Installazione su tablet, offline, aggiornamenti, configurazione per ambiente, backup: `docs/17-rilascio-e-configurazione.md`. Avvio in produzione (non attivato): `docs/18-avvio-produzione.md`.

### Magazzino, materiali e costi (Fase 5)

- **Operaio** (Marco): *Rapportini → nuovo* → sezione *Materiali → Da magazzino*, cercare un articolo, impostare quantità e magazzino (proposto il suo furgone; avviso se la giacenza non basta) → *Completa*: il materiale viene scaricato. Nel rapportino completato *Correggi* registra una correzione motivata senza toccare il documento.
- **Amministratore** (Laura): menu *Magazzino* → *Panoramica* (valore giacenze, sotto scorta, ultimi movimenti, consumi e costi del mese), *Materiali e giacenze* (anagrafica, filtri, magazzini), *Movimenti* (carico, scarico, rettifica, trasferimento, storico), *Costi e consumi* (per cliente, intervento, materiale, lavoratore, tipologia). Sotto scorta anche in dashboard (*Da fare*); costo materiali nella scheda intervento e nel *Report* mensile.
- Dettagli e regole: `docs/15-magazzino-materiali-costi.md`.

### Esportazione PDF (Fase 2)

- **Operaio**: dashboard → *I miei riepiloghi* (o voce *Riepiloghi* nel menu). Scegliere *Riepilogo giornaliero* (giorno) o *Riepilogo mensile* (mese), controllare l'anteprima, poi *Anteprima PDF* o *Esporta … PDF*.
- **Amministratore**: dashboard → *Report presenze* (o *PDF presenze* nel menu). Scegliere l'operaio, il giorno o il mese, ed esportare. Dal cartellino si arriva direttamente al PDF mensile.
- Un mese non approvato produce un PDF **provvisorio** (filigrana e suffisso nel nome file). Dettagli: `docs/13-esportazione-pdf.md`.
- PDF di esempio dai dati demo: `cd prototype && TZ=Europe/Rome npx vite-node scripts/genera-esempi-pdf.ts esempi-pdf`.

## Test

```bash
cd prototype
npm test             # 85 test Vitest: motore ore, servizi, cartellini, rapportini, rapporto autonomo, sincronizzazione, PDF, magazzino, report, configurazione, accesso con PIN
npm run test:e2e     # 15 test Playwright nel browser (tablet e iPhone) (compila e avvia la preview se necessario)
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
│   ├── 12-roadmap-sviluppo.md
│   ├── 13-esportazione-pdf.md     Fase 2: PDF giornaliero e mensile
│   ├── 14-gestione-operativa.md   Fase 3: richieste di correzione, verifica giornata, dettaglio mese
│   ├── 15-magazzino-materiali-costi.md  Fase 5: materiali, giacenze, consumi, costi
│   ├── 16-report-aziendali.md     Fase 6: report, filtri, esportazioni PDF/Excel/CSV
│   ├── 17-rilascio-e-configurazione.md  Fasi 7–8: PWA, offline, notifiche, ambienti, backup, rilascio
│   └── 18-avvio-produzione.md     Fase 9: infrastruttura, dati iniziali, utenti, costi, autorizzazioni
├── database/
│   ├── migrations/0001…0010_*.sql migrazioni (solo preparate, mai applicate a DB remoti)
│   ├── schema.sql                 generato da build-schema.sh
│   ├── er-diagram.mmd
│   ├── avvio-produzione/          modelli di inizializzazione e import (non eseguiti)
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

Non sono state eseguite verifiche di sicurezza (escluse da tutte le fasi). Nel repository non ci sono credenziali: le variabili sono documentate in `prototype/.env.example`; i valori reali vanno in `prototype/.env.production.local` (ignorato da git). **Il progetto non è pronto per la produzione**: vedi `docs/18-avvio-produzione.md` §7.
