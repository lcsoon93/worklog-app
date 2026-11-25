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
