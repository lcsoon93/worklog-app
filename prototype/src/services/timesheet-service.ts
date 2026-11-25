/**
 * Cartellini mensili: generazione snapshot, conferma operaio, approvazione amministratore,
 * correzioni, riapertura e versioni. Specifica: docs/07-cartellini-approvazioni.md.
 *
 * Ogni transizione scrive un record in approvazioni_cartellino (utente, istante, stato
 * precedente/nuovo, motivazione). Le versioni sono immutabili: correzioni e riaperture
 * producono una NUOVA versione; quella approvata resta consultabile.
 */
import { costruisciSnapshotMese, type SnapshotMese } from '../domain/day-records';
import { uuid } from '../domain/ids';
import { etichettaMese } from '../domain/time';
import { valutaTransizione, type Attore } from '../domain/timesheet-workflow';
import type {
  ApprovazioneCartellino,
  AzioneCartellino,
  CartellinoMensile,
  CartellinoVersione,
} from '../domain/types';
import type { UnitOfWork } from '../data/local-db';
import { nuovoBase, richiediAdmin, richiediUtente, type ServiceContext } from './base';
import { AppError, nonTrovato } from './errors';

export class TimesheetService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  cartellino(operaioId: string, anno: number, mese: number): CartellinoMensile | undefined {
    return this.db.all('cartellini_mensili').find((c) => c.operaio_id === operaioId && c.anno === anno && c.mese === mese);
  }

  versioni(cartellinoId: string): CartellinoVersione[] {
    return this.db.where('cartellino_versioni', (v) => v.cartellino_id === cartellinoId).sort((a, b) => b.versione - a.versione);
  }

  versione(cartellinoId: string, n: number): CartellinoVersione | undefined {
    return this.versioni(cartellinoId).find((v) => v.versione === n);
  }

  storico(cartellinoId: string): ApprovazioneCartellino[] {
    return this.db
      .where('approvazioni_cartellino', (a) => a.cartellino_id === cartellinoId)
      .sort((a, b) => b.eseguita_at.localeCompare(a.eseguita_at));
  }

  /** Calcolo dal vivo dei dati attuali (anteprima del mese in compilazione o confronto con lo snapshot). */
  anteprima(operaioId: string, anno: number, mese: number): SnapshotMese {
    return costruisciSnapshotMese(
      operaioId,
      anno,
      mese,
      this.db.all('presenze'),
      this.db.all('pause_presenza'),
      this.db.all('attivita_lavoro', { includiEliminati: true }),
      this.db.now(),
    );
  }

  /** Chiusura del mese per un operaio: crea (se serve) il cartellino e ne genera lo snapshot. */
  async genera(operaioId: string, anno: number, mese: number): Promise<CartellinoMensile> {
    const admin = richiediAdmin(this.ctx);
    let c = this.cartellino(operaioId, anno, mese);
    const uow = this.db.unitOfWork(admin.id);
    if (!c) {
      c = uow.save('cartellini_mensili', {
        ...nuovoBase(this.ctx, uuid()),
        operaio_id: operaioId,
        anno,
        mese,
        stato: 'in_compilazione',
        versione_corrente: 0,
        versione_approvata: null,
        ultima_motivazione: '',
      });
    }
    this.transita(uow, c, 'genera', 'admin', admin.id, '');
    await uow.commit();
    return this.db.get('cartellini_mensili', c.id)!;
  }

  /** Chiude il mese per tutti gli operai attivi. Restituisce l'esito per ciascuno (nessun fallimento silenzioso). */
  async chiudiMese(anno: number, mese: number): Promise<Array<{ operaioId: string; ok: boolean; messaggio: string }>> {
    richiediAdmin(this.ctx);
    const out: Array<{ operaioId: string; ok: boolean; messaggio: string }> = [];
    for (const op of this.db.where('profili', (p) => p.ruolo === 'operaio' && p.attivo)) {
      const c = this.cartellino(op.id, anno, mese);
      if (c && c.stato !== 'in_compilazione') {
        out.push({ operaioId: op.id, ok: true, messaggio: 'Già generato' });
        continue;
      }
      try {
        await this.genera(op.id, anno, mese);
        out.push({ operaioId: op.id, ok: true, messaggio: 'Generato' });
      } catch (e) {
        out.push({ operaioId: op.id, ok: false, messaggio: e instanceof AppError ? e.messaggio : String(e) });
      }
    }
    return out;
  }

  async conferma(cartellinoId: string): Promise<void> {
    await this.azioneOperaio(cartellinoId, 'conferma', '');
  }

  async segnalaDiscrepanza(cartellinoId: string, motivazione: string): Promise<void> {
    await this.azioneOperaio(cartellinoId, 'segnala_discrepanza', motivazione);
  }

  async approva(cartellinoId: string): Promise<void> {
    await this.azioneAdmin(cartellinoId, 'approva', '');
  }

  async richiediCorrezione(cartellinoId: string, motivazione: string): Promise<void> {
    await this.azioneAdmin(cartellinoId, 'richiedi_correzione', motivazione);
  }

  async rifiuta(cartellinoId: string, motivazione: string): Promise<void> {
    await this.azioneAdmin(cartellinoId, 'rifiuta', motivazione);
  }

  async riapri(cartellinoId: string, motivazione: string): Promise<void> {
    await this.azioneAdmin(cartellinoId, 'riapri', motivazione);
  }

  /** Dopo le correzioni: nuova versione da riconfermare (operaio o amministratore). */
  async rigenera(cartellinoId: string, motivazione = ''): Promise<void> {
    const u = richiediUtente(this.ctx);
    const c = this.db.get('cartellini_mensili', cartellinoId);
    if (!c) throw nonTrovato('Cartellino');
    if (u.ruolo === 'operaio' && c.operaio_id !== u.id) throw new AppError('NON_CONSENTITO', 'Cartellino di un altro operaio.');
    const uow = this.db.unitOfWork(u.id);
    this.transita(uow, c, 'rigenera', u.ruolo, u.id, motivazione);
    await uow.commit();
  }

  private async azioneOperaio(cartellinoId: string, azione: AzioneCartellino, motivazione: string) {
    const u = richiediUtente(this.ctx);
    const c = this.db.get('cartellini_mensili', cartellinoId);
    if (!c) throw nonTrovato('Cartellino');
    if (azione === 'conferma') {
      const v = this.versione(c.id, c.versione_corrente);
      const attuale = this.anteprima(c.operaio_id, c.anno, c.mese);
      if (v && v.impronta !== attuale.impronta) {
        throw new AppError('STATO_NON_VALIDO', 'I dati del mese sono cambiati dopo la generazione: serve una nuova versione.');
      }
    }
    const uow = this.db.unitOfWork(u.id);
    this.transita(uow, c, azione, u.ruolo, u.id, motivazione);
    await uow.commit();
  }

  private async azioneAdmin(cartellinoId: string, azione: AzioneCartellino, motivazione: string) {
    const admin = richiediAdmin(this.ctx);
    const c = this.db.get('cartellini_mensili', cartellinoId);
    if (!c) throw nonTrovato('Cartellino');
    const uow = this.db.unitOfWork(admin.id);
    this.transita(uow, c, azione, 'admin', admin.id, motivazione);
    await uow.commit();
  }

  private transita(
    uow: UnitOfWork,
    c: CartellinoMensile,
    azione: AzioneCartellino,
    attore: Attore,
    utenteId: string,
    motivazione: string,
  ) {
    const esito = valutaTransizione({ stato: c.stato, azione, attore, utenteId, titolareId: c.operaio_id, motivazione });
    if (!esito.ok) throw new AppError('STATO_NON_VALIDO', esito.errore);

    let versione = c.versione_corrente;
    if (esito.regola.nuovaVersione) {
      const snap = this.anteprima(c.operaio_id, c.anno, c.mese);
      const prefisso = `${c.anno}-${String(c.mese).padStart(2, '0')}-`;
      const aperte = this.db.where('presenze', (p) => p.operaio_id === c.operaio_id && p.data_lavoro.startsWith(prefisso) && p.uscita_at === null);
      if (aperte.length) {
        throw new AppError(
          'STATO_NON_VALIDO',
          `${etichettaMese(c.anno, c.mese)}: ci sono giornate ancora aperte (${aperte.map((p) => p.data_lavoro).join(', ')}). Chiuderle prima di generare il cartellino.`,
        );
      }
      versione = c.versione_corrente + 1;
      uow.save('cartellino_versioni', {
        ...nuovoBase(this.ctx, uuid()),
        cartellino_id: c.id,
        versione,
        giorni: snap.giorni,
        totali: snap.totali,
        impronta: snap.impronta,
        motivo: motivazione || (versione === 1 ? 'Chiusura del mese' : 'Nuova versione dopo correzioni'),
      });
    }
    const now = this.db.nowIso();
    uow.save('approvazioni_cartellino', {
      ...nuovoBase(this.ctx, uuid()),
      cartellino_id: c.id,
      versione,
      azione,
      stato_precedente: c.stato,
      stato_nuovo: esito.nuovoStato,
      utente_id: utenteId,
      ruolo_utente: attore,
      motivazione: motivazione.trim(),
      eseguita_at: now,
    });
    const corrente = uow.peek('cartellini_mensili', c.id) ?? c;
    uow.save(
      'cartellini_mensili',
      {
        ...corrente,
        stato: esito.nuovoStato,
        versione_corrente: versione,
        versione_approvata: azione === 'approva' ? versione : corrente.versione_approvata,
        ultima_motivazione: motivazione.trim(),
      },
      { audit: 'transizione', motivo: motivazione },
    );
  }
}
