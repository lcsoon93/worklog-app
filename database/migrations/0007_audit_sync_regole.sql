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
