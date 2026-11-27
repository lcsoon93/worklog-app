/**
 * Rapportini, imprevisti, allegati e ritorni (followup).
 *
 * - Un rapportino può essere autonomo o collegato a un intervento.
 * - La bozza resta SOLO sul dispositivo (stato sync "locale"); viene accodata alla
 *   sincronizzazione quando l'operaio la completa.
 * - Esito "da ultimare" o "ritorno necessario" genera un followup collegato al rapportino
 *   e all'intervento di origine; il ritorno pianificato diventa un nuovo intervento che
 *   punta al followup, e il rapportino del ritorno chiude il followup.
 * - Le ore di un rapportino NON sono digitate: derivano dalle attività collegate.
 */
import type { UnitOfWork } from '../data/local-db';
import { calcolaDaRecord } from '../domain/day-records';
import { uuid } from '../domain/ids';
import { localDate, toMs } from '../domain/time';
import type {
  Allegato,
  FaseInvio,
  AllegatoTipo,
  Followup,
  Imprevisto,
  Intervento,
  Rapportino,
  RapportinoEsito,
} from '../domain/types';
import { nuovoBase, richiediAdmin, richiediGestioneOperativa, richiediUtente, type ServiceContext } from './base';
import { AppError, nonTrovato } from '../shared/errors';
import { MagazzinoService } from './magazzino-service';
import { WorkdayService } from './workday-service';

export interface NuovoRapportino {
  tipo: Rapportino['tipo'];
  cliente_id: string;
  sede_id: string | null;
  intervento_id: string | null;
  followup_id?: string | null;
  data_lavoro?: string;
  /** Fase 12: richiesta ricevuta e indirizzo del lavoro (rapporto autonomo). */
  richiesta?: string;
  indirizzo_intervento?: string;
}

export class ReportService {
  constructor(
    private readonly ctx: ServiceContext,
    /** Fase 5: scarico dei materiali al completamento del rapportino. */
    private readonly magazzino: MagazzinoService = new MagazzinoService(ctx),
  ) {}

  private get db() {
    return this.ctx.db;
  }

  // --- rapportini --------------------------------------------------------------------
  rapportini(filtro: (r: Rapportino) => boolean = () => true): Rapportino[] {
    return this.db.where('rapportini', filtro).sort((a, b) => b.data_lavoro.localeCompare(a.data_lavoro) || b.created_at.localeCompare(a.created_at));
  }

  /**
   * Attività dello stesso giorno compatibili con il rapportino (stesso intervento o cliente).
   * Fase 12: sono escluse le attività già collegate a un ALTRO rapportino, così le stesse ore
   * non vengono contate due volte (es. due rapporti autonomi per lo stesso cliente nello stesso giorno).
   */
  attivitaSuggerite(r: Pick<Rapportino, 'data_lavoro' | 'cliente_id' | 'intervento_id' | 'operai_ids'> & { id?: string }) {
    const presenze = this.db.where('presenze', (p) => p.data_lavoro === r.data_lavoro && r.operai_ids.includes(p.operaio_id));
    const ids = new Set(presenze.map((p) => p.id));
    const giaCollegate = this.attivitaCollegateAltrove(r.id);
    return this.db
      .where(
        'attivita_lavoro',
        (a) =>
          ids.has(a.presenza_id) &&
          !a.superata_da_id &&
          !a.annullata &&
          !giaCollegate.has(a.id) &&
          (r.intervento_id ? a.intervento_id === r.intervento_id : a.cliente_id === r.cliente_id),
      )
      .sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
  }

  /** Attività collegate a rapportini diversi da quello indicato (esclusi gli annullati). */
  private attivitaCollegateAltrove(rapportinoId?: string): Set<string> {
    const out = new Set<string>();
    for (const x of this.db.where('rapportini', (x) => x.id !== rapportinoId && x.stato !== 'annullato')) for (const id of x.attivita_ids) out.add(id);
    return out;
  }

