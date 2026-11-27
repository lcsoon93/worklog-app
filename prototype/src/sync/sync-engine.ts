/**
 * Motore di sincronizzazione (outbox pattern). Specifica in docs/08-offline-sincronizzazione.md.
 *
 * Regole:
 * - le operazioni sono inviate in ordine di creazione; un'operazione bloccata (errore in attesa
 *   di ritentativo o conflitto) blocca le successive DELLA STESSA ENTITÀ, non le altre;
 * - un record diventa "sincronizzato" solo dopo una risposta positiva del server e solo se non
 *   ha altre operazioni pendenti;
 * - i ritentativi riusano lo stesso op_id e lo stesso payload (idempotenza);
 * - backoff esponenziale: 2s, 4s, 8s ... fino a 60s.
 */
import type { AuditLog, BaseRecord, EntityName } from '../domain/types';
import { uuid } from '../domain/ids';
import type { LocalDb, OutboxOp } from '../data/local-db';
import type { BatchOp } from '../data/storage';
import { ErroreRete, ErroreServer, type RemoteApi } from './remote-api';

export interface EsitoCiclo {
  inviate: number;
  riuscite: number;
  errori: number;
  conflitti: number;
  saltate: number;
  /** Fase 15: record ricevuti dal server (modifiche di altri dispositivi). */
  ricevuti: number;
}

/** Intervallo minimo tra due richieste di modifiche al server (salvo invii o "Sincronizza ora"). */
export const INTERVALLO_RICEZIONE_MS = 30_000;

export function backoffMs(tentativi: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, tentativi - 1));
}

export class SyncEngine {
  private running = false;
  private ultimaRicezione = 0;
  /** Ultimo errore della ricezione (es. sessione scaduta), per la pagina di sincronizzazione. */
  erroreRicezione: string | null = null;

  constructor(
    private readonly db: LocalDb,
    private readonly api: RemoteApi,
    private readonly isOnline: () => boolean,
    private readonly utenteId: () => string | null,
  ) {}

  /** Un ciclo di invio è in corso (per il feedback visivo). */
  inCorso(): boolean {
    return this.running;
  }

  pendenti(): OutboxOp[] {
    return this.db.outbox().filter((o) => o.stato !== 'sincronizzato');
  }

  /** Esegue un ciclo di invio. `forza` ignora l'attesa del backoff (pulsante "Riprova ora"). */
  async ciclo(opts: { forza?: boolean } = {}): Promise<EsitoCiclo> {
    const esito: EsitoCiclo = { inviate: 0, riuscite: 0, errori: 0, conflitti: 0, saltate: 0, ricevuti: 0 };
    if (this.running) return esito;
    if (!this.isOnline()) return esito;
    this.running = true;
    try {
      const bloccate = new Set<string>();
      for (const op of this.db.outbox()) {
        const chiave = `${op.entita}:${op.entita_id}`;
        if (op.stato === 'sincronizzato') continue;
        if (bloccate.has(chiave)) {
          esito.saltate++;
          continue;
        }
        if (op.stato === 'conflitto') {
          bloccate.add(chiave);
          continue;
        }
        if (
          op.stato === 'errore' &&
          !opts.forza &&
          op.prossimo_tentativo_at &&
          new Date(op.prossimo_tentativo_at).getTime() > this.db.now()
        ) {
          bloccate.add(chiave);
          continue;
        }
        if (!this.isOnline()) break;
        const ok = await this.invia(op, esito);
        if (!ok) bloccate.add(chiave);
      }
      if (this.api.ricevi && this.isOnline() && (opts.forza || esito.riuscite > 0 || this.db.now() - this.ultimaRicezione >= INTERVALLO_RICEZIONE_MS)) {
        await this.ricevi(esito);
      }
    } finally {
      this.running = false;
    }
    return esito;
  }

