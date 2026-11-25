-- =====================================================================================
-- Verifica funzionale dello schema su un database LOCALE usa-e-getta (vedi database/README.md).
-- Ogni blocco prova una regola: i casi validi devono passare, quelli non validi devono fallire.
-- Non è un test di sicurezza: non verifica permessi, RLS o autenticazione.
-- =====================================================================================
\set ON_ERROR_STOP on
set search_path = app, public;
set timezone = 'Europe/Rome';

create or replace function pg_temp.atteso_errore(sql text, descrizione text)
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'OK (rifiutato come previsto): % → %', descrizione, sqlerrm;
    return;
  end;
  raise exception 'FALLITO: % doveva essere rifiutato', descrizione;
end $$;

-- Dati di base -------------------------------------------------------------------------
insert into profili (id, nome, cognome, email, ruolo) values
  ('00000000-0000-4000-8000-000000000001', 'Ada', 'Admin', 'admin@test.local', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'Otto', 'Operaio', 'op@test.local', 'operaio');
insert into clienti (id, ragione_sociale, partita_iva) values
  ('00000000-0000-4000-8000-00000000000a', 'Cliente A', '01234567890'),
  ('00000000-0000-4000-8000-00000000000b', 'Cliente B', null);
insert into sedi_cliente (id, cliente_id, nome, cap, provincia) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Sede A', '40121', 'BO');
insert into dispositivi (id) values ('tablet-1');

-- Sede di un altro cliente ----------------------------------------------------------------
select pg_temp.atteso_errore($$insert into interventi (codice, cliente_id, sede_id, titolo, tipo, stato, data_programmata)
  values ('X1', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000a1', 'Prova', 'manutenzione', 'programmato', '2026-03-10')$$,
  'intervento con sede di un altro cliente');

insert into interventi (id, codice, cliente_id, sede_id, titolo, tipo, stato, data_programmata, ora_inizio)
  values ('00000000-0000-4000-8000-0000000000c1', 'INT-2026-101', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
          'Manutenzione caldaia', 'manutenzione', 'programmato', '2026-03-10', '08:00');
insert into intervento_operai (intervento_id, operaio_id, ruolo) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000002', 'responsabile');
select pg_temp.atteso_errore($$insert into intervento_operai (intervento_id, operaio_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000002')$$, 'stesso operaio assegnato due volte');

-- Presenze ------------------------------------------------------------------------------
insert into presenze (id, operaio_id, data_lavoro, entrata_at, entrata_registrata_at, ultimo_segnale_at)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', '2026-03-10',
          '2026-03-10 08:00+01', '2026-03-10 08:00+01', '2026-03-10 08:00+01');
select pg_temp.atteso_errore($$insert into presenze (operaio_id, data_lavoro, entrata_at, entrata_registrata_at, ultimo_segnale_at)
  values ('00000000-0000-4000-8000-000000000002', '2026-03-10', '2026-03-10 09:00+01', '2026-03-10 09:00+01', '2026-03-10 09:00+01')$$,
  'seconda presenza aperta per lo stesso operaio');
select pg_temp.atteso_errore($$insert into presenze (operaio_id, data_lavoro, entrata_at, uscita_at, entrata_registrata_at, ultimo_segnale_at)
  values ('00000000-0000-4000-8000-000000000001', '2026-03-11', '2026-03-10 08:00+01', '2026-03-10 09:00+01', '2026-03-10 08:00+01', '2026-03-10 08:00+01')$$,
  'data_lavoro diversa dal giorno dell''entrata');

-- Attività: destinazione coerente, dentro la presenza, un solo timer ---------------------
insert into attivita_lavoro (id, presenza_id, operaio_id, tipo, cliente_id, intervento_id, inizio_at, fine_at)
  values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002',
          'lavoro_cliente', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c1', '2026-03-10 08:00+01', '2026-03-10 12:00+01');
select pg_temp.atteso_errore($$insert into attivita_lavoro (presenza_id, operaio_id, tipo, inizio_at)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'lavoro_cliente', '2026-03-10 12:00+01')$$,
  'lavoro cliente senza cliente');
select pg_temp.atteso_errore($$insert into attivita_lavoro (presenza_id, operaio_id, tipo, codice_interno, inizio_at, fine_at)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'interna', 'magazzino', '2026-03-10 07:00+01', '2026-03-10 07:30+01')$$,
  'attività prima dell''entrata');
insert into attivita_lavoro (presenza_id, operaio_id, tipo, inizio_at)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'da_definire', '2026-03-10 13:00+01');
select pg_temp.atteso_errore($$insert into attivita_lavoro (presenza_id, operaio_id, tipo, inizio_at)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'da_definire', '2026-03-10 13:30+01')$$,
  'secondo timer attivo per lo stesso operaio');

