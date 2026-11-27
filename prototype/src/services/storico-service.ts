/**
 * Fase 14 – Gestione amministrativa dello storico e doppia esportazione.
 *
 * - Lo stato amministrativo (escluso / archiviato) è un record SEPARATO (stati_amministrativi):
 *   attività, rapporti, presenze e cartellini non vengono mai modificati da un'esclusione.
 * - Riepilogo operativo: tutto ciò che è registrato, con lo stato amministrativo indicato.
 * - Riepilogo amministrativo (fatturazione): solo gli elementi inclusi; ore e materiali sono
 *   ricalcolati sugli elementi inclusi.
 * - Ogni operazione passa dall'audit (chi, quando, prima/dopo, motivo); ogni esportazione ha
 *   un codice nuovo e resta registrata (i documenti già generati non cambiano).
 */
import { calcolaDaRecord } from '../domain/day-records';
import { uuid } from '../domain/ids';
import { toMs } from '../domain/time';
import type { AttivitaLavoro, ElementoStorico, Esportazione, Rapportino, StatoAmministrativo } from '../domain/types';
import type { Colonna, ReportDoc, TabellaReport } from '../reports/report-tabellare';
import { nomeProfilo, nuovoBase, richiediAdmin, verificaMeseModificabile, type ServiceContext } from './base';
import { AppError, nonTrovato } from '../shared/errors';
import { ReportService } from './report-service';

export type TipoRiepilogo = 'operativo' | 'amministrativo';
export type StatoElemento = 'incluso' | 'escluso' | 'archiviato';

export interface FiltroStorico {
  da: string;
  a: string;
  cliente_id: string;
  sede_id?: string | null;
}

export interface AttivitaStorico {
  attivita: AttivitaLavoro;
  data: string;
  operaio_id: string;
  ms: number;
  rapportino_id: string | null;
  /** Stato proprio dell'elemento. */
  stato: StatoElemento;
  /** Entra nel riepilogo amministrativo (considerando giornata e rapporto collegato). */
  inclusa: boolean;
}

export interface RapportoStorico {
  rapportino: Rapportino;
  ms: number;
  stato: StatoElemento;
  incluso: boolean;
}

export interface GiornoStorico {
  data: string;
  chiave: string;
  stato: StatoElemento;
  attivita: AttivitaStorico[];
  rapporti: RapportoStorico[];
}

export interface MaterialeTotale {
  descrizione: string;
  unita: string;
  quantita: number;
}

export interface Totali {
  ms: number;
  rapporti: number;
  attivita: number;
  giornate: number;
  materiali: MaterialeTotale[];
}

export interface ModelloStorico {
  filtro: FiltroStorico;
  giorni: GiornoStorico[];
  totaliOperativo: Totali;
  totaliAmministrativo: Totali;
}

const chiaveGiornata = (clienteId: string, data: string) => `${clienteId}|${data}`;