  /**
   * Invia una operazione. Ogni scrittura locale è calcolata al momento in cui viene applicata
   * (LocalDb.applyBatch con funzione): payload e versione di base si congelano insieme al
   * passaggio "in sincronizzazione", e l'esito si applica sul record più recente. Così una
   * modifica salvata dall'utente durante l'invio non viene né persa né segnata come inviata.
   */
  private async invia(opIniziale: OutboxOp, esito: EsitoCiclo): Promise<boolean> {
    let op: OutboxOp | null = null;
    await this.db.applyBatch(() => {
      const attuale = this.db.outbox().find((o) => o.id === opIniziale.id);
      if (!attuale || attuale.stato === 'sincronizzato' || attuale.stato === 'conflitto') return [];
      const record = this.db.get(attuale.entita, attuale.entita_id) as unknown as BaseRecord | undefined;
      // Il record locale non esiste più (es. reset demo): l'operazione non ha più senso.
      if (!record) return [{ tipo: 'delete', store: 'outbox', id: attuale.id }];
      // Primo invio: si congelano payload e versione di base; i ritentativi li riusano.
      op = {
        ...attuale,
        payload: attuale.payload ?? stripTecnici(record),
        base_versione: attuale.base_versione ?? record.row_version,
        stato: 'in_sincronizzazione',
        tentativi: attuale.tentativi + 1,
        updated_at: this.db.nowIso(),
      };
      return [{ tipo: 'put', store: 'outbox', value: op }, ...this.statoRecord(op.entita, op.entita_id, 'in_sincronizzazione')];
    });
    const inviata = op as OutboxOp | null;
    if (!inviata) return true;
    esito.inviate++;

    try {
      const risposta = await this.api.applica({
        op_id: inviata.id,
        device_id: this.db.deviceId,
        utente_id: this.utenteId(),
        entita: inviata.entita,
        entita_id: inviata.entita_id,
        base_versione: inviata.base_versione ?? 0,
        payload: inviata.payload as Record<string, unknown>,
      });

      if (risposta.esito === 'conflitto') {
        const conflitto: OutboxOp = {
          ...inviata,
          stato: 'conflitto',
          ultimo_errore: 'Il record è stato modificato da un altro dispositivo.',
          conflitto: { versione_server: risposta.versione_server, dati_server: risposta.dati_server },
          updated_at: this.db.nowIso(),
        };
        await this.db.applyBatch(() => [
          { tipo: 'put', store: 'outbox', value: conflitto },
          ...this.statoRecord(inviata.entita, inviata.entita_id, 'conflitto'),
        ]);
        esito.conflitti++;
        return false;
      }

      // Successo confermato dal server.
      await this.db.applyBatch(() => {
        const corrente = this.db.get(inviata.entita, inviata.entita_id) as unknown as BaseRecord | undefined;
        const altrePendenti = this.db
          .outbox()
          .some((o) => o.id !== inviata.id && o.entita === inviata.entita && o.entita_id === inviata.entita_id && o.stato !== 'sincronizzato');
        const batch: BatchOp[] = [
          { tipo: 'put', store: 'outbox', value: { ...inviata, stato: 'sincronizzato', ultimo_errore: null, updated_at: this.db.nowIso() } as OutboxOp },
        ];
        if (corrente) {
          batch.push({
            tipo: 'put',
            store: inviata.entita,
            value: {
              ...corrente,
              ...risposta.patch,
              row_version: risposta.row_version,
              sync_stato: altrePendenti ? 'in_attesa' : 'sincronizzato',
            } as BaseRecord,
          });
        }
        for (const x of risposta.extra) batch.push({ tipo: 'put', store: x.entita, value: x.record });
        return batch;
      });
      esito.riuscite++;
      return true;
    } catch (e) {
      const messaggio =
        e instanceof ErroreRete ? e.message : e instanceof ErroreServer ? `${e.status}: ${e.message}` : String(e);
      const fallita: OutboxOp = {
        ...inviata,
        stato: 'errore',
        ultimo_errore: messaggio,
        prossimo_tentativo_at: new Date(this.db.now() + backoffMs(inviata.tentativi)).toISOString(),
        updated_at: this.db.nowIso(),
      };
      await this.db.applyBatch(() => [
        { tipo: 'put', store: 'outbox', value: fallita },
        ...this.statoRecord(inviata.entita, inviata.entita_id, 'errore'),
      ]);
      esito.errori++;
      return false;
    }
  }

  /**
   * Ricezione delle modifiche (Fase 15). Un record ricevuto NON sovrascrive:
   * - un record con operazioni ancora in coda sul dispositivo (vince la modifica locale, che
   *   verrà inviata e, se superata, segnalata come conflitto);
   * - un record locale con versione uguale o più recente.
   * Il cursore è salvato per utente, così un altro accesso sullo stesso dispositivo riparte da zero.
   */
  private async ricevi(esito: EsitoCiclo): Promise<void> {
    const utente = this.utenteId();
    if (!utente || !this.api.ricevi) return;
    const chiaveCursore = `sync_cursore:${utente}`;
    let cursore = this.db.meta<number>(chiaveCursore) ?? 0;
    try {
      for (let pagina = 0; pagina < 50; pagina++) {
        const p = await this.api.ricevi(cursore);
        // Calcolato al momento della scrittura: una modifica locale salvata durante la richiesta vince.
        await this.db.applyBatch(() => {
          const pendenti = new Set(this.pendenti().map((o) => `${o.entita}:${o.entita_id}`));
          const batch: BatchOp[] = [];
          for (const r of p.record) {
            if (pendenti.has(`${r.entita}:${r.dati.id}`)) continue;
            const locale = this.db.get(r.entita, r.dati.id) as unknown as BaseRecord | undefined;
            if (locale && locale.row_version >= r.row_version) continue;
            batch.push({ tipo: 'put', store: r.entita, value: { ...r.dati, row_version: r.row_version, sync_stato: 'sincronizzato' } as BaseRecord });
          }
          esito.ricevuti += batch.length;
          return batch;
        });
        cursore = Math.max(cursore, p.ultimo);
        await this.db.setMeta(chiaveCursore, cursore);
        if (!p.altri) break;
      }
      this.ultimaRicezione = this.db.now();
      this.erroreRicezione = null;
    } catch (e) {
      this.erroreRicezione = e instanceof ErroreRete ? e.message : e instanceof ErroreServer ? `${e.status}: ${e.message}` : String(e);
      this.ultimaRicezione = this.db.now(); // riprova al prossimo intervallo, senza insistere
    }
  }

