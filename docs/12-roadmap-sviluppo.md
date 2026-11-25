# 12 – Roadmap di sviluppo

## Fase 1 – Analisi, prototipo, modello dati (questa consegna)

Consegnati: specifica e flussi, prototipo PWA navigabile con dati demo e server simulato, motore ore testato, macchina a stati del cartellino, schema PostgreSQL verificato in locale, strategia offline, piano test con esiti. Dettaglio stato in docs/01 §8.

## Fase 2 – Prodotto minimo in produzione (proposta, 10–12 settimane)

Prerequisito: approvazione delle decisioni aperte (docs/11) e autorizzazione esplicita per backend reale, sicurezza e deploy.

| Sprint | Obiettivo | Attività principali | Criteri di completamento |
|---|---|---|---|
| 0 (1 sett.) | Decisioni e ambienti | Approvazione D-xx; progetto Supabase di sviluppo e di produzione (a cura del committente); variabili d'ambiente; CI (typecheck, unit, E2E, verifica SQL) | Pipeline verde su ogni push |
| 1 (2 sett.) | Backend dati | Applicare le migrazioni a Supabase **di sviluppo**; RPC `sync_apply` (idempotenza, `row_version`, regole, audit) e `sync_pull` incrementale; numerazioni; `SupabaseRemoteApi` | T24–T28 eseguiti contro Supabase di sviluppo |
| 2 (2 sett.) | Autenticazione e sicurezza | Supabase Auth, profili, sessione offline, RLS e RPC `security definer`; **fase di sicurezza autorizzata**: revisione, test di autorizzazione, audit dipendenze | Report di sicurezza approvato |
| 3 (2 sett.) | Motore lato server e cartellini | Motore ore in Edge Function con lo stesso modulo; generazione snapshot lato server; transizioni via RPC; notifiche (email/push) di conferma e richieste di correzione | E1–E17 eseguiti anche lato server; flusso mensile E2E su backend reale |
| 4 (2 sett.) | Allegati e documenti | Upload su Storage (idempotente, ripresa); PDF rapportino e cartellino (`pdfmake`); PDF aziendali lato server; Excel (`exceljs`) | Documenti generati solo da versioni approvate; quadratura verificata |
| 5 (1–2 sett.) | Pilota | 2–3 operai su tablet reali per 2 settimane; checklist manuale M1–M8; correzioni UX | Nessuna timbratura persa; feedback raccolto |
| 6 (1 sett.) | Avvio | Import anagrafiche reali, formazione, deploy (autorizzato), monitoraggio errori | Go-live approvato |

## Backlog Fase 2+ (non ancora pianificato)

- Correzioni da parte dell'amministratore con notifica e riconferma (D-12).
- Causali di assenza (ferie, permessi, malattia) e straordinari nel cartellino.
- Arrotondamenti contrattuali solo nei documenti paga.
- Fusione per campo nei conflitti di anagrafiche/interventi.
- Geolocalizzazione facoltativa di entrata/uscita (richiede valutazione privacy).
- Catalogo materiali con codici articolo e giacenze.
- Firma del cliente con invio copia via email.
- Dashboard ore per cliente/commessa e redditività.
- Notifiche per giornate non chiuse e cartellini in attesa.

## Rischi

| Rischio | Mitigazione |
|---|---|
| Spazio IndexedDB su tablet economici con molte foto | Ridimensionamento, upload rapido, `storage.persist()`, pulizia dopo conferma |
| iOS/Safari limita i Service Worker e lo storage delle PWA non installate | Installazione obbligatoria come PWA; test su iPad nel pilota |
| Orologio del tablet sbagliato | Il server registra `created_at` e confronta con `client_created_at`: scarti > 5 min → anomalia (da aggiungere in Fase 2) |
| Due dispositivi per lo stesso operaio | Anomalie di sovrapposizione + vincoli DB su presenza aperta; politica "un tablet per operaio" consigliata |
| Interpretazioni contrattuali (mezzanotte, pause, soglie) | Decisioni D-15/D-16 da validare con il consulente del lavoro |

## Piano esecutivo immediato (prime 2 settimane di Fase 2)

1. Riunione di revisione del prototipo con amministrazione e 2 operai (1 h) → raccolta modifiche UX.
2. Approvazione scritta delle decisioni D-03, D-05, D-06, D-07, D-10, D-12, D-15, D-16, D-23.
3. Creazione ambiente Supabase di sviluppo da parte del committente; condivisione credenziali solo tramite variabili d'ambiente.
4. Implementazione `sync_apply` + `SupabaseRemoteApi` mantenendo invariati servizi e UI (sostituzione dell'implementazione di `RemoteApi`).
5. Riesecuzione dell'intera suite (unit, E2E, SQL) contro l'ambiente di sviluppo.
