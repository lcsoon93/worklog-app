/**
 * Servizio giornata lavorativa: presenza (entrata/uscita), pause, timer attività,
 * correzioni e recupero dopo chiusure anomale. Specifica: docs/06 e docs/02.
 *
 * Il timer NON è un contatore: ogni avvio/arresto salva un timestamp. La durata mostrata
 * è sempre ricalcolata come (fine ?? adesso) - inizio, quindi sopravvive a chiusura del
 * browser, spegnimento del dispositivo e ricarica della pagina.
 */
import { uuid } from '../domain/ids';
import {
  attivitaEffettive,
  calcolaDaRecord,
  ErroreValidazione,
  pianificaCorrezione,
  pianificaDivisione,
  validaIntervalloAttivita,
  type ModificaAttivita,
} from '../domain/day-records';
import type { RiepilogoGiornata } from '../domain/hours-engine';
import { statoPresenza } from '../domain/stato-presenza';
import { localDate, toIso, toMs } from '../domain/time';
import type { AttivitaLavoro, PausaPresenza, PausaTipo, Presenza } from '../domain/types';
import { nuovoBase, richiediUtente, verificaMeseModificabile, type ServiceContext } from './base';
import { AppError, nonTrovato } from '../shared/errors';

export type Destinazione = Pick<
  AttivitaLavoro,
  'tipo' | 'cliente_id' | 'sede_id' | 'intervento_id' | 'codice_interno' | 'descrizione'
>;

const TOLLERANZA_FUTURO_MS = 60_000;
const INTERVALLO_SEGNALE_MS = 5 * 60_000;

function v<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroreValidazione) throw new AppError('VALIDAZIONE', e.message);
    throw e;
  }
}

