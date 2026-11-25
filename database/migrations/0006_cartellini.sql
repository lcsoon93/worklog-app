-- =====================================================================================
-- 0006 – Cartellini mensili, versioni immutabili e registro approvazioni (docs/07)
-- =====================================================================================
set search_path = app, public;

-- Transizioni ammesse: unica fonte di verità lato server (coincide con src/domain/timesheet-workflow.ts).
create table app.transizioni_cartellino (
  azione                    text not null,
  stato_da                  text not null,
  stato_a                   text not null,
  ruoli                     text[] not null,
  motivazione_obbligatoria  boolean not null,
  nuova_versione            boolean not null,
  solo_titolare             boolean not null,
  primary key (azione, stato_da)
);
insert into app.transizioni_cartellino values
  ('genera',              'in_compilazione',        'da_confermare_operaio',  '{admin,sistema}',          false, true,  false),
  ('conferma',            'da_confermare_operaio',  'confermato_operaio',     '{operaio}',                false, false, true),
  ('segnala_discrepanza', 'da_confermare_operaio',  'da_correggere',          '{operaio}',                true,  false, true),
  ('ricezione_server',    'confermato_operaio',     'in_attesa_approvazione', '{sistema}',                false, false, false),
  ('approva',             'in_attesa_approvazione', 'approvato',              '{admin}',                  false, false, false),
  ('richiedi_correzione', 'in_attesa_approvazione', 'da_correggere',          '{admin}',                  true,  false, false),
  ('rifiuta',             'in_attesa_approvazione', 'da_correggere',          '{admin}',                  true,  false, false),
  ('rigenera',            'da_correggere',          'da_confermare_operaio',  '{admin,sistema,operaio}',  false, true,  false),
  ('rigenera',            'riaperto',               'da_confermare_operaio',  '{admin,sistema,operaio}',  false, true,  false),
  ('riapri',              'approvato',              'riaperto',               '{admin}',                  true,  false, false);

