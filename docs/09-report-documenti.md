# 09 – Documenti e report

Stato: progettato in Fase 1. **Fase 2: implementati e verificati i PDF del riepilogo giornaliero e mensile per operaio** (docs/13). Restano da realizzare: PDF dei rapportini, PDF aziendali e per cliente, esportazioni Excel (oggi solo anteprima CSV nel report mensile).

## 1. Regole generali

1. **Una sola fonte per le ore**: il motore ore (docs/06). Nessun report somma durate salvate o digitate.
2. **Ogni presenza è calcolata una volta**; i totali per operaio, cliente, intervento e mese sono somme di quei risultati. Niente join che moltiplicano le righe (es. attività × operai del rapportino).
3. **Documenti ufficiali solo da dati verificati**: i PDF dei cartellini usano la **versione approvata** (snapshot), mai il dato dal vivo. Se il cartellino non è approvato il documento riporta in evidenza "BOZZA – NON APPROVATO".
4. **Quadratura obbligatoria**: ogni report verifica `Σ clienti + Σ interne + trasferimenti generici = attribuite` e `attribuite + non attribuite = effettive`. Se non quadra il report non si esporta (nel prototipo: badge "Quadratura verificata").
5. Ogni documento riporta: data di generazione, utente, versione dei dati (numero versione cartellino o "dati al gg/mm/aaaa hh:mm"), versione del motore ore.

## 2. Rapportini

| Documento | Contenuto | Fonte dati |
|---|---|---|
| **PDF singolo** | Intestazione azienda, numero definitivo (o provvisorio con dicitura), data, cliente, sede, intervento, operai, descrizione, esito, ore (dalle attività), materiali, foto (miniature 2×N), firme con nome e data, imprevisti, eventuale ritorno generato o rapportino d'origine | `rapportini`, `rapportino_operai`, `rapportino_attivita` → motore ore, `rapportino_materiali`, `rapportino_foto`/`firme` → `allegati`, `imprevisti`, `followup` |
| **PDF giornaliero** | Tutti i rapportini di un giorno, uno per pagina, con indice | Filtro `data_lavoro` |
| **PDF mensile** | Indice per giorno + rapportini; riepilogo ore per cliente | Filtro mese |
| **PDF per cliente** | Rapportini del cliente nel periodo, totale ore lavoro/viaggio, materiali aggregati | Filtro `cliente_id` |
| **PDF per operaio** | Rapportini a cui ha partecipato, ore attribuite per rapportino | `rapportino_operai` |

Le ore di un rapportino = somma delle quote **effettive** (dopo risoluzione delle sovrapposizioni) delle attività collegate. Se un'attività collegata viene corretta, il rapportino mostra la versione effettiva corrente e segnala la correzione.

## 3. Cartellini

| Documento | Contenuto | Fonte dati |
|---|---|---|
| **PDF giornaliero** | Per operaio: entrata, uscita (con valori originali se corretti), pause, linea del tempo, attività con destinazione e durata, ore effettive/attribuite/non attribuite, anomalie, correzioni con motivo | Motore ore sul giorno + catena correzioni + audit |
| **PDF mensile** | Tabella giorni (entrata, uscita, pause, effettive, attribuite, non attribuite, note), totali, stato di approvazione, versione, registro approvazioni (chi/quando/motivo), firme digitali di conferma e approvazione (riferimenti al registro) | `cartellino_versioni` (versione approvata) + `approvazioni_cartellino` |
| **Riepilogo per operaio** | Più mesi per un operaio: totali e stato di ciascun cartellino | `cartellini_mensili` + versioni approvate |
| **Riepilogo aziendale** | Tutti gli operai di un mese: giorni, effettive, attribuite, non attribuite, stato; totale aziendale; elenco cartellini non approvati | Versioni approvate; per i non approvati la versione corrente con dicitura |

Campi obbligatori richiesti: entrata e uscita, pause, ore effettive, ore attribuite, ore non attribuite, stato di approvazione → tutti presenti nello snapshot `giorni[]`/`totali` (docs/05).

## 4. Esportazioni Excel

| File | Fogli | Note |
|---|---|---|
| Presenze mese | `Riepilogo` (per operaio), `Giorni` (una riga per presenza), `Attività` (una riga per attività effettiva con quota effettiva), `Anomalie` | Durate in **ore decimali** e in `hh:mm` (formato cella `[h]:mm`), mai testo |
| Ore per cliente | `Clienti` (lavoro, viaggio, rapportini), `Dettaglio` (attività per cliente/intervento/operaio) | Somma da quote effettive |
| Interventi | elenco con stato, squadra, ore registrate, rapportini, ritorni | |
| Rapportini | elenco con numero, data, cliente, esito, ore, materiali | |

Anteprima nel prototipo: `#/admin/report` → "Esporta CSV" (separatore `;`, BOM UTF-8 per Excel italiano), nome file con suffisso `ANTEPRIMA`.

## 5. Librerie e generazione

- **PDF**: proposta `pdfmake` lato client (funziona offline, tabelle e immagini, licenza MIT) per rapportino singolo e cartellino del singolo operaio; per i documenti aziendali e massivi generazione **lato server** (Edge Function) per non caricare il tablet. Alternativa: HTML stampabile + "Salva come PDF" del browser (zero dipendenze, meno controllo). Decisione D-11.
- **Excel**: `exceljs` (formati numerici, larghezze colonne, più fogli).
- Ogni generazione registra in `audit_log` (azione `crea`, entità `documento`) parametri e versione dei dati.

## 6. Report mensile nel prototipo (`#/admin/report`)

- Mese selezionabile; avviso se non tutti i cartellini sono approvati (dati non definitivi).
- KPI: ore effettive (lorde, pause), attribuite (% sul totale), non attribuite (di cui da classificare), rapportini.
- Tabelle per operaio (con stato cartellino), per cliente (lavoro e viaggio separati, numero rapportini), per attività interna.
- Badge di quadratura calcolato ad ogni visualizzazione.