export class WorkdayService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  // --- letture -----------------------------------------------------------------------
  presenzaAperta(operaioId: string): Presenza | undefined {
    return this.db
      .where('presenze', (p) => p.operaio_id === operaioId && p.uscita_at === null)
      .sort((a, b) => b.entrata_at.localeCompare(a.entrata_at))[0];
  }

  presenzeDelGiorno(operaioId: string, data: string): Presenza[] {
    return this.db
      .where('presenze', (p) => p.operaio_id === operaioId && p.data_lavoro === data)
      .sort((a, b) => a.entrata_at.localeCompare(b.entrata_at));
  }

  pause(presenzaId: string): PausaPresenza[] {
    return this.db.where('pause_presenza', (p) => p.presenza_id === presenzaId).sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
  }

  pausaInCorso(presenzaId: string): PausaPresenza | undefined {
    return this.pause(presenzaId).find((p) => p.fine_at === null);
  }

  /** Tutte le attività della presenza, comprese quelle sostituite (per lo storico). */
  tutteLeAttivita(presenzaId: string): AttivitaLavoro[] {
    return this.db.where('attivita_lavoro', (a) => a.presenza_id === presenzaId).sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
  }

  attivita(presenzaId: string): AttivitaLavoro[] {
    return attivitaEffettive(this.tutteLeAttivita(presenzaId));
  }

  attivitaInCorso(presenzaId: string): AttivitaLavoro | undefined {
    return this.attivita(presenzaId).find((a) => a.fine_at === null);
  }

  /** Ultima attività fermata della presenza aperta, se il timer è fermo: proposta per "Riprendi". */
  ultimaRiprendibile(presenzaId: string): AttivitaLavoro | undefined {
    if (this.attivitaInCorso(presenzaId) || this.pausaInCorso(presenzaId)) return undefined;
    return this.attivita(presenzaId)
      .filter((a) => a.fine_at)
      .sort((a, b) => (b.fine_at ?? '').localeCompare(a.fine_at ?? ''))[0];
  }

  riepilogo(presenzaId: string, now = this.db.now()): RiepilogoGiornata {
    const p = this.db.get('presenze', presenzaId);
    if (!p) throw nonTrovato('Presenza');
    return calcolaDaRecord(p, this.pause(presenzaId), this.tutteLeAttivita(presenzaId), now);
  }

  /** Presenza di un giorno precedente rimasta aperta (browser chiuso, dispositivo spento, dimenticanza). */
  giornataNonChiusa(operaioId: string): { presenza: Presenza; uscitaProposta: string } | undefined {
    const p = this.presenzaAperta(operaioId);
    if (!p) return undefined;
    if (statoPresenza(p, this.db.now()) !== 'non_chiusa') return undefined;
    return { presenza: p, uscitaProposta: this.uscitaProposta(p) };
  }

  /** Ultimo istante noto di attività: segnale dell'app, inizio/fine di attività e pause. */
  uscitaProposta(p: Presenza): string {
    const istanti = [toMs(p.entrata_at), toMs(p.ultimo_segnale_at)];
    for (const a of this.tutteLeAttivita(p.id)) {
      istanti.push(toMs(a.inizio_at));
      if (a.fine_at) istanti.push(toMs(a.fine_at));
    }
    for (const x of this.pause(p.id)) {
      istanti.push(toMs(x.inizio_at));
      if (x.fine_at) istanti.push(toMs(x.fine_at));
    }
    return toIso(Math.max(...istanti));
  }

  // --- presenza ----------------------------------------------------------------------
  async registraEntrata(at?: number): Promise<Presenza> {
    const u = richiediUtente(this.ctx);
    const now = this.db.now();
    const t = at ?? now;
    if (t > now + TOLLERANZA_FUTURO_MS) throw new AppError('VALIDAZIONE', "L'entrata non può essere nel futuro.");
    if (this.presenzaAperta(u.id)) throw new AppError('STATO_NON_VALIDO', 'Hai già una giornata aperta: registra prima l\'uscita.');
    const data = localDate(t);
    verificaMeseModificabile(this.ctx, u.id, data);
    const ultima = this.db
      .where('presenze', (p) => p.operaio_id === u.id && p.uscita_at !== null)
      .sort((a, b) => b.uscita_at!.localeCompare(a.uscita_at!))[0];
    if (ultima && toMs(ultima.uscita_at!) > t) {
      throw new AppError('VALIDAZIONE', "L'entrata non può precedere l'uscita della presenza precedente.");
    }
    const iso = toIso(t);
    const presenza: Presenza = {
      ...nuovoBase(this.ctx, uuid()),
      operaio_id: u.id,
      data_lavoro: data,
      entrata_at: iso,
      uscita_at: null,
      entrata_registrata_at: iso,
      uscita_registrata_at: null,
      ultimo_segnale_at: iso,
      uscita_automatica: false,
      note: '',
    };
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('presenze', presenza, { audit: 'crea' });
    await uow.commit();
    return saved;
  }

  async registraUscita(presenzaId: string, at?: number, opts: { motivo?: string } = {}): Promise<Presenza> {
    const u = richiediUtente(this.ctx);
    const p = this.db.get('presenze', presenzaId);
    if (!p) throw nonTrovato('Presenza');
    if (p.uscita_at) throw new AppError('STATO_NON_VALIDO', 'Uscita già registrata.');
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    const now = this.db.now();
    const t = at ?? now;
    if (t > now + TOLLERANZA_FUTURO_MS) throw new AppError('VALIDAZIONE', "L'uscita non può essere nel futuro.");
    if (t <= toMs(p.entrata_at)) throw new AppError('VALIDAZIONE', "L'uscita deve essere successiva all'entrata.");
    const iso = toIso(t);
    if (this.attivita(p.id).some((a) => a.fine_at && toMs(a.fine_at) > t) || this.pause(p.id).some((x) => x.fine_at && toMs(x.fine_at) > t)) {
      throw new AppError('VALIDAZIONE', "Ci sono attività o pause che terminano dopo l'uscita indicata.");
    }
    const uow = this.db.unitOfWork(u.id);

    const inCorso = this.attivitaInCorso(p.id);
    if (inCorso) {
      if (toMs(inCorso.inizio_at) >= t) {
        throw new AppError('VALIDAZIONE', "C'è un'attività iniziata dopo l'orario di uscita indicato: correggila prima.");
      }
      uow.save('attivita_lavoro', { ...inCorso, fine_at: iso, chiusura_automatica: true }, { motivo: "Timer chiuso all'uscita" });
    }
    const pausa = this.pausaInCorso(p.id);
    if (pausa) {
      if (toMs(pausa.inizio_at) >= t) throw new AppError('VALIDAZIONE', "C'è una pausa iniziata dopo l'orario di uscita indicato.");
      uow.save('pause_presenza', { ...pausa, fine_at: iso }, { motivo: "Pausa chiusa all'uscita" });
    }
    const manuale = at !== undefined && Math.abs(at - now) > TOLLERANZA_FUTURO_MS;
    const saved = uow.save(
      'presenze',
      { ...p, uscita_at: iso, uscita_registrata_at: iso, uscita_automatica: manuale, ultimo_segnale_at: toIso(now) },
      { audit: 'modifica', motivo: opts.motivo ?? (manuale ? 'Uscita indicata manualmente' : '') },
    );
    await uow.commit();
    return saved;
  }

  /** Correzione di entrata/uscita: il valore registrato in origine resta nei campi *_registrata_at e nell'audit. */
  async correggiPresenza(presenzaId: string, modifica: { entrata_at?: string; uscita_at?: string }, motivo: string): Promise<void> {
    const u = richiediUtente(this.ctx);
    const p = this.db.get('presenze', presenzaId);
    if (!p) throw nonTrovato('Presenza');
    if (!motivo.trim()) throw new AppError('VALIDAZIONE', 'Indica il motivo della correzione.');
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    const entrata = modifica.entrata_at ?? p.entrata_at;
    const uscita = modifica.uscita_at ?? p.uscita_at;
    if (uscita && toMs(uscita) <= toMs(entrata)) throw new AppError('VALIDAZIONE', "L'uscita deve essere successiva all'entrata.");
    if (localDate(toMs(entrata)) !== p.data_lavoro) {
      throw new AppError('VALIDAZIONE', "L'entrata corretta deve restare nello stesso giorno lavorativo.");
    }
    const limiteInizio = toMs(entrata);
    const limiteFine = uscita ? toMs(uscita) : this.db.now();
    for (const a of this.attivita(p.id)) {
      if (toMs(a.inizio_at) < limiteInizio || (a.fine_at && toMs(a.fine_at) > limiteFine)) {
        throw new AppError('VALIDAZIONE', 'Alcune attività cadrebbero fuori dalla presenza: correggi prima le attività.');
      }
    }
    const uow = this.db.unitOfWork(u.id);
    uow.save('presenze', { ...p, entrata_at: entrata, uscita_at: uscita }, { audit: 'correzione', motivo: motivo.trim() });
    await uow.commit();
  }

  /** Aggiorna l'ultimo segnale di vita (al massimo ogni 5 minuti per non saturare la coda). */
  async segnale(presenzaId: string): Promise<void> {
    const p = this.db.get('presenze', presenzaId);
    if (!p || p.uscita_at) return;
    const now = this.db.now();
    if (now - toMs(p.ultimo_segnale_at) < INTERVALLO_SEGNALE_MS) return;
    const uow = this.db.unitOfWork(this.ctx.utente()?.id ?? null);
    uow.save('presenze', { ...p, ultimo_segnale_at: toIso(now) }, { motivo: 'Segnale di attività' });
    await uow.commit();
  }

  // --- pause -------------------------------------------------------------------------
  async iniziaPausa(presenzaId: string, tipo: PausaTipo): Promise<PausaPresenza> {
    const u = richiediUtente(this.ctx);
    const p = this.richiediPresenzaAperta(presenzaId);
    if (this.pausaInCorso(p.id)) throw new AppError('STATO_NON_VALIDO', 'C\'è già una pausa in corso.');
    const iso = this.db.nowIso();
    const uow = this.db.unitOfWork(u.id);
    const inCorso = this.attivitaInCorso(p.id);
    if (inCorso) {
      // L'attività viene sospesa: si chiude l'intervallo all'inizio della pausa.
      uow.save('attivita_lavoro', { ...inCorso, fine_at: iso }, { motivo: 'Sospesa per pausa' });
    }
    const pausa = uow.save('pause_presenza', {
      ...nuovoBase(this.ctx, uuid()),
      presenza_id: p.id,
      operaio_id: p.operaio_id,
      tipo,
      inizio_at: iso,
      fine_at: null,
      attivita_sospesa_id: inCorso?.id ?? null,
    });
    await uow.commit();
    return pausa;
  }

  async terminaPausa(presenzaId: string): Promise<{ pausa: PausaPresenza; daRiprendere: AttivitaLavoro | undefined }> {
    const u = richiediUtente(this.ctx);
    const p = this.richiediPresenzaAperta(presenzaId);
    const pausa = this.pausaInCorso(p.id);
    if (!pausa) throw new AppError('STATO_NON_VALIDO', 'Nessuna pausa in corso.');
    const uow = this.db.unitOfWork(u.id);
    const chiusa = uow.save('pause_presenza', { ...pausa, fine_at: this.db.nowIso() });
    await uow.commit();
    return { pausa: chiusa, daRiprendere: this.db.get('attivita_lavoro', pausa.attivita_sospesa_id) };
  }

  // --- timer attività ----------------------------------------------------------------
  async avviaAttivita(presenzaId: string, dest: Destinazione): Promise<AttivitaLavoro> {
    const u = richiediUtente(this.ctx);
    const p = this.richiediPresenzaAperta(presenzaId);
    const d = this.normalizzaDestinazione(dest);
    const iso = this.db.nowIso();
    const uow = this.db.unitOfWork(u.id);
    // Avviare un'attività durante una pausa termina la pausa (un solo tocco per ripartire).
    const pausa = this.pausaInCorso(p.id);
    if (pausa) uow.save('pause_presenza', { ...pausa, fine_at: iso }, { motivo: "Pausa terminata dall'avvio di un'attività" });
    // Attività consecutive: la precedente si chiude nello stesso istante in cui parte la nuova.
    const inCorso = this.attivitaInCorso(p.id);
    if (inCorso) uow.save('attivita_lavoro', { ...inCorso, fine_at: iso }, { motivo: 'Cambio attività' });
    const nuova = uow.save('attivita_lavoro', {
      ...nuovoBase(this.ctx, uuid()),
      presenza_id: p.id,
      operaio_id: p.operaio_id,
      ...d,
      inizio_at: iso,
      fine_at: null,
      origine: 'timer',
      sostituisce_id: null,
      superata_da_id: null,
      annullata: false,
      motivo_correzione: '',
      chiusura_automatica: false,
    });
    if (d.intervento_id) {
      const i = this.db.get('interventi', d.intervento_id);
      if (i && i.stato === 'programmato') uow.save('interventi', { ...i, stato: 'in_corso' }, { motivo: 'Avvio lavori' });
    }
    await uow.commit();
    return nuova;
  }

  async fermaAttivita(presenzaId: string): Promise<AttivitaLavoro> {
    const u = richiediUtente(this.ctx);
    const p = this.richiediPresenzaAperta(presenzaId);
    const a = this.attivitaInCorso(p.id);
    if (!a) throw new AppError('STATO_NON_VALIDO', 'Nessun timer attivo.');
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('attivita_lavoro', { ...a, fine_at: this.db.nowIso() });
    await uow.commit();
    return saved;
  }

  async riprendiAttivita(presenzaId: string, attivitaId: string): Promise<AttivitaLavoro> {
    const a = this.db.get('attivita_lavoro', attivitaId);
    if (!a) throw nonTrovato('Attività');
    return this.avviaAttivita(presenzaId, {
      tipo: a.tipo,
      cliente_id: a.cliente_id,
      sede_id: a.sede_id,
      intervento_id: a.intervento_id,
      codice_interno: a.codice_interno,
      descrizione: a.descrizione,
    });
  }

  /** Assegna cliente/tipo al timer IN CORSO (es. avviato senza cliente). Tracciato nell'audit. */
  async classificaInCorso(presenzaId: string, dest: Destinazione): Promise<void> {
    const u = richiediUtente(this.ctx);
    const a = this.attivitaInCorso(presenzaId);
    if (!a) throw new AppError('STATO_NON_VALIDO', 'Nessun timer attivo.');
    const uow = this.db.unitOfWork(u.id);
    uow.save('attivita_lavoro', { ...a, ...this.normalizzaDestinazione(dest) }, { motivo: 'Classificazione timer in corso' });
    await uow.commit();
  }

  // --- correzioni --------------------------------------------------------------------
  async correggiAttivita(attivitaId: string, modifica: ModificaAttivita, motivo: string): Promise<AttivitaLavoro> {
    const u = richiediUtente(this.ctx);
    const a = this.db.get('attivita_lavoro', attivitaId);
    if (!a) throw nonTrovato('Attività');
    const p = this.db.get('presenze', a.presenza_id)!;
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    if (!a.fine_at) throw new AppError('STATO_NON_VALIDO', 'Ferma il timer prima di correggere questa attività.');
    if (modifica.intervento_id) Object.assign(modifica, this.daIntervento(modifica.intervento_id));
    const piano = v(() => pianificaCorrezione(a, modifica, motivo, uuid(), this.db.nowIso()));
    const n = piano.nuove[0];
    v(() =>
      validaIntervalloAttivita(
        toMs(n.inizio_at),
        n.fine_at ? toMs(n.fine_at) : null,
        { entrata: toMs(p.entrata_at), uscita: p.uscita_at ? toMs(p.uscita_at) : null },
        this.attivita(p.id),
        [a.id],
        this.db.now(),
      ),
    );
    const uow = this.db.unitOfWork(u.id);
    uow.save('attivita_lavoro', piano.originale, { audit: 'correzione', motivo });
    const saved = uow.save('attivita_lavoro', n, { audit: 'correzione', motivo });
    await uow.commit();
    return saved;
  }

  async aggiungiAttivita(presenzaId: string, dest: Destinazione, inizio: number, fine: number, motivo: string): Promise<AttivitaLavoro> {
    const u = richiediUtente(this.ctx);
    const p = this.db.get('presenze', presenzaId);
    if (!p) throw nonTrovato('Presenza');
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    if (!motivo.trim()) throw new AppError('VALIDAZIONE', "Indica perché l'intervallo è stato aggiunto a mano.");
    const d = this.normalizzaDestinazione(dest);
    v(() =>
      validaIntervalloAttivita(
        inizio,
        fine,
        { entrata: toMs(p.entrata_at), uscita: p.uscita_at ? toMs(p.uscita_at) : null },
        this.attivita(p.id),
        [],
        this.db.now(),
      ),
    );
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save(
      'attivita_lavoro',
      {
        ...nuovoBase(this.ctx, uuid()),
        presenza_id: p.id,
        operaio_id: p.operaio_id,
        ...d,
        inizio_at: toIso(inizio),
        fine_at: toIso(fine),
        origine: 'manuale',
        sostituisce_id: null,
        superata_da_id: null,
        annullata: false,
        motivo_correzione: motivo.trim(),
        chiusura_automatica: false,
      },
      { audit: 'correzione', motivo },
    );
    await uow.commit();
    return saved;
  }

  async dividiAttivita(attivitaId: string, istante: number, secondaParte: ModificaAttivita, motivo: string): Promise<AttivitaLavoro[]> {
    const u = richiediUtente(this.ctx);
    const a = this.db.get('attivita_lavoro', attivitaId);
    if (!a) throw nonTrovato('Attività');
    const p = this.db.get('presenze', a.presenza_id)!;
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    if (secondaParte.intervento_id) Object.assign(secondaParte, this.daIntervento(secondaParte.intervento_id));
    const piano = v(() => pianificaDivisione(a, istante, secondaParte, motivo, [uuid(), uuid()], this.db.nowIso(), this.db.now()));
    const uow = this.db.unitOfWork(u.id);
    uow.save('attivita_lavoro', piano.originale, { audit: 'correzione', motivo });
    const out = piano.nuove.map((n) => uow.save('attivita_lavoro', n, { audit: 'correzione', motivo }));
    await uow.commit();
    return out;
  }

  async annullaAttivita(attivitaId: string, motivo: string): Promise<void> {
    const u = richiediUtente(this.ctx);
    const a = this.db.get('attivita_lavoro', attivitaId);
    if (!a) throw nonTrovato('Attività');
    const p = this.db.get('presenze', a.presenza_id)!;
    verificaMeseModificabile(this.ctx, p.operaio_id, p.data_lavoro);
    if (!motivo.trim()) throw new AppError('VALIDAZIONE', "Indica il motivo dell'annullamento.");
    const uow = this.db.unitOfWork(u.id);
    uow.save(
      'attivita_lavoro',
      { ...a, annullata: true, fine_at: a.fine_at ?? this.db.nowIso(), motivo_correzione: motivo.trim() },
      { audit: 'correzione', motivo },
    );
    await uow.commit();
  }

  // --- supporto ----------------------------------------------------------------------
  private richiediPresenzaAperta(presenzaId: string): Presenza {
    const p = this.db.get('presenze', presenzaId);
    if (!p) throw nonTrovato('Presenza');
    if (p.uscita_at) throw new AppError('STATO_NON_VALIDO', 'La giornata è già chiusa.');
    return p;
  }

  private daIntervento(interventoId: string): Partial<Destinazione> {
    const i = this.db.get('interventi', interventoId);
    if (!i) throw nonTrovato('Intervento');
    return { cliente_id: i.cliente_id, sede_id: i.sede_id };
  }

  private normalizzaDestinazione(dest: Destinazione): Destinazione {
    const d: Destinazione = { ...dest, descrizione: dest.descrizione ?? '' };
    if (d.intervento_id) Object.assign(d, this.daIntervento(d.intervento_id));
    if (d.tipo === 'lavoro_cliente' && !d.cliente_id) throw new AppError('VALIDAZIONE', 'Seleziona il cliente.');
    if (d.tipo === 'interna') {
      if (!d.codice_interno) throw new AppError('VALIDAZIONE', "Seleziona il tipo di attività interna.");
      d.cliente_id = null;
      d.sede_id = null;
      d.intervento_id = null;
    } else {
      d.codice_interno = null;
    }
    if (d.tipo === 'da_definire') {
      d.cliente_id = null;
      d.sede_id = null;
      d.intervento_id = null;
    }
    return d;
  }
}
