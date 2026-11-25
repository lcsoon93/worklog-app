/**
 * Modello dei documenti di riepilogo (giornaliero e mensile) e sua costruzione.
 *
 * Funzioni PURE: ricevono i record già letti e l'istante "adesso", e producono un modello
 * pronto per l'anteprima e per il PDF. Tutte le ore provengono dal motore centrale
 * (calcolaDaRecord): qui si filtrano, si raggruppano e si sommano i suoi risultati, senza
 * ricalcolare intervalli.
 *
 * Regole (docs/13):
 * - giorno = data_lavoro della presenza (giorno dell'entrata, D-15): un turno oltre mezzanotte
 *   appartiene al giorno di entrata e al suo mese;
 * - solo presenze/attività dell'operaio richiesto; attività legate alla presenza (presenza_id);
 * - presenze "non chiuse" (uscita mancante): nessun totale inventato, giorno escluso dai totali
 *   e segnalato;
 * - giorni senza presenza: valori "—", mai 0:00 né "lavorato".
 */
import { attivitaEffettive, calcolaDaRecord, contaCorrezioni, costruisciSnapshotMese } from '../domain/day-records';
import type { RiepilogoGiornata } from '../domain/hours-engine';
import { impronta } from '../domain/ids';
import { statoPresenza, type StatoPresenza } from '../domain/stato-presenza';
import { daysInMonth, isWeekend, pad, toMs } from '../domain/time';
import { ETICHETTE_AZIONE, ETICHETTE_STATO } from '../domain/timesheet-workflow';
import {
  CODICI_ATTIVITA_INTERNA,
  type ApprovazioneCartellino,
  type AttivitaLavoro,
  type AttivitaTipo,
  type CartellinoMensile,
  type CartellinoStato,
  type CartellinoVersione,
  type PausaPresenza,
  type Presenza,
  type Profilo,
  type Rapportino,
  type RichiestaCorrezione,
} from '../domain/types';
import type { DatiAzienda } from '../config/azienda';

// ---------------------------------------------------------------------------------------
// Tipi del modello
// ---------------------------------------------------------------------------------------

export type CategoriaAttivita = 'cliente' | 'trasferimento' | 'interna' | 'non_attribuita';

export const ETICHETTE_CATEGORIA: Record<CategoriaAttivita, string> = {
  cliente: 'Lavori presso clienti',
  trasferimento: 'Trasferimenti',
  interna: 'Attività interne',
  non_attribuita: 'Attività non attribuite',
};

export interface Avviso {
  livello: 'info' | 'avviso' | 'errore';
  testo: string;
}

export interface Intestazione {
  azienda: DatiAzienda;
  titolo: string;
  idDocumento: string;
  generatoIl: number;
  generatoDa: string;
  operaio: { id: string; nome: string; qualifica: string };
}

export interface PausaDoc {
  tipo: string;
  inizio: number;
  fine: number | null;
  durataMs: number | null;
}

export interface AttivitaDoc {
  id: string;
  data: string;
  categoria: CategoriaAttivita;
  tipo: string;
  inizio: number;
  fine: number | null;
  /** Quota conteggiata dal motore (dopo pause, limiti di presenza e sovrapposizioni). null = non calcolabile. */
  durataMs: number | null;
  registrataMs: number | null;
  cliente: string;
  sede: string;
  intervento: string;
  descrizione: string;
  note: string[];
}

export interface PresenzaDoc {
  id: string;
  stato: StatoPresenza;
  entrata: number;
  uscita: number | null;
  entrataOriginale: number | null;
  uscitaOriginale: number | null;
  pause: PausaDoc[];
  lordaMs: number | null;
  pauseMs: number | null;
  nettaMs: number | null;
}

/** Totali di ore. null = non calcolabile (dati incompleti), mai trasformato in zero. */
export interface TotaliOre {
  lordaMs: number;
  pauseMs: number;
  nettaMs: number;
  clientiMs: number;
  interneMs: number;
  trasferimentiMs: number;
  attribuiteMs: number;
  nonAttribuiteMs: number;
  daClassificareMs: number;
}

export interface CorrezioneDoc {
  data: string;
  quando: number;
  descrizione: string;
  motivo: string;
}

export interface RichiestaDoc {
  data: string;
  inviataIl: number;
  messaggio: string;
  stato: string;
  aperta: boolean;
  risposta: string;
  gestitaDa: string | null;
  gestitaIl: number | null;
}

export interface RapportinoDoc {
  numero: string;
  definitivo: boolean;
  cliente: string;
  intervento: string;
  descrizione: string;
  esito: string;
}

