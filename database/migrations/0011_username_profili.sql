-- =====================================================================================
-- 0011 – Accesso con username e PIN
-- L'utente accede con un nome utente e un codice PIN di 6 cifre. In Supabase Auth ogni
-- account ha un'email tecnica non recapitabile, ricavata dal nome utente:
--   <username>@utenti.worklog.invalid   (dominio .invalid riservato: nessuna email inviata)
-- Il PIN è la password dell'account in Supabase Auth (salvata solo come hash bcrypt).
-- =====================================================================================
set search_path = app, public;

alter table app.profili add column username text
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
create unique index profili_username_uq on app.profili (username) where deleted_at is null and username is not null;
comment on column app.profili.username is 'Nome utente per l''accesso (minuscolo). Email tecnica in Supabase Auth: <username>@utenti.worklog.invalid';
