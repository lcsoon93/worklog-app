# 06 – Motore di calcolo delle ore

Implementazione di riferimento: `prototype/src/domain/hours-engine.ts` (funzione pura `calcolaGiornata`) e `intervals.ts`. Test: `prototype/tests/unit/hours-engine.test.ts` (esempi E1–E17 + 1000 giornate casuali) e `workday.test.ts`.

Stato: **progettato, implementato nel prototipo, verificato con test**. Non è collegato a dati reali: in Fase 2 lo stesso algoritmo (stesso codice TypeScript o porting in SQL/Edge Function, vedi §10) calcolerà gli snapshot lato server.

## 1. Principi

1. **Intervalli espliciti**: ogni presenza, pausa e attività è un intervallo semi-aperto `[inizio, fine)` di istanti assoluti (UTC). Nessuna durata è mai salvata: si calcola sempre `fine − inizio`.
2. **Il timer non è un contatore**: l'avvio salva `inizio_at`, l'arresto `fine_at`. Il display mostra `adesso − inizio_at`; `setInterval` serve solo a ridisegnare lo schermo. Chiudere il browser, spegnere il tablet o perdere la rete non perde nulla.
3. **Funzione pura**: riceve presenza, pause, attività effettive e l'istante "adesso"; non legge l'orologio, non scrive. Stessi dati → stesso risultato.
4. **Nessun doppio conteggio**: ogni millisecondo di lavoro è attribuito al più a una attività.
5. **Arrotondamento solo in presentazione**: si calcola in millisecondi; il formato `H:MM` arrotonda al minuto più vicino solo quando si mostra. I totali mensili sono somme di millisecondi, non di minuti arrotondati.

## 2. Definizioni

| Grandezza | Definizione |
|---|---|
| Finestra di presenza `P` | `[entrata, uscita)`; se aperta `[entrata, adesso)` |
| **Presenza lorda** | durata(P) = uscita − entrata |
| Pause `Q` | unione delle pause, intersecata con `P` |
| **Pause** | durata(Q) (sovrapposizioni contate una volta) |
| Finestre di lavoro `W` | `P \ Q` |
| **Presenza netta** | durata(W) = lorda − pause |
| Parte valida di un'attività | `[inizio, fine) ∩ W` |
| Tempo coperto | unione delle parti valide di tutte le attività |
| **Ore attribuite** | tempo coperto da attività con destinazione definita: lavoro cliente, trasferimento, interna |
| Da classificare | tempo coperto da attività `da_definire` (timer avviato senza cliente) |
| Scoperto | `netta − coperto` (presente ma senza attività) |
| **Ore non attribuite** | `netta − attribuite` = da classificare + scoperto |

> Decisione D-05: la specifica chiede "ore attribuite = unione degli intervalli validi delle attività". Il motore separa l'unione in *attribuite* (destinazione nota) e *da classificare* (timer senza cliente), che confluisce nelle *non attribuite*. Se si preferisse contare anche le "da classificare" come attribuite basta cambiare una riga (`attribuite = coperta`). Richiede approvazione.

Invarianti verificate su 1000 giornate casuali: `attribuite + non_attribuite = netta`; `netta + pause = lorda`; `coperta ≤ netta`; `Σ effettiva(attività) = coperta`; `effettiva ≤ valida` per ogni attività.

## 3. Algoritmo