export interface RiepilogoGiornalieroDoc {
  tipo: 'giornaliero';
  intestazione: Intestazione;
  data: string;
  statoGiornata: 'chiusa' | 'in_corso' | 'non_chiusa' | 'assente';
  presenze: PresenzaDoc[];
  attivita: AttivitaDoc[];
  intervalliScoperti: Array<{ inizio: number; fine: number }>;
  /** null se almeno una presenza del giorno è incompleta. */
  totali: TotaliOre | null;
  calcolatoFinoA: number | null;
  rapportini: RapportinoDoc[];
  bozzeEscluse: number;
  /** Stato del cartellino del mese a cui appartiene la giornata. */
  cartellinoMese: { etichetta: string; approvato: boolean };
  richiesteCorrezione: RichiestaDoc[];
  anomalie: Avviso[];
  note: string[];
  correzioni: CorrezioneDoc[];
  datiNonSincronizzati: number;
  esportabile: boolean;
  motivoNonEsportabile: string | null;
}

export interface GiornoMeseDoc {
  data: string;
  weekend: boolean;
  presenze: number;
  entrata: number | null;
  uscita: number | null;
  pauseMs: number | null;
  nettaMs: number | null;
  attribuiteMs: number | null;
  stato: string;
  lavorato: boolean;
  incompleto: boolean;
  anomalie: string[];
  correzioni: number;
}

export interface ClienteMeseDoc {
  cliente: string;
  giornate: number;
  lavoroMs: number;
  trasferimentoMs: number;
  totaleMs: number;
  interventi: number;
}

export interface InternaMeseDoc {
  attivita: string;
  giornate: number;
  ms: number;
}

export interface CartellinoDoc {
  esiste: boolean;
  stato: CartellinoStato;
  etichetta: string;
  versioneCorrente: number | null;
  versioneApprovata: number | null;
  approvato: boolean;
  approvatoIl: number | null;
  approvatoDa: string | null;
  /** I dati attuali coincidono con la versione approvata? null se non approvato. */
  coerenteConApprovata: boolean | null;
  storico: Array<{ quando: number; azione: string; utente: string; motivazione: string; versione: number }>;
}

export interface RiepilogoMensileDoc {
  tipo: 'mensile';
  intestazione: Intestazione;
  anno: number;
  mese: number;
  totali: TotaliOre & { giorniLavorati: number; giorniSenzaPresenza: number; giorniFerialiSenzaPresenza: number; giorniIncompleti: number };
  giorni: GiornoMeseDoc[];
  attivitaPerGiorno: Array<{ data: string; attivita: AttivitaDoc[] }>;
  perCliente: ClienteMeseDoc[];
  perInterna: InternaMeseDoc[];
  correzioni: CorrezioneDoc[];
  richiesteCorrezione: RichiestaDoc[];
  cartellino: CartellinoDoc;
  provvisorio: boolean;
  anomalie: Avviso[];
  datiNonSincronizzati: number;
  quadratura: boolean;
  esportabile: boolean;
  motivoNonEsportabile: string | null;
}

export type RiepilogoDoc = RiepilogoGiornalieroDoc | RiepilogoMensileDoc;

// ---------------------------------------------------------------------------------------
// Sorgente dati
// ---------------------------------------------------------------------------------------

export interface SorgenteRiepiloghi {
  azienda: DatiAzienda;
  operaio: Profilo;
  generatoDa: Profilo;
  now: number;
  presenze: readonly Presenza[];
  pause: readonly PausaPresenza[];
  /** Tutte le attività, incluse quelle sostituite/annullate (servono per le correzioni). */
  attivita: readonly AttivitaLavoro[];
  rapportini: readonly Rapportino[];
  cartellino?: CartellinoMensile;
  versioni?: readonly CartellinoVersione[];
  approvazioni?: readonly ApprovazioneCartellino[];
  richieste?: readonly RichiestaCorrezione[];
  nomeCliente: (id: string | null) => string;
  nomeSede: (id: string | null) => string;
  intervento: (id: string | null) => { codice: string; titolo: string } | null;
  nomeUtente: (id: string | null) => string;
}

// ---------------------------------------------------------------------------------------
// Supporto comune
// ---------------------------------------------------------------------------------------

const CATEGORIA: Record<AttivitaTipo, CategoriaAttivita> = {
  lavoro_cliente: 'cliente',
  trasferimento: 'trasferimento',
  interna: 'interna',
  da_definire: 'non_attribuita',
};

const TIPO_LABEL: Record<AttivitaTipo, string> = {
  lavoro_cliente: 'Lavoro dal cliente',
  trasferimento: 'Trasferimento',
  interna: 'Attività interna',
  da_definire: 'Da classificare',
};

