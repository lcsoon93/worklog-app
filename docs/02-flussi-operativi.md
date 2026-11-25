# 02 – Flussi operativi

Per ogni flusso: passi, schermata del prototipo (`#/percorso`), regole e casi limite. I diagrammi sono Mermaid.

## 1. Flusso operaio

### 1.1 Giornata tipo

```mermaid
flowchart TD
  L[Login<br/>#/login] --> D[Dashboard Oggi<br/>#/op]
  D --> NC{Giornata precedente<br/>non chiusa?}
  NC -- sì --> CH[Chiudi giornata precedente<br/>uscita proposta = ultimo segnale] --> D
  NC -- no --> E[Registra entrata]
  E --> T[Avvia timer<br/>intervento di oggi · cliente · interna · trasferimento · senza cliente]
  T --> W((Lavoro in corso))
  W -->|Cambia attività| T2[Nuova attività<br/>la precedente si chiude nello stesso istante] --> W
  W -->|Ferma| S[Presente senza timer<br/>tempo non attribuito] --> T
  W -->|Pausa| PA[Pausa<br/>timer sospeso] -->|Riprendi| W
  PA -->|Termina pausa| S
  W -->|Imprevisto| IM[Registra imprevisto<br/>#/op/imprevisto] --> W
  W -->|Rapportino| RA[Rapportino rapido/completo<br/>#/rapportini/nuovo] --> W
  W -->|Fine giornata| RG[Riepilogo<br/>#/op/riepilogo]
  S -->|Fine giornata| RG
  RG -->|correzioni con motivo| RG
  RG --> U[Registra uscita<br/>timer e pausa aperti chiusi all'uscita] --> FINE[Giornata chiusa]
```

### 1.2 Passi e regole

| Passo | Schermata | Regole |
|---|---|---|
| Login | `#/login` | Prototipo: account demo con un tocco (password `demo`). Fase 2: Supabase Auth, sessione persistente per uso offline |
| Dashboard | `#/op` | Stato giornata in evidenza (card grande), timer in secondi, totali del giorno, azioni rapide, interventi di oggi con "Avvia" diretto |
| Inizio giornata / Entrata | `#/op`, `#/op/presenza` | Blocca se esiste una giornata aperta; non accetta orari futuri; la data lavoro è quella dell'entrata |
| Avvio timer | `#/op/timer` | Un tocco su un intervento di oggi = cliente+sede+intervento; altrimenti cliente (+sede, +intervento facoltativo), interna, trasferimento, senza cliente. Se c'è una pausa aperta viene chiusa |
| Cambio cliente / intervento | `#/op/timer` | "Cambia e avvia": chiusura della precedente e apertura della nuova con lo stesso timestamp |
| Pausa | `#/op/pause` o pulsante Pausa | Una sola pausa aperta; il timer si chiude all'inizio pausa e viene ricordato (`attivita_sospesa_id`) |
| Ripresa | card pausa | "Riprendi X" chiude la pausa e crea una NUOVA attività con la stessa destinazione |
| Imprevisto | `#/op/imprevisto` | Tipo + descrizione obbligatori; intervento predefinito = quello del timer in corso; foto facoltative |
| Rapportino | `#/rapportini/nuovo` | Da intervento: si apre già collegato; autonomo: scelta cliente. Le attività del giorno compatibili sono collegate in automatico |
| Fine giornata | `#/op/riepilogo` | Conferma con riepilogo e avvisi (timer attivo, pausa aperta, ore da classificare) |
| Riepilogo ore | `#/op/riepilogo?data=` | Totali, linea del tempo, ripartizione, anomalie, documenti del giorno; navigazione tra i giorni |
| Correzione attività | `#/op/riepilogo` | Correggi, Dividi, Annulla, Aggiungi; motivo obbligatorio; vietate sovrapposizioni e intervalli fuori presenza; mese bloccato se cartellino in verifica |

### 1.3 Correzione di un'attività

```mermaid
sequenceDiagram
  actor O as Operaio
  participant UI as Riepilogo
  participant S as WorkdayService
  participant DB as IndexedDB (UnitOfWork)
  O->>UI: Dividi attività 09:00–12:00 alle 10:30, seconda parte → Cliente B, motivo
  UI->>S: dividiAttivita(id, 10:30, {cliente B}, motivo)
  S->>S: mese modificabile? intervallo interno? motivo presente?
  S->>DB: originale.superata_da_id = A1 · nuova A1 09:00–10:30 · nuova A2 10:30–12:00 (sostituisce_id = originale) · 3 righe audit · outbox
  DB-->>S: commit atomico OK
  S-->>UI: aggiornamento (motore ore ricalcola)
```

## 2. Flusso amministratore

```mermaid
flowchart TD
  L[Login] --> D[Dashboard aziendale<br/>#/admin]
  D --> SQ[Squadra oggi: stato live di ogni operaio] --> PR[Consultazione presenze<br/>#/admin/presenze]
  D --> AN[Anomalie: giornate non chiuse, ore da classificare] --> PR
  D --> AG[Agenda giorno/settimana/mese<br/>#/agenda/:vista]
  AG --> NI[Programmazione intervento<br/>#/admin/interventi/nuovo] --> SI[Scheda intervento<br/>#/interventi/:id]
  SI --> AS[Assegnazione operai<br/>#/admin/interventi/:id/assegna]
  D --> RP[Rapportini #/rapportini] --> RV[Dettaglio rapportino]
  D --> RT[Ritorni #/admin/ritorni] --> PI[Pianifica → nuovo intervento di ritorno]
  D --> CA[Cartellini #/admin/cartellini] --> VE[Verifica cartellino] --> AP{Approva / Correzione / Rifiuta / Riapri}
  D --> RE[Report mensile #/admin/report]
  D --> ANA[Operai · Clienti · Sedi]
```