-- Correzioni: l'intervallo chiuso non si sovrascrive, si sostituisce -----------------------
select pg_temp.atteso_errore($$update attivita_lavoro set fine_at = '2026-03-10 12:30+01' where id = '00000000-0000-4000-8000-0000000000f1'$$,
  'modifica diretta di un intervallo chiuso');
select pg_temp.atteso_errore($$insert into attivita_lavoro (presenza_id, operaio_id, tipo, cliente_id, inizio_at, fine_at, origine, sostituisce_id)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'lavoro_cliente', '00000000-0000-4000-8000-00000000000b',
          '2026-03-10 08:00+01', '2026-03-10 12:30+01', 'correzione', '00000000-0000-4000-8000-0000000000f1')$$,
  'correzione senza motivo');
begin;
insert into attivita_lavoro (id, presenza_id, operaio_id, tipo, cliente_id, inizio_at, fine_at, origine, sostituisce_id, motivo_correzione)
  values ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'lavoro_cliente',
          '00000000-0000-4000-8000-00000000000b', '2026-03-10 08:00+01', '2026-03-10 12:30+01', 'correzione', '00000000-0000-4000-8000-0000000000f1', 'Cliente sbagliato');
update attivita_lavoro set superata_da_id = '00000000-0000-4000-8000-0000000000f2' where id = '00000000-0000-4000-8000-0000000000f1';
commit;
select pg_temp.atteso_errore($$update attivita_lavoro set superata_da_id = null where id = '00000000-0000-4000-8000-0000000000f1'$$,
  'riattivare un''attività già sostituita');
do $$ begin
  if (select count(*) from v_attivita_effettive where presenza_id = '00000000-0000-4000-8000-0000000000e1') <> 2 then
    raise exception 'FALLITO: attese 2 attività effettive';
  end if;
  raise notice 'OK: storico conservato, 2 attività effettive su 3 righe';
end $$;

-- Pause --------------------------------------------------------------------------------
insert into pause_presenza (presenza_id, operaio_id, tipo, inizio_at, fine_at) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'pranzo', '2026-03-10 12:30+01', '2026-03-10 13:00+01');
select pg_temp.atteso_errore($$insert into pause_presenza (presenza_id, operaio_id, tipo, inizio_at, fine_at) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'breve', '2026-03-10 12:45+01', '2026-03-10 12:50+01')$$,
  'pause sovrapposte nella stessa presenza');

-- Uscita: chiusura del timer e poi della presenza; valori registrati immutabili ------------
update attivita_lavoro set fine_at = '2026-03-10 17:00+01', chiusura_automatica = true
  where presenza_id = '00000000-0000-4000-8000-0000000000e1' and fine_at is null;
update presenze set uscita_at = '2026-03-10 17:00+01', uscita_registrata_at = '2026-03-10 17:00+01' where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.atteso_errore($$update presenze set entrata_registrata_at = '2026-03-10 07:00+01' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'modifica del valore di entrata registrato in origine');
select pg_temp.atteso_errore($$update presenze set uscita_at = '2026-03-10 15:00+01' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'uscita corretta prima della fine delle attività');
select pg_temp.atteso_errore($$update presenze set uscita_at = '2026-03-11 09:00+01' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'presenza oltre 24 ore');

-- Rapportino, ritorno collegato ------------------------------------------------------------
insert into rapportini (id, numero, numero_provvisorio, tipo, data_lavoro, cliente_id, sede_id, intervento_id, redatto_da,
                        descrizione_lavoro, esito, note_interne, device_id)
  values ('00000000-0000-4000-8000-0000000000d1', 'R-2026-0001', 'B-T1-001', 'rapido', '2026-03-10', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000002',
          'Smontata valvola difettosa', 'ritorno_necessario', 'Montare valvola nuova', 'tablet-1');
insert into rapportino_attivita values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f2');
select pg_temp.atteso_errore($$insert into rapportini (numero_provvisorio, tipo, data_lavoro, cliente_id, redatto_da, descrizione_lavoro, esito, device_id)
  values ('B-T1-002', 'rapido', '2026-03-10', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000002',
          'Lavoro da finire domani', 'da_ultimare', 'tablet-1')$$, 'esito da ultimare senza note');
insert into followup (id, tipo, rapportino_origine_id, intervento_origine_id, cliente_id, sede_id, motivo)
  values ('00000000-0000-4000-8000-0000000000b1', 'ritorno', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'Montare valvola nuova');
select pg_temp.atteso_errore($$update followup set stato = 'chiuso' where id = '00000000-0000-4000-8000-0000000000b1'$$,
  'ritorno chiuso senza rapportino di chiusura');
insert into interventi (id, codice, cliente_id, sede_id, titolo, tipo, stato, data_programmata, followup_origine_id)
  values ('00000000-0000-4000-8000-0000000000c2', 'INT-2026-102', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
          'Ritorno: valvola', 'ritorno', 'programmato', '2026-03-12', '00000000-0000-4000-8000-0000000000b1');
