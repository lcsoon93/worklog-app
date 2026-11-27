/** Fase 15: sincronizzazione tra dispositivi (invio + ricezione) e client Supabase. */
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/data/storage';
import type { BaseRecord, EntityName, Profilo } from '../../src/domain/types';
import { atLocal } from '../../src/domain/time';
import { AppServices } from '../../src/services/app-services';
import { AuthSupabase } from '../../src/sync/auth-supabase';
import { ErroreServer, type PaginaRemota, type RemoteApi, type RichiestaSync, type RispostaSync } from '../../src/sync/remote-api';
import { SupabaseRemoteApi } from '../../src/sync/supabase-remote-api';

/** Server condiviso in memoria con le stesse regole di base di sync_apply / sync_pull (senza permessi). */
class ServerCondiviso {
  seq = 0;
  record = new Map<string, { entita: EntityName; dati: Record<string, unknown> & { id: string }; row_version: number; seq: number }>();
  numero = 0;
  api(): RemoteApi {
    return {
      applica: async (req: RichiestaSync): Promise<RispostaSync> => {
        const k = `${req.entita}:${req.entita_id}`;
        const cur = this.record.get(k);
        if ((cur?.row_version ?? 0) !== req.base_versione) return { esito: 'conflitto', op_id: req.op_id, versione_server: cur?.row_version ?? 0, dati_server: cur?.dati ?? {} };
        const patch: Record<string, unknown> = {};
        if (req.entita === 'rapportini' && req.payload.stato !== 'bozza' && !req.payload.numero) patch.numero = `R-2026-${String(++this.numero).padStart(4, '0')}`;
        const v = (cur?.row_version ?? 0) + 1;
        this.record.set(k, { entita: req.entita, dati: { ...req.payload, ...patch, row_version: v } as unknown as Record<string, unknown> & { id: string }, row_version: v, seq: ++this.seq });
        return { esito: 'ok', op_id: req.op_id, row_version: v, patch, extra: [], ricevuta_at: new Date().toISOString() };
      },
      ricevi: async (dopo: number): Promise<PaginaRemota> => {
        const righe = [...this.record.values()].filter((r) => r.seq > dopo).sort((a, b) => a.seq - b.seq);
        return { record: righe, ultimo: righe.at(-1)?.seq ?? dopo, altri: false };
      },
    };
  }
}

const base = (id: string): BaseRecord => ({ id, created_at: '2026-03-01T00:00:00Z', created_by: null, updated_at: '2026-03-01T00:00:00Z', updated_by: null, row_version: 1, sync_stato: 'sincronizzato', device_id: 'server', deleted_at: null });
const comphas: Profilo = { ...base('00000000-0000-4000-8000-0000000000a1'), nome: 'Gianmario', cognome: 'Prova', email: 'admin@x.it', username: 'admin', telefono: '', ruolo: 'admin', attivo: true, colore: '#000000', qualifica: '', ore_giornaliere_contratto: 8 };
const luca: Profilo = { ...base('00000000-0000-4000-8000-0000000000b1'), nome: 'Luca', cognome: 'Prova', email: 'luca@x.it', username: 'tecnico', telefono: '', ruolo: 'operaio', attivo: true, colore: '#000000', qualifica: 'Tecnico', ore_giornaliere_contratto: 8, amministratore_operativo: true };

async function dispositivo(server: ServerCondiviso, utente: Profilo) {
  const s = await AppServices.crea(new MemoryStorage(), { remoto: server.api() });
  s.db.clock = () => atLocal('2026-03-10', '12:00');
  await s.db.applyBatch([{ tipo: 'put', store: 'profili', value: utente }]);
  await s.login(utente.email, 'demo');
  return s;
}

