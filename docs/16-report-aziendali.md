# 16 – Report aziendali e analisi gestionale (Fase 6)

Sezione **Analisi** del menu dell'amministratore (`#/admin/analisi`). Ha quattro viste che condividono gli stessi filtri: Dashboard, Presenze e personale, Interventi e clienti, Economico.

## 1. Principio: un solo calcolo, quattro uscite

`AnalisiService` (`prototype/src/services/analisi-service.ts`) costruisce un **ReportDoc** (`prototype/src/reports/report-tabellare.ts`): indicatori, tabelle, avvisi, periodo, filtri e data di generazione. Lo stesso oggetto alimenta lo schermo, il **PDF** (`generaPdfReport`, che usa il servizio PDF esistente e lo stesso impianto grafico dei riepiloghi), l'**Excel** (`reportXlsx`) e il **CSV** (`reportCsv`). Le esportazioni riportano quindi esattamente ciò che è a video, con gli stessi filtri.

Le fonti dei dati non vengono ricalcolate in modo diverso:

| Dato | Fonte (già esistente) |
|---|---|
| Ore lavorate, pause, ore per tipologia, cliente, intervento, anomalie | motore ore centrale (`calcolaDaRecord`), richiamato una sola volta per presenza |
| Costi e valore a listino dei materiali | registro di magazzino (`riepilogaConsumi`), con il costo unitario storico |
| Stati di interventi, cartellini, ritorni, rapportini | record e registro approvazioni |
| Interventi riprogrammati | storico (audit) delle modifiche alla data programmata |

## 2. Contenuto

| Vista | Indicatori | Tabelle |
|---|---|---|
| Dashboard | interventi programmati, in corso e completati; ore lavorate; presenze; rapportini completati e da completare; costo dei materiali; elementi da verificare | interventi per stato, attività per lavoratore, costi per cliente, costi per intervento, materiali consumati, **anomalie e attività da verificare** (presenze non chiuse, anomalie del motore, ore da classificare, richieste di correzione, cartellini da approvare, ritorni, bozze, consumi con giacenza insufficiente) |
| Presenze e personale | ore, presenze, ore ai clienti, ore interne, cartellini approvati / da approvare / restituiti, anomalie | ore per dipendente, ore per tipologia, ore per cliente, presenze mensili, confronto con il periodo precedente di pari durata, cartellini, presenze giornaliere |
| Interventi e clienti | totali, completati, aperti, riprogrammati, ritorni, ore, rapportini, costo dei materiali | per cliente e sede, per lavoratore, elenco con tempi previsti, impiegati e scostamento, ritorni, materiali utilizzati, storico dei rapportini |
| Economico | costo dei materiali, valore a listino, differenza listino − costo (solo materiali con prezzo di vendita), consumi | costi per cliente, confronto dei costi per intervento (anche € di materiali per ora), costi per cliente e mese, valore dei materiali consumati, consumi per lavoratore e per tipologia, listino prezzi |

**Ricavi e margini non sono inventati.** Il progetto non gestisce fatture, preventivi né tariffe orarie, e la vista Economico lo dichiara in un avviso. Il "valore a listino" applica solo il prezzo di vendita dei materiali, dove esiste. La differenza listino − costo è calcolata solo sui materiali che hanno un prezzo di vendita ed è etichettata come "non è un margine fatturato".

## 3. Filtri

- **Periodo**: predefiniti (mese corrente, mese precedente, ultimi 30 giorni, anno) o date libere; massimo 13 mesi.
- **Lavoratore**, **cliente**, **sede** (dipende dal cliente), **intervento**.
- **Tipologia**: di attività (lavoro presso cliente, trasferimento, interne con il dettaglio per codice, da classificare) nelle viste Dashboard e Personale; di intervento nelle viste Interventi ed Economico.
- **Stato**: del cartellino (Personale) o dell'intervento (Interventi).

I filtri restano nell'indirizzo della pagina, quindi un report si può ricaricare o aprire di nuovo da un link interno. Le ore di presenza non dipendono dai filtri cliente, sede, intervento o tipologia: in quel caso compare la colonna "Ore attività filtrate", e la tabella lo spiega in una nota.

## 4. Visualizzazione ed esportazioni

- Indicatori in alto, poi le tabelle. Quelle lunghe mostrano 25 righe con il pulsante "Mostra tutte".
- Grafici a barre orizzontali a una sola serie: valori scritti accanto alle barre, tooltip, al massimo 12 voci, tabella sempre sotto. Si possono nascondere.
- **PDF**: A4 orizzontale con intestazione aziendale, periodo, filtri, data di generazione, "Pagina x di y" e tutte le tabelle.
- **Excel** (.xlsx, generato senza nuove dipendenze):
  - un foglio "Riepilogo" con periodo, filtri, data di generazione, indicatori e avvisi;
  - un foglio per ogni tabella;
  - importi in €, durate come tempo `[h]:mm` e date come date vere, quindi rielaborabili.
  
  Il file è stato aperto e verificato con openpyxl e LibreOffice.
- **CSV**: separatore `;` con BOM, come lo apre Excel in italiano. Si può esportare l'intero report o una singola tabella, con periodo, filtri e data di generazione in testa.

## 5. Verifiche eseguite

- Test unitari `tests/unit/analisi.test.ts` (A01–A03):
  - ore uguali al motore centrale e quadratura tipologie + non attribuite = ore lavorate;
  - filtri per lavoratore, stato e tipologia;
  - costi uguali al registro di magazzino;
  - presenza dell'avviso sui ricavi;
  - CSV, Excel e PDF con periodo, data di generazione e gli stessi valori, con il testo del PDF estratto e controllato.
- Test end-to-end `tests/e2e/fase6-7.spec.ts`: filtri, grafico, download di CSV, Excel e PDF, con il contenuto del CSV confrontato con la tabella a video.