const PAUSA_LABEL: Record<string, string> = { pranzo: 'Pranzo', breve: 'Breve', altro: 'Altra' };

const ESITO_LABEL: Record<string, string> = {
  completato: 'Lavoro completato',
  da_ultimare: 'Da ultimare',
  ritorno_necessario: 'Serve un ritorno',
  non_eseguito: 'Non eseguito',
};

const ANOMALIE_LABEL: Record<string, string> = {
  presenza_invalida: 'Presenza non valida',
  presenza_lunga: 'Presenza molto lunga',
  turno_oltre_mezzanotte: 'Turno oltre mezzanotte',
  pausa_aperta: 'Pausa non chiusa',
  pausa_fuori_presenza: 'Pausa fuori presenza',
  pause_sovrapposte: 'Pause sovrapposte',
  timer_non_fermato: 'Timer chiuso automaticamente all\'uscita',
  attivita_invalida: 'Attività non valida',
  attivita_fuori_presenza: 'Attività in parte fuori presenza',
  attivita_durante_pausa: 'Attività in parte durante una pausa',
  attivita_sovrapposte: 'Attività sovrapposte (tempo comune contato una volta)',
  attivita_da_classificare: 'Attività da classificare',
  ore_non_attribuite: 'Ore non attribuite oltre soglia',
  nessuna_attivita: 'Presenza senza attività',
  pausa_obbligatoria_mancante: 'Oltre 6 ore senza pausa',
};

function etichettaInterna(codice: string | null): string {
  return codice ? (CODICI_ATTIVITA_INTERNA as Record<string, string>)[codice] ?? codice : 'Non specificata';
}

function totaliVuoti(): TotaliOre {
  return { lordaMs: 0, pauseMs: 0, nettaMs: 0, clientiMs: 0, interneMs: 0, trasferimentiMs: 0, attribuiteMs: 0, nonAttribuiteMs: 0, daClassificareMs: 0 };
}

function aggiungiTotali(t: TotaliOre, r: RiepilogoGiornata) {
  t.lordaMs += r.lorda_ms;
  t.pauseMs += r.pause_ms;
  t.nettaMs += r.netta_ms;
  t.clientiMs += r.per_tipo.lavoro_cliente;
  t.interneMs += r.per_tipo.interna;
  t.trasferimentiMs += r.per_tipo.trasferimento;
  t.attribuiteMs += r.attribuite_ms;
  t.nonAttribuiteMs += r.non_attribuite_ms;
  t.daClassificareMs += r.da_classificare_ms;
}

function nonSincronizzati(...gruppi: ReadonlyArray<ReadonlyArray<{ sync_stato: string }>>): number {
  return gruppi.reduce((n, g) => n + g.filter((r) => r.sync_stato !== 'sincronizzato').length, 0);
}

interface PresenzaCalcolata {
  p: Presenza;
  stato: StatoPresenza;
  r: RiepilogoGiornata | null;
  pause: PausaPresenza[];
  tutte: AttivitaLavoro[];
}

/** Calcola ogni presenza UNA volta con il motore centrale. Le presenze non chiuse non vengono calcolate. */
function calcolaPresenze(src: SorgenteRiepiloghi, presenze: Presenza[]): PresenzaCalcolata[] {
  return presenze.map((p) => {
    const stato = statoPresenza(p, src.now);
    const pause = src.pause.filter((x) => x.presenza_id === p.id && !x.deleted_at).sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
    const tutte = src.attivita.filter((a) => a.presenza_id === p.id && a.operaio_id === p.operaio_id && !a.deleted_at);
    const r = stato === 'non_chiusa' ? null : calcolaDaRecord(p, pause, tutte, src.now);
    return { p, stato, r, pause, tutte };
  });
}

