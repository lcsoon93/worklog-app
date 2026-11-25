/**
 * Database locale offline-first.
 *
 * - Tiene in memoria una copia dei dati (letture sincrone e veloci per la UI).
 * - Ogni scrittura passa da una UnitOfWork che, in un'unica transazione IndexedDB:
 *   salva i record, accoda le operazioni di sincronizzazione (outbox) e scrive l'audit.
 * - La cache viene aggiornata SOLO dopo il commit riuscito su IndexedDB: la UI non mostra
 *   mai come salvato un dato che non è stato scritto.
 */
import { uuid } from '../domain/ids';
import type { AuditLog, BaseRecord, EntityMap, EntityName, SyncStato } from '../domain/types';
import { AppError } from '../services/errors';
import type { BatchOp, StorageAdapter } from './storage';
import { TUTTI_GLI_STORE } from './storage';

export interface OutboxOp {
  /** Chiave di idempotenza: resta la stessa per tutti i tentativi della stessa operazione. */
  id: string;
  entita: EntityName;
  entita_id: string;
  /** Ordine di accodamento (monotono sul dispositivo): garantisce che il padre parta prima dei figli. */
  seq: number;
  stato: SyncStato;
  tentativi: number;
  ultimo_errore: string | null;
  created_at: string;
  updated_at: string;
  prossimo_tentativo_at: string | null;
  /** Fissato al primo invio e riutilizzato identico nei tentativi successivi. */
  payload: unknown | null;
  base_versione: number | null;
  conflitto: { versione_server: number; dati_server: unknown } | null;
}

export interface MetaRecord {
  id: string;
  value: unknown;
}

type Listener = () => void;

export class LocalDb {
  private cache = new Map<string, Map<string, { id: string }>>();
  private listeners = new Set<Listener>();
  private revision = 0;
  private outboxSeq = 0;
  deviceId = 'device-non-inizializzato';
  /** Orologio iniettabile: i test lo sostituiscono per ottenere risultati deterministici. */
  clock: () => number = () => Date.now();

  constructor(public readonly storage: StorageAdapter) {
    for (const s of TUTTI_GLI_STORE) this.cache.set(s, new Map());
  }

  async init(): Promise<void> {
    const all = await this.storage.loadAll();
    for (const s of TUTTI_GLI_STORE) {
      const m = new Map<string, { id: string }>();
      for (const r of all[s] ?? []) m.set(r.id, r);
      this.cache.set(s, m);
    }
    let device = this.meta<string>('device_id');
    if (!device) {
      device = `tablet-${uuid().slice(0, 8)}`;
      await this.setMeta('device_id', device);
    }
    this.deviceId = device;
    this.outboxSeq = Math.max(0, ...this.outbox().map((o) => o.seq ?? 0));
    this.emit();
  }

  now(): number {
    return this.clock();
  }
  nextOutboxSeq(): number {
    return ++this.outboxSeq;
  }
  nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  // --- letture -----------------------------------------------------------------------
  all<K extends EntityName>(entita: K, opts: { includiEliminati?: boolean } = {}): EntityMap[K][] {
    const rows = [...(this.cache.get(entita)?.values() ?? [])] as EntityMap[K][];
    return opts.includiEliminati ? rows : rows.filter((r) => !r.deleted_at);
  }
  get<K extends EntityName>(entita: K, id: string | null | undefined): EntityMap[K] | undefined {
    if (!id) return undefined;
    return this.cache.get(entita)?.get(id) as EntityMap[K] | undefined;
  }
  where<K extends EntityName>(entita: K, pred: (r: EntityMap[K]) => boolean): EntityMap[K][] {
    return this.all(entita).filter(pred);
  }
  outbox(): OutboxOp[] {
    return ([...(this.cache.get('outbox')?.values() ?? [])] as OutboxOp[]).sort((a, b) => a.seq - b.seq);
  }
  audit(): AuditLog[] {
    return ([...(this.cache.get('audit_log')?.values() ?? [])] as AuditLog[]).sort((a, b) =>
      b.eseguita_at.localeCompare(a.eseguita_at),
    );
  }
  meta<T>(key: string): T | undefined {
    return (this.cache.get('meta')?.get(key) as MetaRecord | undefined)?.value as T | undefined;
  }
  raw(store: string): Array<{ id: string }> {
    return [...(this.cache.get(store)?.values() ?? [])];
  }

