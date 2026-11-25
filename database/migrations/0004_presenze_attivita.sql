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
set search_path = app, public;

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
