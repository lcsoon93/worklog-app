-- =====================================================================================
-- schema.sql – schema completo del gestionale (GENERATO da build-schema.sh, non modificare a mano)
-- Fonte: database/migrations/*.sql · Target: PostgreSQL 15+ / Supabase
-- =====================================================================================

-- >>> migrations/0001_estensioni_e_funzioni_comuni.sql
-- =====================================================================================
-- 0001 – Estensioni, schema applicativo e funzioni comuni
-- Target: PostgreSQL 15+ (Supabase). Applicate 0001–0011 al progetto Supabase "worklog" il 25/11/2026, con autorizzazione.
-- =====================================================================================

create extension if not exists pgcrypto;     -- gen_random_uuid()
create schema if not exists extensions;       -- come in Supabase: le estensioni fuori dallo schema public
create extension if not exists btree_gist with schema extensions;   -- vincoli di esclusione su intervalli + uguaglianza

-- Tutte le tabelle applicative stanno nello schema "app" (in Supabase si esporrà solo tramite RPC/viste).
create schema if not exists app;
set search_path = app, public;

-- -------------------------------------------------------------------------------------
-- Colonne tecniche comuni (convenzione, ripetuta in ogni tabella sincronizzabile):
--   id               uuid primary key       generato SUL DISPOSITIVO (v4); default solo come riserva
--   created_at       timestamptz            istante di creazione registrato dal server
--   created_by       uuid -> profili
--   updated_at       timestamptz            aggiornato da trigger
--   updated_by       uuid -> profili
--   row_version      integer                versione della riga per il controllo di concorrenza ottimistico
--   device_id        text                   dispositivo che ha originato l'ultima modifica
--   client_created_at timestamptz           istante di creazione secondo il dispositivo (può essere offline)
--   deleted_at       timestamptz            eliminazione logica: le righe non si cancellano fisicamente
-- -------------------------------------------------------------------------------------

-- Aggiorna updated_at e incrementa row_version a ogni UPDATE.
create or replace function app.tg_aggiorna_metadati()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  new.created_at := old.created_at;      -- immutabili
  new.created_by := old.created_by;
  return new;
end;
$$;

-- Impedisce UPDATE e DELETE sulle tabelle "solo inserimento" (storico, audit, versioni).
create or replace function app.tg_solo_inserimento()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La tabella % è in sola aggiunta: % non consentito', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

-- Impedisce la cancellazione fisica (si usa deleted_at).
create or replace function app.tg_no_delete_fisico()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Cancellazione fisica non consentita su %: usare deleted_at', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- >>> migrations/0002_anagrafiche.sql
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

-- >>> migrations/0003_interventi.sql
-- =====================================================================================
-- 0003 – Interventi programmati e assegnazione operai
-- =====================================================================================
set search_path = app, public;

create table app.interventi (
  id                   uuid primary key default gen_random_uuid(),
  codice               text not null,
  cliente_id           uuid not null references app.clienti(id),
  sede_id              uuid,
  titolo               text not null check (length(trim(titolo)) >= 3),
  descrizione          text not null default '',
  tipo                 text not null check (tipo in ('manutenzione', 'installazione', 'riparazione', 'sopralluogo', 'ritorno')),
  priorita             text not null default 'normale' check (priorita in ('bassa', 'normale', 'alta', 'urgente')),
  stato                text not null default 'da_programmare'
                         check (stato in ('da_programmare', 'programmato', 'in_corso', 'da_ultimare', 'completato', 'annullato')),
  data_programmata     date,
  ora_inizio           time,
  durata_prevista_min  integer check (durata_prevista_min is null or durata_prevista_min between 5 and 24 * 60),
  -- Valorizzato per gli interventi di ritorno (FK aggiunta in 0005, la tabella followup è definita dopo).
  followup_origine_id  uuid,
  note                 text not null default '',
  motivo_annullamento  text,
  created_at           timestamptz not null default now(),
  created_by           uuid references app.profili(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references app.profili(id),
  row_version          integer not null default 1 check (row_version > 0),
  device_id            text,
  client_created_at    timestamptz,
  deleted_at           timestamptz,
  -- La sede, se indicata, deve appartenere al cliente dell'intervento.
  foreign key (sede_id, cliente_id) references app.sedi_cliente (id, cliente_id),
  check (stato = 'da_programmare' or data_programmata is not null),
  check (stato <> 'annullato' or motivo_annullamento is not null),
  check ((tipo = 'ritorno') = (followup_origine_id is not null))
);
create unique index interventi_codice_uq on app.interventi (codice);
create index interventi_data_idx on app.interventi (data_programmata) where deleted_at is null and stato <> 'annullato';
create index interventi_cliente_idx on app.interventi (cliente_id, data_programmata desc);
create index interventi_stato_idx on app.interventi (stato) where stato in ('da_programmare', 'da_ultimare');

-- Più operai per intervento; l'eliminazione è logica per conservare lo storico delle squadre.
create table app.intervento_operai (
  id                uuid primary key default gen_random_uuid(),
  intervento_id     uuid not null references app.interventi(id),
  operaio_id        uuid not null references app.profili(id),
  ruolo             text not null default 'squadra' check (ruolo in ('responsabile', 'squadra')),
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create unique index intervento_operai_uq on app.intervento_operai (intervento_id, operaio_id) where deleted_at is null;
create unique index intervento_operai_un_responsabile on app.intervento_operai (intervento_id) where ruolo = 'responsabile' and deleted_at is null;
create index intervento_operai_operaio_idx on app.intervento_operai (operaio_id) where deleted_at is null;

create trigger interventi_metadati before update on app.interventi for each row execute function app.tg_aggiorna_metadati();
create trigger intervento_operai_metadati before update on app.intervento_operai for each row execute function app.tg_aggiorna_metadati();
create trigger interventi_no_delete before delete on app.interventi for each row execute function app.tg_no_delete_fisico();
create trigger intervento_operai_no_delete before delete on app.intervento_operai for each row execute function app.tg_no_delete_fisico();

-- >>> migrations/0004_presenze_attivita.sql
-- =====================================================================================
-- 0004 – Presenze, pause, attività (registrazione ore) e imprevisti
--
-- Principi (docs/06):
--  * gli intervalli sono istanti assoluti (timestamptz), la durata non è mai memorizzata;
--  * la presenza appartiene al giorno dell'ENTRATA (data_lavoro), anche oltre mezzanotte;
--  * le correzioni delle attività creano NUOVE righe (sostituisce_id) e marcano l'originale
--    (superata_da_id): il dato originale non viene mai sovrascritto;
--  * entrata/uscita corrette conservano i valori registrati in *_registrata_at.
-- =====================================================================================
set search_path = app, public, extensions;

create table app.presenze (
  id                     uuid primary key default gen_random_uuid(),
  operaio_id             uuid not null references app.profili(id),
  data_lavoro            date not null,
  entrata_at             timestamptz not null,
  uscita_at              timestamptz,
  entrata_registrata_at  timestamptz not null,
  uscita_registrata_at   timestamptz,
  ultimo_segnale_at      timestamptz not null,
  uscita_automatica      boolean not null default false,
  note                   text not null default '',
  created_at             timestamptz not null default now(),
  created_by             uuid references app.profili(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references app.profili(id),
  row_version            integer not null default 1 check (row_version > 0),
  device_id              text,
  client_created_at      timestamptz,
  deleted_at             timestamptz,
  constraint presenze_uscita_dopo_entrata check (uscita_at is null or uscita_at > entrata_at),
  constraint presenze_max_24h check (uscita_at is null or uscita_at - entrata_at <= interval '24 hours'),
  constraint presenze_data_coerente check (data_lavoro = (entrata_at at time zone 'Europe/Rome')::date),
  unique (id, operaio_id)
);
-- Una sola giornata aperta per operaio.
create unique index presenze_una_aperta on app.presenze (operaio_id) where uscita_at is null and deleted_at is null;
-- Presenze dello stesso operaio non sovrapposte.
alter table app.presenze add constraint presenze_no_sovrapposizioni
  exclude using gist (operaio_id with =, tstzrange(entrata_at, coalesce(uscita_at, 'infinity'::timestamptz), '[)') with &&)
  where (deleted_at is null);
create index presenze_operaio_data_idx on app.presenze (operaio_id, data_lavoro);
create index presenze_data_idx on app.presenze (data_lavoro);

create table app.pause_presenza (
  id                   uuid primary key default gen_random_uuid(),
  presenza_id          uuid not null,
  operaio_id           uuid not null,
  tipo                 text not null check (tipo in ('pranzo', 'breve', 'altro')),
  inizio_at            timestamptz not null,
  fine_at              timestamptz,
  attivita_sospesa_id  uuid,
  created_at           timestamptz not null default now(),
  created_by           uuid references app.profili(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references app.profili(id),
  row_version          integer not null default 1 check (row_version > 0),
  device_id            text,
  client_created_at    timestamptz,
  deleted_at           timestamptz,
  foreign key (presenza_id, operaio_id) references app.presenze (id, operaio_id),
  constraint pause_fine_dopo_inizio check (fine_at is null or fine_at > inizio_at)
);
create unique index pause_una_aperta on app.pause_presenza (presenza_id) where fine_at is null and deleted_at is null;
alter table app.pause_presenza add constraint pause_no_sovrapposizioni
  exclude using gist (presenza_id with =, tstzrange(inizio_at, coalesce(fine_at, 'infinity'::timestamptz), '[)') with &&)
  where (deleted_at is null);
create index pause_presenza_idx on app.pause_presenza (presenza_id);

create table app.attivita_lavoro (
  id                   uuid primary key default gen_random_uuid(),
  presenza_id          uuid not null,
  operaio_id           uuid not null,
  tipo                 text not null check (tipo in ('lavoro_cliente', 'trasferimento', 'interna', 'da_definire')),
  cliente_id           uuid references app.clienti(id),
  sede_id              uuid,
  intervento_id        uuid references app.interventi(id),
  codice_interno       text check (codice_interno in ('magazzino', 'manutenzione_mezzi', 'formazione', 'ufficio', 'riunione')),
  descrizione          text not null default '',
  inizio_at            timestamptz not null,
  fine_at              timestamptz,
  origine              text not null default 'timer' check (origine in ('timer', 'manuale', 'correzione', 'divisione')),
  sostituisce_id       uuid references app.attivita_lavoro(id),
  superata_da_id       uuid references app.attivita_lavoro(id),
  annullata            boolean not null default false,
  motivo_correzione    text not null default '',
  chiusura_automatica  boolean not null default false,
  created_at           timestamptz not null default now(),
  created_by           uuid references app.profili(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references app.profili(id),
  row_version          integer not null default 1 check (row_version > 0),
  device_id            text,
  client_created_at    timestamptz,
  deleted_at           timestamptz,
  foreign key (presenza_id, operaio_id) references app.presenze (id, operaio_id),
  foreign key (sede_id, cliente_id) references app.sedi_cliente (id, cliente_id),
  constraint attivita_fine_dopo_inizio check (fine_at is null or fine_at > inizio_at),
  -- Coerenza tipo/destinazione.
  constraint attivita_destinazione check (
    (tipo = 'lavoro_cliente' and cliente_id is not null and codice_interno is null) or
    (tipo = 'trasferimento' and codice_interno is null) or
    (tipo = 'interna' and codice_interno is not null and cliente_id is null and intervento_id is null) or
    (tipo = 'da_definire' and cliente_id is null and intervento_id is null and codice_interno is null)
  ),
  -- Le righe prodotte da correzione/divisione devono dichiarare la riga sostituita e il motivo.
  constraint attivita_correzione_tracciata check (
    origine in ('timer') or length(trim(motivo_correzione)) > 0
  ),
  constraint attivita_catena check (
    (origine in ('correzione', 'divisione')) = (sostituisce_id is not null)
  ),
  constraint attivita_annullata_motivata check (not annullata or length(trim(motivo_correzione)) > 0)
);
-- Un solo timer attivo per operaio.
create unique index attivita_un_timer_attivo on app.attivita_lavoro (operaio_id)
  where fine_at is null and superata_da_id is null and not annullata and deleted_at is null;
create index attivita_presenza_idx on app.attivita_lavoro (presenza_id);
create index attivita_cliente_idx on app.attivita_lavoro (cliente_id, inizio_at) where superata_da_id is null and not annullata;
create index attivita_intervento_idx on app.attivita_lavoro (intervento_id) where intervento_id is not null;
create index attivita_catena_idx on app.attivita_lavoro (sostituisce_id) where sostituisce_id is not null;
-- NB: NESSUN vincolo di esclusione sulle attività sovrapposte. Due dispositivi offline possono
-- produrle legittimamente; il motore ore le conta una sola volta e le segnala (docs/06 §4, D-07).

alter table app.pause_presenza add constraint pause_attivita_sospesa_fk
  foreign key (attivita_sospesa_id) references app.attivita_lavoro(id);

-- Vista delle sole attività che contano nel calcolo ore.
create view app.v_attivita_effettive as
  select * from app.attivita_lavoro
  where superata_da_id is null and not annullata and deleted_at is null;

create table app.imprevisti (
  id                uuid primary key default gen_random_uuid(),
  operaio_id        uuid not null references app.profili(id),
  presenza_id       uuid references app.presenze(id),
  intervento_id     uuid references app.interventi(id),
  cliente_id        uuid references app.clienti(id),
  rapportino_id     uuid,  -- FK aggiunta in 0005
  tipo              text not null check (tipo in ('materiale_mancante', 'accesso_negato', 'guasto_aggiuntivo', 'cliente_assente', 'sicurezza', 'meteo', 'altro')),
  gravita           text not null default 'media' check (gravita in ('bassa', 'media', 'alta')),
  descrizione       text not null check (length(trim(descrizione)) >= 5),
  avvenuto_at       timestamptz not null,
  blocca_lavoro     boolean not null default false,
  richiede_ritorno  boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create index imprevisti_intervento_idx on app.imprevisti (intervento_id) where intervento_id is not null;
create index imprevisti_operaio_idx on app.imprevisti (operaio_id, avvenuto_at desc);

create trigger presenze_metadati before update on app.presenze for each row execute function app.tg_aggiorna_metadati();
create trigger pause_metadati before update on app.pause_presenza for each row execute function app.tg_aggiorna_metadati();
create trigger attivita_metadati before update on app.attivita_lavoro for each row execute function app.tg_aggiorna_metadati();
create trigger imprevisti_metadati before update on app.imprevisti for each row execute function app.tg_aggiorna_metadati();
create trigger presenze_no_delete before delete on app.presenze for each row execute function app.tg_no_delete_fisico();
create trigger pause_no_delete before delete on app.pause_presenza for each row execute function app.tg_no_delete_fisico();
create trigger attivita_no_delete before delete on app.attivita_lavoro for each row execute function app.tg_no_delete_fisico();
create trigger imprevisti_no_delete before delete on app.imprevisti for each row execute function app.tg_no_delete_fisico();

-- Pause e attività devono iniziare dentro la presenza (la fine può essere aperta).
create or replace function app.tg_intervallo_in_presenza()
returns trigger
language plpgsql
as $$
declare
  p app.presenze%rowtype;
begin
  select * into p from app.presenze where id = new.presenza_id;
  if new.inizio_at < p.entrata_at
     or (p.uscita_at is not null and new.inizio_at >= p.uscita_at)
     or (p.uscita_at is not null and new.fine_at is not null and new.fine_at > p.uscita_at) then
    raise exception 'Intervallo [%, %) fuori dalla presenza [%, %)', new.inizio_at, new.fine_at, p.entrata_at, p.uscita_at
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger pause_in_presenza before insert or update of inizio_at, fine_at on app.pause_presenza
  for each row when (new.deleted_at is null) execute function app.tg_intervallo_in_presenza();
create trigger attivita_in_presenza before insert or update of inizio_at, fine_at on app.attivita_lavoro
  for each row when (new.deleted_at is null and not new.annullata and new.superata_da_id is null)
  execute function app.tg_intervallo_in_presenza();

-- >>> migrations/0005_rapportini_followup_allegati.sql
-- =====================================================================================
-- 0005 – Rapportini, materiali, foto, firme, allegati e ritorni (followup)
-- =====================================================================================
set search_path = app, public;

-- Metadati dei file. Il contenuto binario sta in Supabase Storage (bucket privato), mai nel DB.
create table app.allegati (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null check (tipo in ('foto', 'firma', 'documento')),
  entita            text not null check (entita in ('rapportino', 'imprevisto', 'intervento')),
  entita_id         uuid not null,
  nome_file         text not null,
  mime              text not null check (mime ~ '^(image|application)/'),
  dimensione        integer not null check (dimensione > 0 and dimensione <= 15 * 1024 * 1024),
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  storage_path      text,                 -- valorizzato quando l'upload è confermato
  caricato_at       timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz,
  check ((storage_path is null) = (caricato_at is null))
);
create index allegati_entita_idx on app.allegati (entita, entita_id);

create table app.rapportini (
  id                  uuid primary key default gen_random_uuid(),
  numero              text,              -- definitivo, assegnato dal server (R-AAAA-NNNN)
  numero_provvisorio  text not null,     -- generato sul dispositivo, univoco per dispositivo
  tipo                text not null check (tipo in ('rapido', 'completo')),
  stato               text not null default 'completato' check (stato in ('completato', 'firmato', 'annullato')),
  data_lavoro         date not null,
  cliente_id          uuid not null references app.clienti(id),
  sede_id             uuid,
  intervento_id       uuid references app.interventi(id),
  followup_id         uuid,              -- rapportino di un ritorno (FK sotto)
  redatto_da          uuid not null references app.profili(id),
  descrizione_lavoro  text not null check (length(trim(descrizione_lavoro)) >= 10),
  esito               text not null check (esito in ('completato', 'da_ultimare', 'ritorno_necessario', 'non_eseguito')),
  note_interne        text not null default '',
  firma_cliente_nome  text,
  motivo_annullamento text,
  created_at          timestamptz not null default now(),
  created_by          uuid references app.profili(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references app.profili(id),
  row_version         integer not null default 1 check (row_version > 0),
  device_id           text not null,
  client_created_at   timestamptz,
  deleted_at          timestamptz,
  foreign key (sede_id, cliente_id) references app.sedi_cliente (id, cliente_id),
  check (esito not in ('da_ultimare', 'ritorno_necessario') or length(trim(note_interne)) >= 5),
  check (stato <> 'annullato' or motivo_annullamento is not null)
);
-- NB: le bozze restano solo sul dispositivo (stato "locale"): sul server arrivano rapportini completati.
create unique index rapportini_numero_uq on app.rapportini (numero) where numero is not null;
create unique index rapportini_provvisorio_uq on app.rapportini (device_id, numero_provvisorio);
create index rapportini_data_idx on app.rapportini (data_lavoro desc);
create index rapportini_cliente_idx on app.rapportini (cliente_id, data_lavoro desc);
create index rapportini_intervento_idx on app.rapportini (intervento_id) where intervento_id is not null;

-- Operai presenti sul lavoro documentato.
create table app.rapportino_operai (
  rapportino_id  uuid not null references app.rapportini(id),
  operaio_id     uuid not null references app.profili(id),
  primary key (rapportino_id, operaio_id)
);

-- Collegamento al tempo registrato: le ore del rapportino derivano da queste attività.
create table app.rapportino_attivita (
  rapportino_id  uuid not null references app.rapportini(id),
  attivita_id    uuid not null references app.attivita_lavoro(id),
  primary key (rapportino_id, attivita_id)
);
create index rapportino_attivita_attivita_idx on app.rapportino_attivita (attivita_id);

create table app.rapportino_materiali (
  id             uuid primary key default gen_random_uuid(),
  rapportino_id  uuid not null references app.rapportini(id),
  descrizione    text not null check (length(trim(descrizione)) > 0),
  quantita       numeric(10,3) not null check (quantita > 0),
  unita          text not null check (unita in ('pz', 'm', 'kg', 'l', 'h')),
  codice_articolo text,
  ordine         smallint not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references app.profili(id)
);
create index rapportino_materiali_idx on app.rapportino_materiali (rapportino_id, ordine);

create table app.rapportino_foto (
  rapportino_id  uuid not null references app.rapportini(id),
  allegato_id    uuid not null references app.allegati(id),
  didascalia     text not null default '',
  ordine         smallint not null default 0,
  primary key (rapportino_id, allegato_id)
);

create table app.rapportino_firme (
  id               uuid primary key default gen_random_uuid(),
  rapportino_id    uuid not null references app.rapportini(id),
  allegato_id      uuid not null references app.allegati(id),
  ruolo_firmatario text not null check (ruolo_firmatario in ('cliente', 'operaio')),
  nome_firmatario  text not null check (length(trim(nome_firmatario)) > 0),
  firmato_at       timestamptz not null,
  unique (rapportino_id, ruolo_firmatario)
);

-- Ritorni e lavori da ultimare: sempre collegati al rapportino che li ha generati.
create table app.followup (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    text not null check (tipo in ('ritorno', 'da_ultimare')),
  stato                   text not null default 'aperto' check (stato in ('aperto', 'pianificato', 'chiuso', 'annullato')),
  rapportino_origine_id   uuid not null references app.rapportini(id),
  intervento_origine_id   uuid references app.interventi(id),
  cliente_id              uuid not null references app.clienti(id),
  sede_id                 uuid,
  motivo                  text not null check (length(trim(motivo)) >= 5),
  priorita                text not null default 'normale' check (priorita in ('bassa', 'normale', 'alta', 'urgente')),
  data_suggerita          date,
  intervento_ritorno_id   uuid references app.interventi(id),
  rapportino_chiusura_id  uuid references app.rapportini(id),
  motivo_annullamento     text,
  created_at              timestamptz not null default now(),
  created_by              uuid references app.profili(id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references app.profili(id),
  row_version             integer not null default 1 check (row_version > 0),
  device_id               text,
  client_created_at       timestamptz,
  deleted_at              timestamptz,
  foreign key (sede_id, cliente_id) references app.sedi_cliente (id, cliente_id),
  check (stato not in ('pianificato', 'chiuso') or intervento_ritorno_id is not null or rapportino_chiusura_id is not null),
  check (stato <> 'chiuso' or rapportino_chiusura_id is not null),
  check (stato <> 'annullato' or motivo_annullamento is not null)
);
create index followup_aperti_idx on app.followup (stato, priorita) where stato in ('aperto', 'pianificato');
create index followup_origine_idx on app.followup (rapportino_origine_id);
create unique index followup_intervento_ritorno_uq on app.followup (intervento_ritorno_id) where intervento_ritorno_id is not null;

alter table app.rapportini add constraint rapportini_followup_fk foreign key (followup_id) references app.followup(id);
alter table app.interventi add constraint interventi_followup_fk foreign key (followup_origine_id) references app.followup(id);
alter table app.imprevisti add constraint imprevisti_rapportino_fk foreign key (rapportino_id) references app.rapportini(id);

create table app.imprevisto_allegati (
  imprevisto_id uuid not null references app.imprevisti(id),
  allegato_id   uuid not null references app.allegati(id),
  primary key (imprevisto_id, allegato_id)
);

create trigger allegati_metadati before update on app.allegati for each row execute function app.tg_aggiorna_metadati();
create trigger rapportini_metadati before update on app.rapportini for each row execute function app.tg_aggiorna_metadati();
create trigger followup_metadati before update on app.followup for each row execute function app.tg_aggiorna_metadati();
create trigger allegati_no_delete before delete on app.allegati for each row execute function app.tg_no_delete_fisico();
create trigger rapportini_no_delete before delete on app.rapportini for each row execute function app.tg_no_delete_fisico();
create trigger followup_no_delete before delete on app.followup for each row execute function app.tg_no_delete_fisico();

-- Un rapportino completato non si modifica nei contenuti: si annulla (con motivo) e se ne crea uno nuovo.
create or replace function app.tg_rapportino_immutabile()
returns trigger
language plpgsql
as $$
begin
  if old.stato in ('completato', 'firmato') and (
       new.descrizione_lavoro is distinct from old.descrizione_lavoro or
       new.esito is distinct from old.esito or
       new.cliente_id is distinct from old.cliente_id or
       new.data_lavoro is distinct from old.data_lavoro) then
    raise exception 'Rapportino % già completato: annullarlo e crearne uno nuovo', coalesce(old.numero, old.numero_provvisorio)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger rapportini_immutabile before update on app.rapportini for each row execute function app.tg_rapportino_immutabile();

-- >>> migrations/0006_cartellini.sql
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

-- >>> migrations/0007_audit_sync_regole.sql
-- =====================================================================================
-- 0007 – Audit, registro di idempotenza della sincronizzazione, numerazioni e regole trasversali
-- =====================================================================================
set search_path = app, public;

-- Registro tecnico append-only di ogni modifica (scritto dalle RPC, mai dal client direttamente).
create table app.audit_log (
  id           uuid primary key default gen_random_uuid(),
  entita       text not null,
  entita_id    uuid not null,
  azione       text not null check (azione in ('crea', 'modifica', 'elimina', 'correzione', 'transizione')),
  utente_id    uuid references app.profili(id),
  eseguita_at  timestamptz not null default now(),
  client_at    timestamptz,                 -- istante secondo il dispositivo
  prima        jsonb,
  dopo         jsonb,
  motivo       text not null default '',
  device_id    text,
  op_id        uuid                         -- operazione di sincronizzazione che ha prodotto la modifica
);
create index audit_entita_idx on app.audit_log (entita, entita_id, eseguita_at);
create index audit_utente_idx on app.audit_log (utente_id, eseguita_at desc);
create trigger audit_solo_inserimento before update or delete on app.audit_log for each row execute function app.tg_solo_inserimento();

-- Dispositivi registrati (tablet aziendali o personali).
create table app.dispositivi (
  id              text primary key,
  descrizione     text not null default '',
  utente_id       uuid references app.profili(id),
  ultimo_sync_at  timestamptz,
  app_versione    text,
  created_at      timestamptz not null default now()
);

-- Registro di idempotenza: ogni op_id viene applicato UNA sola volta; i ritentativi
-- ricevono la risposta già memorizzata (docs/08 §5).
create table app.sync_operazioni (
  op_id           uuid primary key,
  device_id       text not null references app.dispositivi(id),
  utente_id       uuid references app.profili(id),
  entita          text not null,
  entita_id       uuid not null,
  base_versione   integer not null,
  esito           text not null check (esito in ('ok', 'conflitto', 'rifiutata')),
  risposta        jsonb not null,
  ricevuta_at     timestamptz not null default now()
);
create index sync_operazioni_entita_idx on app.sync_operazioni (entita, entita_id, ricevuta_at);
create trigger sync_solo_inserimento before update or delete on app.sync_operazioni for each row execute function app.tg_solo_inserimento();

-- Numerazioni definitive assegnate dal server (rapportini R-AAAA-NNNN, interventi INT-AAAA-NNN).
create table app.contatori_documenti (
  serie   text not null,
  anno    smallint not null,
  ultimo  integer not null default 0 check (ultimo >= 0),
  primary key (serie, anno)
);

create or replace function app.prossimo_numero(p_serie text, p_anno smallint)
returns integer
language sql
as $$
  insert into app.contatori_documenti as c (serie, anno, ultimo) values (p_serie, p_anno, 1)
  on conflict (serie, anno) do update set ultimo = c.ultimo + 1
  returning ultimo;
$$;

-- -------------------------------------------------------------------------------------
-- Mese bloccato: presenze, pause e attività di un mese il cui cartellino è in verifica o
-- approvato non si modificano. Per correggere serve una transizione esplicita (docs/07 §5).
-- -------------------------------------------------------------------------------------
create or replace function app.mese_modificabile(p_operaio uuid, p_data date)
returns boolean
language sql
stable
as $$
  select coalesce((
    select stato in ('in_compilazione', 'da_correggere', 'riaperto')
    from app.cartellini_mensili
    where operaio_id = p_operaio
      and anno = extract(year from p_data)::smallint
      and mese = extract(month from p_data)::smallint
  ), true);
$$;

create or replace function app.tg_blocco_mese()
returns trigger
language plpgsql
as $$
declare
  v_operaio uuid;
  v_data date;
begin
  if tg_table_name = 'presenze' then
    v_operaio := coalesce(new.operaio_id, old.operaio_id);
    v_data := coalesce(new.data_lavoro, old.data_lavoro);
  else
    select p.operaio_id, p.data_lavoro into v_operaio, v_data
      from app.presenze p where p.id = coalesce(new.presenza_id, old.presenza_id);
  end if;
  if not app.mese_modificabile(v_operaio, v_data) then
    raise exception 'Mese % bloccato: cartellino in verifica o approvato', to_char(v_data, 'MM/YYYY') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger presenze_blocco_mese before insert or update on app.presenze for each row execute function app.tg_blocco_mese();
create trigger pause_blocco_mese before insert or update on app.pause_presenza for each row execute function app.tg_blocco_mese();
create trigger attivita_blocco_mese before insert or update on app.attivita_lavoro for each row execute function app.tg_blocco_mese();

-- Correzione di entrata/uscita: pause e attività effettive devono restare dentro la presenza.
create or replace function app.tg_presenza_contiene_intervalli()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from app.v_attivita_effettive a
    where a.presenza_id = new.id
      and (a.inizio_at < new.entrata_at or (new.uscita_at is not null and coalesce(a.fine_at, 'infinity') > new.uscita_at))
  ) or exists (
    select 1 from app.pause_presenza x
    where x.presenza_id = new.id and x.deleted_at is null
      and (x.inizio_at < new.entrata_at or (new.uscita_at is not null and coalesce(x.fine_at, 'infinity') > new.uscita_at))
  ) then
    raise exception 'Attività o pause fuori dalla presenza corretta' using errcode = '23514';
  end if;
  return new;
end;
$$;
create constraint trigger presenze_contiene_intervalli after update of entrata_at, uscita_at on app.presenze
  deferrable initially immediate
  for each row execute function app.tg_presenza_contiene_intervalli();

-- Valori registrati in origine: immutabili.
create or replace function app.tg_presenza_valori_registrati()
returns trigger
language plpgsql
as $$
begin
  if new.entrata_registrata_at is distinct from old.entrata_registrata_at
     or (old.uscita_registrata_at is not null and new.uscita_registrata_at is distinct from old.uscita_registrata_at) then
    raise exception 'I valori registrati in origine non sono modificabili' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger presenze_valori_registrati before update on app.presenze for each row execute function app.tg_presenza_valori_registrati();

-- Un'attività già sostituita o annullata non può tornare effettiva né cambiare intervallo.
create or replace function app.tg_attivita_storico_immutabile()
returns trigger
language plpgsql
as $$
begin
  if old.superata_da_id is not null or old.annullata then
    if new.inizio_at is distinct from old.inizio_at or new.fine_at is distinct from old.fine_at
       or new.superata_da_id is distinct from old.superata_da_id or new.annullata is distinct from old.annullata then
      raise exception 'Attività % già corretta/annullata: lo storico non è modificabile', old.id using errcode = 'P0001';
    end if;
  end if;
  if old.fine_at is not null and new.fine_at is distinct from old.fine_at and new.superata_da_id is null and not new.annullata then
    raise exception 'Intervallo chiuso: per cambiarlo creare una correzione (sostituisce_id)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger attivita_storico_immutabile before update on app.attivita_lavoro for each row execute function app.tg_attivita_storico_immutabile();

-- -------------------------------------------------------------------------------------
-- Sicurezza: Row Level Security, ruoli e policy NON sono definiti in Fase 1 (fuori ambito).
-- Requisiti architetturali documentati in docs/03-architettura.md §9.
-- -------------------------------------------------------------------------------------

-- >>> migrations/0008_richieste_correzione.sql
-- =====================================================================================
-- 0008 – Richieste di correzione (Fase 3). Migrazione SOLO PREPARATA: non applicata a DB remoti.
-- Il lavoratore segnala un errore su una giornata; l'amministratore la gestisce.
-- La richiesta non modifica dati: le correzioni restano tracciate come in 0004/0006.
-- =====================================================================================
set search_path = app, public;

create table app.richieste_correzione (
  id                uuid primary key default gen_random_uuid(),
  operaio_id        uuid not null references app.profili(id),
  data_lavoro       date not null,
  presenza_id       uuid references app.presenze(id),
  attivita_id       uuid references app.attivita_lavoro(id),
  messaggio         text not null check (length(trim(messaggio)) >= 10),
  stato             text not null default 'aperta' check (stato in ('aperta', 'presa_in_carico', 'risolta', 'respinta')),
  risposta          text not null default '',
  gestita_da        uuid references app.profili(id),
  gestita_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz,
  -- Gestione registrata con autore e istante; risolvere o respingere richiede una risposta.
  check ((stato = 'aperta') = (gestita_da is null and gestita_at is null)),
  check (stato not in ('risolta', 'respinta') or length(trim(risposta)) >= 5)
);
create index richieste_correzione_aperte_idx on app.richieste_correzione (stato, created_at) where stato in ('aperta', 'presa_in_carico');
create index richieste_correzione_operaio_idx on app.richieste_correzione (operaio_id, data_lavoro);

create trigger richieste_metadati before update on app.richieste_correzione for each row execute function app.tg_aggiorna_metadati();
create trigger richieste_no_delete before delete on app.richieste_correzione for each row execute function app.tg_no_delete_fisico();

-- Una richiesta chiusa (risolta/respinta) non si riapre né si modifica.
create or replace function app.tg_richiesta_chiusa_immutabile()
returns trigger
language plpgsql
as $$
begin
  if old.stato in ('risolta', 'respinta') then
    raise exception 'Richiesta di correzione già chiusa: non modificabile' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger richieste_chiusa_immutabile before update on app.richieste_correzione for each row execute function app.tg_richiesta_chiusa_immutabile();

-- >>> migrations/0009_magazzino_materiali.sql
-- =====================================================================================
-- 0009 – Magazzino, materiali e costi (Fase 5). Migrazione SOLO PREPARATA: non applicata a DB remoti.
-- - Anagrafica materiali e magazzini (sede, automezzi).
-- - Movimenti in SOLA AGGIUNTA: la giacenza è la somma dei movimenti validi (vista).
-- - Ogni movimento fissa il costo unitario del momento: le variazioni di prezzo non sono retroattive.
-- - Consumi da rapportino con chiave univoca per riga: niente doppi scarichi da invii ripetuti.
-- =====================================================================================
set search_path = app, public;

create table app.materiali (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null check (codice = upper(trim(codice)) and length(codice) > 0),
  nome              text not null check (length(trim(nome)) > 0),
  descrizione       text not null default '',
  categoria         text not null default '',
  unita             text not null check (unita in ('pz', 'm', 'kg', 'l', 'conf', 'h')),
  prezzo_acquisto   numeric(12,4) not null default 0 check (prezzo_acquisto >= 0),
  prezzo_vendita    numeric(12,4) check (prezzo_vendita is null or prezzo_vendita >= 0),
  fornitore         text not null default '',
  scorta_minima     numeric(12,3) not null default 0 check (scorta_minima >= 0),
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
create unique index materiali_codice_uk on app.materiali (codice) where deleted_at is null;
create index materiali_categoria_idx on app.materiali (categoria, nome);
create trigger materiali_metadati before update on app.materiali for each row execute function app.tg_aggiorna_metadati();
create trigger materiali_no_delete before delete on app.materiali for each row execute function app.tg_no_delete_fisico();

create table app.magazzini (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null check (codice = upper(trim(codice)) and length(codice) > 0),
  nome              text not null check (length(trim(nome)) > 0),
  tipo              text not null check (tipo in ('sede', 'automezzo')),
  responsabile_id   uuid references app.profili(id),
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
create unique index magazzini_codice_uk on app.magazzini (codice) where deleted_at is null;
create trigger magazzini_metadati before update on app.magazzini for each row execute function app.tg_aggiorna_metadati();
create trigger magazzini_no_delete before delete on app.magazzini for each row execute function app.tg_no_delete_fisico();

create table app.movimenti_magazzino (
  id                      uuid primary key default gen_random_uuid(),
  materiale_id            uuid not null references app.materiali(id),
  magazzino_id            uuid not null references app.magazzini(id),
  tipo                    text not null check (tipo in ('carico', 'scarico', 'rettifica', 'trasferimento', 'consumo', 'correzione_consumo')),
  quantita                numeric(12,3) not null check (quantita <> 0),
  costo_unitario          numeric(12,4) not null check (costo_unitario >= 0),
  prezzo_vendita_unitario numeric(12,4) check (prezzo_vendita_unitario is null or prezzo_vendita_unitario >= 0),
  data_riferimento        date not null,
  motivo                  text not null default '',
  documento               text not null default '',
  rapportino_id           uuid references app.rapportini(id),
  riga_rapportino_id      uuid,
  intervento_id           uuid references app.interventi(id),
  cliente_id              uuid references app.clienti(id),
  operaio_id              uuid references app.profili(id),
  corregge_id             uuid references app.movimenti_magazzino(id),
  trasferimento_id        uuid,
  chiave_univoca          text,
  duplicato_di            uuid references app.movimenti_magazzino(id),
  giacenza_insufficiente  boolean not null default false,
  created_at              timestamptz not null default now(),
  created_by              uuid references app.profili(id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references app.profili(id),
  row_version             integer not null default 1 check (row_version > 0),
  device_id               text,
  client_created_at       timestamptz,
  deleted_at              timestamptz,
  -- Verso coerente con il tipo.
  check (tipo not in ('carico') or quantita > 0),
  check (tipo not in ('scarico', 'consumo') or quantita < 0),
  -- Scarichi manuali e rettifiche sempre motivati.
  check (tipo not in ('scarico', 'rettifica', 'correzione_consumo') or length(trim(motivo)) >= 5),
  -- Consumi e correzioni collegati al rapportino (e quindi a intervento e cliente).
  check (tipo not in ('consumo', 'correzione_consumo') or (rapportino_id is not null and riga_rapportino_id is not null and cliente_id is not null)),
  check ((tipo = 'correzione_consumo') = (corregge_id is not null)),
  check ((tipo = 'trasferimento') = (trasferimento_id is not null))
);
-- Un consumo per riga di rapportino: un secondo invio dello stesso consumo viola il vincolo
-- (l'RPC di sincronizzazione lo registra con duplicato_di invece di applicarlo).
create unique index movimenti_chiave_uk on app.movimenti_magazzino (chiave_univoca) where chiave_univoca is not null and duplicato_di is null;
create index movimenti_materiale_idx on app.movimenti_magazzino (materiale_id, magazzino_id);
create index movimenti_data_idx on app.movimenti_magazzino (data_riferimento, tipo);
create index movimenti_rapportino_idx on app.movimenti_magazzino (rapportino_id, riga_rapportino_id) where rapportino_id is not null;

-- Registro in sola aggiunta: nessuna modifica o cancellazione; le correzioni sono nuovi movimenti.
create trigger movimenti_solo_inserimento before update or delete on app.movimenti_magazzino
  for each row execute function app.tg_solo_inserimento();

-- Giacenze calcolate (mai memorizzate): somma dei movimenti validi per materiale e magazzino.
create or replace view app.v_giacenze as
select m.materiale_id, m.magazzino_id, sum(m.quantita)::numeric(12,3) as giacenza
from app.movimenti_magazzino m
where m.deleted_at is null and m.duplicato_di is null
group by m.materiale_id, m.magazzino_id;

-- Costi dei consumi con il costo unitario storico del movimento (non il prezzo attuale).
create or replace view app.v_costi_consumi as
select m.id, m.data_riferimento, m.materiale_id, m.magazzino_id, m.rapportino_id, m.intervento_id, m.cliente_id, m.operaio_id,
       i.tipo as tipo_intervento,
       (-m.quantita) as quantita,
       round(-m.quantita * m.costo_unitario, 2) as costo,
       case when m.prezzo_vendita_unitario is null then null else round(-m.quantita * m.prezzo_vendita_unitario, 2) end as valore_vendita
from app.movimenti_magazzino m
left join app.interventi i on i.id = m.intervento_id
where m.tipo in ('consumo', 'correzione_consumo') and m.deleted_at is null and m.duplicato_di is null;

-- Riga materiale del rapportino collegata all'anagrafica (facoltativa: resta ammesso il testo libero).
alter table app.rapportino_materiali add column materiale_id uuid references app.materiali(id);
alter table app.rapportino_materiali add column magazzino_id uuid references app.magazzini(id);
alter table app.rapportino_materiali drop constraint if exists rapportino_materiali_unita_check;
alter table app.rapportino_materiali add constraint rapportino_materiali_unita_check check (unita in ('pz', 'm', 'kg', 'l', 'conf', 'h'));

-- >>> migrations/0010_impostazioni_azienda.sql
-- =====================================================================================
-- 0010 – Impostazioni aziendali (Fase 9). Migrazione SOLO PREPARATA: non applicata a DB remoti.
-- Una sola riga con i dati stampati sui documenti e le preferenze operative. Finché il client
-- non legge questa tabella (integrazione Supabase), gli stessi valori vanno anche nelle
-- variabili VITE_AZIENDA_* della build (docs/18-avvio-produzione.md).
-- =====================================================================================
set search_path = app, public;

create table app.impostazioni_azienda (
  id                        boolean primary key default true check (id),   -- riga unica
  ragione_sociale           text not null check (length(trim(ragione_sociale)) >= 2),
  indirizzo                 text not null default '',
  partita_iva               text check (partita_iva is null or partita_iva ~ '^[0-9]{11}$'),
  codice_fiscale            text,
  email                     text not null default '',
  telefono                  text not null default '',
  logo_svg                  text check (logo_svg is null or logo_svg like '<svg%'),
  fuso_orario               text not null default 'Europe/Rome',
  ore_giornaliere_default   numeric(4,2) not null default 8 check (ore_giornaliere_default between 1 and 12),
  -- Preferenze operative (soglie del motore ore, promemoria): valori di riferimento in docs/06 e docs/11 (D-16).
  preferenze                jsonb not null default '{"pausa_obbligatoria_dopo_ore": 6, "presenza_lunga_ore": 12, "ore_non_attribuite_soglia_min": 30, "promemoria_intervento_min": 120}'::jsonb,
  created_at                timestamptz not null default now(),
  created_by                uuid references app.profili(id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references app.profili(id),
  row_version               integer not null default 1 check (row_version > 0),
  device_id                 text,
  client_created_at         timestamptz,
  deleted_at                timestamptz
);
create trigger impostazioni_metadati before update on app.impostazioni_azienda for each row execute function app.tg_aggiorna_metadati();
create trigger impostazioni_no_delete before delete on app.impostazioni_azienda for each row execute function app.tg_no_delete_fisico();

-- >>> migrations/0011_username_profili.sql
-- =====================================================================================
-- 0011 – Accesso con username e PIN
-- L'utente accede con un nome utente e un codice PIN di 6 cifre. In Supabase Auth ogni
-- account ha un'email tecnica non recapitabile, ricavata dal nome utente:
--   <username>@utenti.worklog.invalid   (dominio .invalid riservato: nessuna email inviata)
-- Il PIN è la password dell'account in Supabase Auth (salvata solo come hash bcrypt).
-- =====================================================================================
set search_path = app, public;

alter table app.profili add column username text
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
create unique index profili_username_uq on app.profili (username) where deleted_at is null and username is not null;
comment on column app.profili.username is 'Nome utente per l''accesso (minuscolo). Email tecnica in Supabase Auth: <username>@utenti.worklog.invalid';

-- >>> migrations/0012_accesso_profilo.sql
-- =====================================================================================
-- 0012 – Accesso reale: profilo dell'utente collegato
-- Dopo l'accesso con nome utente e PIN (Supabase Auth, migrazione 0011) l'app chiama la RPC
-- public.mio_profilo(): restituisce SOLO il profilo dell'utente autenticato (auth.uid()) e i
-- dati aziendali per le intestazioni. Lo schema "app" resta non esposto: nessuna tabella è
-- leggibile direttamente con le chiavi pubbliche.
-- plpgsql (corpo non validato alla creazione) così la migrazione si verifica anche su un
-- PostgreSQL locale senza lo schema "auth" di Supabase.
-- =====================================================================================

create or replace function public.mio_profilo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;
  return jsonb_build_object(
    'profilo', (
      select to_jsonb(p)
      from app.profili p
      where p.id = v_uid and p.deleted_at is null and p.attivo
    ),
    'azienda', (
      select jsonb_build_object(
        'ragione_sociale', a.ragione_sociale, 'indirizzo', a.indirizzo, 'partita_iva', a.partita_iva,
        'telefono', a.telefono, 'email', a.email, 'sito_web', a.preferenze ->> 'sito_web', 'logo_svg', a.logo_svg)
      from app.impostazioni_azienda a
      where a.deleted_at is null
    )
  );
end;
$$;

comment on function public.mio_profilo() is 'Profilo dell''utente autenticato e dati aziendali (accesso reale, Fase 12).';

revoke all on function public.mio_profilo() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.mio_profilo() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.mio_profilo() to authenticated';
  end if;
end $$;