  // --- scritture ---------------------------------------------------------------------
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.applyBatch([{ tipo: 'put', store: 'meta', value: { id: key, value } as MetaRecord }]);
  }

  /** Scrive direttamente un batch (usato da UnitOfWork, sync engine e seed). */
  async applyBatch(ops: BatchOp[]): Promise<void> {
    try {
      await this.storage.writeBatch(ops);
    } catch (e) {
      throw new AppError('PERSISTENZA', 'Salvataggio sul dispositivo non riuscito. Riprova.', e);
    }
    for (const op of ops) {
      const st = this.cache.get(op.store)!;
      if (op.tipo === 'put') st.set(op.value.id, structuredClone(op.value));
      else st.delete(op.id);
    }
    this.emit();
  }

  unitOfWork(utenteId: string | null): UnitOfWork {
    return new UnitOfWork(this, utenteId);
  }

  async reset(): Promise<void> {
    await this.storage.clearAll();
    for (const s of TUTTI_GLI_STORE) this.cache.set(s, new Map());
    this.emit();
  }

  // --- notifiche ---------------------------------------------------------------------
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  getRevision(): number {
    return this.revision;
  }
  private emit() {
    this.revision++;
    for (const l of this.listeners) l();
  }
}

export interface SaveOptions {
  audit?: AuditLog['azione'];
  motivo?: string;
  /** Record solo locale (es. bozza): non viene accodato per la sincronizzazione. */
  soloLocale?: boolean;
}

export class UnitOfWork {
  private ops: BatchOp[] = [];
  private touched = new Map<string, BaseRecord>();

  constructor(
    private readonly db: LocalDb,
    private readonly utenteId: string | null,
  ) {}

  /** Restituisce il record come risulterà dopo il commit (vede le modifiche non ancora salvate). */
  peek<K extends EntityName>(entita: K, id: string): EntityMap[K] | undefined {
    return (this.touched.get(`${entita}:${id}`) as EntityMap[K] | undefined) ?? this.db.get(entita, id);
  }

  save<K extends EntityName>(entita: K, record: EntityMap[K], opts: SaveOptions = {}): EntityMap[K] {
    const now = this.db.nowIso();
    const prima = this.peek(entita, record.id);
    const stato: SyncStato = opts.soloLocale ? 'locale' : 'in_attesa';
    const next = {
      ...record,
      created_at: prima?.created_at ?? record.created_at ?? now,
      created_by: prima?.created_by ?? record.created_by ?? this.utenteId,
      updated_at: now,
      updated_by: this.utenteId,
      row_version: prima?.row_version ?? record.row_version ?? 0,
      device_id: this.db.deviceId,
      sync_stato: stato,
    } as EntityMap[K];
    this.touched.set(`${entita}:${record.id}`, next);
    this.ops.push({ tipo: 'put', store: entita, value: next });

    if (!opts.soloLocale) this.enqueue(entita, record.id, now);

    const azione = opts.audit ?? (prima ? 'modifica' : 'crea');
    const audit: AuditLog = {
      id: uuid(),
      entita,
      entita_id: record.id,
      azione,
      utente_id: this.utenteId,
      eseguita_at: now,
      prima: prima ?? null,
      dopo: next,
      motivo: opts.motivo ?? '',
      device_id: this.db.deviceId,
    };
    this.ops.push({ tipo: 'put', store: 'audit_log', value: audit });
    return next;
  }

  /**
   * Accoda la sincronizzazione dell'entità. Se esiste già un'operazione MAI inviata per la
   * stessa entità la si riutilizza (al momento dell'invio verrà letto lo stato più recente);
   * se l'operazione precedente è già partita o in errore se ne crea una nuova, così un
   * ritentativo non trasporta mai dati diversi da quelli del primo invio.
   */
  private enqueue(entita: EntityName, entitaId: string, now: string) {
    const pendingInBatch = this.ops.some(
      (o) => o.tipo === 'put' && o.store === 'outbox' && (o.value as OutboxOp).entita === entita && (o.value as OutboxOp).entita_id === entitaId,
    );
    if (pendingInBatch) return;
    const esistente = this.db
      .outbox()
      .find((o) => o.entita === entita && o.entita_id === entitaId && o.stato === 'in_attesa' && o.payload === null);
    if (esistente) return;
    const op: OutboxOp = {
      id: uuid(),
      entita,
      entita_id: entitaId,
      seq: this.db.nextOutboxSeq(),
      stato: 'in_attesa',
      tentativi: 0,
      ultimo_errore: null,
      created_at: now,
      updated_at: now,
      prossimo_tentativo_at: null,
      payload: null,
      base_versione: null,
      conflitto: null,
    };
    this.ops.push({ tipo: 'put', store: 'outbox', value: op });
  }

  async commit(): Promise<void> {
    await this.db.applyBatch(this.ops);
    this.ops = [];
    this.touched.clear();
  }
}
