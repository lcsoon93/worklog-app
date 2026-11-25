-- =====================================================================================
-- 0009 – Magazzino, materiali e costi (Fase 5). Migrazione SOLO PREPARATA: non applicata a DB remoti.
-- - Anagrafica materiali e magazzini (sede, automezzi).
-- - Movimenti in SOLA AGGIUNTA: la giacenza è la somma dei movimenti validi (vista).
-- - Ogni movimento fissa il costo unitario del momento: le variazioni di prezzo non sono retroattive.
-- - Consumi da rapportino con chiave univoca per riga: niente doppi scarichi da invii ripetuti.
-- =====================================================================================
set search_path = app, public;

create table app.materiali (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null check (codice = upper(trim(codice)) and length(codice) > 0),
  nome              text not null check (length(trim(nome)) > 0),
  descrizione       text not null default '',
  categoria         text not null default '',
  unita             text not null check (unita in ('pz', 'm', 'kg', 'l', 'conf', 'h')),
  prezzo_acquisto   numeric(12,4) not null default 0 check (prezzo_acquisto >= 0),
  prezzo_vendita    numeric(12,4) check (prezzo_vendita is null or prezzo_vendita >= 0),
  fornitore         text not null default '',
  scorta_minima     numeric(12,3) not null default 0 check (scorta_minima >= 0),
  attivo            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create unique index materiali_codice_uk on app.materiali (codice) where deleted_at is null;
create index materiali_categoria_idx on app.materiali (categoria, nome);
create trigger materiali_metadati before update on app.materiali for each row execute function app.tg_aggiorna_metadati();
create trigger materiali_no_delete before delete on app.materiali for each row execute function app.tg_no_delete_fisico();

create table app.magazzini (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null check (codice = upper(trim(codice)) and length(codice) > 0),
  nome              text not null check (length(trim(nome)) > 0),
  tipo              text not null check (tipo in ('sede', 'automezzo')),
  responsabile_id   uuid references app.profili(id),
  attivo            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references app.profili(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references app.profili(id),
  row_version       integer not null default 1 check (row_version > 0),
  device_id         text,
  client_created_at timestamptz,
  deleted_at        timestamptz
);
create unique index magazzini_codice_uk on app.magazzini (codice) where deleted_at is null;
create trigger magazzini_metadati before update on app.magazzini for each row execute function app.tg_aggiorna_metadati();
create trigger magazzini_no_delete before delete on app.magazzini for each row execute function app.tg_no_delete_fisico();

create table app.movimenti_magazzino (
  id                      uuid primary key default gen_random_uuid(),
  materiale_id            uuid not null references app.materiali(id),
  magazzino_id            uuid not null references app.magazzini(id),
  tipo                    text not null check (tipo in ('carico', 'scarico', 'rettifica', 'trasferimento', 'consumo', 'correzione_consumo')),
  quantita                numeric(12,3) not null check (quantita <> 0),
  costo_unitario          numeric(12,4) not null check (costo_unitario >= 0),
  prezzo_vendita_unitario numeric(12,4) check (prezzo_vendita_unitario is null or prezzo_vendita_unitario >= 0),
  data_riferimento        date not null,
  motivo                  text not null default '',
  documento               text not null default '',
  rapportino_id           uuid references app.rapportini(id),
  riga_rapportino_id      uuid,
  intervento_id           uuid references app.interventi(id),
  cliente_id              uuid references app.clienti(id),
  operaio_id              uuid references app.profili(id),
  corregge_id             uuid references app.movimenti_magazzino(id),
  trasferimento_id        uuid,
  chiave_univoca          text,
  duplicato_di            uuid references app.movimenti_magazzino(id),
  giacenza_insufficiente  boolean not null default false,
  created_at              timestamptz not null default now(),
  created_by              uuid references app.profili(id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references app.profili(id),
  row_version             integer not null default 1 check (row_version > 0),
  device_id               text,
  client_created_at       timestamptz,
  deleted_at              timestamptz,
  -- Verso coerente con il tipo.
  check (tipo not in ('carico') or quantita > 0),
  check (tipo not in ('scarico', 'consumo') or quantita < 0),
  -- Scarichi manuali e rettifiche sempre motivati.
  check (tipo not in ('scarico', 'rettifica', 'correzione_consumo') or length(trim(motivo)) >= 5),
  -- Consumi e correzioni collegati al rapportino (e quindi a intervento e cliente).
  check (tipo not in ('consumo', 'correzione_consumo') or (rapportino_id is not null and riga_rapportino_id is not null and cliente_id is not null)),
  check ((tipo = 'correzione_consumo') = (corregge_id is not null)),
  check ((tipo = 'trasferimento') = (trasferimento_id is not null))
);
-- Un consumo per riga di rapportino: un secondo invio dello stesso consumo viola il vincolo
-- (l'RPC di sincronizzazione lo registra con duplicato_di invece di applicarlo).
create unique index movimenti_chiave_uk on app.movimenti_magazzino (chiave_univoca) where chiave_univoca is not null and duplicato_di is null;
create index movimenti_materiale_idx on app.movimenti_magazzino (materiale_id, magazzino_id);
create index movimenti_data_idx on app.movimenti_magazzino (data_riferimento, tipo);
create index movimenti_rapportino_idx on app.movimenti_magazzino (rapportino_id, riga_rapportino_id) where rapportino_id is not null;

-- Registro in sola aggiunta: nessuna modifica o cancellazione; le correzioni sono nuovi movimenti.
create trigger movimenti_solo_inserimento before update or delete on app.movimenti_magazzino
  for each row execute function app.tg_solo_inserimento();

-- Giacenze calcolate (mai memorizzate): somma dei movimenti validi per materiale e magazzino.
create or replace view app.v_giacenze as
select m.materiale_id, m.magazzino_id, sum(m.quantita)::numeric(12,3) as giacenza
from app.movimenti_magazzino m
where m.deleted_at is null and m.duplicato_di is null
group by m.materiale_id, m.magazzino_id;

-- Costi dei consumi con il costo unitario storico del movimento (non il prezzo attuale).
create or replace view app.v_costi_consumi as
select m.id, m.data_riferimento, m.materiale_id, m.magazzino_id, m.rapportino_id, m.intervento_id, m.cliente_id, m.operaio_id,
       i.tipo as tipo_intervento,
       (-m.quantita) as quantita,
       round(-m.quantita * m.costo_unitario, 2) as costo,
       case when m.prezzo_vendita_unitario is null then null else round(-m.quantita * m.prezzo_vendita_unitario, 2) end as valore_vendita
from app.movimenti_magazzino m
left join app.interventi i on i.id = m.intervento_id
where m.tipo in ('consumo', 'correzione_consumo') and m.deleted_at is null and m.duplicato_di is null;

-- Riga materiale del rapportino collegata all'anagrafica (facoltativa: resta ammesso il testo libero).
alter table app.rapportino_materiali add column materiale_id uuid references app.materiali(id);
alter table app.rapportino_materiali add column magazzino_id uuid references app.magazzini(id);
alter table app.rapportino_materiali drop constraint if exists rapportino_materiali_unita_check;
alter table app.rapportino_materiali add constraint rapportino_materiali_unita_check check (unita in ('pz', 'm', 'kg', 'l', 'conf', 'h'));
