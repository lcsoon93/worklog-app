-- =====================================================================================
-- 0017 – Percorso di ricerca fisso per le funzioni delle prime migrazioni (Fase 15)
-- Avviso di sicurezza di Supabase "function_search_path_mutable": le funzioni e i trigger
-- delle migrazioni 0001–0010 ricevono un search_path esplicito (lo stesso con cui sono stati
-- scritti), così il loro comportamento non dipende dalla sessione che le invoca.
-- Applicata al progetto Supabase "worklog" il 27/11/2026, con autorizzazione.
-- =====================================================================================
alter function app.mese_modificabile(p_operaio uuid, p_data date) set search_path = app, public, extensions;
alter function app.prossimo_numero(p_serie text, p_anno smallint) set search_path = app, public, extensions;
alter function app.tg_aggiorna_metadati() set search_path = app, public, extensions;
alter function app.tg_attivita_storico_immutabile() set search_path = app, public, extensions;
alter function app.tg_blocco_mese() set search_path = app, public, extensions;
alter function app.tg_intervallo_in_presenza() set search_path = app, public, extensions;
alter function app.tg_no_delete_fisico() set search_path = app, public, extensions;
alter function app.tg_presenza_contiene_intervalli() set search_path = app, public, extensions;
alter function app.tg_presenza_valori_registrati() set search_path = app, public, extensions;
alter function app.tg_rapportino_immutabile() set search_path = app, public, extensions;
alter function app.tg_richiesta_chiusa_immutabile() set search_path = app, public, extensions;
alter function app.tg_solo_inserimento() set search_path = app, public, extensions;
alter function app.tg_valida_stato_cartellino() set search_path = app, public, extensions;
