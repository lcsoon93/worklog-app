# 05 – Dizionario dati

> **Generato** da `database/genera-dizionario.py` leggendo il catalogo di PostgreSQL 16 locale dopo l'applicazione di `database/schema.sql`. Non modificare a mano: aggiornare le migrazioni o le descrizioni nello script e rigenerare.

Schema: `app`. Colonne tecniche comuni (presenti nelle tabelle sincronizzabili):

| Colonna | Significato |
|---|---|
| `created_at` | Istante di creazione (server). Immutabile. |
| `created_by` | Utente che ha creato il record. Immutabile. |
| `updated_at` | Ultima modifica (trigger). |
| `updated_by` | Utente dell'ultima modifica. |
| `row_version` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | Dispositivo che ha originato la modifica. |
| `client_created_at` | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | Eliminazione logica: se valorizzato il record è escluso. |
| `id` | Chiave primaria UUID v4 generata sul dispositivo. |

Indice: [profili](#profili) · [clienti](#clienti) · [sedi_cliente](#sedi_cliente) · [interventi](#interventi) · [intervento_operai](#intervento_operai) · [presenze](#presenze) · [pause_presenza](#pause_presenza) · [attivita_lavoro](#attivita_lavoro) · [imprevisti](#imprevisti) · [allegati](#allegati) · [rapportini](#rapportini) · [rapportino_operai](#rapportino_operai) · [rapportino_attivita](#rapportino_attivita) · [rapportino_materiali](#rapportino_materiali) · [rapportino_foto](#rapportino_foto) · [rapportino_firme](#rapportino_firme) · [followup](#followup) · [imprevisto_allegati](#imprevisto_allegati) · [transizioni_cartellino](#transizioni_cartellino) · [cartellini_mensili](#cartellini_mensili) · [cartellino_versioni](#cartellino_versioni) · [approvazioni_cartellino](#approvazioni_cartellino) · [audit_log](#audit_log) · [dispositivi](#dispositivi) · [sync_operazioni](#sync_operazioni) · [contatori_documenti](#contatori_documenti) · [richieste_correzione](#richieste_correzione) · [materiali](#materiali) · [magazzini](#magazzini) · [movimenti_magazzino](#movimenti_magazzino) · [impostazioni_azienda](#impostazioni_azienda)

## profili

Utenti dell'azienda (amministratori e operai). In Fase 2 l'id coincide con auth.users.id.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `nome` | text | no |  |  |
| `cognome` | text | no |  |  |
| `email` | text | no |  |  |
| `telefono` | text | no | `''::text` |  |
| `ruolo` | text | no |  | admin \| operaio. |
| `attivo` | boolean | no | `true` | Se falso l'utente non può accedere né timbrare. |
| `qualifica` | text | no | `''::text` |  |
| `colore` | text | no | `'#0f766e'::text` | Colore in agenda. |
| `ore_giornaliere_contratto` | numeric(4,2) | no | `8` | Ore contrattuali giornaliere (riferimento per report). |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |
| `username` | text | sì |  |  |

**Vincoli**

- CHECK `profili_cognome_check`: `CHECK ((length(TRIM(BOTH FROM cognome)) > 0))`
- CHECK `profili_colore_check`: `CHECK ((colore ~ '^#[0-9a-fA-F]{6}$'::text))`
- CHECK `profili_nome_check`: `CHECK ((length(TRIM(BOTH FROM nome)) > 0))`
- CHECK `profili_ore_giornaliere_contratto_check`: `CHECK (((ore_giornaliere_contratto >= (1)::numeric) AND (ore_giornaliere_contratto <= (12)::numeric)))`
- CHECK `profili_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `profili_ruolo_check`: `CHECK ((ruolo = ANY (ARRAY['admin'::text, 'operaio'::text])))`
- CHECK `profili_username_check`: `CHECK (((username IS NULL) OR (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'::text)))`
- FK `profili_created_by_fk`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `profili_updated_by_fk`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `profili_pkey`: `PRIMARY KEY (id)`

**Indici**

- `profili_email_uq`: `btree (lower(email)) WHERE (deleted_at IS NULL)`
- `profili_username_uq`: `btree (username) WHERE ((deleted_at IS NULL) AND (username IS NOT NULL))`

**Trigger**: `profili_metadati` → `tg_aggiorna_metadati()`, `profili_no_delete` → `tg_no_delete_fisico()`

## clienti

Clienti dell'azienda.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `ragione_sociale` | text | no |  |  |
| `partita_iva` | text | sì |  | 11 cifre, univoca tra i clienti attivi; null se assente. |
| `codice_fiscale` | text | sì |  |  |
| `email` | text | no | `''::text` |  |
| `telefono` | text | no | `''::text` |  |
| `referente` | text | no | `''::text` |  |
| `note` | text | no | `''::text` |  |
| `attivo` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `clienti_partita_iva_check`: `CHECK (((partita_iva IS NULL) OR (partita_iva ~ '^[0-9]{11}$'::text)))`
- CHECK `clienti_ragione_sociale_check`: `CHECK ((length(TRIM(BOTH FROM ragione_sociale)) >= 2))`
- CHECK `clienti_row_version_check`: `CHECK ((row_version > 0))`
- FK `clienti_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `clienti_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `clienti_pkey`: `PRIMARY KEY (id)`

**Indici**

- `clienti_piva_uq`: `btree (partita_iva) WHERE ((partita_iva IS NOT NULL) AND (deleted_at IS NULL))`
- `clienti_ragione_sociale_idx`: `btree (lower(ragione_sociale))`

**Trigger**: `clienti_metadati` → `tg_aggiorna_metadati()`, `clienti_no_delete` → `tg_no_delete_fisico()`

## sedi_cliente

Sedi operative dei clienti, luogo degli interventi.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `cliente_id` | uuid | no |  | Riferimento a `clienti`. |
| `nome` | text | no |  |  |
| `indirizzo` | text | no | `''::text` |  |
| `cap` | text | no | `''::text` |  |
| `citta` | text | no | `''::text` |  |
| `provincia` | text | no | `''::text` |  |
| `referente` | text | no | `''::text` |  |
| `telefono` | text | no | `''::text` |  |
| `note_accesso` | text | no | `''::text` | Istruzioni di accesso mostrate agli operai (chiavi, orari, DPI). |
| `latitudine` | numeric(9,6) | sì |  |  |
| `longitudine` | numeric(9,6) | sì |  |  |
| `attiva` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `sedi_cliente_cap_check`: `CHECK (((cap = ''::text) OR (cap ~ '^[0-9]{5}$'::text)))`
- CHECK `sedi_cliente_nome_check`: `CHECK ((length(TRIM(BOTH FROM nome)) >= 2))`
- CHECK `sedi_cliente_provincia_check`: `CHECK (((provincia = ''::text) OR (provincia ~ '^[A-Z]{2}$'::text)))`
- CHECK `sedi_cliente_row_version_check`: `CHECK ((row_version > 0))`
- FK `sedi_cliente_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- FK `sedi_cliente_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `sedi_cliente_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `sedi_cliente_pkey`: `PRIMARY KEY (id)`
- UNIQUE `sedi_cliente_id_cliente_id_key`: `UNIQUE (id, cliente_id)`

**Indici**

- `sedi_cliente_cliente_idx`: `btree (cliente_id) WHERE (deleted_at IS NULL)`
- `sedi_cliente_id_cliente_id_key`: `btree (id, cliente_id)`

**Trigger**: `sedi_metadati` → `tg_aggiorna_metadati()`, `sedi_no_delete` → `tg_no_delete_fisico()`

## interventi

Lavori programmati o richiesti presso un cliente/sede. Gli interventi di ritorno puntano al followup che li ha generati.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `codice` | text | no |  | Codice leggibile assegnato dal server (INT-AAAA-NNN). |
| `cliente_id` | uuid | no |  | Riferimento a `clienti`. |
| `sede_id` | uuid | sì |  | Sede del cliente (FK composta con cliente_id). |
| `titolo` | text | no |  |  |
| `descrizione` | text | no | `''::text` |  |
| `tipo` | text | no |  |  |
| `priorita` | text | no | `'normale'::text` |  |
| `stato` | text | no | `'da_programmare'::text` | da_programmare \| programmato \| in_corso \| da_ultimare \| completato \| annullato. |
| `data_programmata` | date | sì |  |  |
| `ora_inizio` | time without time zone | sì |  |  |
| `durata_prevista_min` | integer | sì |  | Durata prevista in minuti (pianificazione, non ore lavorate). |
| `followup_origine_id` | uuid | sì |  | Per gli interventi di tipo ritorno: followup che li ha generati. |
| `note` | text | no | `''::text` |  |
| `motivo_annullamento` | text | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `interventi_check`: `CHECK (((stato = 'da_programmare'::text) OR (data_programmata IS NOT NULL)))`
- CHECK `interventi_check1`: `CHECK (((stato <> 'annullato'::text) OR (motivo_annullamento IS NOT NULL)))`
- CHECK `interventi_check2`: `CHECK (((tipo = 'ritorno'::text) = (followup_origine_id IS NOT NULL)))`
- CHECK `interventi_durata_prevista_min_check`: `CHECK (((durata_prevista_min IS NULL) OR ((durata_prevista_min >= 5) AND (durata_prevista_min <= (24 * 60)))))`
- CHECK `interventi_priorita_check`: `CHECK ((priorita = ANY (ARRAY['bassa'::text, 'normale'::text, 'alta'::text, 'urgente'::text])))`
- CHECK `interventi_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `interventi_stato_check`: `CHECK ((stato = ANY (ARRAY['da_programmare'::text, 'programmato'::text, 'in_corso'::text, 'da_ultimare'::text, 'completato'::text, 'annullato'::text])))`
- CHECK `interventi_tipo_check`: `CHECK ((tipo = ANY (ARRAY['manutenzione'::text, 'installazione'::text, 'riparazione'::text, 'sopralluogo'::text, 'ritorno'::text])))`
- CHECK `interventi_titolo_check`: `CHECK ((length(TRIM(BOTH FROM titolo)) >= 3))`
- FK `interventi_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `interventi_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `interventi_followup_fk`: `FOREIGN KEY (followup_origine_id) REFERENCES app.followup(id)`
- FK `interventi_sede_id_cliente_id_fkey`: `FOREIGN KEY (sede_id, cliente_id) REFERENCES app.sedi_cliente(id, cliente_id)`
- FK `interventi_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `interventi_pkey`: `PRIMARY KEY (id)`

**Indici**

- `interventi_cliente_idx`: `btree (cliente_id, data_programmata DESC)`
- `interventi_codice_uq`: `btree (codice)`
- `interventi_data_idx`: `btree (data_programmata) WHERE ((deleted_at IS NULL) AND (stato <> 'annullato'::text))`
- `interventi_stato_idx`: `btree (stato) WHERE (stato = ANY (ARRAY['da_programmare'::text, 'da_ultimare'::text]))`

**Trigger**: `interventi_metadati` → `tg_aggiorna_metadati()`, `interventi_no_delete` → `tg_no_delete_fisico()`

## intervento_operai

Squadra assegnata a un intervento (più operai, un responsabile). Le rimozioni sono logiche.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `intervento_id` | uuid | no |  | Riferimento a `interventi`. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |
| `ruolo` | text | no | `'squadra'::text` | responsabile (uno per intervento) \| squadra. |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `intervento_operai_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `intervento_operai_ruolo_check`: `CHECK ((ruolo = ANY (ARRAY['responsabile'::text, 'squadra'::text])))`
- FK `intervento_operai_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `intervento_operai_intervento_id_fkey`: `FOREIGN KEY (intervento_id) REFERENCES app.interventi(id)`
- FK `intervento_operai_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `intervento_operai_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `intervento_operai_pkey`: `PRIMARY KEY (id)`

**Indici**

- `intervento_operai_operaio_idx`: `btree (operaio_id) WHERE (deleted_at IS NULL)`
- `intervento_operai_un_responsabile`: `btree (intervento_id) WHERE ((ruolo = 'responsabile'::text) AND (deleted_at IS NULL))`
- `intervento_operai_uq`: `btree (intervento_id, operaio_id) WHERE (deleted_at IS NULL)`

**Trigger**: `intervento_operai_metadati` → `tg_aggiorna_metadati()`, `intervento_operai_no_delete` → `tg_no_delete_fisico()`

## presenze

Giornata lavorativa di un operaio: entrata, uscita, valori registrati in origine, ultimo segnale dell'app.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |
| `data_lavoro` | date | no |  | Giorno lavorativo = giorno locale dell'entrata (anche se l'uscita è dopo mezzanotte). |
| `entrata_at` | timestamp with time zone | no |  | Entrata effettiva (eventualmente corretta). |
| `uscita_at` | timestamp with time zone | sì |  | Uscita effettiva; null = giornata aperta. |
| `entrata_registrata_at` | timestamp with time zone | no |  | Entrata registrata in origine dal dispositivo. Immutabile. |
| `uscita_registrata_at` | timestamp with time zone | sì |  | Uscita registrata in origine. Immutabile una volta valorizzata. |
| `ultimo_segnale_at` | timestamp with time zone | no |  | Ultimo istante in cui l'app era attiva: base per proporre l'uscita dopo una chiusura anomala. |
| `uscita_automatica` | boolean | no | `false` | Uscita indicata a posteriori (non al momento). |
| `note` | text | no | `''::text` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `presenze_data_coerente`: `CHECK ((data_lavoro = ((entrata_at AT TIME ZONE 'Europe/Rome'::text))::date))`
- CHECK `presenze_max_24h`: `CHECK (((uscita_at IS NULL) OR ((uscita_at - entrata_at) <= '24:00:00'::interval)))`
- CHECK `presenze_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `presenze_uscita_dopo_entrata`: `CHECK (((uscita_at IS NULL) OR (uscita_at > entrata_at)))`
- FK `presenze_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `presenze_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `presenze_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `presenze_pkey`: `PRIMARY KEY (id)`
- t `presenze_contiene_intervalli`: `TRIGGER DEFERRABLE`
- UNIQUE `presenze_id_operaio_id_key`: `UNIQUE (id, operaio_id)`
- EXCLUDE `presenze_no_sovrapposizioni`: `EXCLUDE USING gist (operaio_id WITH =, tstzrange(entrata_at, COALESCE(uscita_at, 'infinity'::timestamp with time zone), '[)'::text) WITH &&) WHERE ((deleted_at IS NULL))`

**Indici**

- `presenze_data_idx`: `btree (data_lavoro)`
- `presenze_id_operaio_id_key`: `btree (id, operaio_id)`
- `presenze_no_sovrapposizioni`: `gist (operaio_id, tstzrange(entrata_at, COALESCE(uscita_at, 'infinity'::timestamp with time zone), '[)'::text)) WHERE (deleted_at IS NULL)`
- `presenze_operaio_data_idx`: `btree (operaio_id, data_lavoro)`
- `presenze_una_aperta`: `btree (operaio_id) WHERE ((uscita_at IS NULL) AND (deleted_at IS NULL))`

**Trigger**: `presenze_blocco_mese` → `tg_blocco_mese()`, `presenze_contiene_intervalli` → `tg_presenza_contiene_intervalli()`, `presenze_metadati` → `tg_aggiorna_metadati()`, `presenze_no_delete` → `tg_no_delete_fisico()`, `presenze_valori_registrati` → `tg_presenza_valori_registrati()`

## pause_presenza

Pause all'interno di una presenza.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `presenza_id` | uuid | no |  | Riferimento a `presenze`. |
| `operaio_id` | uuid | no |  | Riferimento a `presenze`. |
| `tipo` | text | no |  | pranzo \| breve \| altro. |
| `inizio_at` | timestamp with time zone | no |  |  |
| `fine_at` | timestamp with time zone | sì |  |  |
| `attivita_sospesa_id` | uuid | sì |  | Attività interrotta dalla pausa, proposta alla ripresa. |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `pause_fine_dopo_inizio`: `CHECK (((fine_at IS NULL) OR (fine_at > inizio_at)))`
- CHECK `pause_presenza_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `pause_presenza_tipo_check`: `CHECK ((tipo = ANY (ARRAY['pranzo'::text, 'breve'::text, 'altro'::text])))`
- FK `pause_attivita_sospesa_fk`: `FOREIGN KEY (attivita_sospesa_id) REFERENCES app.attivita_lavoro(id)`
- FK `pause_presenza_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `pause_presenza_presenza_id_operaio_id_fkey`: `FOREIGN KEY (presenza_id, operaio_id) REFERENCES app.presenze(id, operaio_id)`
- FK `pause_presenza_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `pause_presenza_pkey`: `PRIMARY KEY (id)`
- EXCLUDE `pause_no_sovrapposizioni`: `EXCLUDE USING gist (presenza_id WITH =, tstzrange(inizio_at, COALESCE(fine_at, 'infinity'::timestamp with time zone), '[)'::text) WITH &&) WHERE ((deleted_at IS NULL))`

**Indici**

- `pause_no_sovrapposizioni`: `gist (presenza_id, tstzrange(inizio_at, COALESCE(fine_at, 'infinity'::timestamp with time zone), '[)'::text)) WHERE (deleted_at IS NULL)`
- `pause_presenza_idx`: `btree (presenza_id)`
- `pause_una_aperta`: `btree (presenza_id) WHERE ((fine_at IS NULL) AND (deleted_at IS NULL))`

**Trigger**: `pause_blocco_mese` → `tg_blocco_mese()`, `pause_in_presenza` → `tg_intervallo_in_presenza()`, `pause_metadati` → `tg_aggiorna_metadati()`, `pause_no_delete` → `tg_no_delete_fisico()`

## attivita_lavoro

Intervalli di tempo della presenza attribuiti a cliente, intervento, attività interna o trasferimento. Le correzioni producono nuove righe collegate.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `presenza_id` | uuid | no |  | Riferimento a `presenze`. |
| `operaio_id` | uuid | no |  | Riferimento a `presenze`. |
| `tipo` | text | no |  | lavoro_cliente \| trasferimento \| interna \| da_definire. |
| `cliente_id` | uuid | sì |  | Riferimento a `clienti`. |
| `sede_id` | uuid | sì |  | Riferimento a `sedi_cliente`. |
| `intervento_id` | uuid | sì |  | Riferimento a `interventi`. |
| `codice_interno` | text | sì |  | Per tipo interna: magazzino \| manutenzione_mezzi \| formazione \| ufficio \| riunione. |
| `descrizione` | text | no | `''::text` |  |
| `inizio_at` | timestamp with time zone | no |  |  |
| `fine_at` | timestamp with time zone | sì |  | Null = timer in corso. |
| `origine` | text | no | `'timer'::text` | timer \| manuale \| correzione \| divisione. |
| `sostituisce_id` | uuid | sì |  | Riga sostituita da questa correzione/divisione. |
| `superata_da_id` | uuid | sì |  | Se valorizzato la riga è storica e non conta nel calcolo. |
| `annullata` | boolean | no | `false` | Attività annullata (con motivo); resta nello storico. |
| `motivo_correzione` | text | no | `''::text` | Obbligatorio per correzioni, inserimenti manuali e annullamenti. |
| `chiusura_automatica` | boolean | no | `false` | Timer chiuso dal sistema all'uscita. |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `attivita_annullata_motivata`: `CHECK (((NOT annullata) OR (length(TRIM(BOTH FROM motivo_correzione)) > 0)))`
- CHECK `attivita_catena`: `CHECK (((origine = ANY (ARRAY['correzione'::text, 'divisione'::text])) = (sostituisce_id IS NOT NULL)))`
- CHECK `attivita_correzione_tracciata`: `CHECK (((origine = 'timer'::text) OR (length(TRIM(BOTH FROM motivo_correzione)) > 0)))`
- CHECK `attivita_destinazione`: `CHECK ((((tipo = 'lavoro_cliente'::text) AND (cliente_id IS NOT NULL) AND (codice_interno IS NULL)) OR ((tipo = 'trasferimento'::text) AND (codice_interno IS NULL)) OR ((tipo = 'interna'::text) AND (codice_interno IS NOT NULL) AND (cliente_id IS NULL) AND (intervento_id IS NULL)) OR ((tipo = 'da_definire'::text) AND (cliente_id IS NULL) AND (intervento_id IS NULL) AND (codice_interno IS NULL))))`
- CHECK `attivita_fine_dopo_inizio`: `CHECK (((fine_at IS NULL) OR (fine_at > inizio_at)))`
- CHECK `attivita_lavoro_codice_interno_check`: `CHECK ((codice_interno = ANY (ARRAY['magazzino'::text, 'manutenzione_mezzi'::text, 'formazione'::text, 'ufficio'::text, 'riunione'::text])))`
- CHECK `attivita_lavoro_origine_check`: `CHECK ((origine = ANY (ARRAY['timer'::text, 'manuale'::text, 'correzione'::text, 'divisione'::text])))`
- CHECK `attivita_lavoro_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `attivita_lavoro_tipo_check`: `CHECK ((tipo = ANY (ARRAY['lavoro_cliente'::text, 'trasferimento'::text, 'interna'::text, 'da_definire'::text])))`
- FK `attivita_lavoro_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `attivita_lavoro_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `attivita_lavoro_intervento_id_fkey`: `FOREIGN KEY (intervento_id) REFERENCES app.interventi(id)`
- FK `attivita_lavoro_presenza_id_operaio_id_fkey`: `FOREIGN KEY (presenza_id, operaio_id) REFERENCES app.presenze(id, operaio_id)`
- FK `attivita_lavoro_sede_id_cliente_id_fkey`: `FOREIGN KEY (sede_id, cliente_id) REFERENCES app.sedi_cliente(id, cliente_id)`
- FK `attivita_lavoro_sostituisce_id_fkey`: `FOREIGN KEY (sostituisce_id) REFERENCES app.attivita_lavoro(id)`
- FK `attivita_lavoro_superata_da_id_fkey`: `FOREIGN KEY (superata_da_id) REFERENCES app.attivita_lavoro(id)`
- FK `attivita_lavoro_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `attivita_lavoro_pkey`: `PRIMARY KEY (id)`

**Indici**

- `attivita_catena_idx`: `btree (sostituisce_id) WHERE (sostituisce_id IS NOT NULL)`
- `attivita_cliente_idx`: `btree (cliente_id, inizio_at) WHERE ((superata_da_id IS NULL) AND (NOT annullata))`
- `attivita_intervento_idx`: `btree (intervento_id) WHERE (intervento_id IS NOT NULL)`
- `attivita_presenza_idx`: `btree (presenza_id)`
- `attivita_un_timer_attivo`: `btree (operaio_id) WHERE ((fine_at IS NULL) AND (superata_da_id IS NULL) AND (NOT annullata) AND (deleted_at IS NULL))`

**Trigger**: `attivita_blocco_mese` → `tg_blocco_mese()`, `attivita_in_presenza` → `tg_intervallo_in_presenza()`, `attivita_metadati` → `tg_aggiorna_metadati()`, `attivita_no_delete` → `tg_no_delete_fisico()`, `attivita_storico_immutabile` → `tg_attivita_storico_immutabile()`

## imprevisti

Problemi riscontrati durante il lavoro.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |
| `presenza_id` | uuid | sì |  | Riferimento a `presenze`. |
| `intervento_id` | uuid | sì |  | Riferimento a `interventi`. |
| `cliente_id` | uuid | sì |  | Riferimento a `clienti`. |
| `rapportino_id` | uuid | sì |  | Riferimento a `rapportini`. |
| `tipo` | text | no |  |  |
| `gravita` | text | no | `'media'::text` |  |
| `descrizione` | text | no |  |  |
| `avvenuto_at` | timestamp with time zone | no |  |  |
| `blocca_lavoro` | boolean | no | `false` | Il problema impedisce di proseguire. |
| `richiede_ritorno` | boolean | no | `false` | Suggerisce l'esito 'serve un ritorno' nel rapportino. |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `imprevisti_descrizione_check`: `CHECK ((length(TRIM(BOTH FROM descrizione)) >= 5))`
- CHECK `imprevisti_gravita_check`: `CHECK ((gravita = ANY (ARRAY['bassa'::text, 'media'::text, 'alta'::text])))`
- CHECK `imprevisti_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `imprevisti_tipo_check`: `CHECK ((tipo = ANY (ARRAY['materiale_mancante'::text, 'accesso_negato'::text, 'guasto_aggiuntivo'::text, 'cliente_assente'::text, 'sicurezza'::text, 'meteo'::text, 'altro'::text])))`
- FK `imprevisti_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `imprevisti_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `imprevisti_intervento_id_fkey`: `FOREIGN KEY (intervento_id) REFERENCES app.interventi(id)`
- FK `imprevisti_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `imprevisti_presenza_id_fkey`: `FOREIGN KEY (presenza_id) REFERENCES app.presenze(id)`
- FK `imprevisti_rapportino_fk`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- FK `imprevisti_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `imprevisti_pkey`: `PRIMARY KEY (id)`

**Indici**

- `imprevisti_intervento_idx`: `btree (intervento_id) WHERE (intervento_id IS NOT NULL)`
- `imprevisti_operaio_idx`: `btree (operaio_id, avvenuto_at DESC)`

**Trigger**: `imprevisti_metadati` → `tg_aggiorna_metadati()`, `imprevisti_no_delete` → `tg_no_delete_fisico()`

## allegati

Metadati di foto, firme e documenti; il contenuto è su Supabase Storage.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `tipo` | text | no |  |  |
| `entita` | text | no |  | rapportino \| imprevisto \| intervento. |
| `entita_id` | uuid | no |  |  |
| `nome_file` | text | no |  |  |
| `mime` | text | no |  |  |
| `dimensione` | integer | no |  |  |
| `sha256` | text | sì |  | Impronta del contenuto: verifica dell'integrità e deduplica degli upload. |
| `storage_path` | text | sì |  | Percorso su Storage; valorizzato solo dopo upload confermato. |
| `caricato_at` | timestamp with time zone | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `allegati_check`: `CHECK (((storage_path IS NULL) = (caricato_at IS NULL)))`
- CHECK `allegati_dimensione_check`: `CHECK (((dimensione > 0) AND (dimensione <= ((15 * 1024) * 1024))))`
- CHECK `allegati_entita_check`: `CHECK ((entita = ANY (ARRAY['rapportino'::text, 'imprevisto'::text, 'intervento'::text])))`
- CHECK `allegati_mime_check`: `CHECK ((mime ~ '^(image|application)/'::text))`
- CHECK `allegati_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `allegati_sha256_check`: `CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text)))`
- CHECK `allegati_tipo_check`: `CHECK ((tipo = ANY (ARRAY['foto'::text, 'firma'::text, 'documento'::text])))`
- FK `allegati_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `allegati_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `allegati_pkey`: `PRIMARY KEY (id)`

**Indici**

- `allegati_entita_idx`: `btree (entita, entita_id)`

**Trigger**: `allegati_metadati` → `tg_aggiorna_metadati()`, `allegati_no_delete` → `tg_no_delete_fisico()`

## rapportini

Documento del lavoro eseguito (autonomo, da intervento o da ritorno). Le bozze non arrivano al server.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `numero` | text | sì |  | Numero definitivo R-AAAA-NNNN assegnato dal server. |
| `numero_provvisorio` | text | no |  | Numero generato sul dispositivo, unico per device_id. |
| `tipo` | text | no |  |  |
| `stato` | text | no | `'completato'::text` | completato \| firmato \| annullato (le bozze restano sul dispositivo). |
| `data_lavoro` | date | no |  |  |
| `cliente_id` | uuid | no |  | Riferimento a `clienti`. |
| `sede_id` | uuid | sì |  | Riferimento a `sedi_cliente`. |
| `intervento_id` | uuid | sì |  | Null = rapportino autonomo. |
| `followup_id` | uuid | sì |  | Valorizzato per i rapportini di un ritorno. |
| `redatto_da` | uuid | no |  | Riferimento a `profili`. |
| `descrizione_lavoro` | text | no |  |  |
| `esito` | text | no |  | completato \| da_ultimare \| ritorno_necessario \| non_eseguito. |
| `note_interne` | text | no | `''::text` | Obbligatorie (≥ 5 caratteri) se l'esito richiede un seguito. |
| `firma_cliente_nome` | text | sì |  |  |
| `motivo_annullamento` | text | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | no |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |
| `richiesta` | text | no | `''::text` |  |
| `indirizzo_intervento` | text | no | `''::text` |  |
| `verificato_at` | timestamp with time zone | sì |  |  |
| `verificato_da` | uuid | sì |  | Riferimento a `profili`. |

**Vincoli**

- CHECK `rapportini_check`: `CHECK (((esito <> ALL (ARRAY['da_ultimare'::text, 'ritorno_necessario'::text])) OR (length(TRIM(BOTH FROM note_interne)) >= 5)))`
- CHECK `rapportini_check1`: `CHECK (((stato <> 'annullato'::text) OR (motivo_annullamento IS NOT NULL)))`
- CHECK `rapportini_descrizione_lavoro_check`: `CHECK ((length(TRIM(BOTH FROM descrizione_lavoro)) >= 10))`
- CHECK `rapportini_esito_check`: `CHECK ((esito = ANY (ARRAY['completato'::text, 'da_ultimare'::text, 'ritorno_necessario'::text, 'non_eseguito'::text])))`
- CHECK `rapportini_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `rapportini_stato_check`: `CHECK ((stato = ANY (ARRAY['completato'::text, 'firmato'::text, 'annullato'::text])))`
- CHECK `rapportini_tipo_check`: `CHECK ((tipo = ANY (ARRAY['rapido'::text, 'completo'::text])))`
- CHECK `rapportini_verifica_ck`: `CHECK (((verificato_at IS NULL) = (verificato_da IS NULL)))`
- FK `rapportini_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `rapportini_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `rapportini_followup_fk`: `FOREIGN KEY (followup_id) REFERENCES app.followup(id)`
- FK `rapportini_intervento_id_fkey`: `FOREIGN KEY (intervento_id) REFERENCES app.interventi(id)`
- FK `rapportini_redatto_da_fkey`: `FOREIGN KEY (redatto_da) REFERENCES app.profili(id)`
- FK `rapportini_sede_id_cliente_id_fkey`: `FOREIGN KEY (sede_id, cliente_id) REFERENCES app.sedi_cliente(id, cliente_id)`
- FK `rapportini_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- FK `rapportini_verificato_da_fkey`: `FOREIGN KEY (verificato_da) REFERENCES app.profili(id)`
- PK `rapportini_pkey`: `PRIMARY KEY (id)`

**Indici**

- `rapportini_autonomi_da_verificare_idx`: `btree (data_lavoro DESC) WHERE ((intervento_id IS NULL) AND (verificato_at IS NULL) AND (deleted_at IS NULL))`
- `rapportini_cliente_idx`: `btree (cliente_id, data_lavoro DESC)`
- `rapportini_data_idx`: `btree (data_lavoro DESC)`
- `rapportini_intervento_idx`: `btree (intervento_id) WHERE (intervento_id IS NOT NULL)`
- `rapportini_numero_uq`: `btree (numero) WHERE (numero IS NOT NULL)`
- `rapportini_provvisorio_uq`: `btree (device_id, numero_provvisorio)`

**Trigger**: `rapportini_immutabile` → `tg_rapportino_immutabile()`, `rapportini_metadati` → `tg_aggiorna_metadati()`, `rapportini_no_delete` → `tg_no_delete_fisico()`

## rapportino_operai

Operai presenti sul lavoro documentato dal rapportino.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `rapportino_id` | uuid | no |  | Riferimento a `rapportini`. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |

**Vincoli**

- FK `rapportino_operai_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `rapportino_operai_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- PK `rapportino_operai_pkey`: `PRIMARY KEY (rapportino_id, operaio_id)`

## rapportino_attivita

Attività da cui derivano le ore del rapportino.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `rapportino_id` | uuid | no |  | Riferimento a `rapportini`. |
| `attivita_id` | uuid | no |  | Riferimento a `attivita_lavoro`. |

**Vincoli**

- FK `rapportino_attivita_attivita_id_fkey`: `FOREIGN KEY (attivita_id) REFERENCES app.attivita_lavoro(id)`
- FK `rapportino_attivita_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- PK `rapportino_attivita_pkey`: `PRIMARY KEY (rapportino_id, attivita_id)`

**Indici**

- `rapportino_attivita_attivita_idx`: `btree (attivita_id)`

## rapportino_materiali

Materiali utilizzati.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `rapportino_id` | uuid | no |  | Riferimento a `rapportini`. |
| `descrizione` | text | no |  |  |
| `quantita` | numeric(10,3) | no |  |  |
| `unita` | text | no |  |  |
| `codice_articolo` | text | sì |  |  |
| `ordine` | smallint | no | `0` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `materiale_id` | uuid | sì |  | Riferimento a `materiali`. |
| `magazzino_id` | uuid | sì |  | Riferimento a `magazzini`. |

**Vincoli**

- CHECK `rapportino_materiali_descrizione_check`: `CHECK ((length(TRIM(BOTH FROM descrizione)) > 0))`
- CHECK `rapportino_materiali_quantita_check`: `CHECK ((quantita > (0)::numeric))`
- CHECK `rapportino_materiali_unita_check`: `CHECK ((unita = ANY (ARRAY['pz'::text, 'm'::text, 'kg'::text, 'l'::text, 'conf'::text, 'h'::text])))`
- FK `rapportino_materiali_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `rapportino_materiali_magazzino_id_fkey`: `FOREIGN KEY (magazzino_id) REFERENCES app.magazzini(id)`
- FK `rapportino_materiali_materiale_id_fkey`: `FOREIGN KEY (materiale_id) REFERENCES app.materiali(id)`
- FK `rapportino_materiali_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- PK `rapportino_materiali_pkey`: `PRIMARY KEY (id)`

**Indici**

- `rapportino_materiali_idx`: `btree (rapportino_id, ordine)`

## rapportino_foto

Foto del rapportino (collegamento ad allegati).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `rapportino_id` | uuid | no |  | Riferimento a `rapportini`. |
| `allegato_id` | uuid | no |  | Riferimento a `allegati`. |
| `didascalia` | text | no | `''::text` |  |
| `ordine` | smallint | no | `0` |  |

**Vincoli**

- FK `rapportino_foto_allegato_id_fkey`: `FOREIGN KEY (allegato_id) REFERENCES app.allegati(id)`
- FK `rapportino_foto_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- PK `rapportino_foto_pkey`: `PRIMARY KEY (rapportino_id, allegato_id)`

## rapportino_firme

Firme di cliente e operaio (collegamento ad allegati).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `rapportino_id` | uuid | no |  | Riferimento a `rapportini`. |
| `allegato_id` | uuid | no |  | Riferimento a `allegati`. |
| `ruolo_firmatario` | text | no |  |  |
| `nome_firmatario` | text | no |  |  |
| `firmato_at` | timestamp with time zone | no |  |  |

**Vincoli**

- CHECK `rapportino_firme_nome_firmatario_check`: `CHECK ((length(TRIM(BOTH FROM nome_firmatario)) > 0))`
- CHECK `rapportino_firme_ruolo_firmatario_check`: `CHECK ((ruolo_firmatario = ANY (ARRAY['cliente'::text, 'operaio'::text])))`
- FK `rapportino_firme_allegato_id_fkey`: `FOREIGN KEY (allegato_id) REFERENCES app.allegati(id)`
- FK `rapportino_firme_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- PK `rapportino_firme_pkey`: `PRIMARY KEY (id)`
- UNIQUE `rapportino_firme_rapportino_id_ruolo_firmatario_key`: `UNIQUE (rapportino_id, ruolo_firmatario)`

**Indici**

- `rapportino_firme_rapportino_id_ruolo_firmatario_key`: `btree (rapportino_id, ruolo_firmatario)`

## followup

Ritorni e lavori da ultimare generati da un rapportino.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `tipo` | text | no |  |  |
| `stato` | text | no | `'aperto'::text` | aperto \| pianificato \| chiuso \| annullato. |
| `rapportino_origine_id` | uuid | no |  | Rapportino che ha generato il seguito (sempre presente). |
| `intervento_origine_id` | uuid | sì |  | Riferimento a `interventi`. |
| `cliente_id` | uuid | no |  | Riferimento a `clienti`. |
| `sede_id` | uuid | sì |  | Riferimento a `sedi_cliente`. |
| `motivo` | text | no |  |  |
| `priorita` | text | no | `'normale'::text` |  |
| `data_suggerita` | date | sì |  |  |
| `intervento_ritorno_id` | uuid | sì |  | Intervento pianificato per il ritorno. |
| `rapportino_chiusura_id` | uuid | sì |  | Rapportino che ha chiuso il seguito. |
| `motivo_annullamento` | text | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `followup_check`: `CHECK (((stato <> ALL (ARRAY['pianificato'::text, 'chiuso'::text])) OR (intervento_ritorno_id IS NOT NULL) OR (rapportino_chiusura_id IS NOT NULL)))`
- CHECK `followup_check1`: `CHECK (((stato <> 'chiuso'::text) OR (rapportino_chiusura_id IS NOT NULL)))`
- CHECK `followup_check2`: `CHECK (((stato <> 'annullato'::text) OR (motivo_annullamento IS NOT NULL)))`
- CHECK `followup_motivo_check`: `CHECK ((length(TRIM(BOTH FROM motivo)) >= 5))`
- CHECK `followup_priorita_check`: `CHECK ((priorita = ANY (ARRAY['bassa'::text, 'normale'::text, 'alta'::text, 'urgente'::text])))`
- CHECK `followup_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `followup_stato_check`: `CHECK ((stato = ANY (ARRAY['aperto'::text, 'pianificato'::text, 'chiuso'::text, 'annullato'::text])))`
- CHECK `followup_tipo_check`: `CHECK ((tipo = ANY (ARRAY['ritorno'::text, 'da_ultimare'::text])))`
- FK `followup_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `followup_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `followup_intervento_origine_id_fkey`: `FOREIGN KEY (intervento_origine_id) REFERENCES app.interventi(id)`
- FK `followup_intervento_ritorno_id_fkey`: `FOREIGN KEY (intervento_ritorno_id) REFERENCES app.interventi(id)`
- FK `followup_rapportino_chiusura_id_fkey`: `FOREIGN KEY (rapportino_chiusura_id) REFERENCES app.rapportini(id)`
- FK `followup_rapportino_origine_id_fkey`: `FOREIGN KEY (rapportino_origine_id) REFERENCES app.rapportini(id)`
- FK `followup_sede_id_cliente_id_fkey`: `FOREIGN KEY (sede_id, cliente_id) REFERENCES app.sedi_cliente(id, cliente_id)`
- FK `followup_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `followup_pkey`: `PRIMARY KEY (id)`

**Indici**

- `followup_aperti_idx`: `btree (stato, priorita) WHERE (stato = ANY (ARRAY['aperto'::text, 'pianificato'::text]))`
- `followup_intervento_ritorno_uq`: `btree (intervento_ritorno_id) WHERE (intervento_ritorno_id IS NOT NULL)`
- `followup_origine_idx`: `btree (rapportino_origine_id)`

**Trigger**: `followup_metadati` → `tg_aggiorna_metadati()`, `followup_no_delete` → `tg_no_delete_fisico()`

## imprevisto_allegati

Foto allegate agli imprevisti.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `imprevisto_id` | uuid | no |  | Riferimento a `imprevisti`. |
| `allegato_id` | uuid | no |  | Riferimento a `allegati`. |

**Vincoli**

- FK `imprevisto_allegati_allegato_id_fkey`: `FOREIGN KEY (allegato_id) REFERENCES app.allegati(id)`
- FK `imprevisto_allegati_imprevisto_id_fkey`: `FOREIGN KEY (imprevisto_id) REFERENCES app.imprevisti(id)`
- PK `imprevisto_allegati_pkey`: `PRIMARY KEY (imprevisto_id, allegato_id)`

## transizioni_cartellino

Regole ammesse della macchina a stati del cartellino (configurazione).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `azione` | text | no |  |  |
| `stato_da` | text | no |  |  |
| `stato_a` | text | no |  |  |
| `ruoli` | text[] | no |  |  |
| `motivazione_obbligatoria` | boolean | no |  |  |
| `nuova_versione` | boolean | no |  |  |
| `solo_titolare` | boolean | no |  |  |

**Vincoli**

- PK `transizioni_cartellino_pkey`: `PRIMARY KEY (azione, stato_da)`

**Trigger**: `transizioni_solo_lettura` → `tg_solo_inserimento()`

## cartellini_mensili

Testata del cartellino mensile di un operaio: stato corrente e versioni.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |
| `anno` | smallint | no |  |  |
| `mese` | smallint | no |  |  |
| `stato` | text | no | `'in_compilazione'::text` | in_compilazione \| da_confermare_operaio \| confermato_operaio \| in_attesa_approvazione \| da_correggere \| approvato \| riaperto. |
| `versione_corrente` | integer | no | `0` | Ultima versione generata (0 = nessuna). |
| `versione_approvata` | integer | sì |  | Versione approvata; resta valorizzata anche dopo una riapertura. |
| `ultima_motivazione` | text | no | `''::text` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `cartellini_mensili_anno_check`: `CHECK (((anno >= 2020) AND (anno <= 2100)))`
- CHECK `cartellini_mensili_check`: `CHECK (((versione_approvata IS NULL) OR (versione_approvata <= versione_corrente)))`
- CHECK `cartellini_mensili_check1`: `CHECK (((stato <> 'approvato'::text) OR (versione_approvata = versione_corrente)))`
- CHECK `cartellini_mensili_check2`: `CHECK (((stato = 'in_compilazione'::text) OR (versione_corrente >= 1)))`
- CHECK `cartellini_mensili_mese_check`: `CHECK (((mese >= 1) AND (mese <= 12)))`
- CHECK `cartellini_mensili_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `cartellini_mensili_stato_check`: `CHECK ((stato = ANY (ARRAY['in_compilazione'::text, 'da_confermare_operaio'::text, 'confermato_operaio'::text, 'in_attesa_approvazione'::text, 'da_correggere'::text, 'approvato'::text, 'riaperto'::text])))`
- CHECK `cartellini_mensili_versione_corrente_check`: `CHECK ((versione_corrente >= 0))`
- FK `cartellini_mensili_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `cartellini_mensili_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `cartellini_mensili_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `cartellini_mensili_pkey`: `PRIMARY KEY (id)`
- UNIQUE `cartellini_mensili_operaio_id_anno_mese_key`: `UNIQUE (operaio_id, anno, mese)`

**Indici**

- `cartellini_mensili_operaio_id_anno_mese_key`: `btree (operaio_id, anno, mese)`
- `cartellini_stato_idx`: `btree (stato) WHERE (stato = ANY (ARRAY['in_attesa_approvazione'::text, 'da_correggere'::text, 'confermato_operaio'::text]))`

**Trigger**: `cartellini_metadati` → `tg_aggiorna_metadati()`, `cartellini_no_delete` → `tg_no_delete_fisico()`, `cartellini_valida_stato` → `tg_valida_stato_cartellino()`

## cartellino_versioni

Snapshot immutabile di una versione del cartellino (giorni e totali calcolati dal motore ore).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `cartellino_id` | uuid | no |  | Riferimento a `cartellini_mensili`. |
| `versione` | integer | no |  |  |
| `giorni` | jsonb | no |  | Array JSON dei giorni (entrata, uscita, pause, netta, attribuite, non attribuite, anomalie, correzioni). |
| `totali` | jsonb | no |  | Totali del mese in millisecondi (somma dei giorni, nessun arrotondamento intermedio). |
| `impronta` | text | no |  | Impronta dello snapshot: rileva cambiamenti dei dati dopo la generazione. |
| `motivo` | text | no |  |  |
| `motore_versione` | text | no | `'1'::text` | Versione dell'algoritmo ore usato per il calcolo. |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |

**Vincoli**

- CHECK `cartellino_versioni_giorni_check`: `CHECK ((jsonb_typeof(giorni) = 'array'::text))`
- CHECK `cartellino_versioni_totali_check`: `CHECK (((totali ? 'netta_ms'::text) AND (totali ? 'attribuite_ms'::text) AND (totali ? 'non_attribuite_ms'::text)))`
- CHECK `cartellino_versioni_versione_check`: `CHECK ((versione >= 1))`
- FK `cartellino_versioni_cartellino_id_fkey`: `FOREIGN KEY (cartellino_id) REFERENCES app.cartellini_mensili(id)`
- FK `cartellino_versioni_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- PK `cartellino_versioni_pkey`: `PRIMARY KEY (id)`
- UNIQUE `cartellino_versioni_cartellino_id_versione_key`: `UNIQUE (cartellino_id, versione)`

**Indici**

- `cartellino_versioni_cartellino_id_versione_key`: `btree (cartellino_id, versione)`

**Trigger**: `versioni_solo_inserimento` → `tg_solo_inserimento()`

## approvazioni_cartellino

Registro append-only di ogni transizione del cartellino.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `cartellino_id` | uuid | no |  | Riferimento a `cartellini_mensili`. |
| `versione` | integer | no |  | Riferimento a `cartellino_versioni`. |
| `azione` | text | no |  | genera \| conferma \| segnala_discrepanza \| ricezione_server \| approva \| richiedi_correzione \| rifiuta \| rigenera \| riapri. |
| `stato_precedente` | text | no |  | Riferimento a `transizioni_cartellino`. |
| `stato_nuovo` | text | no |  |  |
| `utente_id` | uuid | sì |  | Riferimento a `profili`. |
| `ruolo_utente` | text | no |  | admin \| operaio \| sistema. |
| `motivazione` | text | no | `''::text` |  |
| `eseguita_at` | timestamp with time zone | no | `now()` |  |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |

**Vincoli**

- CHECK `approvazioni_cartellino_check`: `CHECK (((ruolo_utente = 'sistema'::text) OR (utente_id IS NOT NULL)))`
- CHECK `approvazioni_cartellino_ruolo_utente_check`: `CHECK ((ruolo_utente = ANY (ARRAY['admin'::text, 'operaio'::text, 'sistema'::text])))`
- FK `approvazioni_cartellino_azione_stato_precedente_fkey`: `FOREIGN KEY (azione, stato_precedente) REFERENCES app.transizioni_cartellino(azione, stato_da)`
- FK `approvazioni_cartellino_cartellino_id_fkey`: `FOREIGN KEY (cartellino_id) REFERENCES app.cartellini_mensili(id)`
- FK `approvazioni_cartellino_cartellino_id_versione_fkey`: `FOREIGN KEY (cartellino_id, versione) REFERENCES app.cartellino_versioni(cartellino_id, versione)`
- FK `approvazioni_cartellino_utente_id_fkey`: `FOREIGN KEY (utente_id) REFERENCES app.profili(id)`
- PK `approvazioni_cartellino_pkey`: `PRIMARY KEY (id)`

**Indici**

- `approvazioni_cartellino_idx`: `btree (cartellino_id, eseguita_at)`

**Trigger**: `approvazioni_solo_inserimento` → `tg_solo_inserimento()`

## audit_log

Registro tecnico append-only delle modifiche (prima/dopo).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `entita` | text | no |  |  |
| `entita_id` | uuid | no |  |  |
| `azione` | text | no |  |  |
| `utente_id` | uuid | sì |  | Riferimento a `profili`. |
| `eseguita_at` | timestamp with time zone | no | `now()` |  |
| `client_at` | timestamp with time zone | sì |  |  |
| `prima` | jsonb | sì |  |  |
| `dopo` | jsonb | sì |  |  |
| `motivo` | text | no | `''::text` |  |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `op_id` | uuid | sì |  |  |

**Vincoli**

- CHECK `audit_log_azione_check`: `CHECK ((azione = ANY (ARRAY['crea'::text, 'modifica'::text, 'elimina'::text, 'correzione'::text, 'transizione'::text])))`
- FK `audit_log_utente_id_fkey`: `FOREIGN KEY (utente_id) REFERENCES app.profili(id)`
- PK `audit_log_pkey`: `PRIMARY KEY (id)`

**Indici**

- `audit_entita_idx`: `btree (entita, entita_id, eseguita_at)`
- `audit_utente_idx`: `btree (utente_id, eseguita_at DESC)`

**Trigger**: `audit_solo_inserimento` → `tg_solo_inserimento()`

## dispositivi

Dispositivi che sincronizzano.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | text | no |  | Chiave primaria UUID v4 generata sul dispositivo. |
| `descrizione` | text | no | `''::text` |  |
| `utente_id` | uuid | sì |  | Riferimento a `profili`. |
| `ultimo_sync_at` | timestamp with time zone | sì |  |  |
| `app_versione` | text | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |

**Vincoli**

- FK `dispositivi_utente_id_fkey`: `FOREIGN KEY (utente_id) REFERENCES app.profili(id)`
- PK `dispositivi_pkey`: `PRIMARY KEY (id)`

## sync_operazioni

Registro di idempotenza: ogni op_id è applicato una sola volta e la risposta è memorizzata.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `op_id` | uuid | no |  | Chiave di idempotenza generata sul dispositivo. |
| `device_id` | text | no |  | Dispositivo che ha originato la modifica. |
| `utente_id` | uuid | sì |  | Riferimento a `profili`. |
| `entita` | text | no |  |  |
| `entita_id` | uuid | no |  |  |
| `base_versione` | integer | no |  | row_version su cui il client ha basato la modifica. |
| `esito` | text | no |  |  |
| `risposta` | jsonb | no |  | Risposta restituita: riusata identica per i ritentativi. |
| `ricevuta_at` | timestamp with time zone | no | `now()` |  |

**Vincoli**

- CHECK `sync_operazioni_esito_check`: `CHECK ((esito = ANY (ARRAY['ok'::text, 'conflitto'::text, 'rifiutata'::text])))`
- FK `sync_operazioni_device_id_fkey`: `FOREIGN KEY (device_id) REFERENCES app.dispositivi(id)`
- FK `sync_operazioni_utente_id_fkey`: `FOREIGN KEY (utente_id) REFERENCES app.profili(id)`
- PK `sync_operazioni_pkey`: `PRIMARY KEY (op_id)`

**Indici**

- `sync_operazioni_entita_idx`: `btree (entita, entita_id, ricevuta_at)`

**Trigger**: `sync_solo_inserimento` → `tg_solo_inserimento()`

## contatori_documenti

Contatori per le numerazioni definitive assegnate dal server.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `serie` | text | no |  |  |
| `anno` | smallint | no |  |  |
| `ultimo` | integer | no | `0` |  |

**Vincoli**

- CHECK `contatori_documenti_ultimo_check`: `CHECK ((ultimo >= 0))`
- PK `contatori_documenti_pkey`: `PRIMARY KEY (serie, anno)`

## richieste_correzione

Richieste di correzione inviate dal lavoratore e gestite dall'amministrazione (Fase 3). Non modificano dati.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `operaio_id` | uuid | no |  | Riferimento a `profili`. |
| `data_lavoro` | date | no |  |  |
| `presenza_id` | uuid | sì |  | Riferimento a `presenze`. |
| `attivita_id` | uuid | sì |  | Riferimento a `attivita_lavoro`. |
| `messaggio` | text | no |  |  |
| `stato` | text | no | `'aperta'::text` |  |
| `risposta` | text | no | `''::text` |  |
| `gestita_da` | uuid | sì |  | Riferimento a `profili`. |
| `gestita_at` | timestamp with time zone | sì |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `richieste_correzione_check`: `CHECK (((stato = 'aperta'::text) = ((gestita_da IS NULL) AND (gestita_at IS NULL))))`
- CHECK `richieste_correzione_check1`: `CHECK (((stato <> ALL (ARRAY['risolta'::text, 'respinta'::text])) OR (length(TRIM(BOTH FROM risposta)) >= 5)))`
- CHECK `richieste_correzione_messaggio_check`: `CHECK ((length(TRIM(BOTH FROM messaggio)) >= 10))`
- CHECK `richieste_correzione_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `richieste_correzione_stato_check`: `CHECK ((stato = ANY (ARRAY['aperta'::text, 'presa_in_carico'::text, 'risolta'::text, 'respinta'::text])))`
- FK `richieste_correzione_attivita_id_fkey`: `FOREIGN KEY (attivita_id) REFERENCES app.attivita_lavoro(id)`
- FK `richieste_correzione_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `richieste_correzione_gestita_da_fkey`: `FOREIGN KEY (gestita_da) REFERENCES app.profili(id)`
- FK `richieste_correzione_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `richieste_correzione_presenza_id_fkey`: `FOREIGN KEY (presenza_id) REFERENCES app.presenze(id)`
- FK `richieste_correzione_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `richieste_correzione_pkey`: `PRIMARY KEY (id)`

**Indici**

- `richieste_correzione_aperte_idx`: `btree (stato, created_at) WHERE (stato = ANY (ARRAY['aperta'::text, 'presa_in_carico'::text]))`
- `richieste_correzione_operaio_idx`: `btree (operaio_id, data_lavoro)`

**Trigger**: `richieste_chiusa_immutabile` → `tg_richiesta_chiusa_immutabile()`, `richieste_metadati` → `tg_aggiorna_metadati()`, `richieste_no_delete` → `tg_no_delete_fisico()`

## materiali

Anagrafica materiali di magazzino (Fase 5). Il prezzo vale per i movimenti futuri.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `codice` | text | no |  |  |
| `nome` | text | no |  |  |
| `descrizione` | text | no | `''::text` |  |
| `categoria` | text | no | `''::text` |  |
| `unita` | text | no |  |  |
| `prezzo_acquisto` | numeric(12,4) | no | `0` | Prezzo di acquisto corrente (€/unità): usato per i nuovi movimenti e per valorizzare le giacenze. |
| `prezzo_vendita` | numeric(12,4) | sì |  | Prezzo di vendita (€/unità), facoltativo; separato dai costi. |
| `fornitore` | text | no | `''::text` |  |
| `scorta_minima` | numeric(12,3) | no | `0` | Sotto questa giacenza totale il materiale è segnalato da riordinare. |
| `attivo` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `materiali_codice_check`: `CHECK (((codice = upper(TRIM(BOTH FROM codice))) AND (length(codice) > 0)))`
- CHECK `materiali_nome_check`: `CHECK ((length(TRIM(BOTH FROM nome)) > 0))`
- CHECK `materiali_prezzo_acquisto_check`: `CHECK ((prezzo_acquisto >= (0)::numeric))`
- CHECK `materiali_prezzo_vendita_check`: `CHECK (((prezzo_vendita IS NULL) OR (prezzo_vendita >= (0)::numeric)))`
- CHECK `materiali_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `materiali_scorta_minima_check`: `CHECK ((scorta_minima >= (0)::numeric))`
- CHECK `materiali_unita_check`: `CHECK ((unita = ANY (ARRAY['pz'::text, 'm'::text, 'kg'::text, 'l'::text, 'conf'::text, 'h'::text])))`
- FK `materiali_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `materiali_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `materiali_pkey`: `PRIMARY KEY (id)`

**Indici**

- `materiali_categoria_idx`: `btree (categoria, nome)`
- `materiali_codice_uk`: `btree (codice) WHERE (deleted_at IS NULL)`

**Trigger**: `materiali_metadati` → `tg_aggiorna_metadati()`, `materiali_no_delete` → `tg_no_delete_fisico()`

## magazzini

Magazzini: sede e automezzi (Fase 5).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `codice` | text | no |  |  |
| `nome` | text | no |  |  |
| `tipo` | text | no |  |  |
| `responsabile_id` | uuid | sì |  | Operaio a cui è affidato l'automezzo: magazzino proposto per i suoi consumi. |
| `attivo` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `magazzini_codice_check`: `CHECK (((codice = upper(TRIM(BOTH FROM codice))) AND (length(codice) > 0)))`
- CHECK `magazzini_nome_check`: `CHECK ((length(TRIM(BOTH FROM nome)) > 0))`
- CHECK `magazzini_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `magazzini_tipo_check`: `CHECK ((tipo = ANY (ARRAY['sede'::text, 'automezzo'::text])))`
- FK `magazzini_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `magazzini_responsabile_id_fkey`: `FOREIGN KEY (responsabile_id) REFERENCES app.profili(id)`
- FK `magazzini_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `magazzini_pkey`: `PRIMARY KEY (id)`

**Indici**

- `magazzini_codice_uk`: `btree (codice) WHERE (deleted_at IS NULL)`

**Trigger**: `magazzini_metadati` → `tg_aggiorna_metadati()`, `magazzini_no_delete` → `tg_no_delete_fisico()`

## movimenti_magazzino

Registro dei movimenti in sola aggiunta (Fase 5): la giacenza è la somma dei movimenti validi.

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Chiave primaria UUID v4 generata sul dispositivo. |
| `materiale_id` | uuid | no |  | Riferimento a `materiali`. |
| `magazzino_id` | uuid | no |  | Riferimento a `magazzini`. |
| `tipo` | text | no |  |  |
| `quantita` | numeric(12,3) | no |  | Variazione con segno della giacenza (+ entra, − esce). Mai zero. |
| `costo_unitario` | numeric(12,4) | no |  | Costo unitario fissato al momento del movimento: non cambia se cambia l'anagrafica. |
| `prezzo_vendita_unitario` | numeric(12,4) | sì |  |  |
| `data_riferimento` | date | no |  | Data di competenza: giorno del rapportino per i consumi. |
| `motivo` | text | no | `''::text` |  |
| `documento` | text | no | `''::text` |  |
| `rapportino_id` | uuid | sì |  | Riferimento a `rapportini`. |
| `riga_rapportino_id` | uuid | sì |  |  |
| `intervento_id` | uuid | sì |  | Riferimento a `interventi`. |
| `cliente_id` | uuid | sì |  | Riferimento a `clienti`. |
| `operaio_id` | uuid | sì |  | Riferimento a `profili`. |
| `corregge_id` | uuid | sì |  | Consumo originale corretto da questo movimento. |
| `trasferimento_id` | uuid | sì |  | Identificativo comune alle due metà di un trasferimento. |
| `chiave_univoca` | text | sì |  | Chiave logica (consumo:<rapportino>:<riga>): impedisce i doppi scarichi. |
| `duplicato_di` | uuid | sì |  | Valorizzato dal server per un invio duplicato: resta nello storico ma non conta. |
| `giacenza_insufficiente` | boolean | no | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `movimenti_magazzino_check`: `CHECK (((tipo <> 'carico'::text) OR (quantita > (0)::numeric)))`
- CHECK `movimenti_magazzino_check1`: `CHECK (((tipo <> ALL (ARRAY['scarico'::text, 'consumo'::text])) OR (quantita < (0)::numeric)))`
- CHECK `movimenti_magazzino_check2`: `CHECK (((tipo <> ALL (ARRAY['scarico'::text, 'rettifica'::text, 'correzione_consumo'::text])) OR (length(TRIM(BOTH FROM motivo)) >= 5)))`
- CHECK `movimenti_magazzino_check3`: `CHECK (((tipo <> ALL (ARRAY['consumo'::text, 'correzione_consumo'::text])) OR ((rapportino_id IS NOT NULL) AND (riga_rapportino_id IS NOT NULL) AND (cliente_id IS NOT NULL))))`
- CHECK `movimenti_magazzino_check4`: `CHECK (((tipo = 'correzione_consumo'::text) = (corregge_id IS NOT NULL)))`
- CHECK `movimenti_magazzino_check5`: `CHECK (((tipo = 'trasferimento'::text) = (trasferimento_id IS NOT NULL)))`
- CHECK `movimenti_magazzino_costo_unitario_check`: `CHECK ((costo_unitario >= (0)::numeric))`
- CHECK `movimenti_magazzino_prezzo_vendita_unitario_check`: `CHECK (((prezzo_vendita_unitario IS NULL) OR (prezzo_vendita_unitario >= (0)::numeric)))`
- CHECK `movimenti_magazzino_quantita_check`: `CHECK ((quantita <> (0)::numeric))`
- CHECK `movimenti_magazzino_row_version_check`: `CHECK ((row_version > 0))`
- CHECK `movimenti_magazzino_tipo_check`: `CHECK ((tipo = ANY (ARRAY['carico'::text, 'scarico'::text, 'rettifica'::text, 'trasferimento'::text, 'consumo'::text, 'correzione_consumo'::text])))`
- FK `movimenti_magazzino_cliente_id_fkey`: `FOREIGN KEY (cliente_id) REFERENCES app.clienti(id)`
- FK `movimenti_magazzino_corregge_id_fkey`: `FOREIGN KEY (corregge_id) REFERENCES app.movimenti_magazzino(id)`
- FK `movimenti_magazzino_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `movimenti_magazzino_duplicato_di_fkey`: `FOREIGN KEY (duplicato_di) REFERENCES app.movimenti_magazzino(id)`
- FK `movimenti_magazzino_intervento_id_fkey`: `FOREIGN KEY (intervento_id) REFERENCES app.interventi(id)`
- FK `movimenti_magazzino_magazzino_id_fkey`: `FOREIGN KEY (magazzino_id) REFERENCES app.magazzini(id)`
- FK `movimenti_magazzino_materiale_id_fkey`: `FOREIGN KEY (materiale_id) REFERENCES app.materiali(id)`
- FK `movimenti_magazzino_operaio_id_fkey`: `FOREIGN KEY (operaio_id) REFERENCES app.profili(id)`
- FK `movimenti_magazzino_rapportino_id_fkey`: `FOREIGN KEY (rapportino_id) REFERENCES app.rapportini(id)`
- FK `movimenti_magazzino_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `movimenti_magazzino_pkey`: `PRIMARY KEY (id)`

**Indici**

- `movimenti_chiave_uk`: `btree (chiave_univoca) WHERE ((chiave_univoca IS NOT NULL) AND (duplicato_di IS NULL))`
- `movimenti_data_idx`: `btree (data_riferimento, tipo)`
- `movimenti_materiale_idx`: `btree (materiale_id, magazzino_id)`
- `movimenti_rapportino_idx`: `btree (rapportino_id, riga_rapportino_id) WHERE (rapportino_id IS NOT NULL)`

**Trigger**: `movimenti_solo_inserimento` → `tg_solo_inserimento()`

## impostazioni_azienda

Dati aziendali e preferenze operative, riga unica (Fase 9).

| Campo | Tipo | Null | Default | Descrizione |
|---|---|---|---|---|
| `id` | boolean | no | `true` | Chiave primaria UUID v4 generata sul dispositivo. |
| `ragione_sociale` | text | no |  |  |
| `indirizzo` | text | no | `''::text` |  |
| `partita_iva` | text | sì |  |  |
| `codice_fiscale` | text | sì |  |  |
| `email` | text | no | `''::text` |  |
| `telefono` | text | no | `''::text` |  |
| `logo_svg` | text | sì |  |  |
| `fuso_orario` | text | no | `'Europe/Rome'::text` |  |
| `ore_giornaliere_default` | numeric(4,2) | no | `8` |  |
| `preferenze` | jsonb | no | `'{"presenza_lunga_ore": 12, "promemoria_intervento_min": 120, "pausa_obbligatoria_dopo_ore": 6, "ore_non_attribuite_soglia_min": 30}'::jsonb` |  |
| `created_at` | timestamp with time zone | no | `now()` | Istante di creazione (server). Immutabile. |
| `created_by` | uuid | sì |  | Utente che ha creato il record. Immutabile. |
| `updated_at` | timestamp with time zone | no | `now()` | Ultima modifica (trigger). |
| `updated_by` | uuid | sì |  | Utente dell'ultima modifica. |
| `row_version` | integer | no | `1` | Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE. |
| `device_id` | text | sì |  | Dispositivo che ha originato la modifica. |
| `client_created_at` | timestamp with time zone | sì |  | Istante di creazione secondo il dispositivo (anche offline). |
| `deleted_at` | timestamp with time zone | sì |  | Eliminazione logica: se valorizzato il record è escluso. |

**Vincoli**

- CHECK `impostazioni_azienda_id_check`: `CHECK (id)`
- CHECK `impostazioni_azienda_logo_svg_check`: `CHECK (((logo_svg IS NULL) OR (logo_svg ~~ '<svg%'::text)))`
- CHECK `impostazioni_azienda_ore_giornaliere_default_check`: `CHECK (((ore_giornaliere_default >= (1)::numeric) AND (ore_giornaliere_default <= (12)::numeric)))`
- CHECK `impostazioni_azienda_partita_iva_check`: `CHECK (((partita_iva IS NULL) OR (partita_iva ~ '^[0-9]{11}$'::text)))`
- CHECK `impostazioni_azienda_ragione_sociale_check`: `CHECK ((length(TRIM(BOTH FROM ragione_sociale)) >= 2))`
- CHECK `impostazioni_azienda_row_version_check`: `CHECK ((row_version > 0))`
- FK `impostazioni_azienda_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES app.profili(id)`
- FK `impostazioni_azienda_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES app.profili(id)`
- PK `impostazioni_azienda_pkey`: `PRIMARY KEY (id)`

**Trigger**: `impostazioni_metadati` → `tg_aggiorna_metadati()`, `impostazioni_no_delete` → `tg_no_delete_fisico()`
