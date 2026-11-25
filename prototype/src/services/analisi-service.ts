/**
 * Report aziendali e analisi gestionale (Fase 6). Specifica in docs/16-report-aziendali.md.
 *
 * Nessun nuovo calcolo: le ore vengono dal motore centrale (calcolaDaRecord, una volta per
 * presenza), i costi dal registro di magazzino (riepilogaConsumi), stati e storici dai record.
 * Il servizio produce ReportDoc già pronti: schermo, PDF, Excel e CSV leggono lo stesso oggetto.
 */
import { calcolaDaRecord } from '../domain/day-records';
import type { AnomaliaCodice, RiepilogoGiornata } from '../domain/hours-engine';
import { costoConsumo, euro, isConsumo, movimentoValido, riepilogaConsumi, venditaConsumo } from '../domain/magazzino';
import { statoPresenza } from '../domain/stato-presenza';
import { addDays, toMs } from '../domain/time';
import {
  CODICI_ATTIVITA_INTERNA,
  type AttivitaLavoro,
  type CartellinoStato,
  type CodiceAttivitaInterna,
  type Intervento,
  type InterventoStato,
  type InterventoTipo,
  type MovimentoMagazzino,
  type PausaPresenza,
  type Presenza,
} from '../domain/types';
import type { Indicatore, ReportDoc, TabellaReport, Valore } from '../reports/report-tabellare';
import { richiediAdmin, type ServiceContext } from './base';
import { AppError } from './errors';

export interface FiltroReport {
  da: string;
  a: string;
  operaioId?: string;
  clienteId?: string;
  sedeId?: string;
  interventoId?: string;
  /** Tipologia di attività: lavoro_cliente | trasferimento | interna | interna:<codice> | da_definire; per interventi ed economico: tipo di intervento. */
  tipo?: string;
  /** Stato dell'oggetto principale del report (cartellino, intervento, rapportino). */
  stato?: string;
}

export const ETICHETTE_TIPO_ATTIVITA: Record<string, string> = {
  lavoro_cliente: 'Lavoro presso cliente',
  trasferimento: 'Trasferimento',
  interna: 'Attività interne',
  da_definire: 'Da classificare',
  ...Object.fromEntries(Object.entries(CODICI_ATTIVITA_INTERNA).map(([k, v]) => [`interna:${k}`, `Interna – ${v}`])),
};

export const ETICHETTE_TIPO_INTERVENTO: Record<InterventoTipo | 'senza_intervento', string> = {
  manutenzione: 'Manutenzione', installazione: 'Installazione', riparazione: 'Riparazione', sopralluogo: 'Sopralluogo', ritorno: 'Ritorno', senza_intervento: 'Senza intervento',
};

export const ETICHETTE_STATO_INTERVENTO: Record<InterventoStato, string> = {
  da_programmare: 'Da programmare', programmato: 'Programmato', in_corso: 'In corso', da_ultimare: 'Da ultimare', completato: 'Completato', annullato: 'Annullato',
};

export const ETICHETTE_STATO_CARTELLINO: Record<CartellinoStato, string> = {
  in_compilazione: 'In compilazione', da_confermare_operaio: 'Da confermare (lavoratore)', confermato_operaio: 'Confermato, in invio', in_attesa_approvazione: 'Da approvare', da_correggere: 'Restituito', approvato: 'Approvato', riaperto: 'Riaperto',
};

const APERTI: InterventoStato[] = ['da_programmare', 'programmato', 'in_corso', 'da_ultimare'];
const ANOMALIE_DA_VERIFICARE: AnomaliaCodice[] = ['presenza_invalida', 'presenza_lunga', 'pausa_aperta', 'timer_non_fermato', 'attivita_sovrapposte', 'attivita_fuori_presenza', 'attivita_durante_pausa', 'attivita_da_classificare', 'ore_non_attribuite', 'nessuna_attivita', 'pausa_obbligatoria_mancante'];

interface Giornata {
  p: Presenza;
  r: RiepilogoGiornata;
  /** Attività conteggiate dal motore, con il loro record. */
  att: Array<{ a: AttivitaLavoro; ms: number }>;
}

