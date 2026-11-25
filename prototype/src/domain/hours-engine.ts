/**
 * Motore di calcolo delle ore (specifica completa in docs/06-motore-calcolo-ore.md).
 *
 * Funzione pura: riceve presenza, pause e attività EFFETTIVE di una giornata (già filtrate
 * da correzioni/annullamenti) e restituisce totali, ripartizioni e anomalie.
 * Non legge orologi di sistema: l'istante "adesso" è un parametro, così il calcolo è
 * deterministico e verificabile.
 *
 * Definizioni (tutte in millisecondi):
 *   lorda          = uscita - entrata
 *   pause          = |unione(pause) ∩ presenza|
 *   netta          = lorda - pause                      (= |finestre di lavoro|)
 *   coperta        = |unione(attività) ∩ finestre di lavoro|
 *   attribuite     = parte coperta da attività con destinazione definita
 *                    (lavoro cliente, trasferimento, interna)
 *   da_classificare= parte coperta da attività 'da_definire' (timer avviato senza cliente)
 *   scoperta       = netta - coperta
 *   non_attribuite = netta - attribuite = da_classificare + scoperta
 *
 * Invarianti garantite: attribuite + non_attribuite = netta; coperta <= netta;
 * somma(effettivo per attività) = coperta (nessun doppio conteggio).
 */
import { type Interval, intersect, normalize, subtract, total } from './intervals';
import type { AttivitaTipo, CodiceAttivitaInterna } from './types';

export interface EnginePresenza {
  id: string;
  entrata: number;
  uscita: number | null;
}

export interface EnginePausa {
  id: string;
  inizio: number;
  fine: number | null;
}

export interface EngineAttivita {
  id: string;
  tipo: AttivitaTipo;
  cliente_id: string | null;
  intervento_id: string | null;
  codice_interno: CodiceAttivitaInterna | null;
  inizio: number;
  fine: number | null;
  /** Usato solo per spareggiare sovrapposizioni con stesso istante di inizio. */
  creata: number;
}

export interface EngineConfig {
  /** Soglia oltre cui la presenza lorda è segnalata come anomala. */
  presenzaLungaMs: number;
  /** Oltre questa durata la presenza è considerata non valida (dato sicuramente errato). */
  presenzaMassimaMs: number;
  /** Soglia ore non attribuite che genera avviso. */
  nonAttribuiteAvvisoMs: number;
  /** Lavoro netto oltre cui è richiesta almeno una pausa (D.Lgs. 66/2003: 6 ore). */
  pausaObbligatoriaDopoMs: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  presenzaLungaMs: 12 * 3600_000,
  presenzaMassimaMs: 24 * 3600_000,
  nonAttribuiteAvvisoMs: 30 * 60_000,
  pausaObbligatoriaDopoMs: 6 * 3600_000,
};

export type AnomaliaCodice =
  | 'presenza_aperta'
  | 'presenza_invalida'
  | 'presenza_lunga'
  | 'turno_oltre_mezzanotte'
  | 'pausa_aperta'
  | 'pausa_fuori_presenza'
  | 'pause_sovrapposte'
  | 'timer_attivo'
  | 'timer_non_fermato'
  | 'attivita_invalida'
  | 'attivita_fuori_presenza'
  | 'attivita_durante_pausa'
  | 'attivita_sovrapposte'
  | 'attivita_da_classificare'
  | 'ore_non_attribuite'
  | 'nessuna_attivita'
  | 'pausa_obbligatoria_mancante';

export interface Anomalia {
  codice: AnomaliaCodice;
  gravita: 'info' | 'avviso' | 'errore';
  messaggio: string;
  riferimenti: string[];
  durata_ms?: number;
}

export interface DettaglioAttivita {
  id: string;
  tipo: AttivitaTipo;
  /** Durata registrata (fine - inizio), con fine provvisoria se il timer è attivo. */
  registrata_ms: number;
  /** Parte che cade dentro le finestre di lavoro (presenza meno pause). */
  valida_ms: number;
  /** Parte effettivamente conteggiata dopo la risoluzione delle sovrapposizioni. */
  effettiva_ms: number;
  segmenti: Interval[];
}

export interface RiepilogoGiornata {
  presenza_id: string;
  finestra: Interval | null;
  aperta: boolean;
  lorda_ms: number;
  pause_ms: number;
  netta_ms: number;
  coperta_ms: number;
  attribuite_ms: number;
  da_classificare_ms: number;
  scoperta_ms: number;
  non_attribuite_ms: number;
  per_tipo: Record<AttivitaTipo, number>;
  per_cliente: Record<string, number>;
  per_intervento: Record<string, number>;
  per_codice_interno: Record<string, number>;
  attivita: DettaglioAttivita[];
  intervalli_scoperti: Interval[];
  anomalie: Anomalia[];
}

