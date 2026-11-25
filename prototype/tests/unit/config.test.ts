/** Fase 8: la configurazione di produzione senza backend reale blocca l'avvio; demo e test no. */
import { describe, expect, it } from 'vitest';
import { leggiConfig, problemiConfig } from '../../src/config/ambiente';

describe('Fase 8 – configurazione per ambiente', () => {
  it('C01 demo predefinita; test con dati di prova; produzione bloccata finché manca il backend reale', () => {
    const demo = leggiConfig({});
    expect(demo).toMatchObject({ ambiente: 'demo', backend: 'simulato', datiDimostrativi: true });
    expect(problemiConfig(demo)).toEqual([]);
    expect(problemiConfig(leggiConfig({ VITE_AMBIENTE: 'test' }))).toEqual([]);
    const prodSimulata = leggiConfig({ VITE_AMBIENTE: 'produzione' });
    expect(prodSimulata.datiDimostrativi).toBe(false);
    expect(problemiConfig(prodSimulata).join(' ')).toMatch(/obbligatorio un backend reale/);
    const prod = leggiConfig({ VITE_AMBIENTE: 'produzione', VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_ANON_KEY: '' });
    const p = problemiConfig(prod).join(' ');
    expect(p).toMatch(/non https/);
    expect(p).toMatch(/ANON_KEY mancante/);
    expect(p).toMatch(/non è ancora implementata/);
  });
});
