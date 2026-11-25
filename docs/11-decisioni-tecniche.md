# 11 – Decisioni tecniche

Formato: decisione · motivo · alternative · stato. **Richiede approvazione** = decisione presa per procedere, da confermare.

| ID | Decisione | Motivo | Alternative valutate | Stato |
|---|---|---|---|---|
| D-01 | Progetto nella root di `worklog-app` (svuotata su richiesta), con `docs/`, `database/`, `prototype/` | Directory predisposta per il nuovo gestionale; nessun altro progetto presente | Nuova directory/repository | Adottata |
| D-02 | Versioni pinnate consolidate: React 18.3, Vite 5.4, TS 5.6, react-router 6.28, Vitest 2.1, Playwright 1.63 | Stabilità e compatibilità note; Playwright allineato al Chromium preinstallato | Versioni più recenti (React 19, Vite 8) | Adottata – rivalutare in Fase 2 |
| D-03 | Design system proprio in CSS + `lucide-react`, nessuna libreria UI | Leggerezza (bundle 124 KB gzip in totale), controllo su dimensioni touch e contrasto, nessuna dipendenza da tema | Mantine, MUI, shadcn/ui+Tailwind | **Richiede approvazione** |
| D-04 | `HashRouter` | Funziona da qualunque hosting statico e offline senza riscritture server | `BrowserRouter` + fallback | Adottata |
| D-05 | "Attribuite" esclude le attività *da classificare* (timer senza cliente), che finiscono nelle *non attribuite* | Spinge a classificare; ore "senza destinazione" non sono attribuite in senso utile | Contarle come attribuite (cambio di una riga) | **Richiede approvazione** |
| D-06 | Stato "Confermato dall'operaio" = conferma sul dispositivo; "In attesa di approvazione" solo dopo ricezione del server (transizione di sistema) | Rende i due stati richiesti significativi e coerenti con l'offline | Unico stato; passaggio manuale dell'operaio | **Richiede approvazione** |
| D-07 | Attività sovrapposte non vietate dal DB; il motore le conta una volta (vince l'ultima iniziata) e le segnala. Il servizio impedisce quelle create dall'utente | Due dispositivi offline possono produrle: rifiutarle perderebbe dati reali | Vincolo di esclusione su `attivita_lavoro` | **Richiede approvazione** |
| D-08 | Motore ore lato server come Edge Function che riusa il modulo TS del dominio | Un'unica implementazione testata | Porting PL/pgSQL con `tstzmultirange` | Proposta (Fase 2) |
| D-09 | Service Worker con aggiornamento a richiesta (`registerType: 'prompt'`) | Non ricaricare l'app durante una registrazione | `autoUpdate` | Adottata (prompt UI in Fase 2) |
| D-10 | Bozze di rapportino solo locali, mai sincronizzate | Le bozze sono personali e incomplete; riduce dati incoerenti sul server | Bozze sincronizzate (ripresa da altro dispositivo) | **Richiede approvazione** |
| D-11 | PDF: `pdfmake` lato client per singoli documenti; server per documenti aziendali | Offline per l'operaio, prestazioni per l'admin | Solo server; HTML stampabile | Proposta |
| D-12 | L'amministratore consulta ma non corregge direttamente le giornate degli operai nel prototipo | Mantiene la responsabilità del dato all'operaio; la correzione admin richiede regole aggiuntive (notifica all'operaio, motivo, nuova conferma) | Correzione admin diretta con tracciamento | **Richiede approvazione** |
| D-13 | La pausa chiude il timer e la ripresa crea una nuova attività (non "sospende" la stessa riga) | Intervalli semplici e immutabili; storico chiaro | Riga unica con sotto-intervalli | Adottata |
| D-14 | Avviare un'attività durante una pausa chiude la pausa | Un tocco per ripartire | Bloccare con messaggio | Adottata |
| D-15 | Presenza attribuita al giorno dell'entrata, anche oltre mezzanotte | Regola semplice e usuale nei cartellini | Spezzare a mezzanotte | **Richiede approvazione** (verificare con consulente del lavoro) |
| D-16 | Soglie: presenza lunga 12 h, massima 24 h, non attribuite 30 min, pausa obbligatoria dopo 6 h | Valori ragionevoli/normativi; configurabili | — | **Richiede approvazione** |
| D-17 | Segnale di vita ogni 5 minuti per proporre l'uscita dopo chiusure anomale | Il browser non garantisce eventi alla chiusura | Nessuna proposta (inserimento manuale) | Adottata |
| D-18 | Numerazioni definitive (rapportini, interventi) assegnate dal server; numero provvisorio per dispositivo | Nessuna collisione offline; numerazione legale senza buchi lato server | Numerazione per dispositivo con prefisso | Adottata |
| D-19 | Campo tecnico di concorrenza rinominato `row_version` | Collisione di nome con la versione del cartellino trovata dal typecheck | — | Adottata |
| D-20 | Le assegnazioni sovrapposte di un operaio sono un avviso, non un blocco | Interventi brevi in sequenza sono comuni | Blocco | Adottata |
| D-21 | Eliminazione solo logica (`deleted_at`) e tabelle storiche append-only, garantite da trigger | Tracciabilità richiesta | Cancellazione fisica + audit | Adottata |
| D-22 | Autenticazione simulata nel prototipo (password unica `demo`) | La sicurezza è esclusa dalla Fase 1 | — | Temporanea |
| D-23 | Rapportino completo richiede firma del cliente salvo esito "non eseguito" | Valore probatorio | Firma facoltativa | **Richiede approvazione** |
| D-24 | Schema dati nello schema PostgreSQL `app` (non `public`) | Esporre solo RPC/viste in Supabase | `public` | Proposta |

## Questioni aperte per il committente

1. D-05, D-06, D-07, D-10, D-12, D-15, D-16, D-23 (vedi tabella).
2. Arrotondamenti contrattuali (es. al quarto d'ora) da applicare **solo** nei documenti paga? Oggi nessun arrotondamento.
3. Straordinari, ferie, permessi, malattia: fuori ambito Fase 1; servono causali di assenza nel cartellino?
4. Il trasferimento verso un cliente va fatturato/riportato separatamente (oggi è separato nei report come "viaggio")?
5. Chi può creare clienti in cantiere (operaio offline)? Oggi solo l'amministratore.
6. Tablet personali o condivisi? Influenza sessione, cifratura locale e logout.