const TIPI: AttivitaTipo[] = ['lavoro_cliente', 'trasferimento', 'interna', 'da_definire'];

function emptyPerTipo(): Record<AttivitaTipo, number> {
  return { lavoro_cliente: 0, trasferimento: 0, interna: 0, da_definire: 0 };
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Calcola il riepilogo di una giornata.
 * @param now istante di riferimento per gli elementi ancora aperti (timer, pausa, presenza).
 */
export function calcolaGiornata(
  presenza: EnginePresenza,
  pause: readonly EnginePausa[],
  attivita: readonly EngineAttivita[],
  now: number,
  config: EngineConfig = DEFAULT_CONFIG,
): RiepilogoGiornata {
  const anomalie: Anomalia[] = [];
  const aperta = presenza.uscita === null;
  const fineProvvisoria = presenza.uscita ?? Math.max(now, presenza.entrata);

  const base: RiepilogoGiornata = {
    presenza_id: presenza.id,
    finestra: null,
    aperta,
    lorda_ms: 0,
    pause_ms: 0,
    netta_ms: 0,
    coperta_ms: 0,
    attribuite_ms: 0,
    da_classificare_ms: 0,
    scoperta_ms: 0,
    non_attribuite_ms: 0,
    per_tipo: emptyPerTipo(),
    per_cliente: {},
    per_intervento: {},
    per_codice_interno: {},
    attivita: [],
    intervalli_scoperti: [],
    anomalie,
  };

  // 1. Finestra di presenza ------------------------------------------------------------
  if (presenza.uscita !== null && presenza.uscita < presenza.entrata) {
    anomalie.push({
      codice: 'presenza_invalida',
      gravita: 'errore',
      messaggio: "L'uscita è precedente all'entrata: la giornata non viene conteggiata.",
      riferimenti: [presenza.id],
    });
    return base;
  }
  const finestra: Interval = { start: presenza.entrata, end: fineProvvisoria };
  const lorda = finestra.end - finestra.start;
  if (lorda > config.presenzaMassimaMs) {
    anomalie.push({
      codice: 'presenza_invalida',
      gravita: 'errore',
      messaggio: 'Presenza superiore a 24 ore: dato da correggere, non conteggiato.',
      riferimenti: [presenza.id],
      durata_ms: lorda,
    });
    return { ...base, finestra };
  }
  if (aperta) {
    anomalie.push({
      codice: 'presenza_aperta',
      gravita: 'info',
      messaggio: 'Giornata ancora aperta: i totali sono provvisori.',
      riferimenti: [presenza.id],
    });
  }
  if (lorda > config.presenzaLungaMs) {
    anomalie.push({
      codice: 'presenza_lunga',
      gravita: 'avviso',
      messaggio: 'Presenza superiore alla soglia giornaliera.',
      riferimenti: [presenza.id],
      durata_ms: lorda,
    });
  }
  if (localDayKey(finestra.start) !== localDayKey(Math.max(finestra.start, finestra.end - 1))) {
    anomalie.push({
      codice: 'turno_oltre_mezzanotte',
      gravita: 'info',
      messaggio: "Turno a cavallo della mezzanotte: attribuito al giorno dell'entrata.",
      riferimenti: [presenza.id],
    });
  }

  // 2. Pause --------------------------------------------------------------------------
  const pauseIntervals: Interval[] = [];
  for (const p of pause) {
    let fine = p.fine;
    if (fine === null) {
      fine = aperta ? Math.max(now, p.inizio) : finestra.end;
      anomalie.push({
        codice: 'pausa_aperta',
        gravita: aperta ? 'info' : 'avviso',
        messaggio: aperta
          ? 'Pausa in corso.'
          : "Pausa non terminata: chiusa d'ufficio all'uscita.",
        riferimenti: [p.id],
      });
    }
    const raw: Interval = { start: p.inizio, end: fine };
    const dentro = total(intersect([raw], [finestra]));
    if (dentro < raw.end - raw.start) {
      anomalie.push({
        codice: 'pausa_fuori_presenza',
        gravita: 'avviso',
        messaggio: 'Parte della pausa è fuori dalla presenza e non viene considerata.',
        riferimenti: [p.id],
        durata_ms: raw.end - raw.start - dentro,
      });
    }
    pauseIntervals.push(raw);
  }
  const sommaPause = pauseIntervals.reduce((a, i) => a + Math.max(0, i.end - i.start), 0);
  if (total(pauseIntervals) < sommaPause) {
    anomalie.push({
      codice: 'pause_sovrapposte',
      gravita: 'avviso',
      messaggio: 'Pause sovrapposte: il tempo comune è conteggiato una sola volta.',
      riferimenti: pause.map((p) => p.id),
    });
  }
  const pauseNellaPresenza = intersect(pauseIntervals, [finestra]);
  const pauseMs = total(pauseNellaPresenza);
  const finestreLavoro = subtract([finestra], pauseNellaPresenza);
  const netta = total(finestreLavoro);

  // 3. Attività: intervallo registrato e parte valida ---------------------------------
  type Lavorata = { a: EngineAttivita; registrato: Interval; validi: Interval[] };
  const lavorate: Lavorata[] = [];
  const dettagli = new Map<string, DettaglioAttivita>();
  for (const a of attivita) {
    let fine = a.fine;
    if (fine === null) {
      if (aperta) {
        fine = Math.max(now, a.inizio);
        anomalie.push({
          codice: 'timer_attivo',
          gravita: 'info',
          messaggio: 'Timer in corso.',
          riferimenti: [a.id],
        });
      } else {
        fine = Math.max(finestra.end, a.inizio);
        anomalie.push({
          codice: 'timer_non_fermato',
          gravita: 'avviso',
          messaggio: "Timer non fermato: considerato concluso all'uscita.",
          riferimenti: [a.id],
        });
      }
    }
    const registrato: Interval = { start: a.inizio, end: fine };
    const det: DettaglioAttivita = {
      id: a.id,
      tipo: a.tipo,
      registrata_ms: Math.max(0, fine - a.inizio),
      valida_ms: 0,
      effettiva_ms: 0,
      segmenti: [],
    };
    dettagli.set(a.id, det);
    if (fine < a.inizio) {
      anomalie.push({
        codice: 'attivita_invalida',
        gravita: 'errore',
        messaggio: 'Attività con fine precedente all\'inizio: esclusa dal calcolo.',
        riferimenti: [a.id],
      });
      continue;
    }
    const validi = intersect([registrato], finestreLavoro);
    det.valida_ms = total(validi);
    const fuoriPresenza = det.registrata_ms - total(intersect([registrato], [finestra]));
    const inPausa = total(intersect(intersect([registrato], [finestra]), pauseNellaPresenza));
    if (fuoriPresenza > 0) {
      anomalie.push({
        codice: 'attivita_fuori_presenza',
        gravita: 'avviso',
        messaggio: 'Parte dell\'attività è fuori dall\'orario di presenza e non viene conteggiata.',
        riferimenti: [a.id],
        durata_ms: fuoriPresenza,
      });
    }
    if (inPausa > 0) {
      anomalie.push({
        codice: 'attivita_durante_pausa',
        gravita: 'avviso',
        messaggio: 'Parte dell\'attività coincide con una pausa e non viene conteggiata.',
        riferimenti: [a.id],
        durata_ms: inPausa,
      });
    }
    lavorate.push({ a, registrato, validi });
  }

  // 4. Risoluzione sovrapposizioni (sweep line) ---------------------------------------
  // Ogni istante coperto da più attività viene assegnato UNA sola volta all'attività
  // iniziata più di recente (è quella su cui l'operaio è "passato"); spareggio: creata dopo, poi id.
  const confini = new Set<number>();
  for (const l of lavorate) for (const s of l.validi) {
    confini.add(s.start);
    confini.add(s.end);
  }
  const punti = [...confini].sort((x, y) => x - y);
  const coppieSovrapposte = new Map<string, { ids: string[]; ms: number }>();
  const vince = (x: EngineAttivita, y: EngineAttivita) =>
    x.inizio !== y.inizio ? x.inizio > y.inizio : x.creata !== y.creata ? x.creata > y.creata : x.id > y.id;

  for (let k = 0; k < punti.length - 1; k++) {
    const seg: Interval = { start: punti[k], end: punti[k + 1] };
    const coprono = lavorate.filter((l) => l.validi.some((v) => v.start <= seg.start && v.end >= seg.end));
    if (coprono.length === 0) continue;
    let vincitore = coprono[0];
    for (const c of coprono) if (vince(c.a, vincitore.a)) vincitore = c;
    const det = dettagli.get(vincitore.a.id)!;
    const ms = seg.end - seg.start;
    det.effettiva_ms += ms;
    const last = det.segmenti[det.segmenti.length - 1];
    if (last && last.end === seg.start) last.end = seg.end;
    else det.segmenti.push({ ...seg });
    if (coprono.length > 1) {
      const ids = coprono.map((c) => c.a.id).sort();
      const key = ids.join('|');
      const prev = coppieSovrapposte.get(key) ?? { ids, ms: 0 };
      prev.ms += ms;
      coppieSovrapposte.set(key, prev);
    }
  }
  for (const { ids, ms } of coppieSovrapposte.values()) {
    anomalie.push({
      codice: 'attivita_sovrapposte',
      gravita: 'avviso',
      messaggio: "Attività sovrapposte: il tempo comune è attribuito una sola volta all'attività iniziata per ultima.",
      riferimenti: ids,
      durata_ms: ms,
    });
  }

  // 5. Totali e ripartizioni ----------------------------------------------------------
  const perTipo = emptyPerTipo();
  const perCliente: Record<string, number> = {};
  const perIntervento: Record<string, number> = {};
  const perCodice: Record<string, number> = {};
  for (const l of lavorate) {
    const ms = dettagli.get(l.a.id)!.effettiva_ms;
    if (ms === 0) continue;
    perTipo[l.a.tipo] += ms;
    if (l.a.cliente_id && (l.a.tipo === 'lavoro_cliente' || l.a.tipo === 'trasferimento')) {
      perCliente[l.a.cliente_id] = (perCliente[l.a.cliente_id] ?? 0) + ms;
    }
    if (l.a.intervento_id) perIntervento[l.a.intervento_id] = (perIntervento[l.a.intervento_id] ?? 0) + ms;
    if (l.a.tipo === 'interna') {
      const c = l.a.codice_interno ?? 'non_specificato';
      perCodice[c] = (perCodice[c] ?? 0) + ms;
    }
  }
  const coperta = TIPI.reduce((acc, t) => acc + perTipo[t], 0);
  const daClassificare = perTipo.da_definire;
  const attribuite = coperta - daClassificare;
  const scoperta = netta - coperta;
  const nonAttribuite = netta - attribuite;
  const coperti = normalize(lavorate.flatMap((l) => dettagli.get(l.a.id)!.segmenti));
  const scoperti = subtract(finestreLavoro, coperti);

  if (daClassificare > 0) {
    anomalie.push({
      codice: 'attivita_da_classificare',
      gravita: 'avviso',
      messaggio: 'Ci sono attività senza cliente o tipo: vanno classificate.',
      riferimenti: lavorate.filter((l) => l.a.tipo === 'da_definire').map((l) => l.a.id),
      durata_ms: daClassificare,
    });
  }
  if (!aperta && netta > 0 && lavorate.length === 0) {
    anomalie.push({
      codice: 'nessuna_attivita',
      gravita: 'avviso',
      messaggio: 'Presenza senza attività registrate.',
      riferimenti: [presenza.id],
    });
  } else if (!aperta && nonAttribuite > config.nonAttribuiteAvvisoMs) {
    anomalie.push({
      codice: 'ore_non_attribuite',
      gravita: 'avviso',
      messaggio: 'Ore non attribuite oltre la soglia.',
      riferimenti: [presenza.id],
      durata_ms: nonAttribuite,
    });
  }
  if (!aperta && netta > config.pausaObbligatoriaDopoMs && pauseMs === 0) {
    anomalie.push({
      codice: 'pausa_obbligatoria_mancante',
      gravita: 'avviso',
      messaggio: 'Lavoro oltre 6 ore senza pausa registrata.',
      riferimenti: [presenza.id],
    });
  }

  return {
    ...base,
    finestra,
    lorda_ms: lorda,
    pause_ms: pauseMs,
    netta_ms: netta,
    coperta_ms: coperta,
    attribuite_ms: attribuite,
    da_classificare_ms: daClassificare,
    scoperta_ms: scoperta,
    non_attribuite_ms: nonAttribuite,
    per_tipo: perTipo,
    per_cliente: perCliente,
    per_intervento: perIntervento,
    per_codice_interno: perCodice,
    attivita: [...dettagli.values()],
    intervalli_scoperti: scoperti,
    anomalie,
  };
}

/** Anomalie che bloccano la conferma del cartellino (gravità errore o elementi ancora aperti). */
export function anomalieBloccanti(r: RiepilogoGiornata): Anomalia[] {
  return r.anomalie.filter(
    (a) =>
      a.gravita === 'errore' ||
      a.codice === 'presenza_aperta' ||
      a.codice === 'timer_attivo' ||
      (a.codice === 'pausa_aperta' && r.aperta),
  );
}

/** Formatta millisecondi come H:MM (arrotondamento al minuto solo in presentazione). */
export function formatDurata(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const totMin = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(totMin / 60);
  const m = totMin % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}`;
}

/** Variante con secondi, per il timer in corso. */
export function formatDurataSecondi(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
