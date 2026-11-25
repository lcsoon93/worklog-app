# 10 – Piano test funzionali

Ambito: comportamento funzionale. **Esclusi per decisione del committente**: security audit, penetration test, test RLS/autorizzazione, scansioni di vulnerabilità, audit delle dipendenze, test di esposizione dati e di autenticazione.

## 1. Livelli di test

| Livello | Strumento | Cosa copre | Comando |
|---|---|---|---|
| Unità – dominio | Vitest | Motore ore, algebra intervalli, macchina a stati | `cd prototype && npm test` |
| Funzionale – servizi | Vitest + storage in memoria | Stesso codice applicativo dell'app (servizi, UnitOfWork, sync, server simulato) senza browser | `npm test` |
| End-to-end | Playwright + Chromium, orologio controllato | Simulazione completa nel browser sul prototipo compilato (IndexedDB e Service Worker reali) | `npm run test:e2e` |
| Database | `psql` su PostgreSQL 16 **locale** usa-e-getta | Vincoli, trigger, regole di integrità dello schema | vedi `database/README.md` |
| Manuale | Tablet/browser | Aspetto, foto da fotocamera, firma a dito, installazione PWA | checklist §4 |

## 2. Esito dell'ultima esecuzione (25/11/2026)

| Suite | Eseguiti | Superati | Falliti |
|---|---|---|---|
| Vitest (4 file) | 41 | 41 | 0 |
| Playwright E2E (Chromium, profilo Galaxy Tab S4) | 3 | 3 | 0 |
| Verifica regole SQL (PostgreSQL 16.15 locale) | 28 controlli | 28 | 0 |
| Typecheck `tsc --noEmit` (strict) | — | OK | — |
| Build di produzione + Service Worker | — | OK | — |
| Navigazione di tutte le schermate con raccolta errori console | 27 schermate | 0 errori | — |

Problemi trovati dai test e corretti durante la Fase 1:

1. Rilevazione "online" errata fuori dal browser (`navigator.onLine` non definito → tutto offline). Corretto.
2. Generazione del cartellino non bloccata con giornate aperte da più di 24 h (il motore le classifica "non valide" e l'anomalia "aperta" non compariva). Il controllo ora interroga direttamente le presenze.
3. **Ordine della coda**: operazioni dello stesso salvataggio ordinate per timestamp uguale + id casuale → una foto poteva partire prima del suo rapportino. Introdotto `seq` monotono.
4. Collisione di nome `versione` (versione di riga vs versione del cartellino) trovata dal typecheck → `row_version`.
5. Dialoghi che non si chiudevano dopo operazioni riuscite senza valore di ritorno (`run()` restituiva `undefined` sia per successo che per errore) → introdotto `runOk()` booleano.
6. Imprevisto: intervento preselezionato sbagliato quando il timer era su un cliente senza intervento.
7. Dati demo con buchi artificiali che segnalavano "ore non attribuite" quasi ogni giorno; ritorni demo eccessivi.

## 3. Casi di test

Legenda esito: ✅ eseguito e superato · 📝 da eseguire manualmente · ⏭ non applicabile in Fase 1.

| # | Caso richiesto | Test | Verifica | Esito |
|---|---|---|---|---|
| 1 | Entrata e uscita | T01, T14, E2E-1 | entrata unica, no orari futuri, uscita > entrata, totali | ✅ |
| 2 | Pause multiple | E6, E12, E16, T01 | unione delle pause, sovrapposte contate una volta, pausa aperta chiusa all'uscita | ✅ |
| 3 | Cambio attività | E2, T01, E2E-1 | chiusura e apertura nello stesso istante | ✅ |
| 4 | Cambio cliente | T01, E2E-1 | ripartizione per cliente corretta | ✅ |
| 5 | Attività interne | E4, T01 | ripartizione per codice | ✅ |
| 6 | Timer attivo alla riapertura | T06 (nuova istanza su stesso storage), E2E-1 (reload della pagina) | durata ricostruita dai timestamp | ✅ |
| 7 | Timer interrotto | T01 (ferma → tempo scoperto), E9 (non fermato → chiuso all'uscita) | | ✅ |
| 8 | Attività sovrapposte | E3; T09 (rifiuto inserimento sovrapposto) | contate una volta + anomalia; inserimenti manuali sovrapposti rifiutati | ✅ |
| 9 | Attività oltre mezzanotte | E7, T13 | giorno dell'entrata, durate corrette | ✅ |
| 10 | Correzione intervallo | T09–T11, E2E-1 (divisione) | nuova riga, originale nello storico, motivo obbligatorio | ✅ |
| 11 | Ore non attribuite | E5, T01, T09 | da classificare + scoperto | ✅ |
| 12 | Fine giornata | T01, T07, E2E-1 | timer/pausa chiusi all'uscita; giornata non chiusa proposta al giorno dopo | ✅ |
| 13 | Conferma operaio | T15, E2E-1 | solo titolare; stato locale → ricezione server | ✅ |
| 14 | Approvazione amministratore | T15, E2E-1 | versione approvata registrata, storico con utente | ✅ |
| 15 | Richiesta correzione | T15, T19, E2E-2 | motivazione obbligatoria, mese sbloccato, nuova versione | ✅ |
| 16 | Riapertura cartellino | T15, E2E-2 | motivazione, versione approvata conservata, v+1 | ✅ |
| 17 | Rapportino autonomo | T22 | senza intervento; firma obbligatoria nel completo | ✅ |
| 18 | Rapportino da intervento | T21 | ore dalle attività, stato intervento aggiornato, numero dal server | ✅ |
| 19 | Ritorno collegato | T23, E2E-1 | followup → intervento ritorno → rapportino che chiude | ✅ |
| 20 | Simulazione offline | T24, T25, T26, T27, E2E-3 | coda, errore+backoff, idempotenza, conflitto | ✅ |
| — | Cambio ora legale | E14 | | ✅ |
| — | Mese bloccato | T15, verifica SQL | | ✅ |
| — | Scrittura locale fallita | T28 | nessun dato mostrato come salvato | ✅ |
| — | Coerenza dati demo | T29 | invarianti su ogni giornata, impronte dei cartellini riproducibili | ✅ |
| — | Proprietà del motore | 1000 giornate casuali | invarianti §2 di docs/06 | ✅ |

### 3.1 Elenco dei test automatici

Unità/servizi (`prototype/tests/unit`):

- `hours-engine.test.ts`: algebra intervalli; E1–E17; formattazione; invarianti su 1000 giornate.
- `workday.test.ts`: T01–T05 giornata completa; T06 timer alla riapertura; T07 giornata non chiusa; T08 attività durante pausa; T09–T11 correzioni; T12 correzione entrata con valore originale; T13 mezzanotte; T14 validazioni.
- `timesheet.test.ts`: regole della macchina a stati; T15–T18 flusso completo con correzione, approvazione, riapertura e versioni; T19 discrepanza e rifiuto; T20 blocco per giornate aperte.
- `reports-sync.test.ts`: T21–T23 rapportini e ritorni; T24–T28 offline e sincronizzazione; T29 dati demo.

End-to-end (`prototype/tests/e2e/giornata-completa.spec.ts`), orologio fissato al 24/11/2026 08:00:

1. **Giornata completa e approvazione**: login operaio → entrata → timer cliente → 1 h → ferma → cambio cliente → ricarica pagina (timer ricostruito) → pausa → ripresa → imprevisto → rapportino rapido con ritorno (numero definitivo dal server) → fine giornata → riepilogo (netta 3:15) → divisione di un'attività (storico conservato) → conferma cartellino (in attesa solo dopo ricezione server) → tutto sincronizzato → login admin → giornata dell'operaio → rapportino → ritorno da pianificare → verifica e approvazione cartellino → nessun errore JavaScript.
2. **Correzione e riapertura**: richiesta correzione con motivazione obbligatoria; riapertura di un approvato, nuova versione, versione approvata ancora indicata.
3. **Offline**: rete simulata assente → entrata e timer → coda visibile → rete ripristinata → tutto sincronizzato.

## 4. Checklist manuale (da eseguire su tablet reale)

| # | Prova | Esito |
|---|---|---|
| M1 | Installazione PWA da Chrome Android / Safari iPadOS, apertura a schermo intero | 📝 |
| M2 | Apertura senza rete dopo la prima visita (app shell dalla cache) | 📝 (build e Service Worker generati; non provato su dispositivo) |
| M3 | Foto con fotocamera posteriore nel rapportino e nell'imprevisto | 📝 |
| M4 | Firma con dito e penna; leggibilità in piena luce | 📝 |
| M5 | Uso con guanti da lavoro sottili (bersagli touch) | 📝 |
| M6 | Orientamento verticale e orizzontale; smartphone 390 px | 🟡 verificato solo a schermo (screenshot 390 px) |
| M7 | Tema scuro automatico | 📝 |
| M8 | Chiusura forzata dell'app con timer attivo e riapertura dopo ore | 📝 (coperto da T06/E2E in emulazione) |
| M9 | PDF giornaliero e mensile: apertura su iPad/Android, stampa A4 su carta, margini e leggibilità | 📝 (verificato solo a schermo: rendering pagina per pagina) |

## 5. Fase 2 – Esportazione PDF (eseguiti il 25/11/2026)

| Suite | Eseguiti | Superati |
|---|---|---|
| Vitest complessivo (Fase 1 + PDF) | 64 | 64 |
| di cui `riepiloghi.test.ts` (modello + testo estratto dai PDF reali con pdfjs) | 22 | 22 |
| Playwright E2E complessivo | 6 | 6 |
| di cui `riepiloghi-pdf.spec.ts` (download reale nel browser + confronto con i valori mostrati) | 3 | 3 |
| Controllo visivo di 3 PDF campione (27 pagine renderizzate) | — | 1 difetto trovato e corretto |

| Caso richiesto | Test |
|---|---|
| Giornata completa / più clienti / attività interne | R01, R09, E2E-PDF-1 |
| Pause multiple | R02 |
| Ore non attribuite | R03 |
| Rapportini multipli / nessun rapportino | R04, R09 |
| Dati incompleti | R05, R10 |
| Turno oltre mezzanotte | R06, R18 |
| Intervalli sovrapposti | R07 |
| Filtri che escludono giorni/operai sbagliati | R08 |
| Giornata senza presenze | R11, E2E-PDF-3 |
| Mese completo / totali coerenti con il cartellino | R12 |
| Giorni senza presenza | R13 |
| Più clienti e attività interne nel mese | R14 |
| Correzioni | R15 |
| Mese non approvato / approvato | R16, R20, R21, E2E-PDF-2, E2E-PDF-3 |
| Dati incompleti nel mese | R17 |
| Cambio mese e anno | R18 |
| Esclusione di altri mesi | R19 |
| Più pagine, numerazione, caratteri accentati, totali | R09, R20 |
| Tabelle non tagliate | R22 (`headerRows`/`dontBreakRows` su tutte le tabelle) + controllo visivo |
| Download effettivo | E2E-PDF-1/2/3 (evento di download, file analizzato) |
| Contenuto = dati visualizzati | E2E-PDF-1 (riepilogo giornata ↔ anteprima ↔ PDF), E2E-PDF-2/3 |
| Offline | E2E-PDF-2 (export con rete simulata assente, avviso nel PDF) |
| Turno notturno non segnalato come "non chiuso" (correzione Fase 1) | T07b |

Difetti trovati e corretti in Fase 2: tabella dei totali spezzata tra due pagine (resa indivisibile); riquadro dello stato di approvazione vuoto nell'ultima pagina del mensile (stesso nodo riusato due volte; trovato dal controllo visivo, ora coperto da R21); logo troppo vicino al testo dell'intestazione.

Non verificato: stampa fisica su carta e visualizzazione del PDF su iPad/Android (checklist manuale M9: aprire, stampare e verificare margini).

## 6. Come aggiungere test in Fase 2

- Ogni nuova regola del motore → esempio numerato in docs/06 + test con lo stesso numero.
- Ogni regola di business lato server → riga in `database/tests/verifica_regole.sql`.
- I test E2E devono usare `page.clock` per evitare dipendenze dall'ora reale.