describe('sincronizzazione tra dispositivi', () => {
  it('S01 Luca invia, Comphas riceve e restituisce, Luca corregge, Comphas approva', async () => {
    const server = new ServerCondiviso();
    for (const p of [comphas, luca]) server.record.set(`profili:${p.id}`, { entita: 'profili', dati: { ...p }, row_version: 1, seq: ++server.seq });
    const L = await dispositivo(server, luca);
    const A = await dispositivo(server, comphas);
    await L.sync.ciclo({ forza: true }); // riceve i profili
    expect(L.planning.operai().map((o) => o.nome)).toEqual(['Luca']);

    // Luca: nuovo cliente dal campo e rapporto autonomo inviato.
    const { cliente } = await L.planning.creaClienteDaCampo({ ragione_sociale: 'Cliente Sincro' });
    const bozza = await L.report.creaBozza({ tipo: 'rapido', cliente_id: cliente.id, sede_id: null, intervento_id: null });
    await L.report.invia({ ...bozza, descrizione_lavoro: 'Lavoro sincronizzato fra dispositivi' });
    const e1 = await L.sync.ciclo({ forza: true });
    expect(e1.errori + e1.conflitti).toBe(0);
    expect(L.db.get('rapportini', bozza.id)?.numero).toBe('R-2026-0001');

    // Comphas riceve cliente e rapporto, lo restituisce.
    const e2 = await A.sync.ciclo({ forza: true });
    expect(e2.ricevuti).toBeGreaterThanOrEqual(3);
    expect(A.report.daApprovare().map((r) => r.id)).toContain(bozza.id);
    expect(A.db.get('clienti', cliente.id)?.ragione_sociale).toBe('Cliente Sincro');
    await A.report.restituisci(bozza.id, 'Specifica il materiale usato');
    await A.sync.ciclo({ forza: true });

    // Luca riceve la restituzione, corregge e reinvia.
    await L.sync.ciclo({ forza: true });
    const daCorreggere = L.db.get('rapportini', bozza.id)!;
    expect(L.report.fase(daCorreggere)).toBe('da_correggere');
    await L.report.correggi({ ...daCorreggere, descrizione_lavoro: 'Lavoro sincronizzato fra dispositivi, raccordo in ottone' }, 'Aggiunto il materiale');
    await L.sync.ciclo({ forza: true });

    // Comphas riceve la correzione e approva; Luca vede l'approvazione.
    await A.sync.ciclo({ forza: true });
    expect(A.db.get('rapportini', bozza.id)?.revisione).toBe(1);
    await A.report.approva(bozza.id);
    await A.sync.ciclo({ forza: true });
    await L.sync.ciclo({ forza: true });
    expect(L.report.fase(L.db.get('rapportini', bozza.id)!)).toBe('approvato');
    expect(L.sync.pendenti()).toHaveLength(0);
    expect(A.sync.pendenti()).toHaveLength(0);
  });

  it('S02 una modifica locale in coda non viene sovrascritta dalla ricezione; il conflitto resta da risolvere', async () => {
    const server = new ServerCondiviso();
    for (const p of [comphas, luca]) server.record.set(`profili:${p.id}`, { entita: 'profili', dati: { ...p }, row_version: 1, seq: ++server.seq });
    const L = await dispositivo(server, luca);
    const A = await dispositivo(server, comphas);
    const c = await L.planning.salvaCliente({ ragione_sociale: 'Cliente Condiviso' });
    await L.sync.ciclo({ forza: true });
    await A.sync.ciclo({ forza: true });
    // Entrambi modificano lo stesso cliente; Comphas invia per primo.
    await A.planning.salvaCliente({ ...A.db.get('clienti', c.id)!, telefono: '081 111' });
    await A.sync.ciclo({ forza: true });
    await L.planning.salvaCliente({ ...L.db.get('clienti', c.id)!, referente: 'Sig. Rossi' });
    const e = await L.sync.ciclo({ forza: true });
    expect(e.conflitti).toBe(1);
    // La versione locale non è stata sovrascritta dalla ricezione.
    expect(L.db.get('clienti', c.id)?.referente).toBe('Sig. Rossi');
    expect(L.db.get('clienti', c.id)?.sync_stato).toBe('conflitto');
  });
});

describe('client Supabase', () => {
  const sessione = (scade: number) => ({ user_id: 'u', access_token: 'vecchio', refresh_token: 'r1', scade_at: scade });

  it('S03 rinnova la sessione scaduta, ritenta su 401, traduce gli errori', async () => {
    const chiamate: Array<{ url: string; auth?: string }> = [];
    let rifiuta401 = false;
    const finto = (async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      chiamate.push({ url: String(url).replace('https://x.supabase.co', ''), auth: h.Authorization });
      if (String(url).includes('grant_type=refresh_token')) return new Response(JSON.stringify({ access_token: 'nuovo', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
      if (rifiuta401 && h.Authorization === 'Bearer nuovo') { rifiuta401 = false; return new Response('{"message":"JWT expired"}', { status: 401 }); }
      if (String(url).includes('sync_pull')) return new Response(JSON.stringify({ record: [], ultimo: 0, altri: false }), { status: 200 });
      return new Response('{"message":"Operazione non consentita per questo utente (profili)."}', { status: 403 });
    }) as unknown as typeof fetch;
    const s = await AppServices.crea(new MemoryStorage());
    const api = new SupabaseRemoteApi(s.db, new AuthSupabase('https://x.supabase.co/', 'k', finto));
    await expect(api.ricevi(0)).rejects.toBeInstanceOf(ErroreServer); // nessuna sessione
    await s.db.setMeta('sessione_remota', sessione(Date.now() - 1000));
    await api.ricevi(0);
    expect(chiamate.map((c) => c.url)).toEqual(['/auth/v1/token?grant_type=refresh_token', '/rest/v1/rpc/sync_pull']);
    expect(s.db.meta<{ refresh_token: string }>('sessione_remota')?.refresh_token).toBe('r2');
    rifiuta401 = true;
    await api.ricevi(0);
    expect(chiamate.slice(-3).map((c) => c.url)).toEqual(['/rest/v1/rpc/sync_pull', '/auth/v1/token?grant_type=refresh_token', '/rest/v1/rpc/sync_pull']);
    const err = await api.applica({ op_id: 'o', device_id: 'd', utente_id: 'u', entita: 'profili', entita_id: 'x', base_versione: 0, payload: { id: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ErroreServer);
    expect((err as ErroreServer).status).toBe(403);
    expect((err as ErroreServer).message).toMatch(/non consentita/);
  });
});
