/**
 * Integrazione PWA (Fase 7): aggiornamento dell'app, installazione, schermo intero,
 * archiviazione persistente. Uno store minimale che la UI legge con useSyncExternalStore.
 *
 * Aggiornamenti senza perdita di dati: i dati stanno in IndexedDB, che il Service Worker non
 * tocca. La nuova versione si attiva solo quando l'utente preme "Aggiorna" (registerType
 * "prompt"), così un aggiornamento non interrompe un'operazione in corso.
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface StatoPwa {
  aggiornamentoDisponibile: boolean;
  prontaOffline: boolean;
  installabile: boolean;
  installata: boolean;
  archiviazionePersistente: boolean | null;
}

let stato: StatoPwa = {
  aggiornamentoDisponibile: false,
  prontaOffline: false,
  installabile: false,
  installata: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true),
  archiviazionePersistente: null,
};
const ascoltatori = new Set<() => void>();
let applicaAggiornamento: ((ricarica?: boolean) => Promise<void>) | null = null;
let promptInstallazione: BeforeInstallPromptEvent | null = null;

function imposta(patch: Partial<StatoPwa>) {
  stato = { ...stato, ...patch };
  for (const l of ascoltatori) l();
}

export function usePwa(): StatoPwa {
  return useSyncExternalStore(
    (cb) => {
      ascoltatori.add(cb);
      return () => ascoltatori.delete(cb);
    },
    () => stato,
  );
}

/** Chiamata da main.tsx dopo la registrazione del Service Worker. */
export function collegaServiceWorker(update: (ricarica?: boolean) => Promise<void>) {
  applicaAggiornamento = update;
}
export function segnalaAggiornamento() {
  imposta({ aggiornamentoDisponibile: true });
}
export function segnalaProntaOffline() {
  imposta({ prontaOffline: true });
}

export async function aggiornaApp(): Promise<void> {
  if (applicaAggiornamento) await applicaAggiornamento(true);
  else window.location.reload();
}

export function inizializzaPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstallazione = e as BeforeInstallPromptEvent;
    imposta({ installabile: true });
  });
  window.addEventListener('appinstalled', () => imposta({ installabile: false, installata: true }));
  // Chiede al browser di non cancellare i dati locali in caso di poco spazio (timbrature non ancora inviate).
  void navigator.storage?.persist?.().then((ok) => imposta({ archiviazionePersistente: ok })).catch(() => undefined);
}

export async function installaApp(): Promise<boolean> {
  if (!promptInstallazione) return false;
  await promptInstallazione.prompt();
  const scelta = await promptInstallazione.userChoice;
  promptInstallazione = null;
  imposta({ installabile: false, installata: scelta.outcome === 'accepted' });
  return scelta.outcome === 'accepted';
}

export function schermoInteroSupportato(): boolean {
  return typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen);
}

export async function alternaSchermoIntero(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
}

/** Dispositivo Apple (installazione da "Condividi → Aggiungi a Home"). */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
