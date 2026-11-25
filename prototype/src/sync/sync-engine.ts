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
}

export function backoffMs(tentativi: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, tentativi - 1));
}

export class SyncEngine {
  private running = false;

  constructor(
    private readonly db: LocalDb,
    private readonly api: RemoteApi,
    private readonly isOnline: () => boolean,
    private readonly utenteId: () => string | null,
  ) {}

  pendenti(): OutboxOp[] {
    return this.db.outbox().filter((o) => o.stato !== 'sincronizzato');
  }

  /** Esegue un ciclo di invio. `forza` ignora l'attesa del backoff (pulsante "Riprova ora"). */
  async ciclo(opts: { forza?: boolean } = {}): Promise<EsitoCiclo> {
    const esito: EsitoCiclo = { inviate: 0, riuscite: 0, errori: 0, conflitti: 0, saltate: 0 };
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
    } finally {
      this.running = false;
    }
    return esito;
  }

  private async invia(opIniziale: OutboxOp, esito: EsitoCiclo): Promise<boolean> {
    const record = this.db.get(opIniziale.entita, opIniziale.entita_id) as unknown as BaseRecord | undefined;
    if (!record) {
      // Il record locale non esiste più (es. reset demo): l'operazione non ha più senso.
      await this.db.applyBatch([{ tipo: 'delete', store: 'outbox', id: opIniziale.id }]);
      return true;
    }
    const now = this.db.nowIso();
    // Primo invio: si congelano payload e versione di base; i ritentativi li riusano.
    const op: OutboxOp = {
      ...opIniziale,
      payload: opIniziale.payload ?? stripTecnici(record),
      base_versione: opIniziale.base_versione ?? record.row_version,
      stato: 'in_sincronizzazione',
      tentativi: opIniziale.tentativi + 1,
      updated_at: now,
    };
    await this.db.applyBatch([
      { tipo: 'put', store: 'outbox', value: op },
      ...this.statoRecord(op.entita, op.entita_id, 'in_sincronizzazione'),
    ]);
    esito.inviate++;

    try {
      const risposta = await this.api.applica({
        op_id: op.id,
        device_id: this.db.deviceId,
        utente_id: this.utenteId(),
        entita: op.entita,
        entita_id: op.entita_id,
        base_versione: op.base_versione ?? 0,
        payload: op.payload as Record<string, unknown>,
      });

      if (risposta.esito === 'conflitto') {
        const conflitto: OutboxOp = {
          ...op,
          stato: 'conflitto',
          ultimo_errore: 'Il record è stato modificato da un altro dispositivo.',
          conflitto: { versione_server: risposta.versione_server, dati_server: risposta.dati_server },
          updated_at: this.db.nowIso(),
        };
        await this.db.applyBatch([
          { tipo: 'put', store: 'outbox', value: conflitto },
          ...this.statoRecord(op.entita, op.entita_id, 'conflitto'),
        ]);
        esito.conflitti++;
        return false;
      }

      // Successo confermato dal server.
      const corrente = this.db.get(op.entita, op.entita_id) as unknown as BaseRecord | undefined;
      const altrePendenti = this.db
        .outbox()
        .some((o) => o.id !== op.id && o.entita === op.entita && o.entita_id === op.entita_id && o.stato !== 'sincronizzato');
      const batch: BatchOp[] = [
        { tipo: 'put', store: 'outbox', value: { ...op, stato: 'sincronizzato', ultimo_errore: null, updated_at: this.db.nowIso() } as OutboxOp },
      ];
      if (corrente) {
        batch.push({
          tipo: 'put',
          store: op.entita,
          value: {
            ...corrente,
            ...risposta.patch,
            row_version: risposta.row_version,
            sync_stato: altrePendenti ? 'in_attesa' : 'sincronizzato',
          } as BaseRecord,
        });
      }
      for (const x of risposta.extra) {
        batch.push({ tipo: 'put', store: x.entita, value: x.record });
      }
      await this.db.applyBatch(batch);
      esito.riuscite++;
      return true;
    } catch (e) {
      const messaggio =
        e instanceof ErroreRete ? e.message : e instanceof ErroreServer ? `${e.status}: ${e.message}` : String(e);
      const fallita: OutboxOp = {
        ...op,
        stato: 'errore',
        ultimo_errore: messaggio,
        prossimo_tentativo_at: new Date(this.db.now() + backoffMs(op.tentativi)).toISOString(),
        updated_at: this.db.nowIso(),
      };
      await this.db.applyBatch([
        { tipo: 'put', store: 'outbox', value: fallita },
        ...this.statoRecord(op.entita, op.entita_id, 'errore'),
      ]);
      esito.errori++;
      return false;
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
    const r = this.db.get(op.entita, op.entita_id) as unknown as BaseRecord | undefined;
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
    const batch: BatchOp[] = [
      { tipo: 'delete', store: 'outbox', id: op.id },
      { tipo: 'put', store: 'outbox', value: nuova },
      this.auditRisoluzione(op, 'Conflitto risolto mantenendo la versione del dispositivo'),
    ];
    if (r) batch.push({ tipo: 'put', store: op.entita, value: { ...r, row_version: op.conflitto.versione_server, sync_stato: 'in_attesa' } as BaseRecord });
    await this.db.applyBatch(batch);
  }

  /** Accetta la versione del server: il dato locale viene sostituito (resta traccia nell'audit). */
  async risolviAccettaServer(opId: string): Promise<void> {
    const op = this.db.outbox().find((o) => o.id === opId);
    if (!op?.conflitto) return;
    const r = this.db.get(op.entita, op.entita_id) as unknown as BaseRecord | undefined;
    const serverData = op.conflitto.dati_server as Record<string, unknown>;
    const batch: BatchOp[] = [
      { tipo: 'delete', store: 'outbox', id: op.id },
      this.auditRisoluzione(op, 'Conflitto risolto accettando la versione del server', r),
    ];
    if (r) {
      batch.push({
        tipo: 'put',
        store: op.entita,
        value: { ...r, ...serverData, id: r.id, row_version: op.conflitto.versione_server, sync_stato: 'sincronizzato' } as BaseRecord,
      });
    }
    await this.db.applyBatch(batch);
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
