-- =====================================================================================
-- 0012 – Accesso reale: profilo dell'utente collegato
-- Dopo l'accesso con nome utente e PIN (Supabase Auth, migrazione 0011) l'app chiama la RPC
-- public.mio_profilo(): restituisce SOLO il profilo dell'utente autenticato (auth.uid()) e i
-- dati aziendali per le intestazioni. Lo schema "app" resta non esposto: nessuna tabella è
-- leggibile direttamente con le chiavi pubbliche.
-- plpgsql (corpo non validato alla creazione) così la migrazione si verifica anche su un
-- PostgreSQL locale senza lo schema "auth" di Supabase.
-- =====================================================================================

create or replace function public.mio_profilo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;
  return jsonb_build_object(
    'profilo', (
      select to_jsonb(p)
      from app.profili p
      where p.id = v_uid and p.deleted_at is null and p.attivo
    ),
    'azienda', (
      select jsonb_build_object(
        'ragione_sociale', a.ragione_sociale, 'indirizzo', a.indirizzo, 'partita_iva', a.partita_iva,
        'telefono', a.telefono, 'email', a.email, 'sito_web', a.preferenze ->> 'sito_web', 'logo_svg', a.logo_svg)
      from app.impostazioni_azienda a
      where a.deleted_at is null
    )
  );
end;
$$;

comment on function public.mio_profilo() is 'Profilo dell''utente autenticato e dati aziendali (accesso reale, Fase 12).';

revoke all on function public.mio_profilo() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.mio_profilo() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.mio_profilo() to authenticated';
  end if;
end $$;