function attivitaDoc(src: SorgenteRiepiloghi, pc: PresenzaCalcolata): AttivitaDoc[] {
  const dettagli = new Map((pc.r?.attivita ?? []).map((d) => [d.id, d]));
  return attivitaEffettive(pc.tutte)
    .sort((a, b) => a.inizio_at.localeCompare(b.inizio_at))
    .map((a) => {
      const d = dettagli.get(a.id);
      const inizio = toMs(a.inizio_at);
      const fine = a.fine_at ? toMs(a.fine_at) : null;
      const i = src.intervento(a.intervento_id);
      const note: string[] = [];
      if (a.origine === 'correzione') note.push(`Corretta: ${a.motivo_correzione}`);
      if (a.origine === 'divisione') note.push(`Da divisione: ${a.motivo_correzione}`);
      if (a.origine === 'manuale') note.push(`Inserita a mano: ${a.motivo_correzione}`);
      if (a.chiusura_automatica) note.push('Chiusa automaticamente all\'uscita');
      if (fine === null) note.push(pc.stato === 'in_corso' ? 'In corso' : 'Fine non registrata');
      if (d && d.effettiva_ms !== d.registrata_ms) note.push(`Registrata ${fmtNota(d.registrata_ms)}, conteggiata ${fmtNota(d.effettiva_ms)}`);
      return {
        id: a.id,
        data: pc.p.data_lavoro,
        categoria: CATEGORIA[a.tipo],
        tipo: a.tipo === 'interna' ? etichettaInterna(a.codice_interno) : TIPO_LABEL[a.tipo],
        inizio,
        fine,
        durataMs: d ? d.effettiva_ms : null,
        registrataMs: d ? d.registrata_ms : fine !== null ? fine - inizio : null,
        cliente: a.cliente_id ? src.nomeCliente(a.cliente_id) : a.tipo === 'interna' ? 'Interna' : '',
        sede: src.nomeSede(a.sede_id),
        intervento: i ? `${i.codice} – ${i.titolo}` : '',
        descrizione: a.descrizione,
        note,
      };
    });
}

function fmtNota(ms: number): string {
  const m = Math.round(ms / 60_000);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function correzioniDoc(src: SorgenteRiepiloghi, pc: PresenzaCalcolata): CorrezioneDoc[] {
  const out: CorrezioneDoc[] = [];
  const perOriginale = new Map<string, AttivitaLavoro[]>();
  for (const a of pc.tutte) {
    if (a.sostituisce_id) perOriginale.set(a.sostituisce_id, [...(perOriginale.get(a.sostituisce_id) ?? []), a]);
  }
  const desc = (a: AttivitaLavoro) => {
    const dest = a.cliente_id ? src.nomeCliente(a.cliente_id) : a.tipo === 'interna' ? etichettaInterna(a.codice_interno) : TIPO_LABEL[a.tipo];
    return `${dest} ${fmtOra(a.inizio_at)}–${a.fine_at ? fmtOra(a.fine_at) : '…'}`;
  };
  for (const [origId, nuove] of perOriginale) {
    const orig = pc.tutte.find((x) => x.id === origId);
    const tipo = nuove[0].origine === 'divisione' ? 'Divisione' : 'Correzione';
    out.push({
      data: pc.p.data_lavoro,
      quando: toMs(nuove[0].created_at),
      descrizione: `${tipo}: ${orig ? desc(orig) : 'attività'} → ${nuove.map(desc).join(' + ')}`,
      motivo: nuove[0].motivo_correzione,
    });
  }
  for (const a of pc.tutte.filter((x) => x.origine === 'manuale')) {
    out.push({ data: pc.p.data_lavoro, quando: toMs(a.created_at), descrizione: `Intervallo aggiunto: ${desc(a)}`, motivo: a.motivo_correzione });
  }
  for (const a of pc.tutte.filter((x) => x.annullata)) {
    out.push({ data: pc.p.data_lavoro, quando: toMs(a.updated_at), descrizione: `Attività annullata: ${desc(a)}`, motivo: a.motivo_correzione });
  }
  if (pc.p.entrata_at !== pc.p.entrata_registrata_at) {
    out.push({ data: pc.p.data_lavoro, quando: toMs(pc.p.updated_at), descrizione: `Entrata corretta: registrata ${fmtOra(pc.p.entrata_registrata_at)}, valida ${fmtOra(pc.p.entrata_at)}`, motivo: 'vedi registro modifiche' });
  }
  if (pc.p.uscita_registrata_at && pc.p.uscita_at && pc.p.uscita_at !== pc.p.uscita_registrata_at) {
    out.push({ data: pc.p.data_lavoro, quando: toMs(pc.p.updated_at), descrizione: `Uscita corretta: registrata ${fmtOra(pc.p.uscita_registrata_at)}, valida ${fmtOra(pc.p.uscita_at)}`, motivo: 'vedi registro modifiche' });
  }
  return out.sort((a, b) => a.quando - b.quando);
}

function fmtOra(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function anomalieDoc(pc: PresenzaCalcolata): Avviso[] {
  if (pc.stato === 'non_chiusa') {
    return [{ livello: 'errore', testo: 'Uscita non registrata: la giornata non è stata chiusa. Totali non calcolabili finché non viene indicata l\'uscita.' }];
  }
  const visti = new Set<string>();
  const out: Avviso[] = [];
  for (const a of pc.r!.anomalie) {
    if (a.gravita === 'info' && a.codice !== 'turno_oltre_mezzanotte') continue;
    if (visti.has(a.codice)) continue;
    visti.add(a.codice);
    out.push({ livello: a.gravita === 'errore' ? 'errore' : a.gravita === 'avviso' ? 'avviso' : 'info', testo: ANOMALIE_LABEL[a.codice] ?? a.messaggio });
  }
  return out;
}

const ETICHETTA_RICHIESTA: Record<string, string> = { aperta: 'Aperta', presa_in_carico: 'Presa in carico', risolta: 'Risolta', respinta: 'Respinta' };

function richiesteDoc(src: SorgenteRiepiloghi, filtro: (r: RichiestaCorrezione) => boolean): RichiestaDoc[] {
  return (src.richieste ?? [])
    .filter((r) => r.operaio_id === src.operaio.id && !r.deleted_at && filtro(r))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      data: r.data_lavoro,
      inviataIl: toMs(r.created_at),
      messaggio: r.messaggio,
      stato: ETICHETTA_RICHIESTA[r.stato] ?? r.stato,
      aperta: r.stato === 'aperta' || r.stato === 'presa_in_carico',
      risposta: r.risposta,
      gestitaDa: r.gestita_da ? src.nomeUtente(r.gestita_da) : null,
      gestitaIl: r.gestita_at ? toMs(r.gestita_at) : null,
    }));
}

