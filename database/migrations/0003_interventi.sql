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
