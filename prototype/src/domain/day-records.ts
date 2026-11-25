/**
 * Collegamento tra i record persistiti e il motore ore, costruzione dello snapshot mensile
 * e pianificazione (pura) delle correzioni alle attività.
 */
import { calcolaGiornata, type RiepilogoGiornata, type EngineConfig, DEFAULT_CONFIG } from './hours-engine';
import { type Interval, overlaps } from './intervals';
import { impronta } from './ids';
import { daysInMonth, toIso, toMs } from './time';
import type {
  AttivitaLavoro,
  GiornoCartellino,
  PausaPresenza,
  Presenza,
  TotaliCartellino,
} from './types';

/**
 * Numero di OPERAZIONI di correzione (non di righe): una correzione crea 1 riga nuova, una
 * divisione 2 righe con lo stesso originale, un inserimento manuale 1 riga, un annullamento
 * marca 1 riga. Correzione di un'incongruenza della Fase 1, che contava le righe coinvolte.
 */
export function contaCorrezioni(list: readonly AttivitaLavoro[]): number {
  const sostituiti = new Set(list.filter((a) => a.sostituisce_id).map((a) => a.sostituisce_id));
  const manuali = list.filter((a) => a.origine === 'manuale').length;
  const annullate = list.filter((a) => a.annullata).length;
  return sostituiti.size + manuali + annullate;
}

/** Attività che contano nel calcolo: non annullate, non sostituite da correzioni, non eliminate. */
export function attivitaEffettive(list: readonly AttivitaLavoro[]): AttivitaLavoro[] {
  return list.filter((a) => !a.annullata && !a.superata_da_id && !a.deleted_at);
}

export function calcolaDaRecord(
  presenza: Presenza,
  pause: readonly PausaPresenza[],
  attivita: readonly AttivitaLavoro[],
  now: number,
  config: EngineConfig = DEFAULT_CONFIG,
): RiepilogoGiornata {
  return calcolaGiornata(
    { id: presenza.id, entrata: toMs(presenza.entrata_at), uscita: presenza.uscita_at ? toMs(presenza.uscita_at) : null },
    pause
      .filter((p) => p.presenza_id === presenza.id && !p.deleted_at)
      .map((p) => ({ id: p.id, inizio: toMs(p.inizio_at), fine: p.fine_at ? toMs(p.fine_at) : null })),
    attivitaEffettive(attivita.filter((a) => a.presenza_id === presenza.id)).map((a) => ({
      id: a.id,
      tipo: a.tipo,
      cliente_id: a.cliente_id,
      intervento_id: a.intervento_id,
      codice_interno: a.codice_interno,
      inizio: toMs(a.inizio_at),
      fine: a.fine_at ? toMs(a.fine_at) : null,
      creata: toMs(a.created_at),
    })),
    now,
    config,
  );
}

export interface SnapshotMese {
  giorni: GiornoCartellino[];
  totali: TotaliCartellino;
  impronta: string;
}

/**
 * Costruisce lo snapshot del cartellino. Ogni giorno è calcolato una sola volta dal motore;
 * i totali mensili sono la somma dei valori giornalieri in millisecondi (nessun arrotondamento
 * intermedio), così il cartellino non può divergere dal dettaglio.
 */
