# 14 – Fase 3: gestione operativa di presenze, attività e cartellini

Stato: **implementato** nel prototipo e **verificato** con test mirati. I dati sono locali (IndexedDB) e la sincronizzazione avviene verso il **server simulato**: Supabase non è collegato.

## 1. Cosa esisteva già (Fasi 1–2) e non è stato riscritto

Entrata/uscita, pause e ripresa; più presenze nello stesso giorno; turni oltre mezzanotte; calcolo ore lorde/nette dal motore centrale; correzioni con motivo e storico; recupero dei timer dopo la chiusura; timer per cliente/sede/intervento; attività interne, trasferimenti, non attribuite; inserimento e correzione manuale; cartellino con una riga per giorno, stati e versioni; flusso conferma → approvazione/restituzione con autore e istante; riapertura motivata con nuova versione e nuova approvazione; offline con coda, idempotenza e conflitti risolti dall'utente; PDF giornaliero e mensile.

## 2. Novità della Fase 3

| Area | Novità | File |
|---|---|---|
| Richieste di correzione | Nuova entità `richieste_correzione`: il lavoratore segnala un errore su una giornata (facoltativamente su un'attività); l'amministratore la prende in carico, la risolve o la respinge con risposta obbligatoria; autore e istante registrati; audit; sincronizzata come ogni dato (anche se creata offline) | `domain/types.ts`, `services/richieste-service.ts`, `ui/RichiesteCorrezione.tsx`, `database/migrations/0008_richieste_correzione.sql` |
| Sospendi / riprendi | Dopo "Ferma" la dashboard propone "Riprendi <ultima attività>": nuova attività con la stessa destinazione; il tempo di sospensione resta presenza non attribuita | `workday-service.ts` (`ultimaRiprendibile`), `OperaioHome.tsx` |
| Riepilogo giornaliero | Riquadro "Verifica della giornata": stato di sincronizzazione di tutti i dati del giorno, stato del cartellino del mese, "Richiedi correzione", collegamento al PDF, richieste del giorno con risposta. Ripartizione anche per intervento. Con "Storico correzioni": modifiche a entrata/uscita (prima → dopo, data, motivo) dal registro | `FineGiornata.tsx`, `DayDetail.tsx` |
| Cartellino mensile | Sezione "Dettaglio del mese" (lavoratore e amministratore): giorni con/senza presenza (feriali), giornate con uscita mancante escluse dai totali, stato di sincronizzazione, attività giorno per giorno, storico correzioni, richieste di correzione (gestibili dall'amministratore). Riusa il modello dei PDF della Fase 2 | `ui/CartellinoView.tsx` (`DettaglioMese`) |
| Amministratore | Richieste aperte in dashboard ("Da fare") e nella giornata dell'operaio (Presenze); dalla richiesta si apre il cartellino per restituirlo o riaprirlo quando il mese è bloccato | `AdminHome.tsx`, `PresenzeAdmin.tsx` |
| PDF | Giornaliero: righe "Cartellino del mese" e "Sincronizzazione", sezione richieste di correzione. Mensile: richieste del mese con stato, risposta, autore e data. Avviso se ci sono richieste aperte | `reports/modello.ts`, `reports/layout-pdf.ts` |

## 3. Regole

- La richiesta **non modifica dati**. Se il mese è modificabile il lavoratore corregge da sé (correzione tracciata); se è in verifica o approvato l'amministratore restituisce il cartellino o lo riapre con motivazione: ogni modifica produce una nuova versione che richiede nuova conferma e nuova approvazione (la versione approvata precedente resta archiviata).
- Transizioni: aperta → presa in carico → risolta/respinta (anche diretta da aperta). Risolta e respinta richiedono una risposta (≥ 5 caratteri) e sono definitive. Lato database: vincoli e trigger in `0008` (verificati su PostgreSQL 16 locale, 31 controlli totali).
- Nessuna sovrascrittura silenziosa: la richiesta segue lo stesso controllo di versione e la stessa gestione dei conflitti degli altri dati (docs/08).

## 4. Test eseguiti (solo quelli necessari alle modifiche)

| Test | Esito |
|---|---|
| `tests/unit/fase3.test.ts` F01–F04: validazioni, offline → sincronizzazione solo dopo conferma, gestione con autore/istante, mese approvato → richiesta → riapertura → correzione → nuova conferma e nuova approvazione (v2, v1 archiviata), contenuto dei PDF, sospendi/riprendi | 4/4 |
| Suite unitaria completa (codice condiviso modificato) | 68/68 |
| `tests/e2e/fase3.spec.ts`: riprendi con un tocco, verifica della giornata, richiesta → gestione in dashboard admin → risposta visibile al lavoratore | 1/1 |
| E2E esistenti sulle schermate modificate | 6/6 |
| Verifica SQL della migrazione 0008 su PostgreSQL locale | 3/3 nuovi controlli (31/31 totali) |

## 5. Questioni aperte

- Nessuna notifica (email/push) all'amministratore per le nuove richieste: le vede in dashboard.
- L'amministratore non corregge direttamente le giornate (D-12): risolve tramite restituzione/riapertura e correzione del lavoratore.
- Il server è simulato e operaio e amministratore condividono lo stesso database del browser.
- La versione del database locale è passata a 2 (nuovo archivio `richieste_correzione`); i dati esistenti restano.
