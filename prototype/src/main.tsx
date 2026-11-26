import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { AppProvider } from './app/AppContext';
import { collegaServiceWorker, inizializzaPwa, segnalaAggiornamento, segnalaProntaOffline } from './app/pwa';
import { CONFIG, problemiConfig } from './config/ambiente';
import { seedDemo, VERSIONE_SEED } from './data/demo-seed';
import { IndexedDbStorage } from './data/storage';
import { AppServices } from './services/app-services';
import './ui/styles.css';

function schermataErrore(titolo: string, righe: string[]) {
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 720 }}>
      <h1>{titolo}</h1>
      {righe.map((r) => <p key={r}>{r}</p>)}
    </div>
  );
}

async function avvia() {
  const root = createRoot(document.getElementById('root')!);
  const problemi = problemiConfig(CONFIG);
  if (problemi.length) {
    root.render(schermataErrore('Configurazione non completa', [...problemi, 'Nessun dato è stato modificato. Correggi le variabili d\'ambiente e ricompila (docs/17-rilascio-e-configurazione.md).']));
    return;
  }
  try {
    // Accesso reale: archivio locale separato da quello della demo (stesso dominio, dati diversi).
    const reale = CONFIG.backend === 'supabase';
    const services = await AppServices.crea(
      new IndexedDbStorage(reale ? 'gestionale-comphas' : undefined),
      reale ? { supabase: { url: CONFIG.supabaseUrl, chiave: CONFIG.supabaseAnonKey } } : {},
    );
    // I dati dimostrativi vengono (ri)generati SOLO negli ambienti demo/test e solo quando
    // cambia la versione del seed. In produzione i dati locali non vengono mai cancellati.
    if (CONFIG.datiDimostrativi) {
      const seed = services.db.meta<{ versione: number }>('seed');
      if (!seed || seed.versione !== VERSIONE_SEED) {
        await services.db.reset();
        await services.db.init();
        await seedDemo(services.db);
      }
    }
    // Esposto solo per ispezione manuale in console durante la demo.
    if (CONFIG.ambiente !== 'produzione') (window as unknown as { __app: AppServices }).__app = services;
    root.render(
      <StrictMode>
        <AppProvider services={services}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  } catch (e) {
    console.error(e);
    root.render(schermataErrore("Impossibile avviare l'applicazione", [
      'Il browser non consente di salvare dati sul dispositivo (IndexedDB). Verifica di non essere in navigazione privata e che ci sia spazio libero.',
      `Dettaglio: ${String(e)}`,
    ]));
  }
}

inizializzaPwa();
if (import.meta.env.PROD) {
  // registerType "prompt": la nuova versione si attiva solo quando l'utente preme "Aggiorna".
  const update = registerSW({
    immediate: true,
    onNeedRefresh: segnalaAggiornamento,
    onOfflineReady: segnalaProntaOffline,
    // Controllo periodico di nuove versioni (ogni ora) per i tablet che restano sempre aperti.
    onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => void reg.update().catch(() => undefined), 3600_000); },
  });
  collegaServiceWorker(update);
}
void avvia();
