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
