-- =====================================================================================
-- 0016 – Sincronizzazione reale (Fase 15)
-- Applicata al progetto Supabase "worklog" il 27/11/2026, con autorizzazione.
--
-- Il dispositivo invia le operazioni della sua coda (outbox) con public.sync_apply e riceve le
-- modifiche degli altri con public.sync_pull. Il server replica le regole del server simulato
-- del prototipo (src/sync/mock-remote-api.ts):
--   • idempotenza per op_id (un invio ripetuto restituisce la stessa risposta);
--   • controllo di concorrenza ottimistico con row_version → "conflitto";
--   • numero definitivo dei rapportini (R-AAAA-NNNN);
--   • ricezione della conferma del cartellino (in_attesa_approvazione + registro);
--   • consumi di magazzino duplicati marcati con duplicato_di (chiave univoca).
--
-- Archivio: app.sync_record conserva l'ultima versione di ogni record come JSON (lo stesso
-- formato dell'app). Le tabelle normalizzate 0001–0015 restano il modello di riferimento per
-- una futura proiezione/reportistica: in questa fase NON vengono alimentate (decisione D-49).
--
-- Sicurezza:
--   • nessuna tabella è leggibile o scrivibile direttamente (RLS attiva senza policy, schema
--     "app" non esposto, privilegi revocati ad anon/authenticated);
--   • le due funzioni sono SECURITY DEFINER e verificano utente e permessi per ogni record:
--       - amministratore: tutto;
--       - amministratore operativo: in più clienti, sedi, interventi, squadre e ritorni;
--       - operaio: i propri dati (presenze, pause, attività, rapportini, allegati, cartellini,
--         richieste, imprevisti, consumi), nuovi clienti/sedi dal campo, stato degli interventi
--         a cui è assegnato, ritorni generati dai propri rapportini;
--     in lettura l'operaio riceve anagrafiche, interventi e magazzino, più i propri dati e i
--     rapportini in cui compare.
-- Foto e firme viaggiano nel record dell'allegato (immagini già ridimensionate dall'app).
-- =====================================================================================
set search_path = app, public;

create table app.sync_record (
  entita       text not null,
  id           text not null,
  dati         jsonb not null,
  row_version  integer not null check (row_version > 0),
  -- utente "proprietario" (per la visibilità in lettura); null = dato condiviso
  proprietario uuid,
  seq          bigint generated always as identity,
  aggiornato_at timestamptz not null default now(),
  aggiornato_da uuid,
  device_id    text,
  primary key (entita, id)
);
create unique index sync_record_seq_uq on app.sync_record (seq);
create index sync_record_proprietario_idx on app.sync_record (proprietario, seq);

-- Idempotenza: si usa il registro app.sync_operazioni (0007, solo inserimento) con i
-- dispositivi registrati in app.dispositivi; numerazione con app.prossimo_numero (0007).
create table app.sync_chiavi (chiave text primary key, entita_id text not null);

alter table app.sync_record enable row level security;
alter table app.sync_chiavi enable row level security;

-- Difesa in profondità: RLS attiva (senza policy = nessun accesso diretto) su tutte le tabelle
-- applicative e nessun privilegio sullo schema per i ruoli dell'API.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r' loop
    execute format('alter table app.%I enable row level security', t.relname);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema app from anon, authenticated';
    execute 'revoke usage on schema app from anon, authenticated';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- Utente corrente (profilo attivo collegato a auth.uid()).
-- -------------------------------------------------------------------------------------
create or replace function app.sync_utente() returns app.profili
language plpgsql stable security definer set search_path = '' as $$
declare p app.profili;
begin
  select * into p from app.profili where id = auth.uid() and attivo and deleted_at is null;
  return p;
end $$;

-- Proprietario di un record (per i permessi e la visibilità).
create or replace function app.sync_proprietario(p_entita text, d jsonb) returns uuid
language sql immutable set search_path = '' as $$
  select (case p_entita
    when 'presenze' then d ->> 'operaio_id'
    when 'pause_presenza' then d ->> 'operaio_id'
    when 'attivita_lavoro' then d ->> 'operaio_id'
    when 'imprevisti' then d ->> 'operaio_id'
    when 'richieste_correzione' then d ->> 'operaio_id'
    when 'cartellini_mensili' then d ->> 'operaio_id'
    when 'cartellino_versioni' then d ->> 'created_by'
    when 'approvazioni_cartellino' then coalesce(d ->> 'utente_id', d ->> 'created_by')
    when 'rapportini' then d ->> 'redatto_da'
    when 'allegati' then d ->> 'created_by'
    when 'movimenti_magazzino' then d ->> 'operaio_id'
    else null end)::uuid
