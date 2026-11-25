-- =====================================================================================
-- Import di clienti, sedi, lavoratori e materiali da CSV – MODELLO (Fase 9).
-- NON eseguire senza autorizzazione. I CSV (separatore ";", UTF-8, con intestazione) seguono i
-- modelli in questa cartella. Le righe già presenti (stessa P.IVA / stessa sede / stessa email /
-- stesso codice materiale) vengono SALTATE, mai aggiornate: nessun dato esistente viene sovrascritto.
--
-- Eseguire DALLA CARTELLA che contiene clienti.csv, sedi.csv, lavoratori.csv, materiali.csv:
--   cd /percorso/dei/csv && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /percorso/02_import_anagrafiche.template.sql
-- =====================================================================================
\set ON_ERROR_STOP on
set search_path = app, public;
begin;

create temp table t_clienti (ragione_sociale text, partita_iva text, email text, telefono text, referente text) on commit drop;
create temp table t_sedi (partita_iva_cliente text, ragione_sociale_cliente text, nome text, indirizzo text, cap text, citta text, provincia text, referente text, telefono text, note_accesso text) on commit drop;
create temp table t_lavoratori (auth_id text, nome text, cognome text, email text, telefono text, qualifica text, ore_giornaliere text) on commit drop;
create temp table t_materiali (codice text, nome text, categoria text, unita text, prezzo_acquisto text, prezzo_vendita text, fornitore text, scorta_minima text) on commit drop;

\copy t_clienti from 'clienti.csv' with (format csv, delimiter ';', header true, encoding 'UTF8')
\copy t_sedi from 'sedi.csv' with (format csv, delimiter ';', header true, encoding 'UTF8')
\copy t_lavoratori from 'lavoratori.csv' with (format csv, delimiter ';', header true, encoding 'UTF8')
\copy t_materiali from 'materiali.csv' with (format csv, delimiter ';', header true, encoding 'UTF8')

insert into clienti (ragione_sociale, partita_iva, email, telefono, referente)
select trim(c.ragione_sociale), nullif(trim(c.partita_iva), ''), coalesce(c.email, ''), coalesce(c.telefono, ''), coalesce(c.referente, '')
from t_clienti c
where not exists (
  select 1 from clienti x where x.deleted_at is null
    and ((nullif(trim(c.partita_iva), '') is not null and x.partita_iva = trim(c.partita_iva))
      or (nullif(trim(c.partita_iva), '') is null and lower(x.ragione_sociale) = lower(trim(c.ragione_sociale)))));

insert into sedi_cliente (cliente_id, nome, indirizzo, cap, citta, provincia, referente, telefono, note_accesso)
select x.id, trim(s.nome), coalesce(s.indirizzo, ''), coalesce(s.cap, ''), coalesce(s.citta, ''), upper(coalesce(s.provincia, '')), coalesce(s.referente, ''), coalesce(s.telefono, ''), coalesce(s.note_accesso, '')
from t_sedi s
join clienti x on x.deleted_at is null and (
  (nullif(trim(s.partita_iva_cliente), '') is not null and x.partita_iva = trim(s.partita_iva_cliente))
  or (nullif(trim(s.partita_iva_cliente), '') is null and lower(x.ragione_sociale) = lower(trim(s.ragione_sociale_cliente))))
where not exists (select 1 from sedi_cliente y where y.cliente_id = x.id and lower(y.nome) = lower(trim(s.nome)) and y.deleted_at is null);

-- Lavoratori: auth_id = id dell'utente invitato in Supabase Auth (obbligatorio).
insert into profili (id, nome, cognome, email, telefono, ruolo, qualifica, ore_giornaliere_contratto)
select l.auth_id::uuid, trim(l.nome), trim(l.cognome), lower(trim(l.email)), coalesce(l.telefono, ''), 'operaio', coalesce(l.qualifica, ''), coalesce(nullif(l.ore_giornaliere, '')::numeric, 8)
from t_lavoratori l
where not exists (select 1 from profili p where p.id = l.auth_id::uuid or (lower(p.email) = lower(trim(l.email)) and p.deleted_at is null));

insert into materiali (codice, nome, categoria, unita, prezzo_acquisto, prezzo_vendita, fornitore, scorta_minima)
select upper(trim(m.codice)), trim(m.nome), coalesce(m.categoria, ''), trim(m.unita), coalesce(nullif(replace(m.prezzo_acquisto, ',', '.'), '')::numeric, 0),
       nullif(replace(coalesce(m.prezzo_vendita, ''), ',', '.'), '')::numeric, coalesce(m.fornitore, ''), coalesce(nullif(replace(m.scorta_minima, ',', '.'), '')::numeric, 0)
from t_materiali m
where not exists (select 1 from materiali x where x.codice = upper(trim(m.codice)) and x.deleted_at is null);

commit;
\echo 'Import completato: le righe già presenti sono state saltate.'
