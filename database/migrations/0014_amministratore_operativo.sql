-- =====================================================================================
-- 0014 – Amministratore operativo e flusso di invio/approvazione dei rapporti (Fase 13)
-- • profili.amministratore_operativo: operaio che gestisce anche clienti, sedi, interventi e
--   ritorni (es. "luca"). Non approva rapporti né cartellini. mio_profilo() lo restituisce già
--   (to_jsonb della riga). Finché questa migrazione non è applicata l'app usa la variabile
--   VITE_AMMINISTRATORI_OPERATIVI.
-- • rapportini: fase del flusso (bozza e pronto restano sul dispositivo: sul server arrivano
--   inviato / da_correggere / approvato), restituzione con motivo, numero di revisione.
-- NON ancora applicata al progetto Supabase.
-- =====================================================================================
set search_path = app, public;

alter table app.profili
  add column amministratore_operativo boolean not null default false,
  add constraint profili_amm_operativo_ck check (not amministratore_operativo or ruolo = 'operaio');

alter table app.rapportini
  add column fase_invio          text not null default 'inviato'
    check (fase_invio in ('inviato', 'da_correggere', 'approvato')),
  add column inviato_at          timestamptz,
  add column motivo_restituzione text not null default '',
  add column restituito_at       timestamptz,
  add column restituito_da       uuid references app.profili(id),
  add column revisione           integer not null default 0 check (revisione >= 0),
  add constraint rapportini_restituzione_ck check (fase_invio <> 'da_correggere' or length(trim(motivo_restituzione)) >= 5),
  add constraint rapportini_approvazione_ck check (fase_invio <> 'approvato' or verificato_at is not null);

-- I rapporti già verificati (0013) risultano approvati.
update app.rapportini set fase_invio = 'approvato' where verificato_at is not null;

create index rapportini_da_approvare_idx on app.rapportini (inviato_at) where fase_invio = 'inviato' and deleted_at is null;

comment on column app.profili.amministratore_operativo is 'Operaio con gestione di clienti, sedi, interventi e ritorni (Fase 13).';
comment on column app.rapportini.fase_invio is 'Flusso: inviato → approvato, oppure da_correggere → (correzione tracciata, revisione+1) → inviato.';
