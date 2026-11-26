-- =====================================================================================
-- 0015 – Storico amministrativo ed esportazioni (Fase 14)
-- • stati_amministrativi: inclusione/esclusione dai documenti per fatturazione e archiviazione
--   di attività, rapporti e giornate. Tabella separata: il dato originale (attività, rapporti,
--   presenze, cartellini) non viene mai modificato da un'esclusione.
-- • esportazioni: registro dei documenti generati (codice univoco, data, autore, totali,
--   elementi riportati). In sola aggiunta: una nuova esportazione è una nuova riga.
-- Le operazioni sono tracciate dall'audit generale (chi, quando, prima/dopo, motivo).
-- Applicata al progetto Supabase "worklog" il 27/11/2026, con autorizzazione.
-- =====================================================================================
set search_path = app, public;

create table app.stati_amministrativi (
  id                uuid primary key default gen_random_uuid(),
  entita            text not null check (entita in ('attivita', 'rapportino', 'giornata')),
  entita_id         text not null,     -- uuid dell'attività/rapporto, oppure "<cliente_id>|<data>" per la giornata
  escluso           boolean not null default false,
  archiviato        boolean not null default false,
  motivo            text not null default '',
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text not null,
  client_created_at timestamptz,
  deleted_at        timestamptz,
  check (entita <> 'giornata' or entita_id ~ '^[0-9a-f-]{36}\|\d{4}-\d{2}-\d{2}$')
);
create unique index stati_amministrativi_uq on app.stati_amministrativi (entita, entita_id) where deleted_at is null;

create table app.esportazioni (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null unique,
  tipo              text not null check (tipo in ('operativo', 'amministrativo')),
  cliente_id        uuid references app.clienti(id),
  sede_id           uuid references app.sedi_cliente(id),
  da                date not null,
  a                 date not null check (a >= da),
  generato_at       timestamptz not null,
  generato_da       uuid not null references app.profili(id),
  ore_ms            bigint not null check (ore_ms >= 0),
  rapporti          integer not null check (rapporti >= 0),
  attivita          integer not null check (attivita >= 0),
  righe_materiali   integer not null check (righe_materiali >= 0),
  rapporti_ids      uuid[] not null default '{}',
  attivita_ids      uuid[] not null default '{}',
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text not null,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create index esportazioni_cliente_idx on app.esportazioni (cliente_id, generato_at desc);

-- Le esportazioni non si modificano: solo inserimento.
create or replace function app.esportazioni_immutabili() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Le esportazioni registrate non si modificano: genera una nuova esportazione.';
end $$;
create trigger esportazioni_no_update before update or delete on app.esportazioni
  for each row execute function app.esportazioni_immutabili();

comment on table app.stati_amministrativi is 'Fase 14: inclusione/esclusione dai documenti per fatturazione e archiviazione, separate dal dato originale.';
comment on table app.esportazioni is 'Fase 14: registro dei riepiloghi esportati (operativo completo / amministrativo per fatturazione).';