function giorniTra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${da}T12:00:00Z`)) / 86400_000) + 1;
}

export class AnalisiService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  // --- nomi -------------------------------------------------------------------------------
  private operaio(id: string | null | undefined) {
    const p = id ? this.db.get('profili', id) : undefined;
    return p ? `${p.cognome} ${p.nome}` : '—';
  }
  private cliente(id: string | null | undefined) {
    return (id && this.db.get('clienti', id)?.ragione_sociale) || '—';
  }
  private sede(id: string | null | undefined) {
    return (id && this.db.get('sedi_cliente', id)?.nome) || '—';
  }

  // --- filtri -----------------------------------------------------------------------------
  private valida(f: FiltroReport) {
    richiediAdmin(this.ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.da) || !/^\d{4}-\d{2}-\d{2}$/.test(f.a)) throw new AppError('VALIDAZIONE', 'Indica un periodo valido.');
    if (f.da > f.a) throw new AppError('VALIDAZIONE', 'La data iniziale è successiva a quella finale.');
    if (giorniTra(f.da, f.a) > 400) throw new AppError('VALIDAZIONE', 'Il periodo massimo è di 13 mesi.');
  }

  descriviFiltri(f: FiltroReport, contesto: 'attivita' | 'intervento' | 'cartellino' | 'nessuno' = 'attivita'): Array<[string, string]> {
    const out: Array<[string, string]> = [['Periodo', `${f.da.split('-').reverse().join('/')} – ${f.a.split('-').reverse().join('/')}`]];
    out.push(['Lavoratore', f.operaioId ? this.operaio(f.operaioId) : 'Tutti']);
    out.push(['Cliente', f.clienteId ? this.cliente(f.clienteId) : 'Tutti']);
    if (f.sedeId) out.push(['Sede', this.sede(f.sedeId)]);
    if (f.interventoId) out.push(['Intervento', this.db.get('interventi', f.interventoId)?.codice ?? '—']);
    if (f.tipo) out.push([contesto === 'attivita' ? 'Tipologia di attività' : 'Tipologia di intervento', contesto === 'attivita' ? ETICHETTE_TIPO_ATTIVITA[f.tipo] ?? f.tipo : ETICHETTE_TIPO_INTERVENTO[f.tipo as InterventoTipo] ?? f.tipo]);
    if (f.stato) out.push(['Stato', ETICHETTE_STATO_INTERVENTO[f.stato as InterventoStato] ?? ETICHETTE_STATO_CARTELLINO[f.stato as CartellinoStato] ?? f.stato]);
    return out;
  }

  private attivitaCorrisponde(a: AttivitaLavoro, f: FiltroReport): boolean {
    if (f.clienteId && a.cliente_id !== f.clienteId) return false;
    if (f.sedeId && a.sede_id !== f.sedeId) return false;
    if (f.interventoId && a.intervento_id !== f.interventoId) return false;
    if (f.tipo) {
      if (f.tipo.startsWith('interna:')) return a.tipo === 'interna' && a.codice_interno === f.tipo.slice(8);
      if (a.tipo !== f.tipo) return false;
    }
    return true;
  }

  private filtroAttivitaAttivo(f: FiltroReport) {
    return Boolean(f.clienteId || f.sedeId || f.interventoId || f.tipo);
  }

  /** Giornate del periodo calcolate dal motore ore, una sola volta per presenza. */
  private giornate(f: Pick<FiltroReport, 'da' | 'a' | 'operaioId'>): Giornata[] {
    const now = this.db.now();
    const presenze = this.db.where('presenze', (p) => p.data_lavoro >= f.da && p.data_lavoro <= f.a && (!f.operaioId || p.operaio_id === f.operaioId));
    const ids = new Set(presenze.map((p) => p.id));
    const pause = new Map<string, PausaPresenza[]>();
    for (const x of this.db.all('pause_presenza')) if (ids.has(x.presenza_id)) pause.set(x.presenza_id, [...(pause.get(x.presenza_id) ?? []), x]);
    const att = new Map<string, AttivitaLavoro[]>();
    for (const x of this.db.all('attivita_lavoro', { includiEliminati: true })) if (ids.has(x.presenza_id)) att.set(x.presenza_id, [...(att.get(x.presenza_id) ?? []), x]);
    return presenze
      .sort((a, b) => a.data_lavoro.localeCompare(b.data_lavoro) || a.entrata_at.localeCompare(b.entrata_at))
      .map((p) => {
        const lista = att.get(p.id) ?? [];
        const r = calcolaDaRecord(p, pause.get(p.id) ?? [], lista, now);
        const perId = new Map(lista.map((a) => [a.id, a]));
        return { p, r, att: r.attivita.map((d) => ({ a: perId.get(d.id)!, ms: d.effettiva_ms })).filter((x) => x.a) };
      });
  }

  private intestazione(id: string, titolo: string, f: FiltroReport, contesto: Parameters<AnalisiService['descriviFiltri']>[1]): Omit<ReportDoc, 'indicatori' | 'tabelle' | 'avvisi'> {
    const u = this.ctx.utente();
    return { id, titolo, filtri: this.descriviFiltri(f, contesto), periodo: { da: f.da, a: f.a }, generatoIl: this.db.now(), generatoDa: u ? `${u.nome} ${u.cognome}` : '' };
  }

  private interventiDelPeriodo(f: FiltroReport): Intervento[] {
    const conRapportini = new Set(this.db.where('rapportini', (r) => r.data_lavoro >= f.da && r.data_lavoro <= f.a && r.intervento_id !== null).map((r) => r.intervento_id));
    const assegnati = f.operaioId ? new Set(this.db.where('intervento_operai', (x) => x.operaio_id === f.operaioId).map((x) => x.intervento_id)) : null;
    const lavorati = f.operaioId ? new Set(this.db.where('attivita_lavoro', (a) => a.operaio_id === f.operaioId && a.intervento_id !== null).map((a) => a.intervento_id)) : null;
    return this.db
      .where('interventi', (i) =>
        ((i.data_programmata !== null && i.data_programmata >= f.da && i.data_programmata <= f.a) || conRapportini.has(i.id) || (i.data_programmata === null && i.stato === 'da_programmare')) &&
        (!f.clienteId || i.cliente_id === f.clienteId) &&
        (!f.sedeId || i.sede_id === f.sedeId) &&
        (!f.interventoId || i.id === f.interventoId) &&
        (!f.tipo || i.tipo === f.tipo) &&
        (!f.stato || i.stato === f.stato) &&
        (!assegnati || assegnati.has(i.id) || lavorati!.has(i.id)),
      )
      .sort((a, b) => (a.data_programmata ?? '9999').localeCompare(b.data_programmata ?? '9999') || a.codice.localeCompare(b.codice));
  }

  /** Interventi la cui data programmata è cambiata dopo la creazione (dallo storico di audit). */
  private riprogrammati(): Set<string> {
    const out = new Set<string>();
    for (const x of this.db.audit()) {
      if (x.entita !== 'interventi' || !x.prima) continue;
      const prima = x.prima as Partial<Intervento>;
      const dopo = x.dopo as Partial<Intervento>;
      if (prima.data_programmata && dopo?.data_programmata && prima.data_programmata !== dopo.data_programmata) out.add(x.entita_id);
    }
    return out;
  }

  private consumi(f: FiltroReport, perTipoIntervento = true): MovimentoMagazzino[] {
    return this.db.where('movimenti_magazzino', (m) => {
      if (!isConsumo(m) || !movimentoValido(m) || m.data_riferimento < f.da || m.data_riferimento > f.a) return false;
      if (f.operaioId && m.operaio_id !== f.operaioId) return false;
      if (f.clienteId && m.cliente_id !== f.clienteId) return false;
      if (f.interventoId && m.intervento_id !== f.interventoId) return false;
      if (f.sedeId && this.db.get('rapportini', m.rapportino_id)?.sede_id !== f.sedeId) return false;
      if (perTipoIntervento && f.tipo) {
        const tipo = m.intervento_id ? this.db.get('interventi', m.intervento_id)?.tipo : 'senza_intervento';
        if (tipo !== f.tipo) return false;
      }
      return true;
    });
  }

  // =======================================================================================
  // PERSONALE
  // =======================================================================================
  personale(f: FiltroReport): ReportDoc {
    this.valida(f);
    const g = this.giornate(f);
    const filtroAtt = this.filtroAttivitaAttivo(f);
    const operai = this.db.all('profili').filter((p) => p.ruolo === 'operaio' && (!f.operaioId || p.id === f.operaioId)).sort((a, b) => a.cognome.localeCompare(b.cognome));

    // 1. Ore per dipendente
    const perOp = new Map<string, Record<string, number>>();
    for (const x of g) {
      const o = perOp.get(x.p.operaio_id) ?? { giorni: 0, lorda: 0, pause: 0, netta: 0, cliente: 0, trasf: 0, interne: 0, daClass: 0, non: 0, anomalie: 0, filtrate: 0 };
      o.giorni += 1;
      o.lorda += x.r.lorda_ms;
      o.pause += x.r.pause_ms;
      o.netta += x.r.netta_ms;
      o.cliente += x.r.per_tipo.lavoro_cliente;
      o.trasf += x.r.per_tipo.trasferimento;
      o.interne += x.r.per_tipo.interna;
      o.daClass += x.r.da_classificare_ms;
      o.non += x.r.non_attribuite_ms;
      o.anomalie += x.r.anomalie.filter((a) => a.gravita !== 'info').length;
      o.filtrate += x.att.filter((y) => this.attivitaCorrisponde(y.a, f)).reduce((s, y) => s + y.ms, 0);
      perOp.set(x.p.operaio_id, o);
    }
    const colOre = [
      { chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' as const },
      { chiave: 'giorni', titolo: 'Giorni di presenza', tipo: 'intero' as const },
      { chiave: 'lorda', titolo: 'Presenza lorda', tipo: 'durata' as const },
      { chiave: 'pause', titolo: 'Pause', tipo: 'durata' as const },
      { chiave: 'netta', titolo: 'Ore lavorate', tipo: 'durata' as const },
      { chiave: 'cliente', titolo: 'Ore cliente', tipo: 'durata' as const },
      { chiave: 'trasf', titolo: 'Trasferimenti', tipo: 'durata' as const },
      { chiave: 'interne', titolo: 'Interne', tipo: 'durata' as const },
      { chiave: 'daClass', titolo: 'Da classificare', tipo: 'durata' as const },
      { chiave: 'non', titolo: 'Non attribuite', tipo: 'durata' as const },
      { chiave: 'anomalie', titolo: 'Anomalie', tipo: 'intero' as const },
      ...(filtroAtt ? [{ chiave: 'filtrate', titolo: 'Ore attività filtrate', tipo: 'durata' as const }] : []),
    ];
    const righeOre = operai.map((o) => ({ operaio: `${o.cognome} ${o.nome}`, ...(perOp.get(o.id) ?? { giorni: 0, lorda: 0, pause: 0, netta: 0, cliente: 0, trasf: 0, interne: 0, daClass: 0, non: 0, anomalie: 0, filtrate: 0 }) }));
    const somma = (k: string) => righeOre.reduce((s, r) => s + ((r as Record<string, Valore>)[k] as number), 0);
    const totOre: Record<string, Valore> = { operaio: 'Totale' };
    for (const c of colOre.slice(1)) totOre[c.chiave] = somma(c.chiave);

    // 2. Presenze giornaliere
    const now = this.db.now();
    const STATO = { chiusa: 'Chiusa', in_corso: 'In corso', non_chiusa: 'Non chiusa' } as const;
    const righeGiorni = g.map((x) => ({
      data: x.p.data_lavoro,
      operaio: this.operaio(x.p.operaio_id),
      entrata: new Date(toMs(x.p.entrata_at)).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      uscita: x.p.uscita_at ? new Date(toMs(x.p.uscita_at)).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null,
      pause: x.r.pause_ms,
      netta: x.r.netta_ms,
      attribuite: x.r.attribuite_ms,
      stato: STATO[statoPresenza(x.p, now)],
      corretta: x.p.entrata_at !== x.p.entrata_registrata_at || x.p.uscita_at !== x.p.uscita_registrata_at ? 'Sì' : 'No',
    }));

    // 3. Presenze mensili
    const perMese = new Map<string, { mese: string; operaio: string; giorni: number; netta: number; attribuite: number }>();
    for (const x of g) {
      const k = `${x.p.data_lavoro.slice(0, 7)}|${x.p.operaio_id}`;
      const r = perMese.get(k) ?? { mese: x.p.data_lavoro.slice(0, 7), operaio: this.operaio(x.p.operaio_id), giorni: 0, netta: 0, attribuite: 0 };
      r.giorni += 1;
      r.netta += x.r.netta_ms;
      r.attribuite += x.r.attribuite_ms;
      perMese.set(k, r);
    }

    // 4. Ore per tipologia di attività (le interne per codice)
    const perTipo = new Map<string, number>();
    const perCliente = new Map<string, { lavoro: number; trasf: number }>();
    let interneTot = 0;
    for (const x of g) {
      for (const y of x.att) {
        if (!this.attivitaCorrisponde(y.a, f)) continue;
        const k = y.a.tipo === 'interna' ? `interna:${y.a.codice_interno ?? 'altro'}` : y.a.tipo;
        perTipo.set(k, (perTipo.get(k) ?? 0) + y.ms);
        if ((y.a.tipo === 'lavoro_cliente' || y.a.tipo === 'trasferimento') && y.a.cliente_id) {
          const c = perCliente.get(y.a.cliente_id) ?? { lavoro: 0, trasf: 0 };
          if (y.a.tipo === 'lavoro_cliente') c.lavoro += y.ms; else c.trasf += y.ms;
          perCliente.set(y.a.cliente_id, c);
        }
        if (y.a.tipo === 'interna') interneTot += y.ms;
      }
    }
    const totTipo = [...perTipo.values()].reduce((a, b) => a + b, 0);
    const righeTipo = [...perTipo.entries()].sort((a, b) => b[1] - a[1]).map(([k, ms]) => ({ tipologia: ETICHETTE_TIPO_ATTIVITA[k] ?? `Interna – ${CODICI_ATTIVITA_INTERNA[k.slice(8) as CodiceAttivitaInterna] ?? 'altro'}`, ore: ms, quota: totTipo ? (ms / totTipo) * 100 : 0 }));
    const righeClienti = [...perCliente.entries()].sort((a, b) => b[1].lavoro + b[1].trasf - a[1].lavoro - a[1].trasf).map(([id, c]) => ({ cliente: this.cliente(id), lavoro: c.lavoro, trasf: c.trasf, totale: c.lavoro + c.trasf }));
    const attribuiteClienti = righeClienti.reduce((s, r) => s + r.totale, 0);

    // 5. Cartellini dei mesi toccati dal periodo
    const mesi = new Set<string>();
    for (let d = f.da; d <= f.a; d = addDays(d, 1)) mesi.add(d.slice(0, 7));
    const cartellini = this.db
      .where('cartellini_mensili', (c) => mesi.has(`${c.anno}-${String(c.mese).padStart(2, '0')}`) && (!f.operaioId || c.operaio_id === f.operaioId) && (!f.stato || c.stato === f.stato))
      .sort((a, b) => a.anno - b.anno || a.mese - b.mese || this.operaio(a.operaio_id).localeCompare(this.operaio(b.operaio_id)));
    const conta = (stati: CartellinoStato[]) => cartellini.filter((c) => stati.includes(c.stato)).length;

    // 6. Confronto con il periodo precedente di pari durata
    const durata = giorniTra(f.da, f.a);
    const precA = addDays(f.da, -1);
    const precDa = addDays(f.da, -durata);
    const gPrec = this.giornate({ da: precDa, a: precA, operaioId: f.operaioId });
    const nettaPrec = new Map<string, { netta: number; cliente: number }>();
    for (const x of gPrec) {
      const o = nettaPrec.get(x.p.operaio_id) ?? { netta: 0, cliente: 0 };
      o.netta += x.r.netta_ms;
      o.cliente += x.r.per_tipo.lavoro_cliente;
      nettaPrec.set(x.p.operaio_id, o);
    }
    const righeConfronto = operai.map((o) => {
      const ora = perOp.get(o.id)?.netta ?? 0;
      const prima = nettaPrec.get(o.id)?.netta ?? 0;
      const oraCli = perOp.get(o.id)?.cliente ?? 0;
      return { operaio: `${o.cognome} ${o.nome}`, ora, prima, diff: ora - prima, var: prima ? ((ora - prima) / prima) * 100 : null, quotaCli: ora ? (oraCli / ora) * 100 : null };
    });

    const totNetta = totOre.netta as number;
    const indicatori: Indicatore[] = [
      { etichetta: 'Ore lavorate', valore: totNetta, tipo: 'durata' },
      { etichetta: 'Presenze (giorni-persona)', valore: g.length, tipo: 'intero' },
      { etichetta: 'Ore attribuite ai clienti', valore: attribuiteClienti, tipo: 'durata', nota: 'lavoro + trasferimenti' },
      { etichetta: 'Ore interne', valore: interneTot, tipo: 'durata' },
      { etichetta: 'Cartellini approvati', valore: conta(['approvato']), tipo: 'intero', tono: 'ok' },
      { etichetta: 'Cartellini da approvare', valore: conta(['in_attesa_approvazione', 'confermato_operaio']), tipo: 'intero', tono: conta(['in_attesa_approvazione', 'confermato_operaio']) ? 'warn' : undefined },
      { etichetta: 'Cartellini restituiti', valore: conta(['da_correggere']), tipo: 'intero', tono: conta(['da_correggere']) ? 'danger' : undefined },
      { etichetta: 'Anomalie', valore: totOre.anomalie as number, tipo: 'intero', tono: (totOre.anomalie as number) ? 'warn' : undefined },
    ];

    const tabelle: TabellaReport[] = [
      { id: 'ore-dipendente', titolo: 'Ore lavorate per dipendente', colonne: colOre, righe: righeOre, totale: totOre, grafico: { etichetta: 'operaio', valore: 'netta' }, nota: filtroAtt ? 'Le ore di presenza non dipendono dai filtri cliente/sede/intervento/tipologia; la colonna "Ore attività filtrate" sì.' : undefined },
      { id: 'ore-tipologia', titolo: 'Ore per tipologia di attività', colonne: [{ chiave: 'tipologia', titolo: 'Tipologia', tipo: 'testo' }, { chiave: 'ore', titolo: 'Ore', tipo: 'durata' }, { chiave: 'quota', titolo: 'Quota', tipo: 'percentuale' }], righe: righeTipo, totale: { tipologia: 'Totale attribuito', ore: totTipo, quota: totTipo ? 100 : 0 }, grafico: { etichetta: 'tipologia', valore: 'ore' } },
      { id: 'ore-clienti', titolo: 'Ore attribuite ai clienti', colonne: [{ chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'lavoro', titolo: 'Lavoro', tipo: 'durata' }, { chiave: 'trasf', titolo: 'Trasferimenti', tipo: 'durata' }, { chiave: 'totale', titolo: 'Totale', tipo: 'durata' }], righe: righeClienti, totale: { cliente: 'Totale clienti', lavoro: righeClienti.reduce((s, r) => s + r.lavoro, 0), trasf: righeClienti.reduce((s, r) => s + r.trasf, 0), totale: attribuiteClienti }, grafico: { etichetta: 'cliente', valore: 'totale' }, nota: `Ore interne nello stesso periodo: ${Math.floor(interneTot / 3600_000)}:${String(Math.round((interneTot % 3600_000) / 60_000)).padStart(2, '0')}. I trasferimenti senza cliente non sono inclusi.` },
      { id: 'presenze-mensili', titolo: 'Presenze mensili', colonne: [{ chiave: 'mese', titolo: 'Mese', tipo: 'testo' }, { chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'giorni', titolo: 'Giorni', tipo: 'intero' }, { chiave: 'netta', titolo: 'Ore lavorate', tipo: 'durata' }, { chiave: 'attribuite', titolo: 'Ore attribuite', tipo: 'durata' }], righe: [...perMese.values()] },
      { id: 'confronto', titolo: `Confronto con il periodo precedente (${precDa.split('-').reverse().join('/')} – ${precA.split('-').reverse().join('/')})`, colonne: [{ chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'ora', titolo: 'Ore periodo', tipo: 'durata' }, { chiave: 'prima', titolo: 'Ore periodo precedente', tipo: 'durata' }, { chiave: 'diff', titolo: 'Differenza', tipo: 'durata' }, { chiave: 'var', titolo: 'Variazione', tipo: 'percentuale' }, { chiave: 'quotaCli', titolo: 'Quota ore cliente', tipo: 'percentuale' }], righe: righeConfronto },
      { id: 'cartellini', titolo: 'Cartellini mensili', colonne: [{ chiave: 'mese', titolo: 'Mese', tipo: 'testo' }, { chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'versione', titolo: 'Versione', tipo: 'intero' }, { chiave: 'approvata', titolo: 'Versione approvata', tipo: 'intero' }, { chiave: 'motivazione', titolo: 'Ultima motivazione', tipo: 'testo' }], righe: cartellini.map((c) => ({ mese: `${c.anno}-${String(c.mese).padStart(2, '0')}`, operaio: this.operaio(c.operaio_id), stato: ETICHETTE_STATO_CARTELLINO[c.stato], versione: c.versione_corrente, approvata: c.versione_approvata, motivazione: c.ultima_motivazione || null })) },
      { id: 'presenze-giornaliere', titolo: 'Presenze giornaliere', colonne: [{ chiave: 'data', titolo: 'Data', tipo: 'data' }, { chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'entrata', titolo: 'Entrata', tipo: 'testo' }, { chiave: 'uscita', titolo: 'Uscita', tipo: 'testo' }, { chiave: 'pause', titolo: 'Pause', tipo: 'durata' }, { chiave: 'netta', titolo: 'Ore lavorate', tipo: 'durata' }, { chiave: 'attribuite', titolo: 'Attribuite', tipo: 'durata' }, { chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'corretta', titolo: 'Corretta', tipo: 'testo' }], righe: righeGiorni },
    ];
    const avvisi = righeGiorni.some((r) => r.stato === 'Non chiusa') ? ['Alcune presenze non sono chiuse: le loro ore sono calcolate fino all\'ultimo segnale disponibile e vanno verificate.'] : [];
    return { ...this.intestazione('personale', 'Report presenze e personale', f, 'attivita'), indicatori, tabelle, avvisi };
  }

  // =======================================================================================
  // INTERVENTI E CLIENTI
  // =======================================================================================
  interventi(f: FiltroReport): ReportDoc {
    this.valida(f);
    const lista = this.interventiDelPeriodo(f);
    const ids = new Set(lista.map((i) => i.id));
    const riprog = this.riprogrammati();
    // Ore sugli interventi: motore ore su TUTTE le presenze del periodo (filtrate per lavoratore).
    const g = this.giornate(f);
    const orePerInt = new Map<string, number>();
    const orePerIntOp = new Map<string, number>();
    for (const x of g) {
      for (const [iid, ms] of Object.entries(x.r.per_intervento)) {
        orePerInt.set(iid, (orePerInt.get(iid) ?? 0) + ms);
        orePerIntOp.set(`${x.p.operaio_id}|${iid}`, (orePerIntOp.get(`${x.p.operaio_id}|${iid}`) ?? 0) + ms);
      }
    }
    const consumi = this.consumi({ ...f, stato: undefined }, true);
    const costoPerInt = new Map<string, number>();
    for (const m of consumi) if (m.intervento_id) costoPerInt.set(m.intervento_id, euro((costoPerInt.get(m.intervento_id) ?? 0) + costoConsumo(m)));
    const rapportini = this.db.where('rapportini', (r) => r.stato !== 'bozza' && r.stato !== 'annullato');
    const followup = this.db.all('followup');

    // 1. Per cliente e sede
    const perSede = new Map<string, Record<string, Valore>>();
    for (const i of lista) {
      const k = `${i.cliente_id}|${i.sede_id ?? ''}`;
      const r = perSede.get(k) ?? { cliente: this.cliente(i.cliente_id), sede: this.sede(i.sede_id), totale: 0, completati: 0, aperti: 0, annullati: 0, ritorni: 0, ore: 0, costo: 0 };
      r.totale = (r.totale as number) + 1;
      if (i.stato === 'completato') r.completati = (r.completati as number) + 1;
      if (APERTI.includes(i.stato)) r.aperti = (r.aperti as number) + 1;
      if (i.stato === 'annullato') r.annullati = (r.annullati as number) + 1;
      if (i.tipo === 'ritorno') r.ritorni = (r.ritorni as number) + 1;
      r.ore = (r.ore as number) + (orePerInt.get(i.id) ?? 0);
      r.costo = euro((r.costo as number) + (costoPerInt.get(i.id) ?? 0));
      perSede.set(k, r);
    }

    // 2. Per lavoratore
    const assegnazioni = this.db.where('intervento_operai', (x) => ids.has(x.intervento_id));
    const operai = this.db.all('profili').filter((p) => p.ruolo === 'operaio' && (!f.operaioId || p.id === f.operaioId)).sort((a, b) => a.cognome.localeCompare(b.cognome));
    const righeOp = operai.map((o) => {
      const mie = new Set(assegnazioni.filter((x) => x.operaio_id === o.id).map((x) => x.intervento_id));
      for (const k of orePerIntOp.keys()) if (k.startsWith(`${o.id}|`) && ids.has(k.split('|')[1])) mie.add(k.split('|')[1]);
      const mieInt = lista.filter((i) => mie.has(i.id));
      return {
        operaio: `${o.cognome} ${o.nome}`,
        interventi: mieInt.length,
        completati: mieInt.filter((i) => i.stato === 'completato').length,
        aperti: mieInt.filter((i) => APERTI.includes(i.stato)).length,
        ore: mieInt.reduce((s, i) => s + (orePerIntOp.get(`${o.id}|${i.id}`) ?? 0), 0),
        rapportini: rapportini.filter((r) => r.redatto_da === o.id && r.data_lavoro >= f.da && r.data_lavoro <= f.a && (!r.intervento_id || ids.has(r.intervento_id) || !f.interventoId)).length,
      };
    });

    // 3. Elenco interventi con tempi e materiali
    const righeInt = lista.map((i) => {
      const ore = orePerInt.get(i.id) ?? 0;
      const prev = i.durata_prevista_min ? i.durata_prevista_min * 60_000 : null;
      const ritorno = followup.some((x) => x.intervento_origine_id === i.id && x.stato !== 'annullato');
      return {
        codice: i.codice,
        data: i.data_programmata,
        cliente: this.cliente(i.cliente_id),
        sede: this.sede(i.sede_id),
        tipo: ETICHETTE_TIPO_INTERVENTO[i.tipo],
        stato: ETICHETTE_STATO_INTERVENTO[i.stato],
        riprogrammato: riprog.has(i.id) ? 'Sì' : 'No',
        prevista: prev,
        ore,
        scostamento: prev !== null && ore > 0 ? ore - prev : null,
        rapportini: rapportini.filter((r) => r.intervento_id === i.id).length,
        costo: costoPerInt.get(i.id) ?? 0,
        ritorno: ritorno ? 'Sì' : 'No',
      };
    });

    // 4. Storico rapportini
    const assegnatiOp = f.operaioId ? new Set(this.db.where('intervento_operai', (x) => x.operaio_id === f.operaioId).map((x) => x.intervento_id)) : null;
    const rap = this.db
      .where('rapportini', (r) => r.data_lavoro >= f.da && r.data_lavoro <= f.a &&
        (!f.operaioId || r.operai_ids.includes(f.operaioId) || r.redatto_da === f.operaioId || (r.intervento_id !== null && assegnatiOp!.has(r.intervento_id))) &&
        (!f.clienteId || r.cliente_id === f.clienteId) && (!f.sedeId || r.sede_id === f.sedeId) && (!f.interventoId || r.intervento_id === f.interventoId) &&
        (!f.tipo || (r.intervento_id ? this.db.get('interventi', r.intervento_id)?.tipo === f.tipo : f.tipo === 'senza_intervento')))
      .sort((a, b) => b.data_lavoro.localeCompare(a.data_lavoro));
    const costoRap = new Map<string, number>();
    for (const m of this.db.all('movimenti_magazzino')) if (m.rapportino_id && isConsumo(m) && movimentoValido(m)) costoRap.set(m.rapportino_id, euro((costoRap.get(m.rapportino_id) ?? 0) + costoConsumo(m)));
    const ESITO: Record<string, string> = { completato: 'Completato', da_ultimare: 'Da ultimare', ritorno_necessario: 'Serve un ritorno', non_eseguito: 'Non eseguito' };
    const STATO_R: Record<string, string> = { bozza: 'Bozza (da completare)', completato: 'Completato', firmato: 'Firmato', annullato: 'Annullato' };
    const ore = (rid: string) => g.reduce((s, x) => s + x.att.filter((y) => this.db.get('rapportini', rid)?.attivita_ids.includes(y.a.id)).reduce((a, y) => a + y.ms, 0), 0);
    const righeRap = rap.map((r) => ({
      numero: r.numero ?? r.numero_provvisorio,
      data: r.data_lavoro,
      cliente: this.cliente(r.cliente_id),
      intervento: r.intervento_id ? this.db.get('interventi', r.intervento_id)?.codice ?? '—' : 'Autonomo',
      redatto: this.operaio(r.redatto_da),
      esito: ESITO[r.esito] ?? r.esito,
      stato: STATO_R[r.stato] ?? r.stato,
      ore: ore(r.id),
      costo: costoRap.get(r.id) ?? 0,
    }));

    // 5. Ritorni richiesti
    const fu = followup
      .filter((x) => {
        const origine = this.db.get('rapportini', x.rapportino_origine_id);
        const data = origine?.data_lavoro ?? x.created_at.slice(0, 10);
        return data >= f.da && data <= f.a && (!f.clienteId || x.cliente_id === f.clienteId) && (!f.sedeId || x.sede_id === f.sedeId) && (!f.interventoId || x.intervento_origine_id === f.interventoId || x.intervento_ritorno_id === f.interventoId);
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const STATO_F: Record<string, string> = { aperto: 'Da pianificare', pianificato: 'Pianificato', chiuso: 'Chiuso', annullato: 'Annullato' };

    // 6. Materiali utilizzati sugli interventi del report
    const perMat = new Map<string, { q: number; costo: number }>();
    for (const m of consumi) {
      if (m.intervento_id && !ids.has(m.intervento_id)) continue;
      if (!m.intervento_id && (f.interventoId || f.stato)) continue;
      const x = perMat.get(m.materiale_id) ?? { q: 0, costo: 0 };
      x.q += -m.quantita;
      x.costo += costoConsumo(m);
      perMat.set(m.materiale_id, x);
    }

    const conta = (fn: (i: Intervento) => boolean) => lista.filter(fn).length;
    const indicatori: Indicatore[] = [
      { etichetta: 'Interventi nel periodo', valore: lista.length, tipo: 'intero' },
      { etichetta: 'Completati', valore: conta((i) => i.stato === 'completato'), tipo: 'intero', tono: 'ok' },
      { etichetta: 'Aperti', valore: conta((i) => APERTI.includes(i.stato)), tipo: 'intero', tono: conta((i) => APERTI.includes(i.stato)) ? 'warn' : undefined },
      { etichetta: 'Riprogrammati', valore: conta((i) => riprog.has(i.id)), tipo: 'intero' },
      { etichetta: 'Ritorni da pianificare', valore: fu.filter((x) => x.stato === 'aperto').length, tipo: 'intero', tono: fu.some((x) => x.stato === 'aperto') ? 'warn' : undefined },
      { etichetta: 'Ore sugli interventi', valore: [...lista].reduce((s, i) => s + (orePerInt.get(i.id) ?? 0), 0), tipo: 'durata' },
      { etichetta: 'Rapportini', valore: rap.length, tipo: 'intero' },
      { etichetta: 'Costo materiali', valore: euro(righeInt.reduce((s, r) => s + r.costo, 0)), tipo: 'euro' },
    ];
    const tabelle: TabellaReport[] = [
      { id: 'per-cliente-sede', titolo: 'Interventi per cliente e sede', colonne: [{ chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'sede', titolo: 'Sede', tipo: 'testo' }, { chiave: 'totale', titolo: 'Interventi', tipo: 'intero' }, { chiave: 'completati', titolo: 'Completati', tipo: 'intero' }, { chiave: 'aperti', titolo: 'Aperti', tipo: 'intero' }, { chiave: 'annullati', titolo: 'Annullati', tipo: 'intero' }, { chiave: 'ritorni', titolo: 'Ritorni', tipo: 'intero' }, { chiave: 'ore', titolo: 'Ore impiegate', tipo: 'durata' }, { chiave: 'costo', titolo: 'Costo materiali', tipo: 'euro' }], righe: [...perSede.values()].sort((a, b) => (b.totale as number) - (a.totale as number)), grafico: { etichetta: 'cliente', valore: 'totale' } },
      { id: 'per-lavoratore', titolo: 'Interventi per lavoratore', colonne: [{ chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'interventi', titolo: 'Interventi', tipo: 'intero' }, { chiave: 'completati', titolo: 'Completati', tipo: 'intero' }, { chiave: 'aperti', titolo: 'Aperti', tipo: 'intero' }, { chiave: 'ore', titolo: 'Ore sugli interventi', tipo: 'durata' }, { chiave: 'rapportini', titolo: 'Rapportini redatti', tipo: 'intero' }], righe: righeOp, grafico: { etichetta: 'operaio', valore: 'interventi' } },
      { id: 'elenco-interventi', titolo: 'Interventi: stato, tempi e materiali', nota: 'Ore impiegate: quota effettiva calcolata dal motore ore nel periodo. Scostamento = ore impiegate − durata prevista.', colonne: [{ chiave: 'codice', titolo: 'Codice', tipo: 'testo' }, { chiave: 'data', titolo: 'Data', tipo: 'data' }, { chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'sede', titolo: 'Sede', tipo: 'testo' }, { chiave: 'tipo', titolo: 'Tipo', tipo: 'testo' }, { chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'riprogrammato', titolo: 'Riprogr.', tipo: 'testo' }, { chiave: 'prevista', titolo: 'Prevista', tipo: 'durata' }, { chiave: 'ore', titolo: 'Impiegate', tipo: 'durata' }, { chiave: 'scostamento', titolo: 'Scostamento', tipo: 'durata' }, { chiave: 'rapportini', titolo: 'Rapp.', tipo: 'intero' }, { chiave: 'costo', titolo: 'Materiali', tipo: 'euro' }, { chiave: 'ritorno', titolo: 'Ritorno', tipo: 'testo' }], righe: righeInt },
      { id: 'ritorni', titolo: 'Interventi che richiedono un ritorno', colonne: [{ chiave: 'data', titolo: 'Data origine', tipo: 'data' }, { chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'sede', titolo: 'Sede', tipo: 'testo' }, { chiave: 'tipo', titolo: 'Tipo', tipo: 'testo' }, { chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'motivo', titolo: 'Motivo', tipo: 'testo' }, { chiave: 'origine', titolo: 'Intervento di origine', tipo: 'testo' }, { chiave: 'ritorno', titolo: 'Intervento di ritorno', tipo: 'testo' }], righe: fu.map((x) => ({ data: this.db.get('rapportini', x.rapportino_origine_id)?.data_lavoro ?? x.created_at.slice(0, 10), cliente: this.cliente(x.cliente_id), sede: this.sede(x.sede_id), tipo: x.tipo === 'ritorno' ? 'Ritorno' : 'Da ultimare', stato: STATO_F[x.stato], motivo: x.motivo, origine: x.intervento_origine_id ? this.db.get('interventi', x.intervento_origine_id)?.codice ?? '—' : '—', ritorno: x.intervento_ritorno_id ? this.db.get('interventi', x.intervento_ritorno_id)?.codice ?? '—' : null })) },
      { id: 'materiali-interventi', titolo: 'Materiali utilizzati', colonne: [{ chiave: 'codice', titolo: 'Codice', tipo: 'testo' }, { chiave: 'materiale', titolo: 'Materiale', tipo: 'testo' }, { chiave: 'quantita', titolo: 'Quantità', tipo: 'quantita' }, { chiave: 'unita', titolo: 'U.M.', tipo: 'testo' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }], righe: [...perMat.entries()].sort((a, b) => b[1].costo - a[1].costo).map(([id, x]) => { const m = this.db.get('materiali', id); return { codice: m?.codice ?? '—', materiale: m?.nome ?? '—', quantita: Math.round(x.q * 1000) / 1000, unita: m?.unita ?? '', costo: euro(x.costo) }; }) },
      { id: 'rapportini', titolo: 'Storico rapportini', colonne: [{ chiave: 'numero', titolo: 'Numero', tipo: 'testo' }, { chiave: 'data', titolo: 'Data', tipo: 'data' }, { chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'intervento', titolo: 'Intervento', tipo: 'testo' }, { chiave: 'redatto', titolo: 'Redatto da', tipo: 'testo' }, { chiave: 'esito', titolo: 'Esito', tipo: 'testo' }, { chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'ore', titolo: 'Ore', tipo: 'durata' }, { chiave: 'costo', titolo: 'Materiali', tipo: 'euro' }], righe: righeRap },
    ];
    return { ...this.intestazione('interventi', 'Report interventi e clienti', f, 'intervento'), indicatori, tabelle, avvisi: [] };
  }

  // =======================================================================================
  // ECONOMICO
  // =======================================================================================
  economico(f: FiltroReport): ReportDoc {
    this.valida(f);
    const movs = this.consumi(f, true);
    const tipoInt = (id: string | null) => (id ? this.db.get('interventi', id)?.tipo ?? 'altro' : 'senza_intervento');
    const rie = riepilogaConsumi(movs, tipoInt);
    const g = this.giornate(f);
    const orePerInt = new Map<string, number>();
    for (const x of g) for (const [iid, ms] of Object.entries(x.r.per_intervento)) orePerInt.set(iid, (orePerInt.get(iid) ?? 0) + ms);

    // Listino: solo dove il prezzo di vendita esiste; nessun ricavo inventato.
    const conListino = movs.filter((m) => m.prezzo_vendita_unitario !== null);
    const costoConListino = euro(conListino.reduce((s, m) => s + costoConsumo(m), 0));
    const venditaListino = euro(conListino.reduce((s, m) => s + (venditaConsumo(m) ?? 0), 0));
    const senzaListino = movs.length - conListino.length;

    const righeInt = rie.perIntervento.map((v) => {
      const i = v.chiave ? this.db.get('interventi', v.chiave) : undefined;
      const ore = i ? orePerInt.get(i.id) ?? 0 : null;
      return { intervento: i ? `${i.codice} – ${i.titolo}` : 'Rapportini senza intervento', cliente: i ? this.cliente(i.cliente_id) : '—', tipo: i ? ETICHETTE_TIPO_INTERVENTO[i.tipo] : '—', utilizzi: v.utilizzi, costo: v.costo, listino: v.vendita, ore, costoOra: ore ? euro(v.costo / (ore / 3600_000)) : null };
    });
    const perMese = new Map<string, { mese: string; cliente: string; costo: number; listino: number }>();
    for (const m of movs) {
      const k = `${m.data_riferimento.slice(0, 7)}|${m.cliente_id}`;
      const r = perMese.get(k) ?? { mese: m.data_riferimento.slice(0, 7), cliente: this.cliente(m.cliente_id), costo: 0, listino: 0 };
      r.costo = euro(r.costo + costoConsumo(m));
      r.listino = euro(r.listino + (venditaConsumo(m) ?? 0));
      perMese.set(k, r);
    }
    const righeMat = rie.perMateriale.map((v) => {
      const m = this.db.get('materiali', v.chiave);
      const suoi = movs.filter((x) => x.materiale_id === v.chiave);
      const tuttiConPrezzo = suoi.every((x) => x.prezzo_vendita_unitario !== null);
      return { codice: m?.codice ?? '—', materiale: m?.nome ?? '—', categoria: m?.categoria ?? '', quantita: v.quantita, unita: m?.unita ?? '', costo: v.costo, listino: tuttiConPrezzo ? v.vendita : null, differenza: tuttiConPrezzo ? euro(v.vendita - v.costo) : null };
    });
    const listino = this.db.all('materiali').filter((m) => m.attivo).sort((a, b) => a.codice.localeCompare(b.codice)).map((m) => ({
      codice: m.codice, materiale: m.nome, unita: m.unita, acquisto: m.prezzo_acquisto, vendita: m.prezzo_vendita, ricarico: m.prezzo_vendita !== null && m.prezzo_acquisto > 0 ? ((m.prezzo_vendita - m.prezzo_acquisto) / m.prezzo_acquisto) * 100 : null, fornitore: m.fornitore,
    }));

    const indicatori: Indicatore[] = [
      { etichetta: 'Costo materiali consumati', valore: rie.costo, tipo: 'euro', nota: 'costo unitario storico di ogni scarico' },
      { etichetta: 'Valore a listino dei consumi', valore: venditaListino, tipo: 'euro', nota: senzaListino ? `${senzaListino} consumi senza prezzo di vendita esclusi` : 'prezzo di vendita del momento' },
      { etichetta: 'Differenza listino − costo', valore: euro(venditaListino - costoConListino), tipo: 'euro', nota: 'solo materiali con prezzo di vendita; non è un margine fatturato' },
      { etichetta: 'Consumi registrati', valore: rie.righe, tipo: 'intero' },
      { etichetta: 'Interventi con materiali', valore: rie.perIntervento.filter((v) => v.chiave).length, tipo: 'intero' },
      { etichetta: 'Clienti serviti', valore: rie.perCliente.length, tipo: 'intero' },
    ];
    const tabelle: TabellaReport[] = [
      { id: 'costi-cliente', titolo: 'Costi materiali per cliente', colonne: [{ chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'utilizzi', titolo: 'Consumi', tipo: 'intero' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }, { chiave: 'listino', titolo: 'Valore a listino', tipo: 'euro' }], righe: rie.perCliente.map((v) => ({ cliente: this.cliente(v.chiave), utilizzi: v.utilizzi, costo: v.costo, listino: v.vendita })), totale: { cliente: 'Totale', utilizzi: rie.righe, costo: rie.costo, listino: rie.vendita }, grafico: { etichetta: 'cliente', valore: 'costo' } },
      { id: 'costi-intervento', titolo: 'Confronto dei costi per intervento', nota: 'Costo materiali per ora = costo materiali ÷ ore impiegate sull\'intervento nel periodo (motore ore).', colonne: [{ chiave: 'intervento', titolo: 'Intervento', tipo: 'testo' }, { chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'tipo', titolo: 'Tipo', tipo: 'testo' }, { chiave: 'utilizzi', titolo: 'Consumi', tipo: 'intero' }, { chiave: 'costo', titolo: 'Costo materiali', tipo: 'euro' }, { chiave: 'listino', titolo: 'Valore a listino', tipo: 'euro' }, { chiave: 'ore', titolo: 'Ore impiegate', tipo: 'durata' }, { chiave: 'costoOra', titolo: 'Materiali per ora', tipo: 'euro' }], righe: righeInt, totale: { intervento: 'Totale', utilizzi: rie.righe, costo: rie.costo, listino: rie.vendita }, grafico: { etichetta: 'intervento', valore: 'costo' } },
      { id: 'costi-cliente-mese', titolo: 'Costi per cliente e mese', colonne: [{ chiave: 'mese', titolo: 'Mese', tipo: 'testo' }, { chiave: 'cliente', titolo: 'Cliente', tipo: 'testo' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }, { chiave: 'listino', titolo: 'Valore a listino', tipo: 'euro' }], righe: [...perMese.values()].sort((a, b) => a.mese.localeCompare(b.mese) || b.costo - a.costo) },
      { id: 'materiali-consumati', titolo: 'Valore dei materiali consumati', colonne: [{ chiave: 'codice', titolo: 'Codice', tipo: 'testo' }, { chiave: 'materiale', titolo: 'Materiale', tipo: 'testo' }, { chiave: 'categoria', titolo: 'Categoria', tipo: 'testo' }, { chiave: 'quantita', titolo: 'Quantità', tipo: 'quantita' }, { chiave: 'unita', titolo: 'U.M.', tipo: 'testo' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }, { chiave: 'listino', titolo: 'Valore a listino', tipo: 'euro' }, { chiave: 'differenza', titolo: 'Differenza', tipo: 'euro' }], righe: righeMat, grafico: { etichetta: 'materiale', valore: 'costo' } },
      { id: 'costi-lavoratore', titolo: 'Consumi per lavoratore', colonne: [{ chiave: 'operaio', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'utilizzi', titolo: 'Consumi', tipo: 'intero' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }], righe: rie.perOperaio.map((v) => ({ operaio: this.operaio(v.chiave), utilizzi: v.utilizzi, costo: v.costo })) },
      { id: 'costi-tipologia', titolo: 'Consumi per tipologia di intervento', colonne: [{ chiave: 'tipo', titolo: 'Tipologia', tipo: 'testo' }, { chiave: 'utilizzi', titolo: 'Consumi', tipo: 'intero' }, { chiave: 'costo', titolo: 'Costo', tipo: 'euro' }], righe: rie.perTipoIntervento.map((v) => ({ tipo: ETICHETTE_TIPO_INTERVENTO[v.chiave as InterventoTipo] ?? v.chiave, utilizzi: v.utilizzi, costo: v.costo })) },
      { id: 'listino', titolo: 'Riepilogo prezzi (listino attuale)', nota: 'Prezzi attuali di anagrafica: valgono per i movimenti futuri, i costi storici non cambiano.', colonne: [{ chiave: 'codice', titolo: 'Codice', tipo: 'testo' }, { chiave: 'materiale', titolo: 'Materiale', tipo: 'testo' }, { chiave: 'unita', titolo: 'U.M.', tipo: 'testo' }, { chiave: 'acquisto', titolo: 'Prezzo acquisto', tipo: 'euro' }, { chiave: 'vendita', titolo: 'Prezzo vendita', tipo: 'euro' }, { chiave: 'ricarico', titolo: 'Ricarico', tipo: 'percentuale' }, { chiave: 'fornitore', titolo: 'Fornitore', tipo: 'testo' }], righe: listino },
    ];
    const avvisi = [
      'Ricavi effettivi e margini non sono calcolati: il progetto non gestisce fatture, preventivi né tariffe orarie della manodopera. Il "valore a listino" applica solo il prezzo di vendita dei materiali, dove presente.',
      'Il costo della manodopera non è incluso: le ore sono riportate, ma non esiste un costo orario configurato.',
    ];
    return { ...this.intestazione('economico', 'Report economico', f, 'intervento'), indicatori, tabelle, avvisi };
  }

  // =======================================================================================
  // DASHBOARD
  // =======================================================================================
  dashboard(f: FiltroReport): ReportDoc {
    this.valida(f);
    const pers = this.personale({ ...f, stato: undefined });
    const eco = this.economico({ ...f, tipo: undefined, stato: undefined });
    const lista = this.interventiDelPeriodo({ ...f, tipo: undefined });
    const g = this.giornate(f);
    const now = this.db.now();
    const ind = (r: ReportDoc, e: string) => r.indicatori.find((x) => x.etichetta === e)?.valore ?? 0;
    const bozze = this.db.where('rapportini', (r) => r.stato === 'bozza' && r.data_lavoro >= f.da && r.data_lavoro <= f.a && (!f.operaioId || r.redatto_da === f.operaioId) && (!f.clienteId || r.cliente_id === f.clienteId));
    const completati = this.db.where('rapportini', (r) => (r.stato === 'completato' || r.stato === 'firmato') && r.data_lavoro >= f.da && r.data_lavoro <= f.a && (!f.operaioId || r.redatto_da === f.operaioId || r.operai_ids.includes(f.operaioId)) && (!f.clienteId || r.cliente_id === f.clienteId));
    const daUltimare = lista.filter((i) => i.stato === 'da_ultimare');

    // Da verificare: anomalie e attività che richiedono un controllo.
    const daVerificare: Array<Record<string, Valore>> = [];
    for (const x of g) {
      const st = statoPresenza(x.p, now);
      if (st === 'non_chiusa') daVerificare.push({ data: x.p.data_lavoro, categoria: 'Presenza non chiusa', lavoratore: this.operaio(x.p.operaio_id), dettaglio: 'Uscita non registrata', priorita: 'Alta' });
      for (const a of x.r.anomalie) {
        if (!ANOMALIE_DA_VERIFICARE.includes(a.codice) || a.gravita === 'info') continue;
        daVerificare.push({ data: x.p.data_lavoro, categoria: a.codice === 'attivita_da_classificare' ? 'Attività da classificare' : a.codice === 'ore_non_attribuite' ? 'Ore non attribuite' : 'Anomalia presenze', lavoratore: this.operaio(x.p.operaio_id), dettaglio: a.messaggio, priorita: a.gravita === 'errore' ? 'Alta' : 'Media' });
      }
    }
    for (const r of this.db.where('richieste_correzione', (r) => (r.stato === 'aperta' || r.stato === 'presa_in_carico') && (!f.operaioId || r.operaio_id === f.operaioId))) {
      daVerificare.push({ data: r.data_lavoro, categoria: 'Richiesta di correzione', lavoratore: this.operaio(r.operaio_id), dettaglio: r.messaggio, priorita: 'Media' });
    }
    for (const c of this.db.where('cartellini_mensili', (c) => (c.stato === 'in_attesa_approvazione' || c.stato === 'confermato_operaio') && (!f.operaioId || c.operaio_id === f.operaioId))) {
      daVerificare.push({ data: `${c.anno}-${String(c.mese).padStart(2, '0')}-01`, categoria: 'Cartellino da approvare', lavoratore: this.operaio(c.operaio_id), dettaglio: `Versione ${c.versione_corrente}`, priorita: 'Media' });
    }
    for (const x of this.db.where('followup', (x) => x.stato === 'aperto' && (!f.clienteId || x.cliente_id === f.clienteId))) {
      daVerificare.push({ data: x.created_at.slice(0, 10), categoria: 'Ritorno da pianificare', lavoratore: '—', dettaglio: `${this.cliente(x.cliente_id)}: ${x.motivo}`, priorita: x.priorita === 'urgente' || x.priorita === 'alta' ? 'Alta' : 'Media' });
    }
    for (const r of bozze) daVerificare.push({ data: r.data_lavoro, categoria: 'Rapportino da completare', lavoratore: this.operaio(r.redatto_da), dettaglio: `${r.numero_provvisorio} · ${this.cliente(r.cliente_id)}`, priorita: 'Media' });
    for (const m of this.db.where('movimenti_magazzino', (m) => m.giacenza_insufficiente && movimentoValido(m) && m.data_riferimento >= f.da && m.data_riferimento <= f.a)) {
      daVerificare.push({ data: m.data_riferimento, categoria: 'Consumo con giacenza insufficiente', lavoratore: this.operaio(m.operaio_id), dettaglio: this.db.get('materiali', m.materiale_id)?.nome ?? '—', priorita: 'Media' });
    }
    daVerificare.sort((a, b) => (a.priorita === b.priorita ? String(b.data).localeCompare(String(a.data)) : a.priorita === 'Alta' ? -1 : 1));

    const statiInt = (Object.keys(ETICHETTE_STATO_INTERVENTO) as InterventoStato[]).map((s) => ({ stato: ETICHETTE_STATO_INTERVENTO[s], numero: lista.filter((i) => i.stato === s).length })).filter((r) => r.numero > 0);
    const oreDip = pers.tabelle.find((t) => t.id === 'ore-dipendente')!;
    const indicatori: Indicatore[] = [
      { etichetta: 'Interventi programmati', valore: lista.filter((i) => i.stato === 'programmato' || i.stato === 'da_programmare').length, tipo: 'intero' },
      { etichetta: 'Interventi in corso', valore: lista.filter((i) => i.stato === 'in_corso').length, tipo: 'intero' },
      { etichetta: 'Interventi completati', valore: lista.filter((i) => i.stato === 'completato').length, tipo: 'intero', tono: 'ok' },
      { etichetta: 'Ore lavorate', valore: ind(pers, 'Ore lavorate'), tipo: 'durata' },
      { etichetta: 'Presenze (giorni-persona)', valore: ind(pers, 'Presenze (giorni-persona)'), tipo: 'intero' },
      { etichetta: 'Rapportini completati', valore: completati.length, tipo: 'intero' },
      { etichetta: 'Rapportini da completare', valore: bozze.length + daUltimare.length, tipo: 'intero', nota: `${bozze.length} bozze · ${daUltimare.length} interventi da ultimare`, tono: bozze.length + daUltimare.length ? 'warn' : undefined },
      { etichetta: 'Materiali consumati', valore: ind(eco, 'Costo materiali consumati'), tipo: 'euro' },
      { etichetta: 'Da verificare', valore: daVerificare.length, tipo: 'intero', tono: daVerificare.length ? 'warn' : 'ok' },
    ];
    const tabelle: TabellaReport[] = [
      { id: 'interventi-stato', titolo: 'Interventi per stato', colonne: [{ chiave: 'stato', titolo: 'Stato', tipo: 'testo' }, { chiave: 'numero', titolo: 'Interventi', tipo: 'intero' }], righe: statiInt, grafico: { etichetta: 'stato', valore: 'numero' } },
      { ...oreDip, id: 'attivita-lavoratore', titolo: 'Attività per lavoratore', colonne: oreDip.colonne.filter((c) => ['operaio', 'giorni', 'netta', 'cliente', 'trasf', 'interne', 'daClass', 'non', 'anomalie'].includes(c.chiave)) },
      { ...eco.tabelle.find((t) => t.id === 'costi-cliente')!, titolo: 'Costi materiali per cliente' },
      { ...eco.tabelle.find((t) => t.id === 'costi-intervento')!, titolo: 'Costi materiali per intervento (i più alti)', righe: eco.tabelle.find((t) => t.id === 'costi-intervento')!.righe.slice(0, 10), totale: undefined },
      { ...eco.tabelle.find((t) => t.id === 'materiali-consumati')!, titolo: 'Materiali consumati' },
      { id: 'da-verificare', titolo: 'Anomalie e attività da verificare', colonne: [{ chiave: 'priorita', titolo: 'Priorità', tipo: 'testo' }, { chiave: 'data', titolo: 'Data', tipo: 'data' }, { chiave: 'categoria', titolo: 'Categoria', tipo: 'testo' }, { chiave: 'lavoratore', titolo: 'Lavoratore', tipo: 'testo' }, { chiave: 'dettaglio', titolo: 'Dettaglio', tipo: 'testo' }], righe: daVerificare },
    ];
    return { ...this.intestazione('dashboard', 'Dashboard aziendale', f, 'attivita'), indicatori, tabelle, avvisi: [] };
  }
}