  /** Ore del rapportino: parte effettiva (motore ore) delle attività collegate. */
  oreRapportino(r: Rapportino): number {
    let tot = 0;
    const perPresenza = new Map<string, string[]>();
    for (const id of r.attivita_ids) {
      const a = this.db.get('attivita_lavoro', id);
      if (!a || a.superata_da_id || a.annullata) continue;
      perPresenza.set(a.presenza_id, [...(perPresenza.get(a.presenza_id) ?? []), id]);
    }
    for (const [pid, ids] of perPresenza) {
      const p = this.db.get('presenze', pid);
      if (!p) continue;
      const rie = calcolaDaRecord(
        p,
        this.db.where('pause_presenza', (x) => x.presenza_id === pid),
        this.db.where('attivita_lavoro', (x) => x.presenza_id === pid),
        this.db.now(),
      );
      for (const d of rie.attivita) if (ids.includes(d.id)) tot += d.effettiva_ms;
    }
    return tot;
  }

  async creaBozza(input: NuovoRapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    if (!input.cliente_id) throw new AppError('VALIDAZIONE', 'Seleziona il cliente.');
    const seq = (this.db.meta<number>('seq_rapportini') ?? 0) + 1;
    await this.db.setMeta('seq_rapportini', seq);
    let operai = [u.id];
    if (input.intervento_id) {
      const assegnati = this.db.where('intervento_operai', (x) => x.intervento_id === input.intervento_id).map((x) => x.operaio_id);
      if (assegnati.includes(u.id)) operai = [u.id, ...assegnati.filter((x) => x !== u.id)];
    }
    const data = input.data_lavoro ?? localDate(this.db.now());
    const base: Rapportino = {
      ...nuovoBase(this.ctx, uuid()),
      numero_provvisorio: `B-${this.db.deviceId.slice(-4).toUpperCase()}-${String(seq).padStart(3, '0')}`,
      numero: null,
      tipo: input.tipo,
      stato: 'bozza',
      data_lavoro: data,
      cliente_id: input.cliente_id,
      sede_id: input.sede_id,
      intervento_id: input.intervento_id,
      followup_id: input.followup_id ?? this.followupDaIntervento(input.intervento_id),
      redatto_da: u.id,
      operai_ids: operai,
      attivita_ids: [],
      descrizione_lavoro: '',
      esito: 'completato',
      note_interne: '',
      materiali: [],
      foto_ids: [],
      firma_cliente_id: null,
      firma_cliente_nome: '',
      firma_operaio_id: null,
      imprevisti_ids: [],
      richiesta: input.richiesta?.trim() ?? '',
      indirizzo_intervento: input.indirizzo_intervento?.trim() ?? '',
      verificato_at: null,
      verificato_da: null,
    };
    base.attivita_ids = this.attivitaSuggerite(base).map((a) => a.id);
    // Imprevisti della giornata sullo stesso intervento/cliente vengono collegati in automatico.
    base.imprevisti_ids = this.db
      .where('imprevisti', (i) => i.operaio_id === u.id && localDate(new Date(i.avvenuto_at).getTime()) === data && (input.intervento_id ? i.intervento_id === input.intervento_id : i.cliente_id === input.cliente_id))
      .map((i) => i.id);
    if (base.imprevisti_ids.some((id) => this.db.get('imprevisti', id)?.richiede_ritorno)) base.esito = 'ritorno_necessario';
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('rapportini', base, { soloLocale: true });
    await uow.commit();
    return saved;
  }

  async salvaBozza(r: Rapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    const cur = this.db.get('rapportini', r.id);
    if (!cur) throw nonTrovato('Rapportino');
    if (cur.stato !== 'bozza') throw new AppError('STATO_NON_VALIDO', 'Il rapportino è già stato completato.');
    // Un rapporto "pronto" resta tale solo se ancora completo; altrimenti torna bozza.
    const fase: FaseInvio = cur.fase_invio === 'pronto' && this.validaCompletamento(r).length === 0 ? 'pronto' : 'bozza';
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('rapportini', { ...r, stato: 'bozza', fase_invio: fase }, { soloLocale: true });
    await uow.commit();
    return saved;
  }