export function costruisciSnapshotMese(
  operaioId: string,
  anno: number,
  mese: number,
  presenze: readonly Presenza[],
  pause: readonly PausaPresenza[],
  attivita: readonly AttivitaLavoro[],
  now: number,
): SnapshotMese {
  const giorni: GiornoCartellino[] = [];
  const totali: TotaliCartellino = {
    giorni_lavorati: 0,
    lorda_ms: 0,
    pause_ms: 0,
    netta_ms: 0,
    attribuite_ms: 0,
    non_attribuite_ms: 0,
    anomalie: 0,
    correzioni: 0,
  };
  for (const data of daysInMonth(anno, mese)) {
    const delGiorno = presenze.filter((p) => p.operaio_id === operaioId && p.data_lavoro === data && !p.deleted_at);
    if (delGiorno.length === 0) {
      giorni.push({
        data,
        presenza_id: null,
        entrata_at: null,
        uscita_at: null,
        pause_ms: 0,
        lorda_ms: 0,
        netta_ms: 0,
        attribuite_ms: 0,
        da_classificare_ms: 0,
        non_attribuite_ms: 0,
        anomalie: [],
        correzioni: 0,
      });
      continue;
    }
    // Più presenze nello stesso giorno (es. rientro pomeridiano) sono ammesse: si sommano.
    for (const p of delGiorno) {
      const r = calcolaDaRecord(p, pause, attivita, now);
      const correzioni = contaCorrezioni(attivita.filter((a) => a.presenza_id === p.id));
      const anomalie = [...new Set(r.anomalie.filter((a) => a.gravita !== 'info' || a.codice === 'presenza_aperta').map((a) => a.codice))];
      giorni.push({
        data,
        presenza_id: p.id,
        entrata_at: p.entrata_at,
        uscita_at: p.uscita_at,
        pause_ms: r.pause_ms,
        lorda_ms: r.lorda_ms,
        netta_ms: r.netta_ms,
        attribuite_ms: r.attribuite_ms,
        da_classificare_ms: r.da_classificare_ms,
        non_attribuite_ms: r.non_attribuite_ms,
        anomalie,
        correzioni,
      });
      totali.lorda_ms += r.lorda_ms;
      totali.pause_ms += r.pause_ms;
      totali.netta_ms += r.netta_ms;
      totali.attribuite_ms += r.attribuite_ms;
      totali.non_attribuite_ms += r.non_attribuite_ms;
      totali.anomalie += anomalie.length;
      totali.correzioni += correzioni;
    }
  }
  totali.giorni_lavorati = new Set(giorni.filter((g) => g.presenza_id).map((g) => g.data)).size;
  return { giorni, totali, impronta: impronta({ giorni, totali }) };
}

// ---------------------------------------------------------------------------------------
// Correzioni: il record originale non viene mai modificato nei suoi dati; viene marcato come
// "superato" e sostituito da uno o più nuovi record che puntano a esso (sostituisce_id).
// ---------------------------------------------------------------------------------------

export class ErroreValidazione extends Error {}

export interface FinestraPresenza {
  entrata: number;
  uscita: number | null;
}

export function validaIntervalloAttivita(
  inizio: number,
  fine: number | null,
  presenza: FinestraPresenza,
  altre: readonly AttivitaLavoro[],
  escludiIds: readonly string[] = [],
  now: number = Date.now(),
): void {
  if (fine !== null && fine <= inizio) throw new ErroreValidazione("L'ora di fine deve essere successiva all'ora di inizio.");
  const limite = presenza.uscita ?? now;
  if (inizio < presenza.entrata || (fine ?? inizio) > limite) {
    throw new ErroreValidazione("L'intervallo deve essere compreso nell'orario di presenza.");
  }
  const io: Interval = { start: inizio, end: fine ?? limite };
  for (const a of attivitaEffettive(altre)) {
    if (escludiIds.includes(a.id)) continue;
    const altro: Interval = { start: toMs(a.inizio_at), end: a.fine_at ? toMs(a.fine_at) : limite };
    if (overlaps(io, altro)) {
      throw new ErroreValidazione('L\'intervallo si sovrappone a un\'altra attività: correggi prima quella.');
    }
  }
}

export interface ModificaAttivita {
  inizio_at?: string;
  fine_at?: string | null;
  tipo?: AttivitaLavoro['tipo'];
  cliente_id?: string | null;
  sede_id?: string | null;
  intervento_id?: string | null;
  codice_interno?: AttivitaLavoro['codice_interno'];
  descrizione?: string;
}

export interface PianoCorrezione {
  originale: AttivitaLavoro;
  nuove: AttivitaLavoro[];
}