  private statoRecord(entita: EntityName, id: string, stato: BaseRecord['sync_stato']): BatchOp[] {
    const r = this.db.get(entita, id) as unknown as BaseRecord | undefined;
    return r ? [{ tipo: 'put', store: entita, value: { ...r, sync_stato: stato } as BaseRecord }] : [];
  }

  // --- risoluzione conflitti ----------------------------------------------------------

  /** Mantiene la versione del dispositivo: nuova operazione basata sulla versione del server. */
  async risolviMantieniLocale(opId: string): Promise<void> {
    const op = this.db.outbox().find((o) => o.id === opId);
    if (!op?.conflitto) return;
    const conflitto = op.conflitto;
    const now = this.db.nowIso();
    const nuova: OutboxOp = {
      ...op,
      id: uuid(),
      stato: 'in_attesa',
      tentativi: 0,
      payload: null,
      base_versione: op.conflitto.versione_server,
      conflitto: null,
      ultimo_errore: null,
      prossimo_tentativo_at: null,
      created_at: op.created_at,
      updated_at: now,
    };
    await this.db.applyBatch(() => {
      const r = this.db.get(op.entita, op.entita_id) as unknown as BaseRecord | undefined;
      const batch: BatchOp[] = [
        { tipo: 'delete', store: 'outbox', id: op.id },
        { tipo: 'put', store: 'outbox', value: nuova },
        this.auditRisoluzione(op, 'Conflitto risolto mantenendo la versione del dispositivo'),
      ];
      if (r) batch.push({ tipo: 'put', store: op.entita, value: { ...r, row_version: conflitto.versione_server, sync_stato: 'in_attesa' } as BaseRecord });
      return batch;
    });
  }

  /** Accetta la versione del server: il dato locale viene sostituito (resta traccia nell'audit). */
  async risolviAccettaServer(opId: string): Promise<void> {
    const op = this.db.outbox().find((o) => o.id === opId);
    if (!op?.conflitto) return;
    const conflitto = op.conflitto;
    const serverData = conflitto.dati_server as Record<string, unknown>;
    await this.db.applyBatch(() => {
      const r = this.db.get(op.entita, op.entita_id) as unknown as BaseRecord | undefined;
      const batch: BatchOp[] = [
        { tipo: 'delete', store: 'outbox', id: op.id },
        this.auditRisoluzione(op, 'Conflitto risolto accettando la versione del server', r),
      ];
      if (r) {
        batch.push({
          tipo: 'put',
          store: op.entita,
          value: { ...r, ...serverData, id: r.id, row_version: conflitto.versione_server, sync_stato: 'sincronizzato' } as BaseRecord,
        });
      }
      return batch;
    });
  }

  private auditRisoluzione(op: OutboxOp, motivo: string, prima?: unknown): BatchOp {
    return {
      tipo: 'put',
      store: 'audit_log',
      value: {
        id: uuid(),
        entita: op.entita,
        entita_id: op.entita_id,
        azione: 'modifica',
        utente_id: this.utenteId(),
        eseguita_at: this.db.nowIso(),
        prima: prima ?? null,
        dopo: op.conflitto,
        motivo,
        device_id: this.db.deviceId,
      } as AuditLog,
    };
  }

  /** Rimuove dalla coda le operazioni già confermate (pulizia periodica). */
  async pulisciSincronizzate(piuVecchieDiMs = 0): Promise<void> {
    const limite = this.db.now() - piuVecchieDiMs;
    const ops = this.db
      .outbox()
      .filter((o) => o.stato === 'sincronizzato' && new Date(o.updated_at).getTime() <= limite)
      .map((o) => ({ tipo: 'delete' as const, store: 'outbox', id: o.id }));
    await this.db.applyBatch(ops);
  }
}

function stripTecnici(r: BaseRecord): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sync_stato, ...resto } = r;
  return resto;
}
