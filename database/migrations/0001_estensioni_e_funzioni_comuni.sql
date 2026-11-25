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
