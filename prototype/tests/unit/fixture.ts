import { MemoryStorage } from '../../src/data/storage';
import { atLocal } from '../../src/domain/time';
import type { BaseRecord, Cliente, Profilo, SedeCliente } from '../../src/domain/types';
import { AppServices } from '../../src/services/app-services';

export const H = 3600_000;
export const M = 60_000;

/** Ambiente di test: storage in memoria, orologio controllabile, latenza server nulla. */
export async function creaAmbiente(start = atLocal('2026-03-10', '07:55')) {
  const storage = new MemoryStorage();
  const s = await AppServices.crea(storage, { sleep: async () => {} });
  let now = start;
  s.db.clock = () => now;
  await s.impostaSimulazione({ latenzaMs: 0 });

  const base = (id: string): BaseRecord => ({
    id,
    created_at: new Date(now).toISOString(),
    created_by: null,
    updated_at: new Date(now).toISOString(),
    updated_by: null,
    row_version: 1,
    sync_stato: 'sincronizzato',
    device_id: 'seed',
    deleted_at: null,
  });
  const admin: Profilo = { ...base('00000000-0000-4000-8000-000000000001'), nome: 'Ada', cognome: 'Admin', email: 'admin@test.local', telefono: '', ruolo: 'admin', attivo: true, colore: '#000', qualifica: '', ore_giornaliere_contratto: 8 };
  const op: Profilo = { ...base('00000000-0000-4000-8000-000000000002'), nome: 'Otto', cognome: 'Operaio', email: 'op@test.local', telefono: '', ruolo: 'operaio', attivo: true, colore: '#000', qualifica: '', ore_giornaliere_contratto: 8 };
  const cliA: Cliente = { ...base('00000000-0000-4000-8000-00000000000a'), ragione_sociale: 'Cliente A', partita_iva: '', email: '', telefono: '', referente: '', note: '', attivo: true };
  const cliB: Cliente = { ...base('00000000-0000-4000-8000-00000000000b'), ragione_sociale: 'Cliente B', partita_iva: '', email: '', telefono: '', referente: '', note: '', attivo: true };
  const sedeA: SedeCliente = { ...base('00000000-0000-4000-8000-0000000000a1'), cliente_id: cliA.id, nome: 'Sede A', indirizzo: '', cap: '', citta: '', provincia: '', referente: '', telefono: '', note_accesso: '', attiva: true };
  const rows: Array<[string, BaseRecord]> = [['profili', admin], ['profili', op], ['clienti', cliA], ['clienti', cliB], ['sedi_cliente', sedeA]];
  const versioni: Record<string, number> = {};
  for (const [e, r] of rows) versioni[`${e}:${r.id}`] = 1;
  await s.db.applyBatch([
    ...rows.map(([store, value]) => ({ tipo: 'put' as const, store, value })),
    { tipo: 'put', store: 'mock_server', value: { id: 'stato', processate: {}, versioni, dati: {}, contatori: {}, applicazioni: 0 } as unknown as { id: string } },
  ]);

  return {
    s,
    storage,
    admin,
    op,
    cliA,
    cliB,
    sedeA,
    /** Imposta l'orologio a una certa ora del giorno di test (o di un'altra data). */
    alle(hhmm: string, date = '2026-03-10') {
      now = atLocal(date, hhmm);
    },
    avanza(ms: number) {
      now += ms;
    },
    now: () => now,
    async come(u: Profilo) {
      await s.login(u.email, 'demo');
    },
  };
}
