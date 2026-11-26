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
    expect(p).toMatch(/sincronizzazione dei dati .* non sono ancora implementate/);
    // In test l'accesso reale è consentito (collaudo), senza dati dimostrativi.
    const pilota = leggiConfig({ VITE_AMBIENTE: 'test', VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' });
    expect(pilota.datiDimostrativi).toBe(false);
    expect(problemiConfig(pilota)).toEqual([]);
  });
});

describe('Accesso con nome utente e PIN', () => {
  it('C02 nome utente + PIN; PIN errato rifiutato; nome utente validato e univoco', async () => {
    const { creaAmbiente } = await import('./fixture');
    const { emailTecnica } = await import('../../src/config/accesso');
    const { s, admin } = await creaAmbiente();
    expect(emailTecnica(' Luca ')).toBe('luca@utenti.worklog.invalid');
    await expect(s.login('op', '000000')).rejects.toThrow(/PIN non corretti/);
    expect((await s.login('OP', '123456')).email).toBe('op@test.local');
    await s.login(admin.email, '123456');
    await expect(s.planning.salvaOperaio({ nome: 'Nuovo', cognome: 'Tecnico', email: 'n@test.local', username: 'X' })).rejects.toThrow(/Nome utente non valido/);
    await expect(s.planning.salvaOperaio({ nome: 'Nuovo', cognome: 'Tecnico', email: 'n@test.local', username: 'admin' })).rejects.toThrow(/già in uso/);
    const n = await s.planning.salvaOperaio({ nome: 'Nuovo', cognome: 'Tecnico', email: 'n@test.local', username: ' Luca ' });
    expect(n.username).toBe('luca');
    expect((await s.login('luca', '123456')).id).toBe(n.id);
  });
});

describe('Accesso reale (Supabase Auth simulato con fetch)', () => {
  it('C03 PIN verificato dal server, profilo salvato; PIN errato rifiutato; senza rete accesso con l\'impronta locale', async () => {
    const { AppServices } = await import('../../src/services/app-services');
    const { MemoryStorage } = await import('../../src/data/storage');
    // Valori di prova inventati: nessun account o PIN reale.
    const PIN = '482915';
    const PROFILO = { id: '11111111-1111-4111-8111-111111111111', nome: 'Tecnico', cognome: 'Prova', email: 'tecnico@utenti.worklog.invalid', username: 'tecnico', ruolo: 'operaio', attivo: true, qualifica: 'Tecnico', row_version: 3 };
    let rete = true;
    const chiamate: string[] = [];
    const finto = (async (url: string, init?: RequestInit) => {
      if (!rete) throw new TypeError('Failed to fetch');
      chiamate.push(String(url).replace('https://x.supabase.co', ''));
      if (String(url).includes('/auth/v1/token')) {
        const b = JSON.parse(String(init!.body));
        if (b.email !== 'tecnico@utenti.worklog.invalid' || b.password !== PIN) return new Response('{"error_code":"invalid_credentials"}', { status: 400 });
        return new Response(JSON.stringify({ access_token: 't', refresh_token: 'r', expires_in: 3600, user: { id: PROFILO.id } }), { status: 200 });
      }
      if (String(url).includes('/rpc/mio_profilo')) return new Response(JSON.stringify({ profilo: PROFILO, azienda: { ragione_sociale: 'Azienda Prova', indirizzo: 'Via 1', partita_iva: '12345678901', telefono: '', email: '', sito_web: null, logo_svg: null } }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const s = await AppServices.crea(new MemoryStorage(), { supabase: { url: 'https://x.supabase.co', chiave: 'k', fetch: finto } });
    expect(s.syncAttiva).toBe(true); // Fase 15: sincronizzazione reale attiva
    await expect(s.login('tecnico', '000000')).rejects.toThrow(/PIN non corretti/);
    const p = await s.login(' Tecnico ', PIN);
    expect(p).toMatchObject({ nome: 'Tecnico', ruolo: 'operaio', sync_stato: 'sincronizzato' });
    expect(s.utente()?.id).toBe(PROFILO.id);
    const { AZIENDA } = await import('../../src/config/azienda');
    expect(AZIENDA.ragioneSociale).toBe('Azienda Prova');
    await s.logout();
    expect(chiamate.some((c) => c.startsWith('/auth/v1/logout'))).toBe(true);
    // Senza rete: entra con l'impronta salvata, rifiuta un PIN diverso.
    rete = false;
    await expect(s.login('tecnico', '111111')).rejects.toThrow(/PIN non corretti/);
    expect((await s.login('tecnico', PIN)).id).toBe(PROFILO.id);
    await s.logout();
    await expect(s.login('altro', '123123')).rejects.toThrow(/primo accesso su questo dispositivo richiede la connessione/);
  });
});
