-- =====================================================================================
-- Dati iniziali di PRODUZIONE – MODELLO (Fase 9). NON eseguire senza autorizzazione del titolare.
--
-- Uso (solo dopo aver applicato le migrazioni 0001–0010 e creato gli account in Supabase Auth):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v ragione_sociale='…' -v indirizzo='…' -v partita_iva='…' \
--     -v admin_id='<uuid di auth.users>' -v admin_nome='…' -v admin_cognome='…' -v admin_email='…' \
--     -f 01_dati_iniziali.template.sql
--
-- Sicurezza dei dati esistenti: ogni inserimento è "se non esiste già" (ON CONFLICT DO NOTHING /
-- NOT EXISTS). Rieseguire lo script non sovrascrive né duplica nulla.
-- =====================================================================================
\set ON_ERROR_STOP on
set search_path = app, public;
begin;

insert into impostazioni_azienda (ragione_sociale, indirizzo, partita_iva)
values (:'ragione_sociale', :'indirizzo', nullif(:'partita_iva', ''))
on conflict (id) do nothing;

-- Primo amministratore: l'id DEVE essere quello dell'utente creato/invitato in Supabase Auth.
insert into profili (id, nome, cognome, email, ruolo, qualifica)
values (:'admin_id'::uuid, :'admin_nome', :'admin_cognome', lower(:'admin_email'), 'admin', 'Amministratore')
on conflict (id) do nothing;

-- Magazzino principale (gli automezzi si aggiungono dall'app: Magazzino → Magazzini).
insert into magazzini (codice, nome, tipo)
select 'MAG-01', 'Magazzino centrale', 'sede'
where not exists (select 1 from magazzini where codice = 'MAG-01' and deleted_at is null);

commit;
\echo 'Dati iniziali inseriti (le righe già presenti non sono state toccate).'
