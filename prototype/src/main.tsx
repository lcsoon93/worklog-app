import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { AppProvider } from './app/AppContext';
import { seedDemo, VERSIONE_SEED } from './data/demo-seed';
import { IndexedDbStorage } from './data/storage';
import { AppServices } from './services/app-services';
import './ui/styles.css';

async function avvia() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const services = await AppServices.crea(new IndexedDbStorage());
    const seed = services.db.meta<{ versione: number }>('seed');
    if (!seed || seed.versione !== VERSIONE_SEED) {
      await services.db.reset();
      await services.db.init();
      await seedDemo(services.db);
    }
    // Esposto solo per ispezione manuale in console durante la demo.
    (window as unknown as { __app: AppServices }).__app = services;
    root.render(
      <StrictMode>
        <AppProvider services={services}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  } catch (e) {
    console.error(e);
    root.render(
      <div style={{ padding: 32, fontFamily: 'system-ui' }}>
        <h1>Impossibile avviare l'applicazione</h1>
        <p>Il browser non consente di salvare dati sul dispositivo (IndexedDB). Verifica di non essere in navigazione privata.</p>
        <pre>{String(e)}</pre>
      </div>,
    );
  }
}

if (import.meta.env.PROD) registerSW({ immediate: true });
void avvia();
