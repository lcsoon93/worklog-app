/**
 * Accesso reale con Supabase Auth (Fase 12), senza dipendenze aggiuntive: chiamate REST con fetch.
 *
 * - Nome utente + PIN → email tecnica (config/accesso.ts) + password su /auth/v1/token.
 * - Profilo e dati aziendali → RPC public.mio_profilo() (migrazione 0012), che restituisce solo
 *   i dati dell'utente autenticato.
 * - Accesso senza rete: dopo un accesso riuscito il dispositivo conserva un'impronta PBKDF2 del
 *   PIN (mai il PIN in chiaro), così il tecnico può entrare anche in cantiere senza copertura.
 */
import { AMMINISTRATORI_OPERATIVI, emailTecnica, normalizzaUsername } from '../config/accesso';
import type { Profilo } from '../domain/types';
import { AppError } from './errors';

export interface SessioneRemota {
  user_id: string;
  access_token: string;
  refresh_token: string;
  /** Scadenza dell'access token (ms epoch). */
  scade_at: number;
}

export interface DatiAziendaRemoti {
  ragione_sociale: string;
  indirizzo: string;
  partita_iva: string | null;
  telefono: string;
  email: string;
  sito_web: string | null;
  logo_svg: string | null;
}

export interface CredenzialeOffline {
  profilo_id: string;
  sale: string;
  impronta: string;
  iterazioni: number;
}

type Fetch = typeof fetch;

export class AuthSupabase {
  constructor(
    private readonly url: string,
    private readonly chiave: string,
    private readonly fetchFn: Fetch = (...a) => fetch(...a),
  ) {}

  private async chiama(percorso: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(`${this.url.replace(/\/$/, '')}${percorso}`, init);
    } catch {
      throw new AppError('RETE', 'Server non raggiungibile: controlla la connessione.');
    }
  }

  /** Accesso con nome utente e PIN. Errore NON_CONSENTITO se le credenziali sono sbagliate. */
  async accedi(username: string, pin: string): Promise<SessioneRemota> {
    const r = await this.chiama('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: this.chiave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailTecnica(username), password: pin }),
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 400 || r.status === 401) throw new AppError('NON_CONSENTITO', 'Nome utente o PIN non corretti.');
    if (r.status === 429) throw new AppError('NON_CONSENTITO', 'Troppi tentativi di accesso: attendi qualche minuto e riprova.');
    if (!r.ok || typeof d.access_token !== 'string') throw new AppError('RETE', `Accesso non riuscito (errore ${r.status}). Riprova tra poco.`);
    return {
      user_id: String((d.user as { id?: string } | undefined)?.id ?? ''),
      access_token: d.access_token,
      refresh_token: String(d.refresh_token ?? ''),
      scade_at: Date.now() + Number(d.expires_in ?? 3600) * 1000,
    };
  }

  /** Profilo dell'utente autenticato e dati aziendali. Profilo null = account non abilitato. */
  async mioProfilo(s: SessioneRemota): Promise<{ profilo: Record<string, unknown> | null; azienda: DatiAziendaRemoti | null }> {
    const r = await this.chiama('/rest/v1/rpc/mio_profilo', {
      method: 'POST',
      headers: { apikey: this.chiave, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new AppError('RETE', `Profilo non disponibile (errore ${r.status}). Riprova tra poco.`);
    const d = (await r.json()) as { profilo: Record<string, unknown> | null; azienda: DatiAziendaRemoti | null } | null;
    return { profilo: d?.profilo ?? null, azienda: d?.azienda ?? null };
  }

  /** Rinnova la sessione con il refresh token (Fase 15). Errore NON_CONSENTITO se va ripetuto l'accesso. */
  async rinnova(s: SessioneRemota): Promise<SessioneRemota> {
    const r = await this.chiama('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: this.chiave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 400 || r.status === 401) throw new AppError('NON_CONSENTITO', 'Sessione scaduta: esci e accedi di nuovo per sincronizzare.');
    if (!r.ok || typeof d.access_token !== 'string') throw new AppError('RETE', `Rinnovo della sessione non riuscito (errore ${r.status}).`);
    return {
      user_id: String((d.user as { id?: string } | undefined)?.id ?? s.user_id),
      access_token: d.access_token,
      refresh_token: String(d.refresh_token ?? s.refresh_token),
      scade_at: Date.now() + Number(d.expires_in ?? 3600) * 1000,
    };
  }

  /** Chiamata RPC autenticata (Fase 15: sincronizzazione). */
  async rpc(s: SessioneRemota, funzione: string, corpo: unknown): Promise<Response> {
    return this.chiama(`/rest/v1/rpc/${funzione}`, {
      method: 'POST',
      headers: { apikey: this.chiave, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  }

  /** Chiude la sessione sul server (se raggiungibile). Non blocca mai l'uscita dall'app. */
  async esci(s: SessioneRemota): Promise<void> {
    await this.chiama('/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: this.chiave, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => undefined);
  }
}

/** Converte la riga di app.profili ricevuta dal server nel record locale. */
export function profiloDaServer(p: Record<string, unknown>, amministratoriOperativi: string[] = AMMINISTRATORI_OPERATIVI): Profilo {
  const username = p.username ? String(p.username) : '';
  return {
    amministratore_operativo: p.ruolo !== 'admin' && (p.amministratore_operativo === true || (!!username && amministratoriOperativi.includes(username))),
    id: String(p.id),
    nome: String(p.nome ?? ''),
    cognome: String(p.cognome ?? ''),
    username: p.username ? String(p.username) : undefined,
    email: String(p.email ?? ''),
    telefono: String(p.telefono ?? ''),
    ruolo: p.ruolo === 'admin' ? 'admin' : 'operaio',
    attivo: p.attivo !== false,
    colore: String(p.colore ?? '#0f766e'),
    qualifica: String(p.qualifica ?? ''),
    ore_giornaliere_contratto: Number(p.ore_giornaliere_contratto ?? 8),
    created_at: String(p.created_at ?? new Date().toISOString()),
    created_by: (p.created_by as string | null) ?? null,
    updated_at: String(p.updated_at ?? new Date().toISOString()),
    updated_by: (p.updated_by as string | null) ?? null,
    row_version: Number(p.row_version ?? 1),
    sync_stato: 'sincronizzato',
    device_id: (p.device_id as string | null) ?? 'server',
    deleted_at: null,
  } as Profilo;
}

// --- impronta del PIN per l'accesso senza rete --------------------------------------------

const ITERAZIONI = 210_000;
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const daHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function deriva(pin: string, sale: Uint8Array, iterazioni: number): Promise<string> {
  const chiave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sale, iterations: iterazioni }, chiave, 256);
  return hex(bits);
}

export async function creaCredenzialeOffline(profiloId: string, pin: string): Promise<CredenzialeOffline> {
  const sale = crypto.getRandomValues(new Uint8Array(16));
  return { profilo_id: profiloId, sale: hex(sale), impronta: await deriva(pin, sale, ITERAZIONI), iterazioni: ITERAZIONI };
}

export async function verificaCredenzialeOffline(c: CredenzialeOffline, pin: string): Promise<boolean> {
  return (await deriva(pin, daHex(c.sale), c.iterazioni)) === c.impronta;
}

export const chiaveOffline = (username: string) => `accesso_offline:${normalizzaUsername(username)}`;
