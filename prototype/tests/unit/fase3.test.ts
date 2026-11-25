/** Fase 3: richieste di correzione, ripresa dell'ultima attività, nuova approvazione dopo modifiche, PDF. */
import { describe, expect, it } from 'vitest';
import { atLocal } from '../../src/domain/time';
import { generaPdfGiornaliero, generaPdfMensile } from '../../src/reports/pdf-report-service';
import { creaAmbiente, H } from './fixture';
import { testoPdf } from './pdf-helpers';

const cliente = (id: string) => ({ tipo: 'lavoro_cliente' as const, cliente_id: id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });

async function giornataFebbraio() {
  const t = await creaAmbiente(atLocal('2026-02-10', '08:00'));
  await t.come(t.op);
  const p = await t.s.workday.registraEntrata();
  await t.s.workday.avviaAttivita(p.id, cliente(t.cliA.id));
  t.alle('16:00', '2026-02-10');
  await t.s.workday.registraUscita(p.id);
  return { t, p };
}

describe('Fase 3 – richieste di correzione', () => {
  it('F01 creazione validata, salvata anche offline e sincronizzata solo con conferma del server', async () => {
    const { t, p } = await giornataFebbraio();
    await expect(t.s.richieste.richiedi({ data_lavoro: '2026-02-10', messaggio: 'errore' })).rejects.toThrow(/almeno 10/);
    await expect(t.s.richieste.richiedi({ data_lavoro: '2026-02-11', messaggio: 'Uscita reale alle 17:30', presenza_id: p.id })).rejects.toThrow(/non appartiene/);
    await t.s.impostaSimulazione({ offline: true });
    const r = await t.s.richieste.richiedi({ data_lavoro: '2026-02-10', messaggio: 'Uscita reale alle 17:30, non alle 16:00', presenza_id: p.id });
    expect(r).toMatchObject({ stato: 'aperta', sync_stato: 'in_attesa', gestita_da: null });
    await t.s.sync.ciclo();
    expect(t.s.db.get('richieste_correzione', r.id)?.sync_stato).toBe('in_attesa');
    await t.s.impostaSimulazione({ offline: false });
    await t.s.sync.ciclo();
    expect(t.s.db.get('richieste_correzione', r.id)?.sync_stato).toBe('sincronizzato');
  });

  it('F02 gestione: autore e istante registrati, risposta obbligatoria, richiesta chiusa non riapribile', async () => {
    const { t, p } = await giornataFebbraio();
    const r = await t.s.richieste.richiedi({ data_lavoro: '2026-02-10', messaggio: 'Manca mezz\'ora di magazzino a fine giornata', presenza_id: p.id });
    await t.come(t.admin);
    t.alle('09:00', '2026-02-11');
    const presa = await t.s.richieste.gestisci(r.id, 'presa_in_carico', '');
    expect(presa).toMatchObject({ stato: 'presa_in_carico', gestita_da: t.admin.id, gestita_at: new Date(atLocal('2026-02-11', '09:00')).toISOString() });
    await expect(t.s.richieste.gestisci(r.id, 'respinta', '')).rejects.toThrow(/motivo del rifiuto/);
    await t.s.richieste.gestisci(r.id, 'risolta', 'Intervallo aggiunto dal lavoratore');
    await expect(t.s.richieste.gestisci(r.id, 'respinta', 'Ripensamento')).rejects.toThrow(/non può passare/);
    expect(t.s.richieste.elenco({ soloAperte: true })).toHaveLength(0);
    expect(t.s.db.audit().filter((a) => a.entita === 'richieste_correzione' && a.azione === 'transizione')).toHaveLength(2);
  });

  it('F03 mese approvato: richiesta → riapertura → correzione tracciata → nuova conferma e nuova approvazione', async () => {
    const { t, p } = await giornataFebbraio();
    t.alle('09:00', '2026-03-02');
    await t.come(t.admin);
    const c = await t.s.timesheet.genera(t.op.id, 2026, 2);
    await t.come(t.op);
    await t.s.timesheet.conferma(c.id);
    await t.s.sync.ciclo();
    await t.come(t.admin);
    await t.s.timesheet.approva(c.id);

    // Il lavoratore trova un errore: correzione diretta bloccata, quindi invia una richiesta.
    await t.come(t.op);
    await expect(t.s.workday.correggiPresenza(p.id, { uscita_at: new Date(atLocal('2026-02-10', '17:00')).toISOString() }, 'Uscita reale')).rejects.toThrow(/verifica o approvato/);
    const r = await t.s.richieste.richiedi({ data_lavoro: '2026-02-10', messaggio: 'Sono uscito alle 17:00, non alle 16:00', presenza_id: p.id });
    expect(t.s.richieste.meseBloccato(r)).toBe(true);

    // L'amministratore riapre (motivazione), il lavoratore corregge, nuova versione, nuova conferma, nuova approvazione.
    await t.come(t.admin);
    await t.s.timesheet.riapri(c.id, 'Richiesta di correzione del lavoratore');
    await t.come(t.op);
    await t.s.workday.correggiPresenza(p.id, { uscita_at: new Date(atLocal('2026-02-10', '17:00')).toISOString() }, 'Uscita reale 17:00');
    await t.s.timesheet.rigenera(c.id, 'Correzione uscita del 10');
    await t.s.timesheet.conferma(c.id);
    await t.s.sync.ciclo();
    await t.come(t.admin);
    await t.s.timesheet.approva(c.id);
    await t.s.richieste.gestisci(r.id, 'risolta', 'Cartellino riaperto, uscita corretta, nuova approvazione v2');

    const cart = t.s.db.get('cartellini_mensili', c.id)!;
    expect(cart).toMatchObject({ stato: 'approvato', versione_corrente: 2, versione_approvata: 2 });
    expect(t.s.timesheet.versione(c.id, 1)!.totali.netta_ms).toBe(8 * H);
    expect(t.s.timesheet.versione(c.id, 2)!.totali.netta_ms).toBe(9 * H);
    const approvazioni = t.s.timesheet.storico(c.id).filter((a) => a.azione === 'approva');
    expect(approvazioni.map((a) => a.versione).sort()).toEqual([1, 2]);
    expect(approvazioni.every((a) => a.utente_id === t.admin.id && a.eseguita_at)).toBe(true);

    // PDF mensile: approvato v2, coerente con i dati, con la richiesta e la sua risposta.
    const m = t.s.riepiloghi.mensile(t.op.id, 2026, 2);
    expect(m.cartellino).toMatchObject({ approvato: true, versioneApprovata: 2, coerenteConApprovata: true });
    expect(m.richiesteCorrezione[0]).toMatchObject({ stato: 'Risolta', gestitaDa: 'Ada Admin' });
    const testo = (await testoPdf(await generaPdfMensile(m))).join(' ');
    expect(testo).toContain('CARTELLINO APPROVATO');
    expect(testo).toContain('(versione 2)');
    expect(testo).toContain('Sono uscito alle 17:00, non alle 16:00');
    expect(testo).toContain('Risolta');
    expect(testo).toContain('Riaperto');

    // PDF giornaliero: stato del cartellino del mese, sincronizzazione e richiesta.
    const g = t.s.riepiloghi.giornaliero(t.op.id, '2026-02-10');
    expect(g.cartellinoMese).toEqual({ etichetta: 'Approvato', approvato: true });
    const tg = (await testoPdf(await generaPdfGiornaliero(g))).join(' ');
    expect(tg).toContain('Cartellino del mese Approvato');
    expect(tg).toMatch(/Sincronizzazione (\d+ elementi non ancora sincronizzati|Tutti i dati risultano sincronizzati)/);
    expect(tg).toContain('Richieste di correzione');
  });
});

describe('Fase 3 – sospendi e riprendi', () => {
  it('F04 dopo "Ferma" si propone l\'ultima attività; la ripresa crea un nuovo intervallo con la stessa destinazione', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    const a = await t.s.workday.avviaAttivita(p.id, cliente(t.cliA.id));
    expect(t.s.workday.ultimaRiprendibile(p.id)).toBeUndefined(); // timer attivo
    t.alle('10:00');
    await t.s.workday.fermaAttivita(p.id);
    expect(t.s.workday.ultimaRiprendibile(p.id)?.id).toBe(a.id);
    t.alle('10:20');
    const ripresa = await t.s.workday.riprendiAttivita(p.id, a.id);
    expect(ripresa.id).not.toBe(a.id);
    expect(ripresa.cliente_id).toBe(t.cliA.id);
    t.alle('11:00');
    const r = t.s.workday.riepilogo(p.id);
    expect(r.per_cliente[t.cliA.id]).toBe(2 * H + 40 * 60_000);
    expect(r.non_attribuite_ms).toBe(20 * 60_000); // la sospensione resta tempo di presenza non attribuito
  });
});