update followup set stato = 'pianificato', intervento_ritorno_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.atteso_errore($$update rapportini set descrizione_lavoro = 'Testo cambiato dopo' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'modifica di un rapportino completato');

-- Cartellino: transizioni solo se registrate e ammesse; versioni e storico immutabili -------
insert into cartellini_mensili (id, operaio_id, anno, mese) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 2026, 3);
select pg_temp.atteso_errore($$update cartellini_mensili set stato = 'approvato', versione_corrente = 1, versione_approvata = 1
  where id = '00000000-0000-4000-8000-000000000101'$$, 'approvazione diretta senza passaggi');
begin;
insert into cartellino_versioni (cartellino_id, versione, giorni, totali, impronta, motivo)
  values ('00000000-0000-4000-8000-000000000101', 1, '[]', '{"netta_ms": 0, "attribuite_ms": 0, "non_attribuite_ms": 0}', 'abc', 'Chiusura del mese');
insert into approvazioni_cartellino (cartellino_id, versione, azione, stato_precedente, stato_nuovo, utente_id, ruolo_utente)
  values ('00000000-0000-4000-8000-000000000101', 1, 'genera', 'in_compilazione', 'da_confermare_operaio', '00000000-0000-4000-8000-000000000001', 'admin');
update cartellini_mensili set stato = 'da_confermare_operaio', versione_corrente = 1 where id = '00000000-0000-4000-8000-000000000101';
commit;
-- Mese bloccato
select pg_temp.atteso_errore($$insert into pause_presenza (presenza_id, operaio_id, tipo, inizio_at, fine_at) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 'breve', '2026-03-10 15:00+01', '2026-03-10 15:10+01')$$,
  'pausa aggiunta in un mese bloccato');
-- Conferma da parte di un utente diverso dal titolare
select pg_temp.atteso_errore($$
  insert into approvazioni_cartellino (cartellino_id, versione, azione, stato_precedente, stato_nuovo, utente_id, ruolo_utente)
  values ('00000000-0000-4000-8000-000000000101', 1, 'conferma', 'da_confermare_operaio', 'confermato_operaio', '00000000-0000-4000-8000-000000000001', 'operaio');
  update cartellini_mensili set stato = 'confermato_operaio' where id = '00000000-0000-4000-8000-000000000101'$$,
  'conferma eseguita da un utente diverso dal titolare');
select pg_temp.atteso_errore($$update approvazioni_cartellino set motivazione = 'x'$$, 'modifica del registro approvazioni');
select pg_temp.atteso_errore($$delete from cartellino_versioni$$, 'cancellazione di una versione');
select pg_temp.atteso_errore($$
  insert into approvazioni_cartellino (cartellino_id, versione, azione, stato_precedente, stato_nuovo, utente_id, ruolo_utente)
  values ('00000000-0000-4000-8000-000000000101', 1, 'segnala_discrepanza', 'da_confermare_operaio', 'da_correggere', '00000000-0000-4000-8000-000000000002', 'operaio');
  update cartellini_mensili set stato = 'da_correggere' where id = '00000000-0000-4000-8000-000000000101'$$,
  'discrepanza senza motivazione');

-- Numerazione e idempotenza ---------------------------------------------------------------
do $$ begin
  if app.prossimo_numero('rapportini', 2026::smallint) <> 1 or app.prossimo_numero('rapportini', 2026::smallint) <> 2 then
    raise exception 'FALLITO: numerazione';
  end if;
  raise notice 'OK: numerazione progressiva';
end $$;
insert into sync_operazioni (op_id, device_id, entita, entita_id, base_versione, esito, risposta)
  values ('00000000-0000-4000-8000-000000000201', 'tablet-1', 'presenze', '00000000-0000-4000-8000-0000000000e1', 0, 'ok', '{}');
select pg_temp.atteso_errore($$insert into sync_operazioni (op_id, device_id, entita, entita_id, base_versione, esito, risposta)
  values ('00000000-0000-4000-8000-000000000201', 'tablet-1', 'presenze', '00000000-0000-4000-8000-0000000000e1', 0, 'ok', '{}')$$,
  'stessa operazione applicata due volte');
select pg_temp.atteso_errore($$delete from presenze$$, 'cancellazione fisica di una presenza');

do $$ begin
  if (select row_version from presenze where id = '00000000-0000-4000-8000-0000000000e1') < 2 then
    raise exception 'FALLITO: row_version non incrementata';
  end if;
  raise notice 'OK: row_version incrementata dagli UPDATE';
end $$;

-- Richieste di correzione (Fase 3) --------------------------------------------------------
insert into richieste_correzione (id, operaio_id, data_lavoro, presenza_id, messaggio)
  values ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000002', '2026-03-10',
          '00000000-0000-4000-8000-0000000000e1', 'Uscita reale alle 17:30, non alle 17:00');