  // --- ore del rapporto: timer o orario manuale (Fase 12) -----------------------------
  // Le ore restano SEMPRE attività della presenza (unica fonte): il rapporto le collega soltanto.
  // Un orario che si sovrappone a un'attività già registrata (es. il timer) viene rifiutato
  // dal motore ore, quindi nessun minuto è contato due volte.

  /** Attività del timer collegata al rapporto e ancora in corso. */
  timerInCorso(r: Rapportino) {
    return r.attivita_ids.map((id) => this.db.get('attivita_lavoro', id)).find((a) => a && !a.fine_at && !a.annullata && !a.superata_da_id);
  }

  /** Avvia il timer sul cliente del rapporto (registra l'entrata se serve) e lo collega. */
  async avviaTimer(r: Rapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    this.richiediBozzaPropria(r, u.id);
    if (r.data_lavoro !== localDate(this.db.now())) throw new AppError('VALIDAZIONE', 'Il timer si usa solo per i rapporti di oggi: inserisci gli orari a mano.');
    const wd = new WorkdayService(this.ctx);
    const p = wd.presenzaAperta(u.id) ?? (await wd.registraEntrata());
    const a = await wd.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: r.cliente_id, sede_id: r.sede_id, intervento_id: r.intervento_id, codice_interno: null, descrizione: r.intervento_id ? '' : 'Intervento autonomo' });
    return this.salvaBozza({ ...r, attivita_ids: [...new Set([...r.attivita_ids, a.id])] });
  }

  async fermaTimer(r: Rapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    this.richiediBozzaPropria(r, u.id);
    const a = this.timerInCorso(r);
    if (!a) throw new AppError('STATO_NON_VALIDO', 'Nessun timer in corso su questo rapporto.');
    await new WorkdayService(this.ctx).fermaAttivita(a.presenza_id);
    return this.salvaBozza(r);
  }

  /**
   * Orario indicato a mano (inizio-fine nel giorno del rapporto): diventa un'attività manuale
   * della presenza che lo contiene. Senza presenza, con `registraEntrata` si registra
   * l'entrata all'orario di inizio (solo per il giorno corrente).
   */
  async aggiungiOrario(r: Rapportino, inizio: number, fine: number, opts: { registraEntrata?: boolean } = {}): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    this.richiediBozzaPropria(r, u.id);
    if (!(fine > inizio)) throw new AppError('VALIDAZIONE', "L'orario di fine deve essere successivo all'inizio.");
    if (localDate(inizio) !== r.data_lavoro) throw new AppError('VALIDAZIONE', 'Gli orari devono essere nel giorno del rapporto.');
    if (fine > this.db.now() + 60_000) throw new AppError('VALIDAZIONE', "L'orario di fine non può essere nel futuro: per il lavoro in corso usa il timer.");
    const wd = new WorkdayService(this.ctx);
    let p = wd.presenzeDelGiorno(u.id, r.data_lavoro).find((x) => toMs(x.entrata_at) <= inizio && (!x.uscita_at || toMs(x.uscita_at) >= fine));
    if (!p) {
      const nessuna = wd.presenzeDelGiorno(u.id, r.data_lavoro).length === 0 && !wd.presenzaAperta(u.id);
      if (nessuna && opts.registraEntrata && r.data_lavoro === localDate(this.db.now())) p = await wd.registraEntrata(inizio);
      else if (nessuna) throw new AppError('SENZA_PRESENZA', "Non hai registrato l'entrata: le ore del rapporto devono stare dentro la presenza.");
      else throw new AppError('VALIDAZIONE', "L'orario è fuori dalla presenza registrata (entrata/uscita): correggi la presenza o gli orari.");
    }
    const a = await wd.aggiungiAttivita(
      p.id,
      { tipo: 'lavoro_cliente', cliente_id: r.cliente_id, sede_id: r.sede_id, intervento_id: r.intervento_id, codice_interno: null, descrizione: r.intervento_id ? '' : 'Intervento autonomo' },
      inizio,
      fine,
      `Orario indicato nel rapporto ${r.numero_provvisorio}`,
    );
    return this.salvaBozza({ ...r, attivita_ids: [...new Set([...r.attivita_ids, a.id])] });
  }

  private richiediBozzaPropria(r: Rapportino, utenteId: string) {
    const cur = this.db.get('rapportini', r.id);
    if (!cur) throw nonTrovato('Rapportino');
    if (cur.stato !== 'bozza' || cur.redatto_da !== utenteId) throw new AppError('STATO_NON_VALIDO', 'Il rapporto non è più modificabile.');
  }

  // --- flusso di invio e approvazione (Fase 13) -----------------------------------------
  /** Fase del rapporto; i rapporti precedenti alla Fase 13 sono ricavati dallo stato. */
  fase(r: Rapportino): FaseInvio {
    if (r.fase_invio) return r.fase_invio;
    if (r.stato === 'bozza') return 'bozza';
    return r.verificato_at ? 'approvato' : 'inviato';
  }

  /** Il redattore può modificare il rapporto (bozza, pronto per l'invio, restituito). */
  modificabileDa(r: Rapportino, utenteId: string): boolean {
    return r.redatto_da === utenteId && r.stato !== 'annullato' && ['bozza', 'pronto', 'da_correggere'].includes(this.fase(r));
  }

  /** Completo ma non ancora inviato: resta sul dispositivo e modificabile. */
  async segnaPronto(r: Rapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    this.richiediBozzaPropria(r, u.id);
    const errori = this.validaCompletamento(r);
    if (errori.length) throw new AppError('VALIDAZIONE', errori.join(' '));
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('rapportini', { ...r, stato: 'bozza', fase_invio: 'pronto' }, { soloLocale: true });
    await uow.commit();
    return saved;
  }

  /** Invio all'amministrazione (equivale al completamento: accoda sincronizzazione e scarichi). */
  invia(r: Rapportino): Promise<Rapportino> {
    return this.completa(r);
  }

  /**
   * Elimina un rapporto non ancora inviato (bozza o pronto). Non è mai arrivato al server:
   * l'eliminazione resta sul dispositivo e le attività collegate non vengono toccate.
   */
  async elimina(rapportinoId: string): Promise<void> {
    const u = richiediUtente(this.ctx);
    const r = this.db.get('rapportini', rapportinoId);
    if (!r) throw nonTrovato('Rapportino');
    if (r.redatto_da !== u.id) throw new AppError('NON_CONSENTITO', 'Puoi eliminare solo i rapporti redatti da te.');
    if (r.stato !== 'bozza') throw new AppError('STATO_NON_VALIDO', "Il rapporto è già stato inviato: non si può eliminare, l'amministrazione può restituirlo per correzioni.");
    const now = this.db.nowIso();
    const uow = this.db.unitOfWork(u.id);
    uow.save('rapportini', { ...r, deleted_at: now }, { soloLocale: true, audit: 'elimina', motivo: 'Rapporto non inviato eliminato dal redattore' });
    for (const id of [...r.foto_ids, r.firma_cliente_id, r.firma_operaio_id]) {
      const a = id ? this.db.get('allegati', id) : undefined;
      if (a) uow.save('allegati', { ...a, deleted_at: now }, { soloLocale: true, audit: 'elimina' });
    }
    await uow.commit();
  }

  /** L'amministratore restituisce un rapporto inviato perché il redattore lo corregga. */
  async restituisci(rapportinoId: string, motivo: string): Promise<Rapportino> {
    const admin = richiediAdmin(this.ctx);
    const r = this.db.get('rapportini', rapportinoId);
    if (!r) throw nonTrovato('Rapportino');
    if (this.fase(r) !== 'inviato') throw new AppError('STATO_NON_VALIDO', 'Si possono restituire solo i rapporti inviati e non ancora approvati.');
    if (motivo.trim().length < 5) throw new AppError('VALIDAZIONE', 'Spiega cosa va corretto.');
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('rapportini', { ...r, fase_invio: 'da_correggere', motivo_restituzione: motivo.trim(), restituito_at: this.db.nowIso(), restituito_da: admin.id }, { audit: 'transizione', motivo: motivo.trim() });
    await uow.commit();
    return saved;
  }

  /** Approvazione dell'amministratore: da qui ogni modifica è solo una correzione tracciata. */
  async approva(rapportinoId: string): Promise<Rapportino> {
    const admin = richiediAdmin(this.ctx);
    const r = this.db.get('rapportini', rapportinoId);
    if (!r) throw nonTrovato('Rapportino');
    if (r.stato === 'bozza' || r.stato === 'annullato') throw new AppError('STATO_NON_VALIDO', 'Si possono approvare solo i rapporti inviati.');
    const fase = this.fase(r);
    if (fase === 'approvato') return r;
    if (fase === 'da_correggere') throw new AppError('STATO_NON_VALIDO', 'Il rapporto è stato restituito: attendi la correzione del redattore.');
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('rapportini', { ...r, fase_invio: 'approvato', verificato_at: this.db.nowIso(), verificato_da: admin.id }, { audit: 'transizione', motivo: 'Rapporto approvato' });
    await uow.commit();
    return saved;
  }

  /** Compatibilità Fase 12: la verifica dell'amministratore è l'approvazione. */
  verifica(rapportinoId: string): Promise<Rapportino> {
    return this.approva(rapportinoId);
  }

  /**
   * Correzione tracciata di un rapporto già inviato: dal redattore se restituito, oppure
   * dall'amministratore (anche se approvato, con motivo). Esito e cliente non cambiano
   * (gli effetti su interventi e ritorni sono già stati applicati); i materiali vengono
   * riallineati con movimenti di correzione, mai cancellando gli scarichi originali.
   */
  async correggi(r: Rapportino, motivo: string): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    const cur = this.db.get('rapportini', r.id);
    if (!cur) throw nonTrovato('Rapportino');
    if (cur.stato === 'bozza' || cur.stato === 'annullato') throw new AppError('STATO_NON_VALIDO', 'Il rapporto non è ancora stato inviato: modificalo direttamente.');
    const fase = this.fase(cur);
    const admin = u.ruolo === 'admin';
    if (!admin && !(cur.redatto_da === u.id && fase === 'da_correggere')) throw new AppError('NON_CONSENTITO', "Il rapporto inviato si corregge solo dopo la restituzione dell'amministrazione.");
    if (motivo.trim().length < 5) throw new AppError('VALIDAZIONE', 'Indica il motivo della correzione.');
    const nuovo: Rapportino = {
      ...cur,
      descrizione_lavoro: r.descrizione_lavoro,
      richiesta: r.richiesta,
      indirizzo_intervento: r.indirizzo_intervento,
      note_interne: r.note_interne,
      materiali: r.materiali,
      foto_ids: r.foto_ids,
      attivita_ids: r.attivita_ids,
      operai_ids: r.operai_ids,
      firma_cliente_id: r.firma_cliente_id,
      firma_cliente_nome: r.firma_cliente_nome,
      firma_operaio_id: r.firma_operaio_id,
      revisione: (cur.revisione ?? 0) + 1,
    };
    const errori = this.validaCompletamento(nuovo);
    if (errori.length) throw new AppError('VALIDAZIONE', errori.join(' '));
    if (!admin) Object.assign(nuovo, { fase_invio: 'inviato' as FaseInvio, inviato_at: this.db.nowIso() });
    if (nuovo.firma_cliente_id && nuovo.stato === 'completato') nuovo.stato = 'firmato';
    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('rapportini', nuovo, { audit: 'correzione', motivo: motivo.trim() });
    this.magazzino.pianificaConsumi(uow, saved);
    for (const id of [...nuovo.foto_ids, nuovo.firma_cliente_id, nuovo.firma_operaio_id]) {
      const a = id ? this.db.get('allegati', id) : undefined;
      if (a && a.upload_stato === 'locale') uow.save('allegati', { ...a, upload_stato: 'in_attesa' });
    }
    await uow.commit();
    return saved;
  }

  /** Rapporti inviati in attesa di approvazione (tutti gli operai). */
  daApprovare(): Rapportino[] {
    return this.rapportini((r) => r.stato !== 'bozza' && r.stato !== 'annullato' && this.fase(r) === 'inviato');
  }

  /** Rapporti autonomi (senza intervento programmato) completati e non ancora verificati. */
  autonomiDaVerificare(): Rapportino[] {
    return this.rapportini((r) => !r.intervento_id && (r.stato === 'completato' || r.stato === 'firmato') && this.fase(r) === 'inviato');
  }

  validaCompletamento(r: Rapportino): string[] {
    const errori: string[] = [];
    if (!r.cliente_id) errori.push('Cliente mancante.');
    if (r.descrizione_lavoro.trim().length < 10) errori.push('Descrivi il lavoro svolto (almeno 10 caratteri).');
    if (r.operai_ids.length === 0) errori.push('Indica almeno un operaio.');
    // Le firme sono facoltative: il rapporto si completa anche senza (richiesta del collaudo su iPhone).
    if (r.firma_cliente_id && !r.firma_cliente_nome.trim()) errori.push('Indica il nome di chi firma.');
    if ((r.esito === 'da_ultimare' || r.esito === 'ritorno_necessario') && r.note_interne.trim().length < 5) {
      errori.push('Spiega cosa resta da fare (note per il ritorno).');
    }
    for (const m of r.materiali) {
      if (!m.descrizione.trim()) errori.push('Materiali: indica la descrizione o scegli un articolo.');
      else if (!(m.quantita > 0)) errori.push(`Materiali: quantità non valida per "${m.descrizione}".`);
    }
    return errori;
  }

  async completa(r: Rapportino): Promise<Rapportino> {
    const u = richiediUtente(this.ctx);
    const cur = this.db.get('rapportini', r.id);
    if (!cur) throw nonTrovato('Rapportino');
    if (cur.stato !== 'bozza') throw new AppError('STATO_NON_VALIDO', 'Il rapportino è già stato completato.');
    const errori = this.validaCompletamento(r);
    if (errori.length) throw new AppError('VALIDAZIONE', errori.join(' '));

    const uow = this.db.unitOfWork(u.id);
    const saved = uow.save('rapportini', { ...r, stato: r.firma_cliente_id ? 'firmato' : 'completato', fase_invio: 'inviato', inviato_at: this.db.nowIso(), revisione: 0 });
    // Scarico di magazzino nella stessa transazione locale, accodato dopo il rapportino (padre).
    this.magazzino.pianificaConsumi(uow, saved);
    // Gli allegati vengono accodati DOPO il rapportino: sul server il record padre esiste già.
    for (const id of [...r.foto_ids, r.firma_cliente_id, r.firma_operaio_id]) {
      const a = id ? this.db.get('allegati', id) : undefined;
      if (a) uow.save('allegati', { ...a, upload_stato: 'in_attesa' });
    }
    for (const id of r.imprevisti_ids) {
      const imp = this.db.get('imprevisti', id);
      if (imp && imp.rapportino_id !== r.id) uow.save('imprevisti', { ...imp, rapportino_id: r.id });
    }
    this.effettiSuInterventoEFollowup(uow, saved);
    await uow.commit();
    return saved;
  }

  private followupDaIntervento(interventoId: string | null): string | null {
    if (!interventoId) return null;
    return this.db.get('interventi', interventoId)?.followup_origine_id ?? null;
  }

  private effettiSuInterventoEFollowup(uow: UnitOfWork, r: Rapportino) {
    const richiedeSeguito = r.esito === 'da_ultimare' || r.esito === 'ritorno_necessario';
    if (r.intervento_id) {
      const i = this.db.get('interventi', r.intervento_id);
      if (i && i.stato !== 'annullato') {
        const stato: Intervento['stato'] = r.esito === 'completato' ? 'completato' : richiedeSeguito ? 'da_ultimare' : i.stato;
        if (stato !== i.stato) uow.save('interventi', { ...i, stato }, { motivo: `Esito rapportino ${r.numero_provvisorio}` });
      }
    }
    if (richiedeSeguito) {
      const f: Followup = {
        ...nuovoBase(this.ctx, uuid()),
        tipo: r.esito === 'da_ultimare' ? 'da_ultimare' : 'ritorno',
        stato: 'aperto',
        rapportino_origine_id: r.id,
        intervento_origine_id: r.intervento_id,
        cliente_id: r.cliente_id,
        sede_id: r.sede_id,
        motivo: r.note_interne.trim(),
        priorita: 'normale',
        data_suggerita: null,
        intervento_ritorno_id: null,
        rapportino_chiusura_id: null,
      };
      uow.save('followup', f);
    }
    if (r.followup_id && r.esito === 'completato') {
      const f = this.db.get('followup', r.followup_id);
      if (f && f.stato !== 'chiuso') uow.save('followup', { ...f, stato: 'chiuso', rapportino_chiusura_id: r.id });
    }
  }

  /** Catena documentale: rapportino → followup → intervento di ritorno → rapportini del ritorno. */
  catena(rapportinoId: string) {
    const r = this.db.get('rapportini', rapportinoId);
    if (!r) return null;
    const origine = r.followup_id ? this.db.get('followup', r.followup_id) : undefined;
    const rapportinoOrigine = origine ? this.db.get('rapportini', origine.rapportino_origine_id) : undefined;
    const generati = this.db.where('followup', (f) => f.rapportino_origine_id === r.id);
    return { rapportino: r, origine, rapportinoOrigine, generati };
  }

  // --- imprevisti --------------------------------------------------------------------
  async registraImprevisto(input: Omit<Imprevisto, keyof ReturnType<typeof nuovoBase> | 'operaio_id' | 'avvenuto_at' | 'rapportino_id'>): Promise<Imprevisto> {
    const u = richiediUtente(this.ctx);
    if (input.descrizione.trim().length < 5) throw new AppError('VALIDAZIONE', "Descrivi l'imprevisto.");
    const uow = this.db.unitOfWork(u.id);
    const imp = uow.save('imprevisti', {
      ...nuovoBase(this.ctx, uuid()),
      ...input,
      cliente_id: input.cliente_id ?? (input.intervento_id ? this.db.get('interventi', input.intervento_id)?.cliente_id ?? null : null),
      operaio_id: u.id,
      avvenuto_at: this.db.nowIso(),
      rapportino_id: null,
    });
    for (const id of input.allegati_ids) {
      const a = this.db.get('allegati', id);
      if (a) uow.save('allegati', { ...a, entita_id: imp.id, upload_stato: 'in_attesa' });
    }
    await uow.commit();
    return imp;
  }

  // --- allegati ----------------------------------------------------------------------
  /** Salva un allegato sul dispositivo. Resta "locale" finché il documento padre non viene completato. */
  async aggiungiAllegato(tipo: AllegatoTipo, entita: Allegato['entita'], entitaId: string, nome: string, mime: string, dataUrl: string): Promise<Allegato> {
    const u = richiediUtente(this.ctx);
    if (dataUrl.length > 6_000_000) throw new AppError('VALIDAZIONE', 'File troppo grande per il prototipo (max ~4 MB).');
    const uow = this.db.unitOfWork(u.id);
    const a = uow.save(
      'allegati',
      {
        ...nuovoBase(this.ctx, uuid()),
        tipo,
        entita,
        entita_id: entitaId,
        nome_file: nome,
        mime,
        dimensione: Math.round((dataUrl.length * 3) / 4),
        data_url: dataUrl,
        storage_path: null,
        upload_stato: 'locale',
      },
      { soloLocale: true },
    );
    await uow.commit();
    return a;
  }

  // --- ritorni -----------------------------------------------------------------------
  followup(filtro: (f: Followup) => boolean = () => true): Followup[] {
    return this.db.where('followup', filtro).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async pianificaRitorno(followupId: string, dati: { data: string; ora: string; durata_min: number; operai: string[]; priorita: Followup['priorita'] }): Promise<Intervento> {
    const admin = richiediGestioneOperativa(this.ctx);
    const f = this.db.get('followup', followupId);
    if (!f) throw nonTrovato('Ritorno');
    if (f.stato !== 'aperto') throw new AppError('STATO_NON_VALIDO', 'Il ritorno è già stato pianificato o chiuso.');
    if (dati.operai.length === 0) throw new AppError('VALIDAZIONE', 'Assegna almeno un operaio.');
    const origine = f.intervento_origine_id ? this.db.get('interventi', f.intervento_origine_id) : undefined;
    const rap = this.db.get('rapportini', f.rapportino_origine_id);
    const seq = (this.db.meta<number>('seq_interventi') ?? 100) + 1;
    await this.db.setMeta('seq_interventi', seq);
    const uow = this.db.unitOfWork(admin.id);
    const intervento = uow.save('interventi', {
      ...nuovoBase(this.ctx, uuid()),
      codice: `INT-${dati.data.slice(0, 4)}-${seq}`,
      cliente_id: f.cliente_id,
      sede_id: f.sede_id,
      titolo: `Ritorno: ${origine?.titolo ?? 'rapportino ' + (rap?.numero ?? rap?.numero_provvisorio ?? '')}`,
      descrizione: f.motivo,
      tipo: 'ritorno',
      priorita: dati.priorita,
      stato: 'programmato',
      data_programmata: dati.data,
      ora_inizio: dati.ora,
      durata_prevista_min: dati.durata_min,
      followup_origine_id: f.id,
      note: '',
    });
    dati.operai.forEach((opId, idx) =>
      uow.save('intervento_operai', {
        ...nuovoBase(this.ctx, uuid()),
        intervento_id: intervento.id,
        operaio_id: opId,
        ruolo: idx === 0 ? 'responsabile' : 'squadra',
      }),
    );
    uow.save('followup', { ...f, stato: 'pianificato', intervento_ritorno_id: intervento.id, priorita: dati.priorita, data_suggerita: dati.data });
    await uow.commit();
    return intervento;
  }

  async annullaFollowup(followupId: string, motivo: string): Promise<void> {
    const admin = richiediGestioneOperativa(this.ctx);
    const f = this.db.get('followup', followupId);
    if (!f) throw nonTrovato('Ritorno');
    if (!motivo.trim()) throw new AppError('VALIDAZIONE', 'Indica il motivo.');
    const uow = this.db.unitOfWork(admin.id);
    uow.save('followup', { ...f, stato: 'annullato' }, { motivo });
    await uow.commit();
  }
}

export const ETICHETTE_FASE: Record<FaseInvio, string> = {
  bozza: 'Bozza',
  pronto: 'Pronto per invio',
  inviato: 'Inviato',
  da_correggere: 'Da correggere',
  approvato: 'Approvato',
};

export const ETICHETTE_ESITO: Record<RapportinoEsito, string> = {
  completato: 'Lavoro completato',
  da_ultimare: 'Da ultimare',
  ritorno_necessario: 'Serve un ritorno',
  non_eseguito: 'Non eseguito',
};
