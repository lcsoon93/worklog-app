-- =====================================================================================
-- 0013 – Rapporto di lavoro autonomo (Fase 12)
-- L'operaio può creare un rapporto senza intervento programmato (intervento_id nullo):
--   richiesta            richiesta ricevuta (es. telefonata) che ha originato il lavoro
--   indirizzo_intervento indirizzo del lavoro se il cliente non ha una sede registrata
--   verificato_at/_da    verifica dell'amministratore (non modifica il contenuto del rapporto)
-- Le ore restano attività della presenza (attivita_lavoro) collegate al rapporto: nessun
-- campo "ore" sul rapporto, quindi nessun doppio conteggio.
-- NON ancora applicata al progetto Supabase.
-- =====================================================================================
set search_path = app, public;

alter table app.rapportini
  add column richiesta            text not null default '',
  add column indirizzo_intervento text not null default '',
  add column verificato_at        timestamptz,
  add column verificato_da        uuid references app.profili(id),
  add constraint rapportini_verifica_ck check ((verificato_at is null) = (verificato_da is null));

create index rapportini_autonomi_da_verificare_idx on app.rapportini (data_lavoro desc)
  where intervento_id is null and verificato_at is null and deleted_at is null;

comment on column app.rapportini.richiesta is 'Richiesta ricevuta (es. al telefono) che ha originato il lavoro; usata soprattutto nei rapporti autonomi.';
comment on column app.rapportini.indirizzo_intervento is 'Indirizzo del lavoro quando non coincide con una sede registrata del cliente.';
comment on column app.rapportini.verificato_at is 'Verifica dell''amministratore sul rapporto completato.';
