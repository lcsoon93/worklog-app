/**
 * Contesto applicativo: espone i servizi, la sessione, i toast e il ciclo di sincronizzazione.
 * I componenti leggono i dati tramite i servizi e si ri-renderizzano a ogni modifica del
 * database locale (useSyncExternalStore sulla revisione del LocalDb).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Profilo } from '../domain/types';
import type { AppServices } from '../services/app-services';
import { messaggioErrore } from '../shared/errors';

type ToastTipo = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  tipo: ToastTipo;
  testo: string;
}

interface Ctx {
  s: AppServices;
  toast: (testo: string, tipo?: ToastTipo) => void;
  /** Esegue un'operazione mostrando l'esito reale: successo solo se la promessa è risolta. */
  run: <T>(fn: () => Promise<T>, successo?: string) => Promise<T | undefined>;
  /** Come run, ma restituisce true/false: da usare per operazioni senza valore di ritorno. */
  runOk: (fn: () => Promise<unknown>, successo?: string) => Promise<boolean>;
  kickSync: () => void;
  /** Numero di salvataggi in corso (barra di avanzamento globale). */
  inCorso: number;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const syncTimer = useRef<number | undefined>(undefined);
  const [inCorso, setInCorso] = useState(0);
  /**
   * Un'azione dell'utente alla volta: un secondo tocco mentre la precedente è ancora in corso
   * viene ignorato. Evita duplicati da doppio tap su tablet (clienti, interventi, ritorni…).
   */
  const occupato = useRef(false);
  const occupa = () => { if (occupato.current) return false; occupato.current = true; return true; };
  const libera = () => { occupato.current = false; };

  const toast = useCallback((testo: string, tipo: ToastTipo = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, tipo, testo }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'error' ? 6500 : 3200);
  }, []);

  const kickSync = useCallback(() => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void services.sync.ciclo().catch(() => undefined), 400);
  }, [services]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successo?: string) => {
      if (!occupa()) return undefined;
      setInCorso((n) => n + 1);
      try {
        const r = await fn();
        if (successo) toast(successo, 'ok');
        kickSync();
        return r;
      } catch (e) {
        console.error(e);
        toast(messaggioErrore(e), 'error');
        return undefined;
      } finally {
        setInCorso((n) => n - 1);
        libera();
      }
    },
    [toast, kickSync],
  );

  const runOk = useCallback(
    async (fn: () => Promise<unknown>, successo?: string) => {
      if (!occupa()) return false;
      setInCorso((n) => n + 1);
      try {
        await fn();
        if (successo) toast(successo, 'ok');
        kickSync();
        return true;
      } catch (e) {
        console.error(e);
        toast(messaggioErrore(e), 'error');
        return false;
      } finally {
        setInCorso((n) => n - 1);
        libera();
      }
    },
    [toast, kickSync],
  );

  // Ciclo di sincronizzazione periodico + al ritorno della rete.
  useEffect(() => {
    const id = window.setInterval(() => void services.sync.ciclo().catch(() => undefined), 5000);
    const onOnline = () => kickSync();
    // Al ritorno in primo piano (tablet riattivato) si riprova subito l'invio.
    const onVisibile = () => document.visibilityState === 'visible' && kickSync();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    document.addEventListener('visibilitychange', onVisibile);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      document.removeEventListener('visibilitychange', onVisibile);
    };
  }, [services, kickSync]);

  // Segnale di vita della giornata aperta (serve a proporre l'uscita dopo una chiusura anomala).
  useEffect(() => {
    const beat = () => {
      const u = services.utente();
      if (!u || u.ruolo !== 'operaio') return;
      const p = services.workday.presenzaAperta(u.id);
      if (p) void services.workday.segnale(p.id).catch(() => undefined);
    };
    const id = window.setInterval(beat, 60_000);
    const onVis = () => document.visibilityState === 'hidden' && beat();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [services]);

  const value = useMemo(() => ({ s: services, toast, run, runOk, kickSync, inCorso }), [services, toast, run, runOk, kickSync, inCorso]);
  return (
    <AppCtx.Provider value={value}>
      {inCorso > 0 && <div className="progress-top" role="progressbar" aria-label="Salvataggio in corso" data-testid="salvataggio-in-corso" />}
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`} data-testid={`toast-${t.tipo}`}>
            {t.testo}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider mancante');
  return c;
}

/** Servizi + ri-render automatico a ogni modifica dei dati locali. */
export function useData(): AppServices {
  const { s } = useApp();
  useSyncExternalStore(
    (cb) => s.db.subscribe(cb),
    () => s.db.getRevision(),
  );
  return s;
}

export function useUtente(): Profilo {
  const s = useData();
  const u = s.utente();
  if (!u) throw new Error('Utente non autenticato');
  return u;
}

/** Istante corrente aggiornato periodicamente: solo per il ridisegno, i calcoli usano i timestamp salvati. */
export function useNow(intervalMs = 1000): number {
  const { s } = useApp();
  const [now, setNow] = useState(() => s.db.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(s.db.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [s, intervalMs]);
  return now;
}
