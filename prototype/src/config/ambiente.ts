/**
 * Configurazione per ambiente (Fase 8). Tutti i valori arrivano da variabili VITE_* lette in
 * fase di build (file .env.<modalità>, vedi .env.example e docs/17-rilascio-e-configurazione.md).
 * Nessun segreto: la chiave "anon" di Supabase è pubblica per progetto e protetta da RLS; le
 * chiavi di servizio NON vanno mai messe in variabili VITE_* (finirebbero nel bundle).
 *
 * - demo        → dati dimostrativi rigenerati, server simulato, striscia "PROTOTIPO" (GitHub Pages);
 * - test        → server simulato e dati dimostrativi, oppure (VITE_BACKEND=supabase) accesso reale
 *                  con gli account Supabase, senza dati dimostrativi; striscia "AMBIENTE DI TEST";
 * - produzione  → nessun dato dimostrativo, backend reale obbligatorio.
 */
export type NomeAmbiente = 'demo' | 'test' | 'produzione';
export type TipoBackend = 'simulato' | 'supabase';

export interface ConfigAmbiente {
  ambiente: NomeAmbiente;
  backend: TipoBackend;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Chiave pubblica VAPID per le notifiche push (vuota = push non disponibili). */
  pushVapidPublicKey: string;
  /** Rigenera i dati dimostrativi al cambio di versione del seed (mai in produzione). */
  datiDimostrativi: boolean;
  versioneApp: string;
}

type Env = Record<string, string | boolean | undefined>;

export function leggiConfig(env: Env): ConfigAmbiente {
  const str = (k: string, d = '') => (typeof env[k] === 'string' ? String(env[k]).trim() : d);
  const ambiente = (['demo', 'test', 'produzione'].includes(str('VITE_AMBIENTE')) ? str('VITE_AMBIENTE') : 'demo') as NomeAmbiente;
  const backend = (str('VITE_BACKEND') === 'supabase' ? 'supabase' : 'simulato') as TipoBackend;
  return {
    ambiente,
    backend,
    supabaseUrl: str('VITE_SUPABASE_URL'),
    supabaseAnonKey: str('VITE_SUPABASE_ANON_KEY'),
    pushVapidPublicKey: str('VITE_PUSH_VAPID_PUBLIC_KEY'),
    // Con l'accesso reale (Supabase) niente dati dimostrativi: si lavora con gli account veri.
    datiDimostrativi: ambiente !== 'produzione' && backend === 'simulato',
    versioneApp: str('VITE_VERSIONE_APP', '0.1.0'),
  };
}

/** Problemi che impediscono l'avvio con questa configurazione (mostrati all'avvio, mai ignorati). */
export function problemiConfig(c: ConfigAmbiente): string[] {
  const out: string[] = [];
  if (c.ambiente === 'produzione' && c.backend !== 'supabase') out.push('In produzione è obbligatorio un backend reale (VITE_BACKEND=supabase): il server simulato non conserva i dati fuori dal dispositivo.');
  if (c.backend === 'supabase') {
    if (!/^https:\/\/.+/.test(c.supabaseUrl)) out.push('VITE_SUPABASE_URL mancante o non https.');
    if (!c.supabaseAnonKey) out.push('VITE_SUPABASE_ANON_KEY mancante.');
    if (c.ambiente === 'produzione') out.push("L'accesso reale con Supabase è attivo, ma la sincronizzazione dei dati e l'archiviazione dei file non sono ancora implementate: in produzione i dati resterebbero sul singolo tablet. Usa l'ambiente di test (VITE_AMBIENTE=test) per il collaudo dell'accesso. Vedi docs/17-rilascio-e-configurazione.md §6.");
  }
  return out;
}

export const CONFIG: ConfigAmbiente = leggiConfig((import.meta as unknown as { env?: Env }).env ?? {});