create table app.cartellini_mensili (
  id                  uuid primary key default gen_random_uuid(),
  operaio_id          uuid not null references app.profili(id),
  anno                smallint not null check (anno between 2020 and 2100),
  mese                smallint not null check (mese between 1 and 12),
  stato               text not null default 'in_compilazione' check (stato in (
                        'in_compilazione', 'da_confermare_operaio', 'confermato_operaio', 'in_attesa_approvazione',
                        'da_correggere', 'approvato', 'riaperto')),
  versione_corrente   integer not null default 0 check (versione_corrente >= 0),
  versione_approvata  integer check (versione_approvata is null or versione_approvata <= versione_corrente),
  ultima_motivazione  text not null default '',
  created_at          timestamptz not null default now(),
  created_by          uuid references app.profili(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references app.profili(id),
  row_version         integer not null default 1 check (row_version > 0),
  device_id           text,
  client_created_at   timestamptz,
  deleted_at          timestamptz,
  unique (operaio_id, anno, mese),
  check (stato <> 'approvato' or versione_approvata = versione_corrente),
  check (stato = 'in_compilazione' or versione_corrente >= 1)
);
create index cartellini_stato_idx on app.cartellini_mensili (stato) where stato in ('in_attesa_approvazione', 'da_correggere', 'confermato_operaio');

-- Snapshot immutabile di ogni versione: i giorni sono salvati come JSON calcolato dal motore ore.
create table app.cartellino_versioni (
  id             uuid primary key default gen_random_uuid(),
  cartellino_id  uuid not null references app.cartellini_mensili(id),
  versione       integer not null check (versione >= 1),
  giorni         jsonb not null check (jsonb_typeof(giorni) = 'array'),
  totali         jsonb not null check (totali ? 'netta_ms' and totali ? 'attribuite_ms' and totali ? 'non_attribuite_ms'),
  impronta       text not null,
  motivo         text not null,
  motore_versione text not null default '1',   -- versione dell'algoritmo usato per il calcolo
  created_at     timestamptz not null default now(),
  created_by     uuid references app.profili(id),
  unique (cartellino_id, versione)
);

-- Registro append-only di ogni transizione: chi, quando, da che stato a che stato, perché.
create table app.approvazioni_cartellino (
  id                uuid primary key default gen_random_uuid(),
  cartellino_id     uuid not null references app.cartellini_mensili(id),
  versione          integer not null,
  azione            text not null,
  stato_precedente  text not null,
  stato_nuovo       text not null,
  utente_id         uuid references app.profili(id),
  ruolo_utente      text not null check (ruolo_utente in ('admin', 'operaio', 'sistema')),
  motivazione       text not null default '',
  eseguita_at       timestamptz not null default now(),
  device_id         text,
  foreign key (azione, stato_precedente) references app.transizioni_cartellino (azione, stato_da),
  foreign key (cartellino_id, versione) references app.cartellino_versioni (cartellino_id, versione),
  check (ruolo_utente = 'sistema' or utente_id is not null)
);
create index approvazioni_cartellino_idx on app.approvazioni_cartellino (cartellino_id, eseguita_at);

create trigger cartellini_metadati before update on app.cartellini_mensili for each row execute function app.tg_aggiorna_metadati();
create trigger cartellini_no_delete before delete on app.cartellini_mensili for each row execute function app.tg_no_delete_fisico();
create trigger versioni_solo_inserimento before update or delete on app.cartellino_versioni for each row execute function app.tg_solo_inserimento();
create trigger approvazioni_solo_inserimento before update or delete on app.approvazioni_cartellino for each row execute function app.tg_solo_inserimento();
create trigger transizioni_solo_lettura before insert or update or delete on app.transizioni_cartellino for each statement
  when (current_setting('app.migrazione', true) is distinct from 'on') execute function app.tg_solo_inserimento();

-- Il cambio di stato del cartellino è ammesso solo se esiste la riga di approvazione corrispondente
-- (scritta nella stessa transazione dalla RPC) ed è una transizione definita.
create or replace function app.tg_valida_stato_cartellino()
returns trigger
language plpgsql
as $$
declare
  t app.transizioni_cartellino%rowtype;
  a app.approvazioni_cartellino%rowtype;
begin
  if new.stato = old.stato then
    if new.versione_corrente <> old.versione_corrente or new.versione_approvata is distinct from old.versione_approvata then
      raise exception 'Versione del cartellino modificata senza transizione' using errcode = 'P0001';
    end if;
    return new;
  end if;
  select * into a from app.approvazioni_cartellino
    where cartellino_id = new.id and stato_precedente = old.stato and stato_nuovo = new.stato
    order by eseguita_at desc limit 1;
  if not found then
    raise exception 'Transizione % → % senza registrazione in approvazioni_cartellino', old.stato, new.stato using errcode = 'P0001';
  end if;
  select * into t from app.transizioni_cartellino where azione = a.azione and stato_da = old.stato and stato_a = new.stato;
  if not found then
    raise exception 'Transizione % → % non ammessa', old.stato, new.stato using errcode = 'P0001';
  end if;
  if t.motivazione_obbligatoria and length(trim(a.motivazione)) = 0 then
    raise exception 'Motivazione obbligatoria per %', a.azione using errcode = 'P0001';
  end if;
  if not (a.ruolo_utente = any (t.ruoli)) then
    raise exception 'Ruolo % non abilitato a %', a.ruolo_utente, a.azione using errcode = 'P0001';
  end if;
  if t.solo_titolare and a.utente_id is distinct from new.operaio_id then
    raise exception 'Solo l''operaio titolare può eseguire %', a.azione using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger cartellini_valida_stato before update of stato, versione_corrente, versione_approvata on app.cartellini_mensili
  for each row execute function app.tg_valida_stato_cartellino();