```
calcolaGiornata(presenza, pause[], attività[], adesso):
  1. FINESTRA
     se uscita < entrata → anomalia presenza_invalida (errore), totali = 0, stop
     fine := uscita ?? max(adesso, entrata)
     se fine − entrata > 24 h → presenza_invalida, stop
     se aperta → info presenza_aperta;  se > 12 h → avviso presenza_lunga
     se entrata e fine in giorni locali diversi → info turno_oltre_mezzanotte
  2. PAUSE
     per ogni pausa: fine := fine ?? (aperta ? adesso : uscita)  [+ anomalia pausa_aperta]
     parte fuori da P → avviso pausa_fuori_presenza
     se durata(unione) < Σ durate → avviso pause_sovrapposte
     Q := unione(pause) ∩ P ;  W := P \ Q
  3. ATTIVITÀ
     per ogni attività: fine := fine ?? (aperta ? adesso [info timer_attivo] : uscita [avviso timer_non_fermato])
     se fine < inizio → errore attivita_invalida, esclusa
     validi := [inizio, fine) ∩ W
     parte fuori da P → avviso attivita_fuori_presenza;  parte in Q → avviso attivita_durante_pausa
  4. SOVRAPPOSIZIONI (sweep line)
     confini := tutti gli estremi dei segmenti validi, ordinati
     per ogni segmento elementare [c_k, c_k+1):
        candidati := attività il cui insieme valido copre il segmento
        vincitore := quella con inizio più recente (spareggio: creata dopo, poi id)
        effettiva(vincitore) += durata del segmento
        se candidati ≥ 2 → accumula anomalia attivita_sovrapposte per la coppia
  5. TOTALI
     per_tipo, per_cliente (lavoro + trasferimento con cliente), per_intervento, per_codice_interno
     attribuite := coperta − da_classificare ;  non_attribuite := netta − attribuite
     intervalli_scoperti := W \ unione(segmenti assegnati)
  6. AVVISI DI FINE GIORNATA (solo presenza chiusa)
     nessuna attività → nessuna_attivita
     altrimenti non_attribuite > 30 min → ore_non_attribuite
     netta > 6 h e nessuna pausa → pausa_obbligatoria_mancante (D.Lgs. 66/2003, soglia configurabile)
```

Complessità: O((n+m) log(n+m) + s·n) con s segmenti elementari; per una giornata (decine di intervalli) è trascurabile.

Perché "vince l'ultima iniziata": un'attività che parte mentre un'altra è aperta rappresenta un passaggio; il tempo successivo appartiene alla nuova. La regola è deterministica e non dipende dall'ordine di arrivo dei dati dai dispositivi.

## 4. Attività sovrapposte

Il servizio impedisce sovrapposizioni create dall'utente (correzioni e inserimenti manuali vengono rifiutati). Possono però arrivare dalla sincronizzazione di **due dispositivi** usati offline dallo stesso operaio. Il database quindi **non** le vieta (perderebbe dati reali) e il motore le conta una sola volta segnalandole (D-07).

## 5. Comportamenti richiesti

| Caso | Comportamento | Dove |
|---|---|---|
| Attività consecutive / cambio cliente / cambio intervento | La nuova parte nello stesso istante in cui si chiude la precedente: nessun buco, nessuna sovrapposizione | `avviaAttivita`, E2 |
| Attività interne | Tipo `interna` con codice; attribuite, ripartite per codice | E4 |
| Trasferimenti | Tipo `trasferimento`, cliente facoltativo; con cliente concorre alle ore del cliente (separate nei report come "viaggio") | E4 |
| Attività non attribuite | Timer senza cliente = da classificare; tempo senza timer = scoperto; entrambi "non attribuite" | E5 |
| Pause multiple | Unione delle pause, sottratta dalla presenza | E6, E12 |
| Turni oltre mezzanotte | Istanti assoluti; presenza attribuita al giorno dell'entrata | E7, T13 |
| Cambio ora legale | Durata reale (es. 01:00–05:00 del 29/03/2026 = 3 h) | E14 |
| Timer interrotto (fermato) | `fine_at` registrato; il tempo successivo è scoperto finché non si avvia altro | T01 |
| Timer dimenticato | All'uscita chiuso all'orario di uscita, `chiusura_automatica = true` | E9, T01 |
| Pausa con timer attivo | Il timer si chiude a inizio pausa; la ripresa crea una nuova attività uguale | T01 |
| Attività avviata in pausa | La pausa si chiude nello stesso istante | T08 |
| Chiusura del browser / ricarica | Al riavvio i dati sono in IndexedDB; il timer si ricostruisce da `inizio_at` | T06, E2E |
| Dispositivo spento | Il giorno dopo: banner "giornata non chiusa", uscita proposta = max(ultimo segnale, ultimi istanti registrati) | T07 |
| Connessione persa | Nessun effetto sul calcolo (tutto locale); la sincronizzazione riprende dopo | T24 |
| Modifiche manuali | Mai sovrascritture: nuova riga con `sostituisce_id` e motivo; l'originale `superata_da_id` | T09–T11 |
| Dato originale e correzione | Attività: catena di righe; presenza: `*_registrata_at` immutabili + audit | T12 |
| Attività oltre il tempo di presenza | Parte fuori presenza o in pausa esclusa dal conteggio; inserimenti manuali fuori presenza rifiutati | E10, E11, T09 |

