-- Verifica funzionale della sincronizzazione (0016) su un PostgreSQL LOCALE con schema auth simulato.
-- Uso: psql -f /tmp/auth-stub.sql -f database/schema.sql, poi questo file (database nuovo). Atteso: solo righe OK.
-- auth-stub: schema auth con auth.uid() = current_setting('test.uid'), ruoli anon/authenticated.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into app.profili (id, nome, cognome, email, ruolo, amministratore_operativo, username) values
 ('00000000-0000-4000-8000-0000000000a1','Ada','Admin','a@x.it','admin',false,'comphas'),
 ('00000000-0000-4000-8000-0000000000b1','Luca','Op','l@x.it','operaio',true,'luca'),
 ('00000000-0000-4000-8000-0000000000c1','Mario','Op','m@x.it','operaio',false,'mario');
-- i profili esistenti prima della 0016 vengono copiati dalla migrazione: qui li aggiungiamo a mano
insert into app.sync_record (entita, id, dati, row_version) select 'profili', id::text, jsonb_build_object('id', id, 'nome', nome), 1 from app.profili;

create function pg_temp.chiama(uid text, req jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('test.uid', uid, true);
  return public.sync_apply(req);
exception when others then return jsonb_build_object('errore', sqlerrm, 'codice', sqlstate);
end $$;
create function pg_temp.leggi(uid text) returns jsonb language plpgsql as $$
begin perform set_config('test.uid', uid, true); return public.sync_pull(0, 500); end $$;
create function pg_temp.op(ent text, id text, base int, payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('op_id', gen_random_uuid(), 'device_id', 'dev-test', 'entita', ent, 'entita_id', id, 'base_versione', base, 'payload', payload || jsonb_build_object('id', id)) $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond then raise warning 'OK   %', msg; else raise warning 'FAIL %', msg; end if; end $$;

do $$
declare
  A text := '00000000-0000-4000-8000-0000000000a1'; L text := '00000000-0000-4000-8000-0000000000b1'; M text := '00000000-0000-4000-8000-0000000000c1';
  P1 text := gen_random_uuid(); R1 text := gen_random_uuid(); C1 text := gen_random_uuid(); K1 text := gen_random_uuid(); X text := gen_random_uuid();
  req jsonb; r jsonb; r2 jsonb;
begin
  r := pg_temp.chiama('', pg_temp.op('presenze', P1, 0, jsonb_build_object('operaio_id', L, 'data_lavoro', '2026-11-20')));
  perform pg_temp.ok(r ? 'errore', 'senza utente: rifiutato');
  req := pg_temp.op('presenze', P1, 0, jsonb_build_object('operaio_id', L, 'data_lavoro', '2026-11-20'));
  r := pg_temp.chiama(L, req);
  perform pg_temp.ok(r ->> 'esito' = 'ok' and (r ->> 'row_version')::int = 1, 'Luca registra la propria presenza');
  r2 := pg_temp.chiama(L, req);
  perform pg_temp.ok(r2 = r, 'stesso op_id → stessa risposta (idempotenza)');
  r := pg_temp.chiama(L, pg_temp.op('presenze', P1, 0, jsonb_build_object('operaio_id', L, 'data_lavoro', '2026-11-20', 'note', 'x')));
  perform pg_temp.ok(r ->> 'esito' = 'conflitto', 'versione superata → conflitto');
  r := pg_temp.chiama(L, pg_temp.op('presenze', gen_random_uuid()::text, 0, jsonb_build_object('operaio_id', M, 'data_lavoro', '2026-11-20')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Luca non scrive presenze di Mario');
  r := pg_temp.chiama(M, pg_temp.op('presenze', P1, 1, jsonb_build_object('operaio_id', M, 'data_lavoro', '2026-11-20')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Mario non si appropria della presenza di Luca');
  r := pg_temp.chiama(L, pg_temp.op('rapportini', R1, 0, jsonb_build_object('redatto_da', L, 'stato', 'completato', 'data_lavoro', '2026-11-20', 'fase_invio', 'inviato', 'operai_ids', jsonb_build_array(L, M))));
  perform pg_temp.ok(r -> 'patch' ->> 'numero' = 'R-2026-0001', 'numero definitivo del rapportino');
  r := pg_temp.chiama(L, pg_temp.op('rapportini', R1, 1, jsonb_build_object('redatto_da', L, 'stato', 'completato', 'data_lavoro', '2026-11-20', 'fase_invio', 'approvato', 'numero', 'R-2026-0001')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Luca non approva il proprio rapporto');
  r := pg_temp.chiama(M, pg_temp.op('rapportini', R1, 1, jsonb_build_object('redatto_da', M, 'stato', 'completato', 'data_lavoro', '2026-11-20')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Mario non modifica il rapporto di Luca');
  r := pg_temp.chiama(A, pg_temp.op('rapportini', R1, 1, jsonb_build_object('redatto_da', L, 'stato', 'completato', 'data_lavoro', '2026-11-20', 'fase_invio', 'approvato', 'numero', 'R-2026-0001', 'operai_ids', jsonb_build_array(L, M))));
  perform pg_temp.ok(r ->> 'esito' = 'ok', 'Comphas approva');
  r := pg_temp.chiama(L, pg_temp.op('rapportini', R1, 2, jsonb_build_object('redatto_da', L, 'stato', 'completato', 'data_lavoro', '2026-11-20', 'fase_invio', 'inviato', 'numero', 'R-2026-0001', 'descrizione_lavoro', 'modifica silenziosa')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'dopo l''approvazione Luca non modifica');
  r := pg_temp.chiama(L, pg_temp.op('stati_amministrativi', gen_random_uuid()::text, 0, jsonb_build_object('entita', 'rapportino', 'entita_id', R1, 'escluso', true)));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Luca non gestisce lo storico amministrativo');
  r := pg_temp.chiama(A, pg_temp.op('stati_amministrativi', gen_random_uuid()::text, 0, jsonb_build_object('entita', 'rapportino', 'entita_id', R1, 'escluso', true)));
  perform pg_temp.ok(r ->> 'esito' = 'ok', 'Comphas gestisce lo storico');
  r := pg_temp.chiama(M, pg_temp.op('clienti', C1, 0, jsonb_build_object('ragione_sociale', 'Nuovo dal campo')));
  perform pg_temp.ok(r ->> 'esito' = 'ok', 'operaio crea un cliente dal campo');
  r := pg_temp.chiama(M, pg_temp.op('clienti', C1, 1, jsonb_build_object('ragione_sociale', 'Cambiato')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'operaio non modifica un cliente esistente');
  r := pg_temp.chiama(L, pg_temp.op('clienti', C1, 1, jsonb_build_object('ragione_sociale', 'Nuovo dal campo Srl')));
  perform pg_temp.ok(r ->> 'esito' = 'ok', 'amministratore operativo modifica il cliente');
  r := pg_temp.chiama(L, pg_temp.op('profili', L, 1, jsonb_build_object('nome', 'Luca', 'ruolo', 'admin')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Luca non modifica i profili (né il proprio ruolo)');
  -- cartellino: generato da Comphas, confermato da Luca, poi mese bloccato
  r := pg_temp.chiama(A, pg_temp.op('cartellini_mensili', K1, 0, jsonb_build_object('operaio_id', L, 'anno', 2026, 'mese', 10, 'stato', 'da_confermare_operaio', 'versione_corrente', 1)));
  r := pg_temp.chiama(L, pg_temp.op('cartellini_mensili', K1, 1, jsonb_build_object('operaio_id', L, 'anno', 2026, 'mese', 10, 'stato', 'confermato_operaio', 'versione_corrente', 1)));
  perform pg_temp.ok(r -> 'patch' ->> 'stato' = 'in_attesa_approvazione' and jsonb_array_length(r -> 'extra') = 1, 'conferma del cartellino ricevuta dal server');
  r := pg_temp.chiama(L, pg_temp.op('cartellini_mensili', K1, 2, jsonb_build_object('operaio_id', L, 'anno', 2026, 'mese', 10, 'stato', 'approvato', 'versione_corrente', 1)));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'Luca non approva il proprio cartellino');
  r := pg_temp.chiama(L, pg_temp.op('presenze', gen_random_uuid()::text, 0, jsonb_build_object('operaio_id', L, 'data_lavoro', '2026-10-15')));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'mese in verifica: niente nuove presenze');
  -- consumi duplicati
  r := pg_temp.chiama(L, pg_temp.op('rapportini', X, 0, jsonb_build_object('redatto_da', L, 'stato', 'completato', 'data_lavoro', '2026-11-21')));
  r := pg_temp.chiama(L, pg_temp.op('movimenti_magazzino', gen_random_uuid()::text, 0, jsonb_build_object('operaio_id', L, 'tipo', 'consumo', 'rapportino_id', X, 'chiave_univoca', 'consumo:x:1')));
  r2 := pg_temp.chiama(L, pg_temp.op('movimenti_magazzino', gen_random_uuid()::text, 0, jsonb_build_object('operaio_id', L, 'tipo', 'consumo', 'rapportino_id', X, 'chiave_univoca', 'consumo:x:1')));
  perform pg_temp.ok(r ->> 'esito' = 'ok' and r2 -> 'patch' ? 'duplicato_di', 'consumo duplicato marcato');
  r := pg_temp.chiama(L, pg_temp.op('movimenti_magazzino', gen_random_uuid()::text, 0, jsonb_build_object('operaio_id', L, 'tipo', 'carico', 'rapportino_id', X)));
  perform pg_temp.ok(r ->> 'codice' = '42501', 'operaio non registra carichi di magazzino');
  -- lettura
  r := pg_temp.leggi(M);
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'presenze'), 'Mario non riceve le presenze di Luca');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'rapportini' and e -> 'dati' ->> 'id' = R1), 'Mario riceve il rapporto in cui compare');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' in ('stati_amministrativi', 'cartellini_mensili')), 'Mario non riceve storico e cartellini altrui');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'clienti'), 'Mario riceve i clienti');
  r := pg_temp.leggi(L);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'cartellini_mensili') and exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'approvazioni_cartellino'), 'Luca riceve il proprio cartellino e il registro');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'stati_amministrativi'), 'Luca non riceve lo storico amministrativo');
  r := pg_temp.leggi(A);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'presenze') and exists (select 1 from jsonb_array_elements(r -> 'record') e where e ->> 'entita' = 'stati_amministrativi'), 'Comphas riceve tutto');
  r := public.sync_pull(0, 2) ;
exception when others then raise warning 'FAIL eccezione: %', sqlerrm;
end $$;
-- paginazione e accesso diretto con i ruoli dell'API
select pg_temp.ok((select (pg_temp.leggi('00000000-0000-4000-8000-0000000000a1')) is not null), 'pull admin');
do $$ declare r jsonb; begin perform set_config('test.uid', '00000000-0000-4000-8000-0000000000a1', true); r := public.sync_pull(0, 2);
  perform pg_temp.ok(jsonb_array_length(r -> 'record') = 2 and (r ->> 'altri')::boolean, 'paginazione a blocchi'); end $$;
set role authenticated;
do $$ begin perform count(*) from app.sync_record; raise warning 'FAIL accesso diretto consentito'; exception when insufficient_privilege then raise warning 'OK   nessun accesso diretto alle tabelle'; end $$;
reset role;
set role anon;
do $$ begin perform public.sync_pull(0, 10); raise warning 'FAIL anon esegue sync_pull'; exception when insufficient_privilege then raise warning 'OK   anon non può chiamare le funzioni'; end $$;
reset role;