export class StoricoService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly report: ReportService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  // --- stato amministrativo -------------------------------------------------------------
  statoRecord(entita: ElementoStorico, id: string): StatoAmministrativo | undefined {
    return this.db.where('stati_amministrativi', (x) => x.entita === entita && x.entita_id === id)[0];
  }

  statoDi(entita: ElementoStorico, id: string): StatoElemento {
    const s = this.statoRecord(entita, id);
    return s?.archiviato ? 'archiviato' : s?.escluso ? 'escluso' : 'incluso';
  }

  private async imposta(entita: ElementoStorico, id: string, patch: Partial<Pick<StatoAmministrativo, 'escluso' | 'archiviato'>>, operazione: string, motivo: string): Promise<StatoAmministrativo> {
    const admin = richiediAdmin(this.ctx);
    this.verificaEsistenza(entita, id);
    const cur = this.statoRecord(entita, id);
    const nuovo: StatoAmministrativo = {
      ...(cur ?? { ...nuovoBase(this.ctx, uuid()), entita, entita_id: id, escluso: false, archiviato: false, motivo: '' }),
      ...patch,
      motivo: motivo.trim(),
    };
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('stati_amministrativi', nuovo, { audit: cur ? 'modifica' : 'crea', motivo: `${operazione}${motivo.trim() ? `: ${motivo.trim()}` : ''}` });
    await uow.commit();
    return saved;
  }

  escludi(entita: ElementoStorico, id: string, motivo = '') {
    return this.imposta(entita, id, { escluso: true }, 'Esclusione dai documenti amministrativi', motivo);
  }
  includi(entita: ElementoStorico, id: string, motivo = '') {
    return this.imposta(entita, id, { escluso: false }, 'Inclusione nei documenti amministrativi', motivo);
  }
  archivia(entita: ElementoStorico, id: string, motivo = '') {
    return this.imposta(entita, id, { archiviato: true }, 'Archiviazione', motivo);
  }
  ripristina(entita: ElementoStorico, id: string, motivo = '') {
    return this.imposta(entita, id, { archiviato: false, escluso: false }, 'Ripristino', motivo);
  }

  /** Eliminazione definitiva consentita? (solo elementi archiviati; vedi `eliminaDefinitivamente`) */
  motivoNonEliminabile(entita: ElementoStorico, id: string): string | null {
    if (entita === 'giornata') return 'Una giornata non si elimina: escludila o archiviala.';
    if (this.statoDi(entita, id) !== 'archiviato') return "Archivia l'elemento prima di eliminarlo definitivamente.";
    if (entita === 'attivita') {
      const a = this.db.get('attivita_lavoro', id);
      if (!a) return 'Attività non trovata.';
      if (this.db.where('rapportini', (r) => r.attivita_ids.includes(id)).length) return 'Attività collegata a un rapporto: archivia o elimina prima il rapporto.';
      const p = this.db.get('presenze', a.presenza_id);
      try {
        if (p) verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
      } catch {
        return 'Il cartellino del mese è in verifica o approvato: non si elimina.';
      }
    }
    if (entita === 'rapportino' && !this.db.get('rapportini', id)) return 'Rapporto non trovato.';
    return null;
  }

  /**
   * Eliminazione definitiva (eliminazione logica sincronizzata, con copia completa nell'audit).
   * Solo per elementi archiviati; le attività solo se non collegate a rapporti e con il mese aperto.
   */
  async eliminaDefinitivamente(entita: ElementoStorico, id: string, motivo: string): Promise<void> {
    const admin = richiediAdmin(this.ctx);
    if (motivo.trim().length < 5) throw new AppError('VALIDAZIONE', "Indica il motivo dell'eliminazione definitiva.");
    const blocco = this.motivoNonEliminabile(entita, id);
    if (blocco) throw new AppError('STATO_NON_VALIDO', blocco);
    const now = this.db.nowIso();
    const uow = this.db.unitOfWork(admin.id);
    if (entita === 'attivita') {
      const a = this.db.get('attivita_lavoro', id)!;
      uow.save('attivita_lavoro', { ...a, deleted_at: now }, { audit: 'elimina', motivo: `Eliminazione definitiva: ${motivo.trim()}` });
    } else {
      const r = this.db.get('rapportini', id)!;
      uow.save('rapportini', { ...r, deleted_at: now }, { audit: 'elimina', motivo: `Eliminazione definitiva: ${motivo.trim()}` });
    }
    const st = this.statoRecord(entita, id);
    if (st) uow.save('stati_amministrativi', { ...st, deleted_at: now }, { audit: 'elimina', motivo: 'Elemento eliminato definitivamente' });
    await uow.commit();
  }

  private verificaEsistenza(entita: ElementoStorico, id: string) {
    if (entita === 'attivita' && !this.db.get('attivita_lavoro', id)) throw nonTrovato('Attività');
    if (entita === 'rapportino' && !this.db.get('rapportini', id)) throw nonTrovato('Rapporto');
    if (entita === 'giornata' && !/^[^|]+\|\d{4}-\d{2}-\d{2}$/.test(id)) throw new AppError('VALIDAZIONE', 'Giornata non valida.');
  }

  /** Operazioni registrate sullo storico (esclusioni, archiviazioni, ripristini, eliminazioni). */
  registroOperazioni() {
    return this.db
      .audit()
      .filter((a) => a.entita === 'stati_amministrativi' || (a.azione === 'elimina' && (a.entita === 'attivita_lavoro' || a.entita === 'rapportini') && a.motivo.startsWith('Eliminazione definitiva')))
      .map((a) => {
        const dopo = (a.dopo ?? a.prima) as Partial<StatoAmministrativo & { id: string }> | null;
        const entita: ElementoStorico = a.entita === 'stati_amministrativi' ? (dopo?.entita ?? 'attivita') : a.entita === 'rapportini' ? 'rapportino' : 'attivita';
        const entitaId = a.entita === 'stati_amministrativi' ? String(dopo?.entita_id ?? '') : a.entita_id;
        return { id: a.id, entita, entitaId, operazione: a.motivo || a.azione, utente_id: a.utente_id, eseguita_at: a.eseguita_at };
      });
  }

  // --- modello dei riepiloghi -----------------------------------------------------------
  modello(f: FiltroStorico): ModelloStorico {
    if (!f.cliente_id) throw new AppError('VALIDAZIONE', 'Seleziona il cliente.');
    if (!f.da || !f.a || f.da > f.a) throw new AppError('VALIDAZIONE', 'Periodo non valido.');
    const now = this.db.now();
    const presenze = this.db.where('presenze', (p) => p.data_lavoro >= f.da && p.data_lavoro <= f.a);
    const cache = new Map<string, Map<string, number>>();
    const msAttivita = (a: AttivitaLavoro): number => {
      if (!cache.has(a.presenza_id)) {
        const p = this.db.get('presenze', a.presenza_id);
        const m = new Map<string, number>();
        if (p) {
          const rie = calcolaDaRecord(p, this.db.where('pause_presenza', (x) => x.presenza_id === p.id), this.db.where('attivita_lavoro', (x) => x.presenza_id === p.id), now);
          for (const d of rie.attivita) m.set(d.id, d.effettiva_ms);
        }
        cache.set(a.presenza_id, m);
      }
      return cache.get(a.presenza_id)!.get(a.id) ?? 0;
    };
    const dataPresenza = new Map(presenze.map((p) => [p.id, p]));
    const rapporti = this.report.rapportini((r) => r.cliente_id === f.cliente_id && r.data_lavoro >= f.da && r.data_lavoro <= f.a && r.stato !== 'bozza' && r.stato !== 'annullato' && (!f.sede_id || r.sede_id === f.sede_id));
    const rapportoDi = new Map<string, string>();
    for (const r of this.report.rapportini((r) => r.stato !== 'bozza' && r.stato !== 'annullato')) for (const id of r.attivita_ids) if (!rapportoDi.has(id)) rapportoDi.set(id, r.id);
    const attivita = this.db
      .where('attivita_lavoro', (a) => dataPresenza.has(a.presenza_id) && !a.superata_da_id && !a.annullata && a.cliente_id === f.cliente_id && (a.tipo === 'lavoro_cliente' || a.tipo === 'trasferimento') && (!f.sede_id || a.sede_id === f.sede_id))
      .sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));

    const giorni = new Map<string, GiornoStorico>();
    const giorno = (data: string) => {
      if (!giorni.has(data)) {
        const chiave = chiaveGiornata(f.cliente_id, data);
        giorni.set(data, { data, chiave, stato: this.statoDi('giornata', chiave), attivita: [], rapporti: [] });
      }
      return giorni.get(data)!;
    };
    const statoRapporto = new Map(rapporti.map((r) => [r.id, this.statoDi('rapportino', r.id)]));
    for (const r of rapporti) {
      const g = giorno(r.data_lavoro);
      g.rapporti.push({ rapportino: r, ms: 0, stato: statoRapporto.get(r.id)!, incluso: false });
    }
    for (const a of attivita) {
      const p = dataPresenza.get(a.presenza_id)!;
      const g = giorno(p.data_lavoro);
      const rid = rapportoDi.get(a.id) ?? null;
      const stato = this.statoDi('attivita', a.id);
      const statoRap = rid ? (statoRapporto.get(rid) ?? this.statoDi('rapportino', rid)) : 'incluso';
      g.attivita.push({ attivita: a, data: p.data_lavoro, operaio_id: a.operaio_id, ms: msAttivita(a), rapportino_id: rid, stato, inclusa: stato === 'incluso' && g.stato === 'incluso' && statoRap === 'incluso' });
    }
    for (const g of giorni.values()) {
      for (const rs of g.rapporti) {
        rs.incluso = rs.stato === 'incluso' && g.stato === 'incluso';
        // Ore del rapporto: attività collegate (motore ore); nel riepilogo amministrativo solo quelle incluse.
        rs.ms = rs.rapportino.attivita_ids.reduce((tot, id) => {
          const a = this.db.get('attivita_lavoro', id);
          return a && !a.superata_da_id && !a.annullata && !a.deleted_at ? tot + msAttivita(a) : tot;
        }, 0);
      }
    }
    const lista = [...giorni.values()].sort((a, b) => a.data.localeCompare(b.data));
    return { filtro: f, giorni: lista, totaliOperativo: this.totali(lista, false), totaliAmministrativo: this.totali(lista, true) };
  }

  private totali(giorni: GiornoStorico[], soloInclusi: boolean): Totali {
    const att = giorni.flatMap((g) => g.attivita).filter((a) => !soloInclusi || a.inclusa);
    const rap = giorni.flatMap((g) => g.rapporti).filter((r) => !soloInclusi || r.incluso);
    const mat = new Map<string, MaterialeTotale>();
    for (const r of rap) {
      for (const m of r.rapportino.materiali) {
        const k = `${m.descrizione.trim().toLowerCase()}|${m.unita}`;
        const x = mat.get(k) ?? { descrizione: m.descrizione.trim(), unita: m.unita, quantita: 0 };
        x.quantita = Math.round((x.quantita + m.quantita) * 1000) / 1000;
        mat.set(k, x);
      }
    }
    const giornate = new Set([...att.map((a) => a.data), ...rap.map((r) => r.rapportino.data_lavoro)]);
    return {
      ms: att.reduce((t, a) => t + a.ms, 0),
      rapporti: rap.length,
      attivita: att.length,
      giornate: giornate.size,
      materiali: [...mat.values()].sort((a, b) => a.descrizione.localeCompare(b.descrizione)),
    };
  }

  // --- documenti ------------------------------------------------------------------------
  /** Documento (anteprima o esportazione). Senza `codice` è un'anteprima, non registrata. */
  documento(tipo: TipoRiepilogo, f: FiltroStorico, codice?: string): ReportDoc {
    richiediAdmin(this.ctx);
    const m = this.modello(f);
    const amm = tipo === 'amministrativo';
    const tot = amm ? m.totaliAmministrativo : m.totaliOperativo;
    const u = this.ctx.utente();
    const cliente = this.db.get('clienti', f.cliente_id);
    const sede = f.sede_id ? this.db.get('sedi_cliente', f.sede_id) : undefined;
    const nomeOp = (id: string) => nomeProfilo(this.db, id);
    const nomeSede = (id: string | null) => (id ? (this.db.get('sedi_cliente', id)?.nome ?? '—') : '—');
    const ora = (iso: string | null) => (iso ? new Date(toMs(iso)).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—');
    const ET: Record<StatoElemento, string> = { incluso: 'Incluso', escluso: 'Escluso', archiviato: 'Archiviato' };
    const statoVisibile = (proprio: StatoElemento, giorno: StatoElemento, incluso: boolean) => (incluso ? 'Incluso' : proprio !== 'incluso' ? ET[proprio] : giorno !== 'incluso' ? `Giornata ${ET[giorno].toLowerCase()}` : 'Escluso (rapporto)');

    const colStato: Colonna[] = amm ? [] : [{ chiave: 'stato', titolo: 'Stato amministrativo', tipo: 'testo' }];
    const rapporti = m.giorni.flatMap((g) => g.rapporti.map((r) => ({ g, r }))).filter(({ r }) => !amm || r.incluso);
    const attivita = m.giorni.flatMap((g) => g.attivita.map((a) => ({ g, a }))).filter(({ a }) => !amm || a.inclusa);
    const tabelle: TabellaReport[] = [
      {
        id: 'rapporti',
        titolo: 'Rapporti di lavoro',
        colonne: [
          { chiave: 'data', titolo: 'Data', tipo: 'data' },
          { chiave: 'numero', titolo: 'Numero', tipo: 'testo' },
          { chiave: 'sede', titolo: 'Sede / indirizzo', tipo: 'testo' },
          { chiave: 'descrizione', titolo: 'Lavoro svolto', tipo: 'testo' },
          { chiave: 'operai', titolo: 'Operai', tipo: 'testo' },
          ...colStato,
        ],
        righe: rapporti.map(({ g, r }) => ({
          data: r.rapportino.data_lavoro,
          numero: r.rapportino.numero ?? r.rapportino.numero_provvisorio,
          sede: r.rapportino.sede_id ? nomeSede(r.rapportino.sede_id) : r.rapportino.indirizzo_intervento || '—',
          descrizione: r.rapportino.descrizione_lavoro,
          operai: r.rapportino.operai_ids.map(nomeOp).join(', '),
          ...(amm ? {} : { stato: statoVisibile(r.stato, g.stato, r.incluso) }),
        })),
      },
      {
        id: 'ore',
        titolo: 'Dettaglio delle ore',
        nota: amm ? 'Solo le attività incluse nel documento per la fatturazione.' : 'Tutte le attività registrate, comprese quelle escluse dai documenti amministrativi.',
        colonne: [
          { chiave: 'data', titolo: 'Data', tipo: 'data' },
          { chiave: 'operaio', titolo: 'Operaio', tipo: 'testo' },
          { chiave: 'tipo', titolo: 'Attività', tipo: 'testo' },
          { chiave: 'dalle', titolo: 'Dalle', tipo: 'testo' },
          { chiave: 'alle', titolo: 'Alle', tipo: 'testo' },
          ...colStato,
          { chiave: 'ore', titolo: 'Ore', tipo: 'durata' },
        ],
        righe: attivita.map(({ g, a }) => ({
          data: a.data,
          operaio: nomeOp(a.operaio_id),
          tipo: a.attivita.tipo === 'trasferimento' ? 'Viaggio' : 'Lavoro',
          dalle: ora(a.attivita.inizio_at),
          alle: ora(a.attivita.fine_at),
          ...(amm ? {} : { stato: statoVisibile(a.stato, g.stato, a.inclusa) }),
          ore: a.ms,
        })),
        totale: { data: 'Totale', ore: attivita.reduce((t, x) => t + x.a.ms, 0) },
      },
      {
        id: 'materiali',
        titolo: 'Materiali',
        colonne: [
          { chiave: 'descrizione', titolo: 'Materiale', tipo: 'testo' },
          { chiave: 'unita', titolo: 'Unità', tipo: 'testo' },
          { chiave: 'quantita', titolo: 'Quantità', tipo: 'quantita' },
        ],
        righe: tot.materiali.map((x) => ({ descrizione: x.descrizione, unita: x.unita, quantita: x.quantita })),
      },
    ];
    if (!amm) {
      // Presenze e interventi del periodo presso il cliente: rappresentazione completa del lavoro.
      const presIds = new Set(attivita.map(({ a }) => a.attivita.presenza_id));
      tabelle.push({
        id: 'presenze',
        titolo: 'Presenze delle giornate',
        colonne: [
          { chiave: 'data', titolo: 'Data', tipo: 'data' },
          { chiave: 'operaio', titolo: 'Operaio', tipo: 'testo' },
          { chiave: 'entrata', titolo: 'Entrata', tipo: 'testo' },
          { chiave: 'uscita', titolo: 'Uscita', tipo: 'testo' },
        ],
        righe: [...presIds].map((id) => this.db.get('presenze', id)!).filter(Boolean).sort((a, b) => a.entrata_at.localeCompare(b.entrata_at)).map((p) => ({ data: p.data_lavoro, operaio: nomeOp(p.operaio_id), entrata: ora(p.entrata_at), uscita: ora(p.uscita_at) })),
      });
      const interventi = this.db.where('interventi', (i) => i.cliente_id === f.cliente_id && !!i.data_programmata && i.data_programmata >= f.da && i.data_programmata <= f.a && (!f.sede_id || i.sede_id === f.sede_id));
      tabelle.push({
        id: 'interventi',
        titolo: 'Interventi programmati',
        colonne: [
          { chiave: 'data', titolo: 'Data', tipo: 'data' },
          { chiave: 'codice', titolo: 'Codice', tipo: 'testo' },
          { chiave: 'titolo', titolo: 'Intervento', tipo: 'testo' },
          { chiave: 'stato', titolo: 'Stato', tipo: 'testo' },
        ],
        righe: interventi.sort((a, b) => (a.data_programmata ?? '').localeCompare(b.data_programmata ?? '')).map((i) => ({ data: i.data_programmata, codice: i.codice, titolo: i.titolo, stato: i.stato })),
      });
    }
    const esclusi = m.totaliOperativo.attivita - m.totaliAmministrativo.attivita + (m.totaliOperativo.rapporti - m.totaliAmministrativo.rapporti);
    return {
      id: amm ? 'fatturazione' : 'operativo',
      codiceDocumento: codice ?? `ANTEPRIMA-${amm ? 'AMM' : 'OPE'}`,
      titolo: amm ? 'Riepilogo amministrativo per fatturazione' : 'Riepilogo operativo completo',
      filtri: [
        ['Documento', amm ? 'Riepilogo amministrativo per fatturazione' : 'Riepilogo operativo completo (uso interno)'],
        ['Cliente', cliente?.ragione_sociale ?? '—'],
        ['Sede', sede ? `${sede.nome}${sede.indirizzo ? ` – ${sede.indirizzo}` : ''}` : 'Tutte le sedi'],
        ['Periodo', `${f.da} – ${f.a}`],
        ['Codice', codice ?? 'Anteprima (non registrata)'],
      ],
      periodo: { da: f.da, a: f.a },
      generatoIl: this.db.now(),
      generatoDa: u ? `${u.nome} ${u.cognome}` : '',
      indicatori: [
        { etichetta: 'Ore', valore: tot.ms, tipo: 'durata' },
        { etichetta: 'Rapporti', valore: tot.rapporti, tipo: 'intero' },
        { etichetta: 'Giornate', valore: tot.giornate, tipo: 'intero' },
        { etichetta: 'Righe materiali', valore: tot.materiali.length, tipo: 'intero' },
      ],
      tabelle,
      avvisi: amm ? [] : [
        'Documento interno: riporta tutto lo storico registrato, compresi gli elementi esclusi o archiviati dai documenti amministrativi.',
        ...(esclusi > 0 ? [`Elementi non inclusi nel riepilogo per fatturazione: ${esclusi}. Ore escluse: ${Math.round((m.totaliOperativo.ms - m.totaliAmministrativo.ms) / 60_000)} minuti.`] : []),
      ],
    };
  }

  /** Registra una nuova esportazione (codice e data nuovi) e restituisce il documento da stampare. */
  async esporta(tipo: TipoRiepilogo, f: FiltroStorico): Promise<{ doc: ReportDoc; esportazione: Esportazione }> {
    const admin = richiediAdmin(this.ctx);
    const m = this.modello(f);
    const tot = tipo === 'amministrativo' ? m.totaliAmministrativo : m.totaliOperativo;
    const now = this.db.now();
    const d = new Date(now);
    const pad = (n: number) => String(n).padStart(2, '0');
    const codice = `${tipo === 'amministrativo' ? 'AMM' : 'OPE'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${uuid().slice(0, 4).toUpperCase()}`;
    const doc = this.documento(tipo, f, codice);
    const att = m.giorni.flatMap((g) => g.attivita).filter((a) => tipo === 'operativo' || a.inclusa);
    const rap = m.giorni.flatMap((g) => g.rapporti).filter((r) => tipo === 'operativo' || r.incluso);
    const uow = this.db.unitOfWork(admin.id);
    const esportazione = uow.save('esportazioni', {
      ...nuovoBase(this.ctx, uuid()),
      codice,
      tipo,
      cliente_id: f.cliente_id,
      sede_id: f.sede_id ?? null,
      da: f.da,
      a: f.a,
      generato_at: new Date(now).toISOString(),
      generato_da: admin.id,
      ore_ms: tot.ms,
      rapporti: tot.rapporti,
      attivita: tot.attivita,
      righe_materiali: tot.materiali.length,
      rapporti_ids: rap.map((r) => r.rapportino.id),
      attivita_ids: att.map((a) => a.attivita.id),
    });
    await uow.commit();
    return { doc, esportazione };
  }

  esportazioni(): Esportazione[] {
    return this.db.all('esportazioni').sort((a, b) => b.generato_at.localeCompare(a.generato_at));
  }
}
