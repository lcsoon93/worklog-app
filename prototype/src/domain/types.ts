/**
 * Modello dati del dominio. Rispecchia lo schema PostgreSQL in database/schema.sql.
 * Le date-ora sono stringhe ISO 8601 in UTC; le date di calendario sono 'YYYY-MM-DD'
 * riferite al fuso aziendale (Europe/Rome).
 */

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

/** Stato di sincronizzazione di un record o di un'operazione (vedi docs/08). */
export type SyncStato =
  | 'locale'
  | 'in_attesa'
  | 'in_sincronizzazione'
  | 'sincronizzato'
  | 'errore'
  | 'conflitto';

/** Campi tecnici comuni a tutte le entità sincronizzabili. */
export interface BaseRecord {
  id: UUID;
  created_at: ISODateTime;
  created_by: UUID | null;
  updated_at: ISODateTime;
  updated_by: UUID | null;
  /** Versione della riga confermata dal server, per il controllo di concorrenza (0 = mai sincronizzata). */
  row_version: number;
  sync_stato: SyncStato;
  device_id: string | null;
  deleted_at: ISODateTime | null;
}

export type Ruolo = 'admin' | 'operaio';

export interface Profilo extends BaseRecord {
  nome: string;
  cognome: string;
  /** Nome utente per l'accesso con PIN (minuscolo). Assente nei profili creati prima della migrazione 0011. */
  username?: string;
  email: string;
  telefono: string;
  ruolo: Ruolo;
  attivo: boolean;
  colore: string;
  qualifica: string;
  ore_giornaliere_contratto: number;
}

export interface Cliente extends BaseRecord {
  ragione_sociale: string;
  partita_iva: string;
  email: string;
  telefono: string;
  referente: string;
  note: string;
  attivo: boolean;
}

export interface SedeCliente extends BaseRecord {
  cliente_id: UUID;
  nome: string;
  indirizzo: string;
  cap: string;
  citta: string;
  provincia: string;
  referente: string;
  telefono: string;
  note_accesso: string;
  attiva: boolean;
}

export type InterventoStato =
  | 'da_programmare'
  | 'programmato'
  | 'in_corso'
  | 'da_ultimare'
  | 'completato'
  | 'annullato';

export type InterventoTipo = 'manutenzione' | 'installazione' | 'riparazione' | 'sopralluogo' | 'ritorno';
export type Priorita = 'bassa' | 'normale' | 'alta' | 'urgente';

export interface Intervento extends BaseRecord {
  codice: string;
  cliente_id: UUID;
  sede_id: UUID | null;
  titolo: string;
  descrizione: string;
  tipo: InterventoTipo;
  priorita: Priorita;
  stato: InterventoStato;
  data_programmata: ISODate | null;
  ora_inizio: string | null; // 'HH:MM'
  durata_prevista_min: number | null;
  followup_origine_id: UUID | null;
  note: string;
}

export interface InterventoOperaio extends BaseRecord {
  intervento_id: UUID;
  operaio_id: UUID;
  ruolo: 'responsabile' | 'squadra';
}

export interface Presenza extends BaseRecord {
  operaio_id: UUID;
  data_lavoro: ISODate;
  entrata_at: ISODateTime;
  uscita_at: ISODateTime | null;
  /** Valori registrati in origine dal dispositivo: non cambiano mai, anche dopo una correzione. */
  entrata_registrata_at: ISODateTime;
  uscita_registrata_at: ISODateTime | null;
  /** Ultimo istante in cui l'app era sicuramente attiva: serve a proporre l'uscita dopo chiusure anomale. */
  ultimo_segnale_at: ISODateTime;
  uscita_automatica: boolean;
  note: string;
}

export type PausaTipo = 'pranzo' | 'breve' | 'altro';

export interface PausaPresenza extends BaseRecord {
  presenza_id: UUID;
  operaio_id: UUID;
  tipo: PausaTipo;
  inizio_at: ISODateTime;
  fine_at: ISODateTime | null;
  /** Attività sospesa all'avvio della pausa, proposta alla ripresa. */
  attivita_sospesa_id: UUID | null;
}