### 5.1 Segnale di vita (ultimo_segnale_at)

Mentre una giornata è aperta l'app aggiorna `presenze.ultimo_segnale_at` al massimo ogni 5 minuti e quando la pagina va in background (`visibilitychange`). È l'unico modo affidabile per stimare quando il dispositivo si è spento: il browser non garantisce eventi alla chiusura. L'uscita proposta è sempre **confermata dall'operaio** con un motivo; resta marcata `uscita_automatica`.

### 5.2 Cosa succede se…

| Evento | Dati | Calcolo | UI |
|---|---|---|---|
| …avvia una pausa con timer attivo | attività `fine_at = inizio pausa`; pausa con `attivita_sospesa_id` | Pausa esclusa | Card viola con "Riprendi X" |
| …dimentica di fermare il timer | resta `fine_at = null` | Fino all'uscita: conta fino ad "adesso"; all'uscita chiusa con flag | Avviso "Chiusa automaticamente" |
| …il dispositivo si spegne | ultimo segnale ≤ 5 min prima | Giornata aperta: nessun cartellino generabile finché non chiusa | Banner bloccante + proposta |
| …il browser viene chiuso | nulla si perde (scritture già su IndexedDB) | Riparte da `inizio_at` | Timer corretto alla riapertura |
| …la connessione viene persa | operazioni in coda (`in_attesa`) | Invariato | Pillola "Offline · N in coda" |
| …un intervallo viene corretto dopo | nuova riga, originale storicizzato, audit | Solo righe effettive | "Storico correzioni" mostra la catena |

## 6. Anomalie

| Codice | Gravità | Significato | Blocca la conferma? |
|---|---|---|---|
| `presenza_invalida` | errore | uscita < entrata o > 24 h | Sì |
| `presenza_aperta` | info | giornata in corso | Sì (genera cartellino) |
| `presenza_lunga` | avviso | > 12 h | No |
| `turno_oltre_mezzanotte` | info | informativa | No |
| `pausa_aperta` | info/avviso | pausa in corso / chiusa d'ufficio | No |
| `pausa_fuori_presenza`, `pause_sovrapposte` | avviso | dati incoerenti tollerati | No |
| `timer_attivo` | info | timer in corso | — |
| `timer_non_fermato` | avviso | chiuso all'uscita | No |
| `attivita_invalida` | errore | fine < inizio | Sì |
| `attivita_fuori_presenza`, `attivita_durante_pausa` | avviso | parte esclusa | No |
| `attivita_sovrapposte` | avviso | tempo comune contato una volta | No |
| `attivita_da_classificare` | avviso | timer senza cliente | No |
| `ore_non_attribuite` | avviso | > 30 min | No |
| `nessuna_attivita` | avviso | presenza senza attività | No |
| `pausa_obbligatoria_mancante` | avviso | > 6 h senza pausa | No |

Soglie in `DEFAULT_CONFIG` (configurabili in Fase 2 da tabella impostazioni).

## 7. Esempi verificabili

