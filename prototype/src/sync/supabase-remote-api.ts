/**
 * Backend reale (Fase 15): invio della coda con la RPC `sync_apply` e ricezione delle modifiche
 * con `sync_pull` (migrazione 0016). Stesso contratto del server simulato.
 * La sessione (access/refresh token) è quella dell'accesso con nome utente e PIN, rinnovata
 * quando scade; senza sessione valida le operazioni restano in coda sul dispositivo.
 */
import type { LocalDb } from '../data/local-db';
import type { AuthSupabase, SessioneRemota } from './auth-supabase';
import { AppError } from '../shared/errors';
import { ErroreRete, ErroreServer, type PaginaRemota, type RemoteApi, type RichiestaSync, type RispostaSync } from './remote-api';

const MARGINE_MS = 60_000;

export class SupabaseRemoteApi implements RemoteApi {
  constructor(
    private readonly db: LocalDb,
    private readonly auth: AuthSupabase,
  ) {}

  private async sessione(forzaRinnovo = false): Promise<SessioneRemota> {
    const s = this.db.meta<SessioneRemota>('sessione_remota');
    if (!s) throw new ErroreServer(401, 'Nessuna sessione: accedi con nome utente e PIN per sincronizzare.');
    if (!forzaRinnovo && s.scade_at - MARGINE_MS > Date.now()) return s;
    try {
      const nuova = await this.auth.rinnova(s);
      await this.db.setMeta('sessione_remota', nuova);
      return nuova;
    } catch (e) {
      if (e instanceof AppError && e.codice === 'RETE') throw new ErroreRete(e.messaggio);
      throw new ErroreServer(401, e instanceof AppError ? e.messaggio : String(e));
    }
  }

  private async chiama<T>(funzione: string, corpo: unknown): Promise<T> {
    let s = await this.sessione();
    let r: Response;
    try {
      r = await this.auth.rpc(s, funzione, corpo);
      if (r.status === 401) {
        s = await this.sessione(true);
        r = await this.auth.rpc(s, funzione, corpo);
      }
    } catch (e) {
      if (e instanceof ErroreServer || e instanceof ErroreRete) throw e;
      throw new ErroreRete(e instanceof AppError ? e.messaggio : 'Server non raggiungibile');
    }
    const testo = await r.text();
    if (!r.ok) {
      let msg = testo;
      try {
        msg = (JSON.parse(testo) as { message?: string }).message ?? testo;
      } catch {
        /* testo semplice */
      }
      throw new ErroreServer(r.status, msg || `Errore ${r.status}`);
    }
    return JSON.parse(testo) as T;
  }

  applica(req: RichiestaSync): Promise<RispostaSync> {
    // utente_id non viene inviato: il server usa l'utente della sessione.
    const { utente_id: _ignorato, ...resto } = req;
    return this.chiama<RispostaSync>('sync_apply', { req: resto });
  }

  ricevi(dopo: number): Promise<PaginaRemota> {
    return this.chiama<PaginaRemota>('sync_pull', { dopo, limite: 200 });
  }
}