export type AttivitaTipo = 'lavoro_cliente' | 'trasferimento' | 'interna' | 'da_definire';
export type AttivitaOrigine = 'timer' | 'manuale' | 'correzione' | 'divisione';

export const CODICI_ATTIVITA_INTERNA = {
  magazzino: 'Magazzino',
  manutenzione_mezzi: 'Manutenzione mezzi',
  formazione: 'Formazione',
  ufficio: 'Ufficio / amministrazione',
  riunione: 'Riunione',
} as const;
export type CodiceAttivitaInterna = keyof typeof CODICI_ATTIVITA_INTERNA;

export interface AttivitaLavoro extends BaseRecord {
  presenza_id: UUID;
  operaio_id: UUID;
  tipo: AttivitaTipo;
  cliente_id: UUID | null;
  sede_id: UUID | null;
  intervento_id: UUID | null;
  codice_interno: CodiceAttivitaInterna | null;
  descrizione: string;
  inizio_at: ISODateTime;
  fine_at: ISODateTime | null;
  origine: AttivitaOrigine;
  /** Record originale sostituito da questa correzione (catena di versioni). */
  sostituisce_id: UUID | null;
  /** Valorizzato quando il record è stato sostituito da una correzione: resta nello storico ma non conta. */
  superata_da_id: UUID | null;
  annullata: boolean;
  motivo_correzione: string;
  chiusura_automatica: boolean;
}

export type ImprevistoTipo =
  | 'materiale_mancante'
  | 'accesso_negato'
  | 'guasto_aggiuntivo'
  | 'cliente_assente'
  | 'sicurezza'
  | 'meteo'
  | 'altro';

export interface Imprevisto extends BaseRecord {
  operaio_id: UUID;
  presenza_id: UUID | null;
  intervento_id: UUID | null;
  cliente_id: UUID | null;
  rapportino_id: UUID | null;
  tipo: ImprevistoTipo;
  gravita: 'bassa' | 'media' | 'alta';
  descrizione: string;
  avvenuto_at: ISODateTime;
  blocca_lavoro: boolean;
  richiede_ritorno: boolean;
  allegati_ids: UUID[];
}

export type RapportinoTipo = 'rapido' | 'completo';
export type RapportinoStato = 'bozza' | 'completato' | 'firmato' | 'annullato';
export type RapportinoEsito = 'completato' | 'da_ultimare' | 'ritorno_necessario' | 'non_eseguito';

export interface MaterialeRapportino {
  id: UUID;
  descrizione: string;
  quantita: number;
  unita: string;
  /** Fase 5: articolo di anagrafica (assente = materiale a testo libero, nessuno scarico). */
  materiale_id?: UUID | null;
  /** Fase 5: magazzino (sede o furgone) da cui viene scaricato il materiale. */
  magazzino_id?: UUID | null;
}

export interface Rapportino extends BaseRecord {
  /** Numero provvisorio generato sul dispositivo; quello definitivo è assegnato dal server. */
  numero_provvisorio: string;
  numero: string | null;
  tipo: RapportinoTipo;
  stato: RapportinoStato;
  data_lavoro: ISODate;
  cliente_id: UUID;
  sede_id: UUID | null;
  intervento_id: UUID | null;
  /** Rapportino di un ritorno: punta al documento che lo ha originato. */
  followup_id: UUID | null;
  redatto_da: UUID;
  operai_ids: UUID[];
  attivita_ids: UUID[];
  descrizione_lavoro: string;
  esito: RapportinoEsito;
  note_interne: string;
  materiali: MaterialeRapportino[];
  foto_ids: UUID[];
  firma_cliente_id: UUID | null;
  firma_cliente_nome: string;
  firma_operaio_id: UUID | null;
  imprevisti_ids: UUID[];
}

export type FollowupTipo = 'ritorno' | 'da_ultimare';
export type FollowupStato = 'aperto' | 'pianificato' | 'chiuso' | 'annullato';