Data 10/03/2026, fuso Europe/Rome. Ogni esempio è un test eseguito (vedi docs/10 per l'esito).

| # | Input | Atteso |
|---|---|---|
| E1 | Presenza 08:00–17:00; pausa 12:00–13:00; A 08:00–12:00; B 13:00–17:00 | lorda 9:00, pause 1:00, netta 8:00, attribuite 8:00 (A 4:00, B 4:00), non attribuite 0:00, nessuna anomalia |
| E2 | 08:00–12:00; A 08:00–10:00; B 10:00–12:00 | attribuite 4:00; nessuna sovrapposizione |
| E3 | 08:00–12:00; A 08:00–11:00; B 10:00–12:00 | coperta 4:00; A 2:00, B 2:00; anomalia sovrapposte 1:00 |
| E4 | 08:00–09:30; trasferimento verso A 08:00–08:30; magazzino 08:30–09:30 | attribuite 1:30; cliente A 0:30; magazzino 1:00 |
| E5 | 08:00–12:00; senza cliente 08:00–10:00 | attribuite 0:00; da classificare 2:00; scoperto 2:00 (10:00–12:00); non attribuite 4:00 |
| E6 | 08:00–17:00; pause 10:00–10:15, 12:30–13:15, 15:00–15:10; A 08:00–17:00 | pause 1:10; netta 7:50 = attribuite; avviso attività durante pausa |
| E7 | 22:00 → 06:00 del giorno dopo; pausa 02:00–02:30; A 22:00–02:00 e 02:30–06:00 | lorda 8:00; netta 7:30; attribuite 7:30; info oltre mezzanotte |
| E8 | Presenza aperta dalle 08:00; A dalle 08:00 senza fine; adesso 10:30 | attribuite 2:30; info presenza aperta, timer attivo |
| E9 | 08:00–17:00; pausa 12–13; A 08–12; magazzino dalle 15:00 senza fine | magazzino 2:00 (fino all'uscita); avviso timer non fermato |
| E10 | 08:00–12:00; A 07:30–09:00 | attribuite 1:00; fuori presenza 0:30 |
| E11 | 08:00–17:00; pausa 12–13; A 11:00–14:00 | attribuite 2:00; durante pausa 1:00 |
| E12 | 08:00–17:00; pause 12:00–13:00 e 12:30–13:30 | pause 1:30; avviso sovrapposte |
| E13 | entrata 17:00, uscita 08:00 | netta 0; errore presenza invalida |
| E14 | 29/03/2026 01:00–05:00 (passaggio all'ora legale) | lorda 3:00 |
| E15 | 08:00–15:00 senza pause, A 08–15 | avviso pausa obbligatoria mancante |
| E16 | 08:00–12:00; pausa dalle 11:30 mai chiusa | pause 0:30 (chiusa all'uscita); avviso |
| E17 | 08:00 → 09:00 del giorno dopo (25 h) | netta 0; errore presenza invalida |

Esempio di servizio (T01, tutta la giornata): entrata 08:00; A 08:00–10:00; ferma; B 10:10–12:00; pausa 12:00–12:45 (B sospesa); ripresa B 12:45–15:00; magazzino 15:00–16:00 (chiuso all'uscita) → lorda 8:00, pause 0:45, netta 7:15, A 2:00, B 4:05, magazzino 1:00, attribuite 7:05, non attribuite 0:10.

## 8. Correzioni: algoritmo

| Operazione | Precondizioni | Effetto |
|---|---|---|
| Correggi (orari/destinazione) | attività chiusa, non già corretta, motivo, mese modificabile, nuovo intervallo dentro la presenza e senza sovrapporsi ad altre effettive | nuova riga `origine=correzione, sostituisce_id=orig`; `orig.superata_da_id=nuova` |
| Dividi | attività chiusa, istante strettamente interno, motivo | due nuove righe `origine=divisione` (prima parte = destinazione originale, seconda = scelta); `orig.superata_da_id=prima` |
| Aggiungi intervallo dimenticato | dentro presenza, nessuna sovrapposizione, motivo | nuova riga `origine=manuale` |
| Annulla | motivo | `annullata=true` (resta visibile) |
| Correggi entrata/uscita | motivo, attività/pause restano dentro | aggiorna `entrata_at`/`uscita_at`; `*_registrata_at` invariati; audit `correzione` |

Lo storico di un'attività si ricostruisce seguendo `sostituisce_id` (`storicoAttivita()`).

## 9. Dal giorno al mese

`costruisciSnapshotMese()` calcola ogni presenza del mese **una sola volta** con il motore e somma i valori giornalieri in millisecondi. Ogni giorno conserva anomalie (solo avvisi/errori e giornata aperta) e numero di correzioni. L'impronta (hash dello snapshot) permette di rilevare se i dati sono cambiati dopo la generazione (conferma rifiutata, test T15).

## 10. Esecuzione lato server (Fase 2)

Opzioni valutate (D-08): (a) Edge Function che importa lo stesso modulo TypeScript del dominio — un'unica implementazione, raccomandata; (b) porting in PL/pgSQL con `tstzmultirange` (PG 14+), più vicino ai dati ma con doppia manutenzione. In entrambi i casi gli esempi E1–E17 diventano test di non regressione condivisi e lo snapshot registra `motore_versione`.