$$;

-- Mese bloccato per l'operaio: stesse regole del dispositivo (modificabile solo in compilazione, da correggere, riaperto).
create or replace function app.sync_mese_bloccato(p_operaio uuid, p_data text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_data is not null and exists (
    select 1 from app.sync_record c
    where c.entita = 'cartellini_mensili' and c.proprietario = p_operaio
      and (c.dati ->> 'anno')::int = left(p_data, 4)::int and (c.dati ->> 'mese')::int = substr(p_data, 6, 2)::int
      and c.dati ->> 'stato' not in ('in_compilazione', 'da_correggere', 'riaperto'))
$$;

-- Permesso di scrittura per un operaio (l'amministratore può tutto).
create or replace function app.sync_puo_scrivere(u app.profili, p_entita text, nuovo jsonb, esistente jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  operativo boolean := coalesce(u.amministratore_operativo, false);
  uid text := u.id::text;
  rif text;
begin
  if u.ruolo = 'admin' then return true; end if;
  case p_entita
    when 'cartellini_mensili' then
      -- l'operaio conferma, segnala una discrepanza o rigenera; non approva mai
      return nuovo ->> 'operaio_id' = uid and (esistente is null or esistente ->> 'operaio_id' = uid)
        and nuovo ->> 'stato' in ('in_compilazione', 'da_confermare_operaio', 'confermato_operaio', 'da_correggere')
        and (esistente is null or esistente ->> 'stato' in ('in_compilazione', 'da_confermare_operaio', 'confermato_operaio', 'da_correggere', 'riaperto'));
    when 'presenze', 'pause_presenza', 'attivita_lavoro' then
      -- come sul dispositivo: niente modifiche a un mese il cui cartellino è in verifica o approvato
      return nuovo ->> 'operaio_id' = uid and (esistente is null or esistente ->> 'operaio_id' = uid)
        and not app.sync_mese_bloccato(u.id, case when p_entita = 'presenze' then nuovo ->> 'data_lavoro'
          else (select r.dati ->> 'data_lavoro' from app.sync_record r where r.entita = 'presenze' and r.id = nuovo ->> 'presenza_id') end);
    when 'imprevisti', 'richieste_correzione' then
      return nuovo ->> 'operaio_id' = uid and (esistente is null or esistente ->> 'operaio_id' = uid);
    when 'rapportini' then
      -- il redattore scrive i propri; l'amministrazione restituisce/approva (ruolo admin).
      return nuovo ->> 'redatto_da' = uid and (esistente is null or esistente ->> 'redatto_da' = uid)
        and coalesce(nuovo ->> 'fase_invio', 'inviato') not in ('approvato')
        and (esistente is null or coalesce(esistente ->> 'fase_invio', '') <> 'approvato');
    when 'allegati' then
      return coalesce(nuovo ->> 'created_by', uid) = uid and (esistente is null or esistente ->> 'created_by' = uid);
    when 'cartellino_versioni' then
      return exists (select 1 from app.sync_record r where r.entita = 'cartellini_mensili' and r.id = nuovo ->> 'cartellino_id' and r.dati ->> 'operaio_id' = uid);
    when 'approvazioni_cartellino' then
      return nuovo ->> 'utente_id' = uid and nuovo ->> 'ruolo_utente' = 'operaio'
        and exists (select 1 from app.sync_record r where r.entita = 'cartellini_mensili' and r.id = nuovo ->> 'cartellino_id' and r.dati ->> 'operaio_id' = uid);
    when 'movimenti_magazzino' then
      -- consumi dei propri rapportini
      return nuovo ->> 'operaio_id' = uid and nuovo ->> 'tipo' in ('consumo', 'correzione_consumo') and esistente is null
        and exists (select 1 from app.sync_record r where r.entita = 'rapportini' and r.id = nuovo ->> 'rapportino_id' and r.dati ->> 'redatto_da' = uid);
    when 'clienti', 'sedi_cliente' then
      return operativo or esistente is null; -- nuovo cliente/sede dal campo
    when 'interventi' then
      if operativo then return true; end if;
      -- l'operaio aggiorna solo lo stato degli interventi a cui è assegnato
      return esistente is not null and exists (
        select 1 from app.sync_record r where r.entita = 'intervento_operai' and r.dati ->> 'intervento_id' = nuovo ->> 'id'
          and r.dati ->> 'operaio_id' = uid and r.dati ->> 'deleted_at' is null)
        and (nuovo - array['stato', 'updated_at', 'updated_by', 'row_version', 'device_id']) = (esistente - array['stato', 'updated_at', 'updated_by', 'row_version', 'device_id']);
    when 'intervento_operai' then
      return operativo;
    when 'followup' then
      if operativo then return true; end if;
      rif := coalesce(nuovo ->> 'rapportino_chiusura_id', nuovo ->> 'rapportino_origine_id');
      return exists (select 1 from app.sync_record r where r.entita = 'rapportini' and r.id = rif and r.dati ->> 'redatto_da' = uid);
    else
      -- profili, materiali, magazzini, cartellini (generazione), stati_amministrativi, esportazioni…
      return false;
  end case;
end $$;

-- Visibilità in lettura per un operaio.
create or replace function app.sync_puo_leggere(u app.profili, r app.sync_record) returns boolean
language sql stable set search_path = '' as $$
  select u.ruolo = 'admin'
    or r.entita in ('profili', 'clienti', 'sedi_cliente', 'interventi', 'intervento_operai', 'followup', 'materiali', 'magazzini', 'movimenti_magazzino')
    or r.proprietario = u.id
    or (r.entita = 'rapportini' and r.dati -> 'operai_ids' ? u.id::text)
    or (r.entita = 'approvazioni_cartellino' and exists (select 1 from app.sync_record c where c.entita = 'cartellini_mensili' and c.id = r.dati ->> 'cartellino_id' and c.proprietario = u.id))
    or (r.entita = 'cartellino_versioni' and exists (select 1 from app.sync_record c where c.entita = 'cartellini_mensili' and c.id = r.dati ->> 'cartellino_id' and c.proprietario = u.id))
$$;

-- -------------------------------------------------------------------------------------
-- public.sync_apply(req): applica una operazione della coda del dispositivo.
-- req = { op_id, device_id, entita, entita_id, base_versione, payload }
-- -------------------------------------------------------------------------------------
create or replace function public.sync_apply(req jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u app.profili := app.sync_utente();
  v_op uuid := (req ->> 'op_id')::uuid;
  v_entita text := req ->> 'entita';
  v_id text := req ->> 'entita_id';
  v_base integer := coalesce((req ->> 'base_versione')::integer, 0);
  v_payload jsonb := req -> 'payload';
  v_prec jsonb;
  v_rec app.sync_record;
  v_patch jsonb := '{}'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_anno text;
  v_n integer;
  v_app jsonb;
  v_chiave text;
  v_esistente text;
  v_risposta jsonb;
  v_nuova integer;
begin
  if u.id is null then raise exception 'Utente non autorizzato' using errcode = '42501'; end if;
  if v_op is null or v_entita is null or v_id is null or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Richiesta non valida' using errcode = '22023';
  end if;
  if v_entita not in ('profili','clienti','sedi_cliente','interventi','intervento_operai','presenze','pause_presenza','attivita_lavoro',
                      'imprevisti','rapportini','followup','cartellini_mensili','cartellino_versioni','approvazioni_cartellino','allegati',
                      'richieste_correzione','materiali','magazzini','movimenti_magazzino','stati_amministrativi','esportazioni') then
    raise exception 'Entità non sincronizzabile: %', v_entita using errcode = '22023';
  end if;
  if v_payload ->> 'id' is distinct from v_id then raise exception 'Identificativo incoerente' using errcode = '22023'; end if;

  -- idempotenza (serializza gli invii dello stesso op_id)
  perform pg_advisory_xact_lock(hashtext(v_op::text));
  select risposta into v_prec from app.sync_operazioni where op_id = v_op and utente_id = u.id;
  if v_prec is not null then return v_prec; end if;

  select * into v_rec from app.sync_record where entita = v_entita and id = v_id for update;

  if not app.sync_puo_scrivere(u, v_entita, v_payload, v_rec.dati) then
    raise exception 'Operazione non consentita per questo utente (%).', v_entita using errcode = '42501';
  end if;

  if v_base <> coalesce(v_rec.row_version, 0) then
    return jsonb_build_object('esito', 'conflitto', 'op_id', v_op, 'versione_server', coalesce(v_rec.row_version, 0), 'dati_server', coalesce(v_rec.dati, '{}'::jsonb));
  end if;

  -- regole lato server -------------------------------------------------------------
  if v_entita = 'rapportini' and coalesce(v_payload ->> 'stato', '') <> 'bozza' and coalesce(v_payload ->> 'numero', '') = '' then
    v_anno := left(coalesce(v_payload ->> 'data_lavoro', v_now::text), 4);
    v_n := app.prossimo_numero('rapportini', v_anno::smallint);
    v_patch := v_patch || jsonb_build_object('numero', format('R-%s-%s', v_anno, lpad(v_n::text, 4, '0')));
  end if;

  if v_entita = 'cartellini_mensili' and v_payload ->> 'stato' = 'confermato_operaio' then
    v_patch := v_patch || jsonb_build_object('stato', 'in_attesa_approvazione');
    v_app := jsonb_build_object(
      'id', gen_random_uuid(), 'cartellino_id', v_id, 'versione', v_payload -> 'versione_corrente',
      'azione', 'ricezione_server', 'stato_precedente', 'confermato_operaio', 'stato_nuovo', 'in_attesa_approvazione',
      'utente_id', null, 'ruolo_utente', 'sistema', 'motivazione', '', 'eseguita_at', v_now,
      'created_at', v_now, 'created_by', null, 'updated_at', v_now, 'updated_by', null, 'row_version', 1,
      'sync_stato', 'sincronizzato', 'device_id', 'server', 'deleted_at', null);
    insert into app.sync_record (entita, id, dati, row_version, proprietario, aggiornato_da, device_id)
      values ('approvazioni_cartellino', v_app ->> 'id', v_app, 1, (v_payload ->> 'operaio_id')::uuid, u.id, 'server');
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('entita', 'approvazioni_cartellino', 'record', v_app));
  end if;

  if v_entita = 'movimenti_magazzino' and jsonb_typeof(v_payload -> 'chiave_univoca') = 'string' then
    v_chiave := v_payload ->> 'chiave_univoca';
    select entita_id into v_esistente from app.sync_chiavi where chiave = v_chiave;
    if v_esistente is not null and v_esistente <> v_id then
      v_patch := v_patch || jsonb_build_object('duplicato_di', v_esistente);
    elsif v_esistente is null then
      insert into app.sync_chiavi (chiave, entita_id) values (v_chiave, v_id);
    end if;
  end if;

  v_nuova := coalesce(v_rec.row_version, 0) + 1;
  v_payload := (v_payload - 'sync_stato') || v_patch || jsonb_build_object('row_version', v_nuova);
  insert into app.sync_record (entita, id, dati, row_version, proprietario, aggiornato_at, aggiornato_da, device_id)
    values (v_entita, v_id, v_payload, v_nuova, app.sync_proprietario(v_entita, v_payload), v_now, u.id, req ->> 'device_id')
    on conflict (entita, id) do update set
      dati = excluded.dati, row_version = excluded.row_version, proprietario = excluded.proprietario,
      aggiornato_at = excluded.aggiornato_at, aggiornato_da = excluded.aggiornato_da, device_id = excluded.device_id,
      seq = default;

  v_risposta := jsonb_build_object('esito', 'ok', 'op_id', v_op, 'row_version', v_nuova, 'patch', v_patch, 'extra', v_extra, 'ricevuta_at', v_now);
  insert into app.dispositivi (id, utente_id, ultimo_sync_at) values (coalesce(req ->> 'device_id', 'sconosciuto'), u.id, v_now)
    on conflict (id) do update set utente_id = excluded.utente_id, ultimo_sync_at = excluded.ultimo_sync_at;
  insert into app.sync_operazioni (op_id, device_id, utente_id, entita, entita_id, base_versione, esito, risposta)
    values (v_op, coalesce(req ->> 'device_id', 'sconosciuto'), u.id, v_entita, v_id::uuid, v_base, 'ok', v_risposta);
  return v_risposta;
end $$;

-- -------------------------------------------------------------------------------------
-- public.sync_pull(dopo, limite): modifiche visibili all'utente con seq > dopo.
-- Risposta: { record: [{ entita, dati, row_version, seq }], ultimo, altri }
-- -------------------------------------------------------------------------------------
create or replace function public.sync_pull(dopo bigint default 0, limite integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u app.profili := app.sync_utente();
  v_lim integer := least(greatest(coalesce(limite, 200), 1), 500);
  v_righe jsonb;
  v_ultimo bigint;
  v_altri boolean;
begin
  if u.id is null then raise exception 'Utente non autorizzato' using errcode = '42501'; end if;
  with visibili as (
    select r.* from app.sync_record r
    where r.seq > coalesce(dopo, 0) and app.sync_puo_leggere(u, r)
    order by r.seq
    limit v_lim + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('entita', entita, 'dati', dati, 'row_version', row_version, 'seq', seq) order by seq) filter (where rn <= v_lim), '[]'::jsonb),
         max(seq) filter (where rn <= v_lim),
         count(*) > v_lim
    into v_righe, v_ultimo, v_altri
  from (select v.*, row_number() over (order by v.seq) as rn from visibili v) x;
  return jsonb_build_object('record', v_righe, 'ultimo', coalesce(v_ultimo, dopo, 0), 'altri', coalesce(v_altri, false));
end $$;

revoke all on function public.sync_apply(jsonb) from public;
revoke all on function public.sync_pull(bigint, integer) from public;
revoke all on function app.sync_utente() from public;
revoke all on function app.sync_mese_bloccato(uuid, text) from public;
revoke all on function app.sync_puo_scrivere(app.profili, text, jsonb, jsonb) from public;
revoke all on function app.sync_puo_leggere(app.profili, app.sync_record) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.sync_apply(jsonb) from anon';
    execute 'revoke all on function public.sync_pull(bigint, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.sync_apply(jsonb) to authenticated';
    execute 'grant execute on function public.sync_pull(bigint, integer) to authenticated';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- Dati iniziali: profili e magazzini già presenti sul server diventano record sincronizzabili
-- (stesso formato dell'app), così ogni dispositivo li riceve al primo collegamento.
-- -------------------------------------------------------------------------------------
insert into app.sync_record (entita, id, dati, row_version, proprietario, device_id)
select 'profili', p.id::text,
  jsonb_build_object('id', p.id, 'nome', p.nome, 'cognome', p.cognome, 'username', p.username, 'email', p.email, 'telefono', p.telefono,
    'ruolo', p.ruolo, 'attivo', p.attivo, 'colore', p.colore, 'qualifica', p.qualifica, 'ore_giornaliere_contratto', p.ore_giornaliere_contratto,
    'amministratore_operativo', p.amministratore_operativo,
    'created_at', p.created_at, 'created_by', p.created_by, 'updated_at', p.updated_at, 'updated_by', p.updated_by,
    'row_version', p.row_version, 'device_id', coalesce(p.device_id, 'server'), 'deleted_at', p.deleted_at),
  p.row_version, null, 'server'
from app.profili p
on conflict do nothing;

insert into app.sync_record (entita, id, dati, row_version, proprietario, device_id)
select 'magazzini', m.id::text,
  jsonb_build_object('id', m.id, 'codice', m.codice, 'nome', m.nome, 'tipo', m.tipo, 'responsabile_id', m.responsabile_id, 'attivo', m.attivo,
    'created_at', m.created_at, 'created_by', m.created_by, 'updated_at', m.updated_at, 'updated_by', m.updated_by,
    'row_version', m.row_version, 'device_id', coalesce(m.device_id, 'server'), 'deleted_at', m.deleted_at),
  m.row_version, null, 'server'
from app.magazzini m
on conflict do nothing;

comment on table app.sync_record is 'Fase 15: ultima versione di ogni record sincronizzato (formato dell''app), con versione e proprietario.';
comment on function public.sync_apply(jsonb) is 'Fase 15: applica un''operazione della coda del dispositivo (idempotenza, versioni, regole e permessi).';
comment on function public.sync_pull(bigint, integer) is 'Fase 15: modifiche visibili all''utente successive al cursore.';