export interface Followup extends BaseRecord {
  tipo: FollowupTipo;
  stato: FollowupStato;
  rapportino_origine_id: UUID;
  intervento_origine_id: UUID | null;
  cliente_id: UUID;
  sede_id: UUID | null;
  motivo: string;
  priorita: Priorita;
  data_suggerita: ISODate | null;
  intervento_ritorno_id: UUID | null;
  rapportino_chiusura_id: UUID | null;
}

export type CartellinoStato =
  | 'in_compilazione'
  | 'da_confermare_operaio'
  | 'confermato_operaio'
  | 'in_attesa_approvazione'
  | 'da_correggere'
  | 'approvato'
  | 'riaperto';

export interface CartellinoMensile extends BaseRecord {
  operaio_id: UUID;
  anno: number;
  mese: number; // 1-12
  stato: CartellinoStato;
  versione_corrente: number;
  versione_approvata: number | null;
  ultima_motivazione: string;
}

export interface GiornoCartellino {
  data: ISODate;
  presenza_id: UUID | null;
  entrata_at: ISODateTime | null;
  uscita_at: ISODateTime | null;
  pause_ms: number;
  lorda_ms: number;
  netta_ms: number;
  attribuite_ms: number;
  da_classificare_ms: number;
  non_attribuite_ms: number;
  anomalie: string[];
  correzioni: number;
}

export interface TotaliCartellino {
  giorni_lavorati: number;
  lorda_ms: number;
  pause_ms: number;
  netta_ms: number;
  attribuite_ms: number;
  non_attribuite_ms: number;
  anomalie: number;
  correzioni: number;
}

export interface CartellinoVersione extends BaseRecord {
  cartellino_id: UUID;
  versione: number;
  giorni: GiornoCartellino[];
  totali: TotaliCartellino;
  impronta: string;
  motivo: string;
}

export type AzioneCartellino =
  | 'genera'
  | 'conferma'
  | 'segnala_discrepanza'
  | 'ricezione_server'
  | 'approva'
  | 'richiedi_correzione'
  | 'rifiuta'
  | 'rigenera'
  | 'riapri';

export interface ApprovazioneCartellino extends BaseRecord {
  cartellino_id: UUID;
  versione: number;
  azione: AzioneCartellino;
  stato_precedente: CartellinoStato;
  stato_nuovo: CartellinoStato;
  utente_id: UUID | null;
  ruolo_utente: Ruolo | 'sistema';
  motivazione: string;
  eseguita_at: ISODateTime;
}

/**
 * Richiesta di correzione inviata dal lavoratore all'amministrazione (Fase 3).
 * Serve quando il lavoratore non può o non deve correggere da sé (mese in verifica o
 * approvato, errore da verificare). Non modifica alcun dato: la correzione vera resta
 * tracciata come sempre (righe di correzione, audit, eventuale riapertura del cartellino).
 */
export type RichiestaCorrezioneStato = 'aperta' | 'presa_in_carico' | 'risolta' | 'respinta';

export interface RichiestaCorrezione extends BaseRecord {
  operaio_id: UUID;
  data_lavoro: ISODate;
  presenza_id: UUID | null;
  attivita_id: UUID | null;
  messaggio: string;
  stato: RichiestaCorrezioneStato;
  risposta: string;
  gestita_da: UUID | null;
  gestita_at: ISODateTime | null;
}

/**
 * Magazzino, materiali e costi (Fase 5).
 * La giacenza NON è memorizzata: è la somma dei movimenti validi (registro in sola aggiunta).
 * Ogni movimento porta con sé il costo unitario del momento: cambiare il prezzo in anagrafica
 * non modifica mai i costi storici.
 */
export interface Materiale extends BaseRecord {
  codice: string;
  nome: string;
  descrizione: string;
  categoria: string;
  unita: string;
  /** Prezzo di acquisto corrente (€/unità): usato per i NUOVI movimenti e per valorizzare le giacenze. */
  prezzo_acquisto: number;
  /** Prezzo di vendita (€/unità), facoltativo: tenuto separato dai costi. */
  prezzo_vendita: number | null;
  fornitore: string;
  scorta_minima: number;
  attivo: boolean;
}

export interface Magazzino extends BaseRecord {
  codice: string;
  nome: string;
  tipo: 'sede' | 'automezzo';
  /** Operaio a cui è affidato (furgone): è il magazzino proposto per i suoi consumi. */
  responsabile_id: UUID | null;
  attivo: boolean;
}