function intestazione(src: SorgenteRiepiloghi, titolo: string, prefisso: string, contenuto: unknown): Intestazione {
  const iniziali = `${src.operaio.nome[0] ?? ''}${src.operaio.cognome[0] ?? ''}`.toUpperCase();
  return {
    azienda: src.azienda,
    titolo,
    // Identificativo deterministico: stesso contenuto → stesso codice (verificabile).
    idDocumento: `${prefisso}-${iniziali}-${impronta(contenuto).slice(0, 6).toUpperCase()}`,
    generatoIl: src.now,
    generatoDa: `${src.generatoDa.nome} ${src.generatoDa.cognome}`,
    operaio: { id: src.operaio.id, nome: `${src.operaio.nome} ${src.operaio.cognome}`, qualifica: src.operaio.qualifica },
  };
}

// ---------------------------------------------------------------------------------------
// Riepilogo giornaliero
// ---------------------------------------------------------------------------------------

export function costruisciRiepilogoGiornaliero(src: SorgenteRiepiloghi, data: string): RiepilogoGiornalieroDoc {
  const presenze = src.presenze
    .filter((p) => p.operaio_id === src.operaio.id && p.data_lavoro === data && !p.deleted_at)
    .sort((a, b) => a.entrata_at.localeCompare(b.entrata_at));
  const calc = calcolaPresenze(src, presenze);

  const presenzeDoc: PresenzaDoc[] = calc.map((pc) => ({
    id: pc.p.id,
    stato: pc.stato,
    entrata: toMs(pc.p.entrata_at),
    uscita: pc.p.uscita_at ? toMs(pc.p.uscita_at) : null,
    entrataOriginale: pc.p.entrata_at !== pc.p.entrata_registrata_at ? toMs(pc.p.entrata_registrata_at) : null,
    uscitaOriginale: pc.p.uscita_registrata_at && pc.p.uscita_at !== pc.p.uscita_registrata_at ? toMs(pc.p.uscita_registrata_at) : null,
    pause: pc.pause.map((x) => {
      const inizio = toMs(x.inizio_at);
      const fine = x.fine_at ? toMs(x.fine_at) : null;
      return { tipo: PAUSA_LABEL[x.tipo] ?? x.tipo, inizio, fine, durataMs: fine !== null ? fine - inizio : null };
    }),
    lordaMs: pc.r ? pc.r.lorda_ms : null,
    pauseMs: pc.r ? pc.r.pause_ms : null,
    nettaMs: pc.r ? pc.r.netta_ms : null,
  }));

  const incompleta = calc.some((pc) => pc.stato === 'non_chiusa');
  let totali: TotaliOre | null = null;
  if (!incompleta && calc.length) {
    totali = totaliVuoti();
    for (const pc of calc) aggiungiTotali(totali, pc.r!);
  }
  const inCorso = calc.some((pc) => pc.stato === 'in_corso');

  const rapportiniGiorno = src.rapportini.filter((r) => r.data_lavoro === data && r.operai_ids.includes(src.operaio.id) && !r.deleted_at);
  const rapportini: RapportinoDoc[] = rapportiniGiorno
    .filter((r) => r.stato !== 'bozza')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => {
      const i = src.intervento(r.intervento_id);
      return {
        numero: r.numero ?? r.numero_provvisorio,
        definitivo: !!r.numero,
        cliente: src.nomeCliente(r.cliente_id),
        intervento: i ? `${i.codice} – ${i.titolo}` : 'Rapportino autonomo',
        descrizione: r.descrizione_lavoro.length > 140 ? `${r.descrizione_lavoro.slice(0, 137)}…` : r.descrizione_lavoro,
        esito: ESITO_LABEL[r.esito] ?? r.esito,
      };
    });

  const anomalie = calc.flatMap(anomalieDoc);
  const note: string[] = [];
  for (const pc of calc) if (pc.p.note) note.push(pc.p.note);
  if (presenze.some((p) => p.uscita_automatica)) note.push('Uscita indicata a posteriori dall\'operaio (giornata non chiusa al momento).');
  const correzioni = calc.flatMap((pc) => correzioniDoc(src, pc));
  const attivita = calc.flatMap((pc) => attivitaDoc(src, pc));
  const scoperti = calc.flatMap((pc) => (pc.r?.intervalli_scoperti ?? []).filter((x) => x.end - x.start >= 60_000).map((x) => ({ inizio: x.start, fine: x.end })));

  const richieste = richiesteDoc(src, (r) => r.data_lavoro === data);
  if (richieste.some((r) => r.aperta)) anomalie.push({ livello: 'avviso', testo: `${richieste.filter((r) => r.aperta).length} richieste di correzione in attesa di risposta dell'amministrazione.` });
  const cartMese = cartellinoDoc(src, Number(data.slice(0, 4)), Number(data.slice(5, 7)));
  const statoGiornata: RiepilogoGiornalieroDoc['statoGiornata'] = !calc.length ? 'assente' : incompleta ? 'non_chiusa' : inCorso ? 'in_corso' : 'chiusa';
  const contenuto = { data, presenzeDoc, attivita, totali, rapportini, correzioni, statoGiornata };
  const datiNonSincronizzati = nonSincronizzati(presenze, calc.flatMap((c) => c.pause), calc.flatMap((c) => c.tutte), rapportiniGiorno.filter((r) => r.stato !== 'bozza'));

  return {
    tipo: 'giornaliero',
    intestazione: intestazione(src, 'Riepilogo giornata lavorativa', `RG-${data.replace(/-/g, '')}`, contenuto),
    data,
    statoGiornata,
    presenze: presenzeDoc,
    attivita,
    intervalliScoperti: scoperti,
    totali,
    calcolatoFinoA: inCorso ? src.now : null,
    rapportini,
    bozzeEscluse: rapportiniGiorno.filter((r) => r.stato === 'bozza').length,
    cartellinoMese: { etichetta: cartMese.etichetta, approvato: cartMese.approvato },
    richiesteCorrezione: richieste,
    anomalie,
    note,
    correzioni,
    datiNonSincronizzati,
    esportabile: calc.length > 0,
    motivoNonEsportabile: calc.length ? null : 'Nessuna presenza registrata per questo giorno: non c\'è nulla da riepilogare.',
  };
}

