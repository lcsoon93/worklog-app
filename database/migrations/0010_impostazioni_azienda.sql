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