export type MovimentoTipo =
  | 'carico'
  | 'scarico'
  | 'rettifica'
  | 'trasferimento'
  | 'consumo'
  | 'correzione_consumo';

export interface MovimentoMagazzino extends BaseRecord {
  materiale_id: UUID;
  magazzino_id: UUID;
  tipo: MovimentoTipo;
  /** Variazione della giacenza con segno: positiva entra, negativa esce. Mai zero. */
  quantita: number;
  /** Costo unitario fissato al momento del movimento (non cambia se cambia l'anagrafica). */
  costo_unitario: number;
  /** Prezzo di vendita unitario del momento (solo consumi), separato dal costo. */
  prezzo_vendita_unitario: number | null;
  /** Data di competenza: giorno del rapportino per i consumi, giorno di registrazione per gli altri. */
  data_riferimento: ISODate;
  motivo: string;
  documento: string;
  rapportino_id: UUID | null;
  riga_rapportino_id: UUID | null;
  intervento_id: UUID | null;
  cliente_id: UUID | null;
  operaio_id: UUID | null;
  /** Movimento corretto da questo (correzione di consumo). */
  corregge_id: UUID | null;
  /** Le due metà di un trasferimento condividono questo identificativo. */
  trasferimento_id: UUID | null;
  /** Chiave logica univoca sul server (es. consumo di una riga di rapportino): impedisce i doppi scarichi. */
  chiave_univoca: string | null;
  /** Impostato dal server se la chiave era già registrata: il movimento resta nello storico ma non conta. */
  duplicato_di: UUID | null;
  /** La giacenza disponibile non copriva il consumo al momento della registrazione. */
  giacenza_insufficiente: boolean;
}

export type AllegatoTipo = 'foto' | 'firma' | 'documento';

export interface Allegato extends BaseRecord {
  tipo: AllegatoTipo;
  entita: 'rapportino' | 'imprevisto' | 'intervento';
  entita_id: UUID;
  nome_file: string;
  mime: string;
  dimensione: number;
  /** Nel prototipo il contenuto è salvato come data URL in IndexedDB; in produzione va su Supabase Storage. */
  data_url: string;
  storage_path: string | null;
  upload_stato: SyncStato;
}

export interface AuditLog {
  id: UUID;
  entita: string;
  entita_id: UUID;
  azione: 'crea' | 'modifica' | 'elimina' | 'correzione' | 'transizione';
  utente_id: UUID | null;
  eseguita_at: ISODateTime;
  prima: unknown;
  dopo: unknown;
  motivo: string;
  device_id: string | null;
}

/** Mappa nome-tabella → tipo record. I nomi coincidono con le tabelle PostgreSQL. */
export interface EntityMap {
  profili: Profilo;
  clienti: Cliente;
  sedi_cliente: SedeCliente;
  interventi: Intervento;
  intervento_operai: InterventoOperaio;
  presenze: Presenza;
  pause_presenza: PausaPresenza;
  attivita_lavoro: AttivitaLavoro;
  imprevisti: Imprevisto;
  rapportini: Rapportino;
  followup: Followup;
  cartellini_mensili: CartellinoMensile;
  cartellino_versioni: CartellinoVersione;
  approvazioni_cartellino: ApprovazioneCartellino;
  allegati: Allegato;
  richieste_correzione: RichiestaCorrezione;
  materiali: Materiale;
  magazzini: Magazzino;
  movimenti_magazzino: MovimentoMagazzino;
}

export type EntityName = keyof EntityMap;

export const ENTITY_NAMES: EntityName[] = [
  'profili',
  'clienti',
  'sedi_cliente',
  'interventi',
  'intervento_operai',
  'presenze',
  'pause_presenza',
  'attivita_lavoro',
  'imprevisti',
  'rapportini',
  'followup',
  'cartellini_mensili',
  'cartellino_versioni',
  'approvazioni_cartellino',
  'allegati',
  'richieste_correzione',
  'materiali',
  'magazzini',
  'movimenti_magazzino',
];