// ---------------------------------------------------------------------------------------
// Riepilogo mensile
// ---------------------------------------------------------------------------------------

export function costruisciRiepilogoMensile(src: SorgenteRiepiloghi, anno: number, mese: number): RiepilogoMensileDoc {
  const prefisso = `${anno}-${pad(mese)}-`;
  const presenze = src.presenze
    .filter((p) => p.operaio_id === src.operaio.id && p.data_lavoro.startsWith(prefisso) && !p.deleted_at)
    .sort((a, b) => a.entrata_at.localeCompare(b.entrata_at));
  const calc = calcolaPresenze(src, presenze);
  const perData = new Map<string, PresenzaCalcolata[]>();
  for (const pc of calc) perData.set(pc.p.data_lavoro, [...(perData.get(pc.p.data_lavoro) ?? []), pc]);

  const totali = { ...totaliVuoti(), giorniLavorati: 0, giorniSenzaPresenza: 0, giorniFerialiSenzaPresenza: 0, giorniIncompleti: 0 };
  const giorni: GiornoMeseDoc[] = [];
  for (const data of daysInMonth(anno, mese)) {
    const pcs = perData.get(data) ?? [];
    const weekend = isWeekend(data);
    if (!pcs.length) {
      totali.giorniSenzaPresenza++;
      if (!weekend) totali.giorniFerialiSenzaPresenza++;
      giorni.push({ data, weekend, presenze: 0, entrata: null, uscita: null, pauseMs: null, nettaMs: null, attribuiteMs: null, stato: weekend ? 'Non lavorativo' : 'Nessuna presenza', lavorato: false, incompleto: false, anomalie: [], correzioni: 0 });
      continue;
    }
    const incompleto = pcs.some((pc) => pc.stato === 'non_chiusa');
    const inCorso = pcs.some((pc) => pc.stato === 'in_corso');
    const anomalie = [...new Set(pcs.flatMap(anomalieDoc).filter((a) => a.livello !== 'info').map((a) => a.testo))];
    const correzioni = pcs.reduce((n, pc) => n + contaCorrezioni(pc.tutte), 0);
    totali.giorniLavorati++;
    if (incompleto) totali.giorniIncompleti++;
    const somma = (k: 'pause_ms' | 'netta_ms' | 'attribuite_ms') => (incompleto ? null : pcs.reduce((n, pc) => n + pc.r![k], 0));
    if (!incompleto) for (const pc of pcs) aggiungiTotali(totali, pc.r!);
    const ultima = pcs[pcs.length - 1];
    giorni.push({
      data,
      weekend,
      presenze: pcs.length,
      entrata: toMs(pcs[0].p.entrata_at),
      uscita: ultima.p.uscita_at ? toMs(ultima.p.uscita_at) : null,
      pauseMs: somma('pause_ms'),
      nettaMs: somma('netta_ms'),
      attribuiteMs: somma('attribuite_ms'),
      stato: incompleto ? 'Uscita mancante' : inCorso ? 'In corso' : anomalie.length ? 'Da verificare' : correzioni ? 'Corretta' : 'Regolare',
      lavorato: true,
      incompleto,
      anomalie,
      correzioni,
    });
  }

  // Ripartizioni: solo dalle quote effettive del motore, giorni incompleti esclusi.
  const attivitaPerGiorno: RiepilogoMensileDoc['attivitaPerGiorno'] = [];
  const clienti = new Map<string, { giornate: Set<string>; lavoro: number; trasf: number; interventi: Set<string> }>();
  const interne = new Map<string, { giornate: Set<string>; ms: number }>();
  for (const [data, pcs] of perData) {
    const atts = pcs.flatMap((pc) => attivitaDoc(src, pc));
    attivitaPerGiorno.push({ data, attivita: atts });
    for (const pc of pcs) {
      if (!pc.r) continue;
      const dett = new Map(pc.r.attivita.map((d) => [d.id, d.effettiva_ms]));
      for (const a of attivitaEffettive(pc.tutte)) {
        const ms = dett.get(a.id) ?? 0;
        if (ms <= 0) continue;
        if ((a.tipo === 'lavoro_cliente' || a.tipo === 'trasferimento') && a.cliente_id) {
          const nome = src.nomeCliente(a.cliente_id);
          const c = clienti.get(nome) ?? { giornate: new Set(), lavoro: 0, trasf: 0, interventi: new Set() };
          c.giornate.add(data);
          if (a.tipo === 'lavoro_cliente') c.lavoro += ms;
          else c.trasf += ms;
          if (a.intervento_id) c.interventi.add(a.intervento_id);
          clienti.set(nome, c);
        } else if (a.tipo === 'interna') {
          const k = etichettaInterna(a.codice_interno);
          const x = interne.get(k) ?? { giornate: new Set(), ms: 0 };
          x.giornate.add(data);
          x.ms += ms;
          interne.set(k, x);
        }
      }
    }
  }
  attivitaPerGiorno.sort((a, b) => a.data.localeCompare(b.data));
  const perCliente = [...clienti.entries()]
    .map(([cliente, c]) => ({ cliente, giornate: c.giornate.size, lavoroMs: c.lavoro, trasferimentoMs: c.trasf, totaleMs: c.lavoro + c.trasf, interventi: c.interventi.size }))
    .sort((a, b) => b.totaleMs - a.totaleMs);
  const perInterna = [...interne.entries()].map(([attivita, x]) => ({ attivita, giornate: x.giornate.size, ms: x.ms })).sort((a, b) => b.ms - a.ms);

  // Trasferimenti senza cliente: attribuiti ma non a un cliente.
  const trasfSenzaCliente = totali.trasferimentiMs - perCliente.reduce((n, c) => n + c.trasferimentoMs, 0);
  const quadratura =
    totali.clientiMs + totali.interneMs + totali.trasferimentiMs === totali.attribuiteMs &&
    totali.attribuiteMs + totali.nonAttribuiteMs === totali.nettaMs &&
    totali.nettaMs + totali.pauseMs === totali.lordaMs &&
    perCliente.reduce((n, c) => n + c.totaleMs, 0) + trasfSenzaCliente === totali.clientiMs + totali.trasferimentiMs &&
    perInterna.reduce((n, x) => n + x.ms, 0) === totali.interneMs;

  const cartellino = cartellinoDoc(src, anno, mese);
  const anomalie: Avviso[] = [];
  if (!cartellino.approvato) anomalie.push({ livello: 'avviso', testo: 'Documento PROVVISORIO: il cartellino del mese non è approvato.' });
  if (cartellino.coerenteConApprovata === false) anomalie.push({ livello: 'errore', testo: 'I dati attuali differiscono dalla versione approvata del cartellino.' });
  if (totali.giorniIncompleti) anomalie.push({ livello: 'errore', testo: `${totali.giorniIncompleti} giornate con uscita mancante sono escluse dai totali.` });
  if (giorni.some((g) => g.stato === 'In corso')) anomalie.push({ livello: 'info', testo: 'Il mese contiene la giornata in corso: totali provvisori.' });
  const giorniConAnomalie = giorni.filter((g) => g.anomalie.length && !g.incompleto).length;
  if (giorniConAnomalie) anomalie.push({ livello: 'avviso', testo: `${giorniConAnomalie} giornate con anomalie da verificare (dettaglio nella tabella giornaliera).` });
  const richieste = richiesteDoc(src, (r) => r.data_lavoro.startsWith(prefisso));
  if (richieste.some((r) => r.aperta)) anomalie.push({ livello: 'avviso', testo: `${richieste.filter((r) => r.aperta).length} richieste di correzione ancora aperte.` });
  if (!quadratura) anomalie.push({ livello: 'errore', testo: 'Quadratura dei totali non verificata: il documento non va archiviato.' });

  const correzioni = calc.flatMap((pc) => correzioniDoc(src, pc)).sort((a, b) => a.data.localeCompare(b.data) || a.quando - b.quando);
  const contenuto = { anno, mese, totali, giorni, perCliente, perInterna, correzioni, cartellino: { s: cartellino.stato, v: cartellino.versioneCorrente } };
  const datiNonSincronizzati = nonSincronizzati(presenze, calc.flatMap((c) => c.pause), calc.flatMap((c) => c.tutte));

  return {
    tipo: 'mensile',
    intestazione: intestazione(src, 'Riepilogo mensile presenze e attività', `RM-${anno}${pad(mese)}`, contenuto),
    anno,
    mese,
    totali,
    giorni,
    attivitaPerGiorno,
    perCliente,
    perInterna,
    correzioni,
    richiesteCorrezione: richieste,
    cartellino,
    provvisorio: !cartellino.approvato || cartellino.coerenteConApprovata === false,
    anomalie,
    datiNonSincronizzati,
    quadratura,
    esportabile: quadratura,
    motivoNonEsportabile: quadratura ? null : 'I totali non quadrano: esportazione bloccata per evitare un documento incoerente.',
  };
}

