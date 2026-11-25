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
