/**
 * Anagrafiche (operai, clienti, sedi) e programmazione interventi con assegnazione operai.
 */
import { uuid } from '../domain/ids';
import type { Cliente, Intervento, InterventoOperaio, Profilo, SedeCliente } from '../domain/types';
import { nuovoBase, richiediAdmin, type ServiceContext } from './base';
import { AppError, nonTrovato } from './errors';

export type DatiIntervento = Pick<
  Intervento,
  'cliente_id' | 'sede_id' | 'titolo' | 'descrizione' | 'tipo' | 'priorita' | 'data_programmata' | 'ora_inizio' | 'durata_prevista_min' | 'note'
>;

export class PlanningService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  // --- letture -----------------------------------------------------------------------
  operai(): Profilo[] {
    return this.db.where('profili', (p) => p.ruolo === 'operaio').sort((a, b) => a.cognome.localeCompare(b.cognome));
  }
  clienti(): Cliente[] {
    return this.db.all('clienti').sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale));
  }
  sedi(clienteId?: string): SedeCliente[] {
    return this.db.where('sedi_cliente', (s) => !clienteId || s.cliente_id === clienteId).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  assegnati(interventoId: string): InterventoOperaio[] {
    return this.db.where('intervento_operai', (x) => x.intervento_id === interventoId);
  }
  interventiOperaio(operaioId: string, data?: string): Intervento[] {
    const ids = new Set(this.db.where('intervento_operai', (x) => x.operaio_id === operaioId).map((x) => x.intervento_id));
    return this.db
      .where('interventi', (i) => ids.has(i.id) && (!data || i.data_programmata === data) && i.stato !== 'annullato')
      .sort((a, b) => (a.ora_inizio ?? '').localeCompare(b.ora_inizio ?? ''));
  }
  interventiDelGiorno(data: string): Intervento[] {
    return this.db.where('interventi', (i) => i.data_programmata === data && i.stato !== 'annullato').sort((a, b) => (a.ora_inizio ?? '').localeCompare(b.ora_inizio ?? ''));
  }

  /** Operai già impegnati in altri interventi che si sovrappongono all'orario indicato. */
  conflittiAssegnazione(data: string, ora: string, durataMin: number, escludiInterventoId?: string): Map<string, Intervento[]> {
    const [h, m] = ora.split(':').map(Number);
    const inizio = h * 60 + m;
    const fine = inizio + durataMin;
    const out = new Map<string, Intervento[]>();
    for (const i of this.interventiDelGiorno(data)) {
      if (i.id === escludiInterventoId || !i.ora_inizio) continue;
      const [ih, im] = i.ora_inizio.split(':').map(Number);
      const iIn = ih * 60 + im;
      const iFi = iIn + (i.durata_prevista_min ?? 60);
      if (Math.min(fine, iFi) <= Math.max(inizio, iIn)) continue;
      for (const a of this.assegnati(i.id)) out.set(a.operaio_id, [...(out.get(a.operaio_id) ?? []), i]);
    }
    return out;
  }

  // --- interventi --------------------------------------------------------------------
  async creaIntervento(dati: DatiIntervento, operai: string[]): Promise<Intervento> {
    const admin = richiediAdmin(this.ctx);
    this.validaIntervento(dati);
    const seq = (this.db.meta<number>('seq_interventi') ?? 100) + 1;
    await this.db.setMeta('seq_interventi', seq);
    const uow = this.db.unitOfWork(admin.id);
    const i = uow.save('interventi', {
      ...nuovoBase(this.ctx, uuid()),
      ...dati,
      codice: `INT-${(dati.data_programmata ?? new Date(this.db.now()).toISOString()).slice(0, 4)}-${seq}`,
      stato: dati.data_programmata ? 'programmato' : 'da_programmare',
      followup_origine_id: null,
    });
    operai.forEach((op, idx) =>
      uow.save('intervento_operai', { ...nuovoBase(this.ctx, uuid()), intervento_id: i.id, operaio_id: op, ruolo: idx === 0 ? 'responsabile' : 'squadra' }),
    );
    await uow.commit();
    return i;
  }

  async aggiornaIntervento(id: string, dati: DatiIntervento): Promise<void> {
    const admin = richiediAdmin(this.ctx);
    const i = this.db.get('interventi', id);
    if (!i) throw nonTrovato('Intervento');
    this.validaIntervento(dati);
    const stato = i.stato === 'da_programmare' && dati.data_programmata ? 'programmato' : i.stato;
    const uow = this.db.unitOfWork(admin.id);
    uow.save('interventi', { ...i, ...dati, stato });
    await uow.commit();
  }

  async cambiaStatoIntervento(id: string, stato: Intervento['stato'], motivo: string): Promise<void> {
    const admin = richiediAdmin(this.ctx);
    const i = this.db.get('interventi', id);
    if (!i) throw nonTrovato('Intervento');
    if (stato === 'annullato' && !motivo.trim()) throw new AppError('VALIDAZIONE', "Indica il motivo dell'annullamento.");
    const uow = this.db.unitOfWork(admin.id);
    uow.save('interventi', { ...i, stato }, { motivo });
    await uow.commit();
  }

  /** Sostituisce la squadra: gli operai rimossi sono eliminati logicamente (restano nello storico). */
  async assegnaOperai(interventoId: string, operai: string[], responsabileId: string | null): Promise<void> {
    const admin = richiediAdmin(this.ctx);
    if (!this.db.get('interventi', interventoId)) throw nonTrovato('Intervento');
    if (responsabileId && !operai.includes(responsabileId)) throw new AppError('VALIDAZIONE', 'Il responsabile deve far parte della squadra.');
    const attuali = this.assegnati(interventoId);
    const uow = this.db.unitOfWork(admin.id);
    const now = this.db.nowIso();
    for (const a of attuali) {
      if (!operai.includes(a.operaio_id)) uow.save('intervento_operai', { ...a, deleted_at: now }, { audit: 'elimina' });
    }
    const resp = responsabileId ?? operai[0] ?? null;
    for (const op of operai) {
      const ruolo = op === resp ? 'responsabile' : 'squadra';
      const esistente = attuali.find((a) => a.operaio_id === op);
      if (esistente) {
        if (esistente.ruolo !== ruolo) uow.save('intervento_operai', { ...esistente, ruolo });
      } else {
        uow.save('intervento_operai', { ...nuovoBase(this.ctx, uuid()), intervento_id: interventoId, operaio_id: op, ruolo });
      }
    }
    await uow.commit();
  }

  private validaIntervento(d: DatiIntervento) {
    if (!d.cliente_id) throw new AppError('VALIDAZIONE', 'Seleziona il cliente.');
    if (d.titolo.trim().length < 3) throw new AppError('VALIDAZIONE', "Indica un titolo per l'intervento.");
    if (d.sede_id) {
      const s = this.db.get('sedi_cliente', d.sede_id);
      if (!s || s.cliente_id !== d.cliente_id) throw new AppError('VALIDAZIONE', 'La sede non appartiene al cliente selezionato.');
    }
    if (d.ora_inizio && !/^\d{2}:\d{2}$/.test(d.ora_inizio)) throw new AppError('VALIDAZIONE', 'Ora non valida.');
  }

  // --- anagrafiche -------------------------------------------------------------------
  async salvaCliente(c: Partial<Cliente> & Pick<Cliente, 'ragione_sociale'>): Promise<Cliente> {
    const admin = richiediAdmin(this.ctx);
    if (c.ragione_sociale.trim().length < 2) throw new AppError('VALIDAZIONE', 'Ragione sociale obbligatoria.');
    if (c.partita_iva && !/^\d{11}$/.test(c.partita_iva)) throw new AppError('VALIDAZIONE', 'La partita IVA deve avere 11 cifre.');
    const esistente = c.id ? this.db.get('clienti', c.id) : undefined;
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('clienti', {
      ...(esistente ?? { ...nuovoBase(this.ctx, uuid()), partita_iva: '', email: '', telefono: '', referente: '', note: '', attivo: true }),
      ...c,
    } as Cliente);
    await uow.commit();
    return saved;
  }

  async salvaSede(s: Partial<SedeCliente> & Pick<SedeCliente, 'cliente_id' | 'nome'>): Promise<SedeCliente> {
    const admin = richiediAdmin(this.ctx);
    if (!this.db.get('clienti', s.cliente_id)) throw nonTrovato('Cliente');
    if (s.nome.trim().length < 2) throw new AppError('VALIDAZIONE', 'Nome sede obbligatorio.');
    const esistente = s.id ? this.db.get('sedi_cliente', s.id) : undefined;
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('sedi_cliente', {
      ...(esistente ?? { ...nuovoBase(this.ctx, uuid()), indirizzo: '', cap: '', citta: '', provincia: '', referente: '', telefono: '', note_accesso: '', attiva: true }),
      ...s,
    } as SedeCliente);
    await uow.commit();
    return saved;
  }

  async salvaOperaio(p: Partial<Profilo> & Pick<Profilo, 'nome' | 'cognome' | 'email'>): Promise<Profilo> {
    const admin = richiediAdmin(this.ctx);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new AppError('VALIDAZIONE', 'Email non valida.');
    const doppione = this.db.all('profili').find((x) => x.email.toLowerCase() === p.email.toLowerCase() && x.id !== p.id);
    if (doppione) throw new AppError('VALIDAZIONE', 'Esiste già un utente con questa email.');
    const esistente = p.id ? this.db.get('profili', p.id) : undefined;
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('profili', {
      ...(esistente ?? { ...nuovoBase(this.ctx, uuid()), telefono: '', ruolo: 'operaio', attivo: true, colore: '#0f766e', qualifica: 'Operaio', ore_giornaliere_contratto: 8 }),
      ...p,
    } as Profilo);
    await uow.commit();
    return saved;
  }
}