select pg_temp.atteso_errore($$update richieste_correzione set stato = 'risolta', gestita_da = '00000000-0000-4000-8000-000000000001', gestita_at = now()
  where id = '00000000-0000-4000-8000-000000000301'$$, 'richiesta risolta senza risposta');
select pg_temp.atteso_errore($$update richieste_correzione set stato = 'presa_in_carico' where id = '00000000-0000-4000-8000-000000000301'$$,
  'presa in carico senza autore e istante');
update richieste_correzione set stato = 'respinta', risposta = 'Orario confermato dal cliente', gestita_da = '00000000-0000-4000-8000-000000000001', gestita_at = now()
  where id = '00000000-0000-4000-8000-000000000301';
select pg_temp.atteso_errore($$update richieste_correzione set stato = 'aperta', gestita_da = null, gestita_at = null where id = '00000000-0000-4000-8000-000000000301'$$,
  'riapertura di una richiesta chiusa');

-- Magazzino e materiali (Fase 5) --------------------------------------------------------------
insert into materiali (id, codice, nome, categoria, unita, prezzo_acquisto, prezzo_vendita, scorta_minima)
  values ('00000000-0000-4000-8000-000000000401', 'IDR-003', 'Valvola a sfera 1/2"', 'Idraulica', 'pz', 6.2, 14, 10);
select pg_temp.atteso_errore($$insert into materiali (codice, nome, unita) values ('IDR-003', 'Doppione', 'pz')$$, 'codice materiale duplicato');
select pg_temp.atteso_errore($$insert into materiali (codice, nome, unita, prezzo_acquisto) values ('X-1', 'Negativo', 'pz', -1)$$, 'prezzo di acquisto negativo');
insert into magazzini (id, codice, nome, tipo) values ('00000000-0000-4000-8000-000000000411', 'MAG-01', 'Centrale', 'sede');
insert into movimenti_magazzino (id, materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento, documento)
  values ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'carico', 20, 6.2, '2026-03-01', 'DDT 1');
select pg_temp.atteso_errore($$insert into movimenti_magazzino (materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento)
  values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'scarico', -2, 6.2, '2026-03-02')$$, 'scarico senza motivo');
select pg_temp.atteso_errore($$insert into movimenti_magazzino (materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento)
  values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'consumo', -2, 6.2, '2026-03-10')$$, 'consumo non collegato a un rapportino');
insert into movimenti_magazzino (id, materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento, rapportino_id, riga_rapportino_id, intervento_id, cliente_id, chiave_univoca)
  values ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'consumo', -3, 6.2, '2026-03-10',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a',
          'consumo:00000000-0000-4000-8000-0000000000d1:00000000-0000-4000-8000-000000000431');
select pg_temp.atteso_errore($$insert into movimenti_magazzino (materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento, rapportino_id, riga_rapportino_id, cliente_id, chiave_univoca)
  values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'consumo', -3, 6.2, '2026-03-10',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-00000000000a',
          'consumo:00000000-0000-4000-8000-0000000000d1:00000000-0000-4000-8000-000000000431')$$, 'doppio scarico della stessa riga di rapportino');
select pg_temp.atteso_errore($$update movimenti_magazzino set quantita = -1 where id = '00000000-0000-4000-8000-000000000422'$$, 'modifica di un movimento registrato');
select pg_temp.atteso_errore($$delete from movimenti_magazzino where id = '00000000-0000-4000-8000-000000000422'$$, 'cancellazione di un movimento');
-- Correzione: nuovo movimento collegato, allo stesso costo; poi il prezzo cambia in anagrafica.
insert into movimenti_magazzino (materiale_id, magazzino_id, tipo, quantita, costo_unitario, data_riferimento, motivo, rapportino_id, riga_rapportino_id, cliente_id, corregge_id)
  values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000411', 'correzione_consumo', 1, 6.2, '2026-03-10', 'Una valvola rientrata',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000422');
update materiali set prezzo_acquisto = 9 where id = '00000000-0000-4000-8000-000000000401';
do $$ begin
  if (select giacenza from v_giacenze where materiale_id = '00000000-0000-4000-8000-000000000401') <> 18 then
    raise exception 'FALLITO: giacenza attesa 18';
  end if;
  if (select sum(costo) from v_costi_consumi where materiale_id = '00000000-0000-4000-8000-000000000401') <> 12.40 then
    raise exception 'FALLITO: il costo dei consumi deve restare quello storico (2 × 6,20)';
  end if;
  raise notice 'OK: giacenza dai movimenti e costi storici non modificati dal cambio prezzo';
end $$;

\echo 'VERIFICA COMPLETATA: tutte le regole si comportano come previsto'