| Funzione | Schermata | Regole principali |
|---|---|---|
| Dashboard | `#/admin` | KPI del giorno; squadra con timer live; "Da fare": cartellini da approvare, ritorni da pianificare; anomalie |
| Gestione operai | `#/admin/operai` | Email univoca; disattivazione invece di cancellazione |
| Gestione clienti | `#/admin/clienti`, `#/admin/clienti/:id` | P.IVA 11 cifre univoca; scheda con sedi, interventi, ore registrate |
| Gestione sedi | `#/admin/sedi` | Sede sempre legata a un cliente; note di accesso visibili agli operai |
| Programmazione | `#/admin/interventi/nuovo` | Senza data = "da programmare"; sede del cliente scelto; squadra opzionale |
| Assegnazione | `#/admin/interventi/:id/assegna` | Un responsabile; avviso (non blocco) per sovrapposizioni; rimozioni come eliminazione logica |
| Agenda | `#/agenda/giorno|settimana|mese` | Filtro operaio; ritorni evidenziati |
| Consultazione presenze | `#/admin/presenze?data&operaio` | Tabella del giorno e dettaglio con storico correzioni (sola lettura) |
| Consultazione rapportini | `#/rapportini` | Filtri, ricerca; le bozze altrui non sono visibili (restano sul tablet) |
| Verifica anomalie | Dashboard, presenze, cartellino | Anomalie calcolate dal motore (docs/06 §6) |
| Approvazione cartellini | `#/admin/cartellini/:id` | Azioni disponibili solo se ammesse dallo stato (docs/07) |

## 3. Flusso mensile

```mermaid
sequenceDiagram
  actor A as Amministratore
  actor O as Operaio
  participant T as Tablet operaio
  participant SV as Server
  A->>SV: Chiudi mese → genera snapshot v1 (stato: Da confermare dall'operaio)
  Note over SV: blocco: nessuna giornata aperta nel mese
  SV-->>T: sincronizzazione cartellino v1
  O->>T: Controlla calendario, totali, anomalie
  alt dati corretti
    O->>T: Conferma (stato locale: Confermato dall'operaio)
    T->>SV: invio conferma
    SV-->>T: ricevuta → In attesa di approvazione
  else discrepanza
    O->>T: Segnala discrepanza (motivo) → Da correggere
    O->>T: Corregge i giorni → Genera nuova versione v2 → Da confermare
  end
  A->>SV: Verifica (differenze, anomalie, storico)
  alt approvato
    A->>SV: Approva → Approvato (versione_approvata = vN)
    A->>SV: Genera PDF (Fase 2) dalla versione approvata
  else serve correzione
    A->>SV: Richiedi correzione / Rifiuta (motivo) → Da correggere
    Note over O,SV: correzioni → nuova versione → nuova conferma
  end
  opt rettifica successiva
    A->>SV: Riapri (motivo) → Riaperto, la versione approvata resta archiviata
    Note over A,SV: correzioni → vN+1 → conferma → approvazione
  end
```

Stati e transizioni complete: docs/07.

## 4. Flusso rapportino → ritorno

```mermaid
flowchart LR
  I1[Intervento originale] --> R1[Rapportino<br/>esito: serve un ritorno<br/>note: cosa resta da fare]
  IMP[Imprevisto<br/>serve un ritorno] -.->|suggerisce l'esito| R1
  R1 --> F[Followup aperto]
  F -->|Pianifica| I2[Intervento di ritorno<br/>tipo ritorno · followup_origine_id]
  I2 --> R2[Rapportino del ritorno<br/>followup_id]
  R2 -->|esito completato| FC[Followup chiuso<br/>rapportino_chiusura_id]
  R2 -->|altro ritorno| F2[Nuovo followup] 
```

La catena è navigabile in entrambe le direzioni dal dettaglio del rapportino, dalla scheda intervento e dalla pagina Ritorni.

## 5. Casi limite trasversali

| Caso | Comportamento progettato | Nel prototipo |
|---|---|---|
| Browser chiuso con timer attivo | Riaprendo, il timer mostra il tempo corretto (calcolato da `inizio_at`) | Verificato (E2E reload, T06) |
| Dispositivo spento a fine giornata | Banner bloccante il giorno dopo con uscita proposta | Verificato (T07) |
| Rete assente tutto il giorno | Tutto salvato in IndexedDB, coda visibile, invio al ritorno della rete | Verificato con rete simulata (T24, E2E offline) |
| Due tablet per lo stesso operaio | Attività sovrapposte contate una volta + anomalia; conflitti su stessi record risolti dall'utente | Motore verificato (E3); conflitto simulato (T27) |
| Amministratore modifica un intervento mentre l'operaio è offline | Ultima scrittura vince sui campi descrittivi; stato intervento ricalcolato dal server (docs/08 §6) | Progettato |
| Operaio cambia dispositivo | I dati non sincronizzati restano sul vecchio dispositivo: avviso nella pagina Sync | Progettato (D-10) |
