/**
 * Scritture concorrenti sul database locale: un salvataggio dell'utente e la risposta del server
 * che arrivano nello stesso momento non devono perdere dati né far regredire la versione.
 */
import { describe, expect, it } from 'vitest';
import { MemoryStorage, type BatchOp } from '../../src/data/storage';
import type { BaseRecord, Profilo } from '../../src/domain/types';
import { AppServices } from '../../src/services/app-services';

/** Storage in memoria con un "cancello": finché è chiuso le scritture restano in sospeso. */
class StorageConCancello extends MemoryStorage {
  private cancello: Promise<void> | null = null;
  private apri: (() => void) | null = null;
  private filtro: (ops: BatchOp[]) => boolean = () => true;
  scrittureInAttesa = 0;
  /** Chiude il cancello per le scritture che soddisfano `filtro` (tutte, se omesso). */
  chiudi(filtro: (ops: BatchOp[]) => boolean = () => true) {
    this.filtro = filtro;
    this.cancello = new Promise((r) => (this.apri = r));
  }
  riapri() {
    this.apri?.();
    this.cancello = null;
  }
  override async writeBatch(ops: BatchOp[]) {
    if (this.cancello && this.filtro(ops)) {
      this.scrittureInAttesa++;
      await this.cancello;
      this.scrittureInAttesa--;
    }
    return super.writeBatch(ops);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function finche(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

async function ambiente() {
  const storage = new StorageConCancello();
  let svegliaServer: (() => void) | null = null;
  const s = await AppServices.crea(storage, {
    // Latenza del server simulato controllata dal test.
    sleep: () => new Promise<void>((r) => (svegliaServer = r)),
  });
  const now = Date.parse('2026-03-10T08:00:00Z');
  s.db.clock = () => now;
  const admin: Profilo = {
    id: '00000000-0000-4000-8000-000000000001', created_at: '2026-03-01T00:00:00Z', created_by: null, updated_at: '2026-03-01T00:00:00Z', updated_by: null,
    row_version: 1, sync_stato: 'sincronizzato', device_id: 'seed', deleted_at: null,
    nome: 'Ada', cognome: 'Admin', email: 'admin@test.local', telefono: '', ruolo: 'admin', attivo: true, colore: '#000', qualifica: '', ore_giornaliere_contratto: 8,
  };
  await s.db.applyBatch([
    { tipo: 'put', store: 'profili', value: admin },
    { tipo: 'put', store: 'mock_server', value: { id: 'stato', processate: {}, versioni: { [`profili:${admin.id}`]: 1 }, dati: {}, contatori: {}, applicazioni: 0 } as unknown as { id: string } },
  ]);
  await s.impostaSimulazione({ latenzaMs: 5 });
  await s.login(admin.email, 'demo');
  return {
    s,
    storage,
    serverInAttesa: () => svegliaServer !== null,
    svegliaServer: () => {
      const f = svegliaServer;
      svegliaServer = null;
      f?.();
    },
  };
}

/** Esegue cicli di sincronizzazione (svegliando il server simulato) finché la coda è vuota. */
async function sincronizzaTutto(a: Awaited<ReturnType<typeof ambiente>>) {
  for (let i = 0; i < 10 && a.s.sync.pendenti().some((o) => o.stato !== 'conflitto'); i++) {
    const p = a.s.sync.ciclo({ forza: true });
    for (let k = 0; k < 50; k++) {
      await tick();
      if (a.serverInAttesa()) a.svegliaServer();
    }
    await p;
  }
}

function datiServer(s: AppServices, id: string) {
  return s.api.stato().dati[`clienti:${id}`] as Record<string, unknown> | undefined;
}

describe('Scritture concorrenti (database locale e sincronizzazione)', () => {
  it('K01 – una modifica salvata mentre parte l\'invio non va persa', async () => {
    const amb = await ambiente();
    const { s, storage } = amb;
    const c = await s.planning.salvaCliente({ ragione_sociale: 'Prima versione' });

    // L'invio parte: la scrittura "in sincronizzazione" resta sospesa sul dispositivo.
    storage.chiudi();
    const ciclo = s.sync.ciclo();
    await finche(() => storage.scrittureInAttesa > 0);
    // Intanto l'utente modifica il cliente.
    const salvataggio = s.planning.salvaCliente({ ...s.db.get('clienti', c.id)!, ragione_sociale: 'Seconda versione' });
    await tick();
    storage.riapri();
    await finche(() => amb.serverInAttesa());
    amb.svegliaServer();
    await ciclo;
    await salvataggio;
    await sincronizzaTutto(amb);

    expect(s.sync.pendenti()).toEqual([]);
    expect(datiServer(s, c.id)?.ragione_sociale).toBe('Seconda versione');
    expect(s.db.get('clienti', c.id)?.ragione_sociale).toBe('Seconda versione');
    expect(s.db.get('clienti', c.id)?.sync_stato).toBe('sincronizzato');
  });

  it('K02 – la versione confermata dal server non regredisce (nessun falso conflitto)', async () => {
    const amb = await ambiente();
    const { s, storage } = amb;
    const c = await s.planning.salvaCliente({ ragione_sociale: 'Cliente' });

    const ciclo = s.sync.ciclo();
    await finche(() => amb.serverInAttesa());
    // Il server ha risposto; la scrittura dell'esito sul cliente resta sospesa.
    storage.chiudi((ops) => ops.some((o) => o.tipo === 'put' && o.store === 'clienti'));
    amb.svegliaServer();
    await finche(() => storage.scrittureInAttesa > 0);
    // L'utente salva una modifica partendo dalla versione precedente.
    const salvataggio = s.planning.salvaCliente({ ...s.db.get('clienti', c.id)!, telefono: '0123' });
    await tick();
    storage.riapri();
    await ciclo;
    await salvataggio;
    await sincronizzaTutto(amb);

    expect(s.sync.pendenti().filter((o) => o.stato === 'conflitto')).toEqual([]);
    expect(s.sync.pendenti()).toEqual([]);
    const locale = s.db.get('clienti', c.id) as BaseRecord & { telefono: string };
    expect(locale.row_version).toBe(2);
    expect(locale.telefono).toBe('0123');
    expect(datiServer(s, c.id)?.telefono).toBe('0123');
  });

  it('K03 – le scritture locali sono applicate nell\'ordine in cui sono richieste', async () => {
    const { s, storage } = await ambiente();
    storage.chiudi();
    const p1 = s.db.setMeta('prova', 1);
    const p2 = s.db.setMeta('prova', 2);
    await tick();
    storage.riapri();
    await Promise.all([p1, p2]);
    expect(s.db.meta('prova')).toBe(2);
    // Una scrittura fallita non blocca le successive.
    storage.failNextWrite = true;
    await expect(s.db.setMeta('prova', 3)).rejects.toThrow();
    await s.db.setMeta('prova', 4);
    expect(s.db.meta('prova')).toBe(4);
  });
});