function cartellinoDoc(src: SorgenteRiepiloghi, anno: number, mese: number): CartellinoDoc {
  const c = src.cartellino && src.cartellino.anno === anno && src.cartellino.mese === mese && src.cartellino.operaio_id === src.operaio.id ? src.cartellino : undefined;
  if (!c) {
    return { esiste: false, stato: 'in_compilazione', etichetta: ETICHETTE_STATO.in_compilazione, versioneCorrente: null, versioneApprovata: null, approvato: false, approvatoIl: null, approvatoDa: null, coerenteConApprovata: null, storico: [] };
  }
  const storico = (src.approvazioni ?? [])
    .filter((a) => a.cartellino_id === c.id)
    .sort((a, b) => a.eseguita_at.localeCompare(b.eseguita_at));
  const approvato = c.stato === 'approvato' && c.versione_approvata !== null;
  const approvazione = approvato
    ? [...storico].reverse().find((a) => a.azione === 'approva' && a.versione === c.versione_approvata)
    : undefined;
  let coerente: boolean | null = null;
  if (approvato) {
    const v = (src.versioni ?? []).find((x) => x.cartellino_id === c.id && x.versione === c.versione_approvata);
    const attuale = costruisciSnapshotMese(c.operaio_id, anno, mese, src.presenze, src.pause, src.attivita, src.now);
    coerente = !!v && v.impronta === attuale.impronta;
  }
  return {
    esiste: true,
    stato: c.stato,
    etichetta: ETICHETTE_STATO[c.stato],
    versioneCorrente: c.versione_corrente,
    versioneApprovata: c.versione_approvata,
    approvato,
    approvatoIl: approvazione ? toMs(approvazione.eseguita_at) : null,
    approvatoDa: approvazione ? src.nomeUtente(approvazione.utente_id) : null,
    coerenteConApprovata: coerente,
    storico: storico.map((a) => ({
      quando: toMs(a.eseguita_at),
      azione: ETICHETTE_AZIONE[a.azione],
      utente: a.utente_id ? src.nomeUtente(a.utente_id) : 'Sistema (server)',
      motivazione: a.motivazione,
      versione: a.versione,
    })),
  };
}
