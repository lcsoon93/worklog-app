/**
 * Richieste di correzione (Fase 3): il lavoratore segnala un errore su una giornata,
 * l'amministratore la prende in carico, la risolve o la respinge con motivazione.
 * Ogni passaggio registra autore e istante (campi del record + audit) e viene sincronizzato
 * come ogni altro dato (anche se creato offline).
 */
import { uuid } from '../domain/ids';
import { meseDi } from '../domain/time';
import { meseModificabile } from '../domain/timesheet-workflow';
import type { RichiestaCorrezione, RichiestaCorrezioneStato } from '../domain/types';
import { nuovoBase, richiediAdmin, richiediUtente, type ServiceContext } from './base';
import { AppError, nonTrovato } from '../shared/errors';

export const ETICHETTE_RICHIESTA: Record<RichiestaCorrezioneStato, string> = {
  aperta: 'Aperta',
  presa_in_carico: 'Presa in carico',
  risolta: 'Risolta',
  respinta: 'Respinta',
};

/** Transizioni ammesse per l'amministratore. */
const AMMESSE: Record<RichiestaCorrezioneStato, RichiestaCorrezioneStato[]> = {
  aperta: ['presa_in_carico', 'risolta', 'respinta'],
  presa_in_carico: ['risolta', 'respinta'],
  risolta: [],
  respinta: [],
};

export class RichiesteService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  elenco(filtro: { operaioId?: string; data?: string; anno?: number; mese?: number; soloAperte?: boolean } = {}): RichiestaCorrezione[] {
    const prefisso = filtro.anno && filtro.mese ? `${filtro.anno}-${String(filtro.mese).padStart(2, '0')}-` : null;
    return this.db
      .where('richieste_correzione', (r) =>
        (!filtro.operaioId || r.operaio_id === filtro.operaioId) &&
        (!filtro.data || r.data_lavoro === filtro.data) &&
        (!prefisso || r.data_lavoro.startsWith(prefisso)) &&
        (!filtro.soloAperte || r.stato === 'aperta' || r.stato === 'presa_in_carico'),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Il mese della richiesta è bloccato (cartellino in verifica o approvato)? Serve a guidare l'amministratore. */
  meseBloccato(r: Pick<RichiestaCorrezione, 'operaio_id' | 'data_lavoro'>): boolean {
    const { anno, mese } = meseDi(r.data_lavoro);
    const c = this.db.all('cartellini_mensili').find((x) => x.operaio_id === r.operaio_id && x.anno === anno && x.mese === mese);
    return !meseModificabile(c?.stato);
  }

  async richiedi(input: { data_lavoro: string; messaggio: string; presenza_id?: string | null; attivita_id?: string | null }): Promise<RichiestaCorrezione> {
    const u = richiediUtente(this.ctx);
    if (u.ruolo !== 'operaio') throw new AppError('NON_CONSENTITO', 'La richiesta di correzione è inviata dal lavoratore.');
    const messaggio = input.messaggio.trim();
    if (messaggio.length < 10) throw new AppError('VALIDAZIONE', 'Descrivi cosa va corretto (almeno 10 caratteri), ad esempio orario corretto e motivo.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data_lavoro)) throw new AppError('VALIDAZIONE', 'Giorno non valido.');
    if (input.presenza_id) {
      const p = this.db.get('presenze', input.presenza_id);
      if (!p || p.operaio_id !== u.id || p.data_lavoro !== input.data_lavoro) throw new AppError('VALIDAZIONE', 'La presenza indicata non appartiene a questo giorno.');
    }
    if (input.attivita_id) {
      const a = this.db.get('attivita_lavoro', input.attivita_id);
      if (!a || a.operaio_id !== u.id) throw new AppError('VALIDAZIONE', 'Attività non valida.');
    }
    const uow = this.db.unitOfWork(u.id);
    const r = uow.save('richieste_correzione', {
      ...nuovoBase(this.ctx, uuid()),
      operaio_id: u.id,
      data_lavoro: input.data_lavoro,
      presenza_id: input.presenza_id ?? null,
      attivita_id: input.attivita_id ?? null,
      messaggio,
      stato: 'aperta',
      risposta: '',
      gestita_da: null,
      gestita_at: null,
    });
    await uow.commit();
    return r;
  }

  async gestisci(id: string, stato: RichiestaCorrezioneStato, risposta: string): Promise<RichiestaCorrezione> {
    const admin = richiediAdmin(this.ctx);
    const r = this.db.get('richieste_correzione', id);
    if (!r) throw nonTrovato('Richiesta di correzione');
    if (!AMMESSE[r.stato].includes(stato)) {
      throw new AppError('STATO_NON_VALIDO', `La richiesta è "${ETICHETTE_RICHIESTA[r.stato]}": non può passare a "${ETICHETTE_RICHIESTA[stato]}".`);
    }
    if ((stato === 'respinta' || stato === 'risolta') && risposta.trim().length < 5) {
      throw new AppError('VALIDAZIONE', stato === 'respinta' ? 'Indica il motivo del rifiuto.' : 'Indica come è stata risolta (es. correzione eseguita, cartellino riaperto).');
    }
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save(
      'richieste_correzione',
      { ...r, stato, risposta: risposta.trim() || r.risposta, gestita_da: admin.id, gestita_at: this.db.nowIso() },
      { audit: 'transizione', motivo: risposta },
    );
    await uow.commit();
    return saved;
  }
}