function richiediMotivo(motivo: string) {
  if (!motivo.trim()) throw new ErroreValidazione('Indica il motivo della correzione.');
}

function coerenzaTipo(a: AttivitaLavoro) {
  if (a.tipo === 'lavoro_cliente' && !a.cliente_id) throw new ErroreValidazione('Seleziona il cliente.');
  if (a.tipo === 'interna' && !a.codice_interno) throw new ErroreValidazione("Seleziona il tipo di attività interna.");
  if (a.tipo === 'interna' || a.tipo === 'da_definire') {
    a.cliente_id = null;
    a.sede_id = null;
    a.intervento_id = null;
  }
  if (a.tipo !== 'interna') a.codice_interno = null;
}

/** Correzione di un'attività (orari, cliente, intervento, tipo). */
export function pianificaCorrezione(
  originale: AttivitaLavoro,
  modifica: ModificaAttivita,
  motivo: string,
  nuovoId: string,
  nowIso: string,
): PianoCorrezione {
  richiediMotivo(motivo);
  if (originale.superata_da_id || originale.annullata) throw new ErroreValidazione('Questa attività è già stata corretta.');
  const nuova: AttivitaLavoro = {
    ...originale,
    ...modifica,
    id: nuovoId,
    origine: 'correzione',
    sostituisce_id: originale.id,
    superata_da_id: null,
    motivo_correzione: motivo.trim(),
    chiusura_automatica: false,
    created_at: nowIso,
    updated_at: nowIso,
    row_version: 0,
    sync_stato: 'in_attesa',
  };
  coerenzaTipo(nuova);
  return { originale: { ...originale, superata_da_id: nuovoId, updated_at: nowIso }, nuove: [nuova] };
}

/** Divisione di un intervallo in due parti, eventualmente con destinazioni diverse. */
export function pianificaDivisione(
  originale: AttivitaLavoro,
  istanteDivisione: number,
  secondaParte: ModificaAttivita,
  motivo: string,
  ids: [string, string],
  nowIso: string,
  now: number,
): PianoCorrezione {
  richiediMotivo(motivo);
  if (originale.superata_da_id || originale.annullata) throw new ErroreValidazione('Questa attività è già stata corretta.');
  const inizio = toMs(originale.inizio_at);
  const fine = originale.fine_at ? toMs(originale.fine_at) : now;
  if (!originale.fine_at) throw new ErroreValidazione('Ferma il timer prima di dividere l\'attività.');
  if (istanteDivisione <= inizio || istanteDivisione >= fine) {
    throw new ErroreValidazione("L'ora di divisione deve essere interna all'intervallo.");
  }
  const comune = {
    origine: 'divisione' as const,
    sostituisce_id: originale.id,
    superata_da_id: null,
    motivo_correzione: motivo.trim(),
    chiusura_automatica: false,
    created_at: nowIso,
    updated_at: nowIso,
    row_version: 0,
    sync_stato: 'in_attesa' as const,
  };
  const prima: AttivitaLavoro = { ...originale, ...comune, id: ids[0], fine_at: toIso(istanteDivisione) };
  const seconda: AttivitaLavoro = {
    ...originale,
    ...secondaParte,
    ...comune,
    id: ids[1],
    inizio_at: toIso(istanteDivisione),
    fine_at: originale.fine_at,
  };
  coerenzaTipo(prima);
  coerenzaTipo(seconda);
  return { originale: { ...originale, superata_da_id: ids[0], updated_at: nowIso }, nuove: [prima, seconda] };
}

/** Catena storica di un'attività (dalla più recente all'originale). */
export function storicoAttivita(id: string, tutte: readonly AttivitaLavoro[]): AttivitaLavoro[] {
  const byId = new Map(tutte.map((a) => [a.id, a]));
  const out: AttivitaLavoro[] = [];
  let cur = byId.get(id);
  while (cur) {
    out.push(cur);
    cur = cur.sostituisce_id ? byId.get(cur.sostituisce_id) : undefined;
  }
  return out;
}
