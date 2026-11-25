-- =====================================================================================
-- 0002 – Anagrafiche: profili, clienti, sedi
-- =====================================================================================
set search_path = app, public;

create table app.profili (
  id                uuid primary key default gen_random_uuid(),
  -- In Supabase: id = auth.users.id (FK aggiunta in Fase 2 insieme all'autenticazione reale).
  nome              text not null check (length(trim(nome)) > 0),
  cognome           text not null check (length(trim(cognome)) > 0),
  email             text not null,
  telefono          text not null default '',
  ruolo             text not null check (ruolo in ('admin', 'operaio')),
  attivo            boolean not null default true,
  qualifica         text not null default '',
  colore            text not null default '#0f766e' check (colore ~ '^#[0-9a-fA-F]{6}$'),
  ore_giornaliere_contratto numeric(4,2) not null default 8 check (ore_giornaliere_contratto between 1 and 12),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create unique index profili_email_uq on app.profili (lower(email)) where deleted_at is null;
alter table app.profili add constraint profili_created_by_fk foreign key (created_by) references app.profili(id);
alter table app.profili add constraint profili_updated_by_fk foreign key (updated_by) references app.profili(id);
comment on table app.profili is 'Utenti dell''unica azienda: amministratori e operai.';

create table app.clienti (
  id                uuid primary key default gen_random_uuid(),
  ragione_sociale   text not null check (length(trim(ragione_sociale)) >= 2),
  partita_iva       text check (partita_iva is null or partita_iva ~ '^[0-9]{11}$'),
  codice_fiscale    text,
  email             text not null default '',
  telefono          text not null default '',
  referente         text not null default '',
  note              text not null default '',
  attivo            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create unique index clienti_piva_uq on app.clienti (partita_iva) where partita_iva is not null and deleted_at is null;
create index clienti_ragione_sociale_idx on app.clienti (lower(ragione_sociale));

create table app.sedi_cliente (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references app.clienti(id) on update restrict on delete restrict,
  nome              text not null check (length(trim(nome)) >= 2),
  indirizzo         text not null default '',
  cap               text not null default '' check (cap = '' or cap ~ '^[0-9]{5}$'),
  citta             text not null default '',
  provincia         text not null default '' check (provincia = '' or provincia ~ '^[A-Z]{2}$'),
  referente         text not null default '',
  telefono          text not null default '',
  note_accesso      text not null default '',
  latitudine        numeric(9,6),
  longitudine       numeric(9,6),
  attiva            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz,
  -- Serve come destinazione di FK composte: garantisce che sede e cliente siano coerenti.
  unique (id, cliente_id)
);
create index sedi_cliente_cliente_idx on app.sedi_cliente (cliente_id) where deleted_at is null;

create trigger profili_metadati before update on app.profili for each row execute function app.tg_aggiorna_metadati();
create trigger clienti_metadati before update on app.clienti for each row execute function app.tg_aggiorna_metadati();
create trigger sedi_metadati before update on app.sedi_cliente for each row execute function app.tg_aggiorna_metadati();
create trigger profili_no_delete before delete on app.profili for each row execute function app.tg_no_delete_fisico();
create trigger clienti_no_delete before delete on app.clienti for each row execute function app.tg_no_delete_fisico();
create trigger sedi_no_delete before delete on app.sedi_cliente for each row execute function app.tg_no_delete_fisico();
