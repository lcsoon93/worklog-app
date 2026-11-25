/**
 * Adattatori di persistenza locale. L'app usa IndexedDB; i test usano l'adattatore in memoria
 * (stesso contratto). Nessun componente UI accede direttamente a questi adattatori.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { ENTITY_NAMES } from '../domain/types';

export const STORE_TECNICI = ['outbox', 'audit_log', 'meta', 'mock_server'] as const;
export const TUTTI_GLI_STORE: string[] = [...ENTITY_NAMES, ...STORE_TECNICI];

export type BatchOp =
  | { tipo: 'put'; store: string; value: { id: string } }
  | { tipo: 'delete'; store: string; id: string };

export interface StorageAdapter {
  loadAll(): Promise<Record<string, Array<{ id: string }>>>;
  /** Scrive tutte le operazioni in un'unica transazione: o tutte o nessuna. */
  writeBatch(ops: BatchOp[]): Promise<void>;
  clearAll(): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  private data = new Map<string, Map<string, { id: string }>>();
  /** Per i test: fa fallire la prossima scrittura. */
  failNextWrite = false;

  constructor() {
    for (const s of TUTTI_GLI_STORE) this.data.set(s, new Map());
  }
  async loadAll() {
    const out: Record<string, Array<{ id: string }>> = {};
    for (const [k, v] of this.data) out[k] = [...v.values()].map((x) => structuredClone(x));
    return out;
  }
  async writeBatch(ops: BatchOp[]) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Scrittura locale fallita (simulata)');
    }
    for (const op of ops) {
      const st = this.data.get(op.store);
      if (!st) throw new Error(`Store sconosciuto: ${op.store}`);
      if (op.tipo === 'put') st.set(op.value.id, structuredClone(op.value));
      else st.delete(op.id);
    }
  }
  async clearAll() {
    for (const st of this.data.values()) st.clear();
  }
}

const DB_NAME = 'gestionale-demo';
// v2 (Fase 3): aggiunto lo store richieste_correzione; v3 (Fase 5): materiali, magazzini,
// movimenti_magazzino. L'upgrade crea solo gli store mancanti: i dati esistenti restano.
const DB_VERSION = 3;

export class IndexedDbStorage implements StorageAdapter {
  private dbPromise: Promise<IDBPDatabase>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB(name, DB_VERSION, {
      upgrade(db) {
        for (const s of TUTTI_GLI_STORE) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      },
    });
  }
  async loadAll() {
    const db = await this.dbPromise;
    const out: Record<string, Array<{ id: string }>> = {};
    const tx = db.transaction(TUTTI_GLI_STORE, 'readonly');
    await Promise.all(
      TUTTI_GLI_STORE.map(async (s) => {
        out[s] = await tx.objectStore(s).getAll();
      }),
    );
    await tx.done;
    return out;
  }
  async writeBatch(ops: BatchOp[]) {
    if (ops.length === 0) return;
    const db = await this.dbPromise;
    const stores = [...new Set(ops.map((o) => o.store))];
    const tx = db.transaction(stores, 'readwrite');
    for (const op of ops) {
      if (op.tipo === 'put') void tx.objectStore(op.store).put(op.value);
      else void tx.objectStore(op.store).delete(op.id);
    }
    await tx.done;
  }
  async clearAll() {
    const db = await this.dbPromise;
    const tx = db.transaction(TUTTI_GLI_STORE, 'readwrite');
    await Promise.all(TUTTI_GLI_STORE.map((s) => tx.objectStore(s).clear()));
    await tx.done;
  }
}
