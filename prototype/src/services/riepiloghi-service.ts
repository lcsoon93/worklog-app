/**
 * Recupero dati per i riepiloghi giornalieri e mensili.
 * Legge dal database locale e delega aggregazione e calcolo a reports/modello.ts (che usa il
 * motore ore centrale). Nessuna logica di calcolo qui.
 */
import { AZIENDA } from '../config/azienda';
import { costruisciRiepilogoGiornaliero, costruisciRiepilogoMensile, type RiepilogoGiornalieroDoc, type RiepilogoMensileDoc, type SorgenteRiepiloghi } from '../reports/modello';
import { meseDi } from '../domain/time';
import { richiediUtente, type ServiceContext } from './base';
import { AppError, nonTrovato } from './errors';

export class RiepiloghiService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** Un operaio vede solo i propri riepiloghi; l'amministratore quelli di tutti (regola funzionale). */
  private sorgente(operaioId: string, anno: number, mese: number): SorgenteRiepiloghi {
    const u = richiediUtente(this.ctx);
    if (u.ruolo === 'operaio' && u.id !== operaioId) {
      throw new AppError('NON_CONSENTITO', 'Puoi generare solo i tuoi riepiloghi.');
    }
    const operaio = this.db.get('profili', operaioId);
    if (!operaio) throw nonTrovato('Operaio');
    const cartellino = this.db.all('cartellini_mensili').find((c) => c.operaio_id === operaioId && c.anno === anno && c.mese === mese);
    const presenze = this.db.where('presenze', (p) => p.operaio_id === operaioId);
    const ids = new Set(presenze.map((p) => p.id));
    return {
      azienda: AZIENDA,
      operaio,
      generatoDa: u,
      now: this.db.now(),
      presenze,
      pause: this.db.where('pause_presenza', (x) => ids.has(x.presenza_id)),
      attivita: this.db.all('attivita_lavoro', { includiEliminati: true }).filter((a) => ids.has(a.presenza_id)),
      rapportini: this.db.where('rapportini', (r) => r.operai_ids.includes(operaioId)),
      cartellino,
      versioni: cartellino ? this.db.where('cartellino_versioni', (v) => v.cartellino_id === cartellino.id) : [],
      richieste: this.db.where('richieste_correzione', (r) => r.operaio_id === operaioId),
      approvazioni: cartellino ? this.db.where('approvazioni_cartellino', (a) => a.cartellino_id === cartellino.id) : [],
      nomeCliente: (id) => this.db.get('clienti', id)?.ragione_sociale ?? '',
      nomeSede: (id) => {
        const s = this.db.get('sedi_cliente', id);
        return s ? `${s.nome}, ${s.citta}` : '';
      },
      intervento: (id) => {
        const i = this.db.get('interventi', id);
        return i ? { codice: i.codice, titolo: i.titolo } : null;
      },
      nomeUtente: (id) => {
        const p = this.db.get('profili', id);
        return p ? `${p.nome} ${p.cognome}` : '—';
      },
    };
  }

  giornaliero(operaioId: string, data: string): RiepilogoGiornalieroDoc {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new AppError('VALIDAZIONE', 'Data non valida.');
    const { anno, mese } = meseDi(data);
    return costruisciRiepilogoGiornaliero(this.sorgente(operaioId, anno, mese), data);
  }

  mensile(operaioId: string, anno: number, mese: number): RiepilogoMensileDoc {
    if (!Number.isInteger(anno) || !Number.isInteger(mese) || mese < 1 || mese > 12) throw new AppError('VALIDAZIONE', 'Mese non valido.');
    return costruisciRiepilogoMensile(this.sorgente(operaioId, anno, mese), anno, mese);
  }
}
