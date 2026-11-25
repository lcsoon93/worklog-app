/**
 * Test funzionali della giornata dell'operaio sui servizi reali del prototipo
 * (storage in memoria al posto di IndexedDB, stesso codice applicativo).
 */
import { describe, expect, it } from 'vitest';
import { AppServices } from '../../src/services/app-services';
import { AppError } from '../../src/services/errors';
import { attivitaEffettive, storicoAttivita } from '../../src/domain/day-records';
import { atLocal } from '../../src/domain/time';
import { creaAmbiente, H, M } from './fixture';

describe('giornata operaio', () => {
  it('T01–T05 entrata, timer, cambio cliente, pausa con sospensione, ripresa, imprevisto, uscita', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    expect(p.data_lavoro).toBe('2026-03-10');
    await expect(t.s.workday.registraEntrata()).rejects.toThrow(/già una giornata aperta/);

    // Timer sul cliente A con sede
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('10:00');
    await t.s.workday.fermaAttivita(p.id);
    expect(t.s.workday.attivitaInCorso(p.id)).toBeUndefined();

    // Cambio cliente: avvio B, poi passaggio diretto ad attività interna (la precedente si chiude nello stesso istante)
    t.alle('10:10');
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliB.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('12:00');
    // Pausa con timer attivo: l'attività viene sospesa all'inizio della pausa
    await t.s.workday.iniziaPausa(p.id, 'pranzo');
    const sospesa = t.s.workday.attivita(p.id).find((a) => a.cliente_id === t.cliB.id)!;
    expect(sospesa.fine_at).toBe(new Date(atLocal('2026-03-10', '12:00')).toISOString());
    t.alle('12:45');
    const { daRiprendere } = await t.s.workday.terminaPausa(p.id);
    expect(daRiprendere?.id).toBe(sospesa.id);
    await t.s.workday.riprendiAttivita(p.id, daRiprendere!.id);

    // Imprevisto
    t.alle('14:00');
    const imp = await t.s.report.registraImprevisto({ presenza_id: p.id, intervento_id: null, cliente_id: t.cliB.id, tipo: 'materiale_mancante', gravita: 'media', descrizione: 'Manca il raccordo da 3/4', blocca_lavoro: false, richiede_ritorno: true, allegati_ids: [] });
    expect(imp.operaio_id).toBe(t.op.id);

    // Passaggio diretto ad attività interna
    t.alle('15:00');
    await t.s.workday.avviaAttivita(p.id, { tipo: 'interna', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: 'magazzino', descrizione: '' });
    t.alle('16:00');
    await t.s.workday.registraUscita(p.id);

    const r = t.s.workday.riepilogo(p.id);
    expect(r.lorda_ms).toBe(8 * H);
    expect(r.pause_ms).toBe(45 * M);
    expect(r.netta_ms).toBe(7 * H + 15 * M);
    // A: 8-10 (2h); B: 10:10-12 + 12:45-15 (4h05); magazzino 15-16 (1h)
    expect(r.per_cliente[t.cliA.id]).toBe(2 * H);
    expect(r.per_cliente[t.cliB.id]).toBe(4 * H + 5 * M);
    expect(r.per_codice_interno.magazzino).toBe(1 * H);
    expect(r.attribuite_ms).toBe(7 * H + 5 * M);
    expect(r.non_attribuite_ms).toBe(10 * M);
    // Timer chiuso all'uscita e segnalato
    const ultima = t.s.workday.attivita(p.id).at(-1)!;
    expect(ultima.chiusura_automatica).toBe(true);
  });

  it('T06 timer attivo dopo la riapertura dell\'app (ricostruito dai timestamp salvati)', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });

    // "Chiusura del browser": si ricrea l'app sullo stesso storage, 2h dopo.
    const riaperta = await AppServices.crea(t.storage, { sleep: async () => {} });
    riaperta.db.clock = () => atLocal('2026-03-10', '10:00');
    const inCorso = riaperta.workday.attivitaInCorso(p.id);
    expect(inCorso).toBeDefined();
    expect(riaperta.workday.riepilogo(p.id).attribuite_ms).toBe(2 * H);
    expect(riaperta.utente()?.id).toBe(t.op.id);
  });

  it('T07 giornata non chiusa (dispositivo spento): proposta uscita all\'ultimo segnale noto', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('16:30');
    await t.s.workday.segnale(p.id); // ultimo segnale prima dello spegnimento
    t.alle('07:30', '2026-03-11');
    const nc = t.s.workday.giornataNonChiusa(t.op.id);
    expect(nc?.presenza.id).toBe(p.id);
    expect(nc?.uscitaProposta).toBe(new Date(atLocal('2026-03-10', '16:30')).toISOString());
    await t.s.workday.registraUscita(p.id, new Date(nc!.uscitaProposta).getTime(), { motivo: 'Uscita non registrata' });
    const r = t.s.workday.riepilogo(p.id);
    expect(r.attribuite_ms).toBe(8.5 * H);
    expect(t.s.db.get('presenze', p.id)?.uscita_automatica).toBe(true);
    expect(t.s.workday.giornataNonChiusa(t.op.id)).toBeUndefined();
  });

  it('T08 avvio di un\'attività durante la pausa chiude la pausa', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.iniziaPausa(p.id, 'breve');
    t.alle('08:15');
    await t.s.workday.avviaAttivita(p.id, { tipo: 'da_definire', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    expect(t.s.workday.pausaInCorso(p.id)).toBeUndefined();
    t.alle('09:15');
    await t.s.workday.classificaInCorso(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    expect(t.s.workday.riepilogo(p.id).per_cliente[t.cliA.id]).toBe(1 * H);
  });

  it('T09–T11 correzioni: modifica, divisione, intervallo dimenticato; l\'originale resta nello storico', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('12:00');
    await t.s.workday.fermaAttivita(p.id);
    t.alle('17:00');
    await t.s.workday.registraUscita(p.id);
    const orig = t.s.workday.attivita(p.id)[0];

    await expect(t.s.workday.correggiAttivita(orig.id, { cliente_id: t.cliB.id }, '')).rejects.toThrow(/motivo/);

    // Divisione alle 10:00: la seconda parte va al cliente B
    const [prima, seconda] = await t.s.workday.dividiAttivita(orig.id, atLocal('2026-03-10', '10:00'), { cliente_id: t.cliB.id }, 'Dalle 10 ero dal cliente B');
    let r = t.s.workday.riepilogo(p.id);
    expect(r.per_cliente).toEqual({ [t.cliA.id]: 2 * H, [t.cliB.id]: 2 * H });

    // Correzione dell'orario della seconda parte
    const corr = await t.s.workday.correggiAttivita(seconda.id, { fine_at: new Date(atLocal('2026-03-10', '12:30')).toISOString() }, 'Finito più tardi');
    // Intervallo dimenticato nel pomeriggio
    await t.s.workday.aggiungiAttivita(p.id, { tipo: 'interna', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: 'magazzino', descrizione: '' }, atLocal('2026-03-10', '13:30'), atLocal('2026-03-10', '17:00'), 'Dimenticato di avviare il timer');
    // Sovrapposizione e fuori presenza vengono rifiutate
    await expect(t.s.workday.aggiungiAttivita(p.id, { tipo: 'interna', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: 'ufficio', descrizione: '' }, atLocal('2026-03-10', '12:00'), atLocal('2026-03-10', '13:45'), 'x')).rejects.toThrow(/sovrappone/);
    await expect(t.s.workday.aggiungiAttivita(p.id, { tipo: 'interna', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: 'ufficio', descrizione: '' }, atLocal('2026-03-10', '17:00'), atLocal('2026-03-10', '18:00'), 'x')).rejects.toThrow(/presenza/);

    r = t.s.workday.riepilogo(p.id);
    expect(r.per_cliente[t.cliB.id]).toBe(2.5 * H);
    expect(r.per_codice_interno.magazzino).toBe(3.5 * H);
    expect(r.netta_ms).toBe(9 * H);
    expect(r.non_attribuite_ms).toBe(1 * H); // 12:30-13:30 scoperta

    const tutte = t.s.workday.tutteLeAttivita(p.id);
    expect(tutte.length).toBe(5); // originale + 2 parti + correzione + manuale
    expect(attivitaEffettive(tutte).length).toBe(3);
    expect(storicoAttivita(corr.id, tutte).map((a) => a.id)).toEqual([corr.id, seconda.id, orig.id]);
    expect(t.s.db.get('attivita_lavoro', orig.id)?.superata_da_id).toBe(prima.id);
    expect(t.s.db.audit().filter((a) => a.azione === 'correzione').length).toBeGreaterThanOrEqual(6);
  });

  it('T12 correzione di entrata/uscita conserva il valore registrato in origine', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:10');
    const p = await t.s.workday.registraEntrata();
    t.alle('17:00');
    await t.s.workday.registraUscita(p.id);
    await t.s.workday.correggiPresenza(p.id, { entrata_at: new Date(atLocal('2026-03-10', '07:50')).toISOString() }, 'Timbrato in ritardo, ero già in magazzino');
    const dopo = t.s.db.get('presenze', p.id)!;
    expect(dopo.entrata_at).toBe(new Date(atLocal('2026-03-10', '07:50')).toISOString());
    expect(dopo.entrata_registrata_at).toBe(new Date(atLocal('2026-03-10', '08:10')).toISOString());
    const audit = t.s.db.audit().find((a) => a.entita === 'presenze' && a.azione === 'correzione');
    expect(audit?.motivo).toMatch(/ritardo/);
  });

  it('T13 turno oltre la mezzanotte resta sul giorno dell\'entrata', async () => {
    const t = await creaAmbiente(atLocal('2026-03-10', '22:00'));
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('04:00', '2026-03-11');
    await t.s.workday.registraUscita(p.id);
    const r = t.s.workday.riepilogo(p.id);
    expect(t.s.db.get('presenze', p.id)?.data_lavoro).toBe('2026-03-10');
    expect(r.attribuite_ms).toBe(6 * H);
    expect(r.anomalie.map((a) => a.codice)).toContain('turno_oltre_mezzanotte');
  });

  it('T14 validazioni: uscita prima dell\'entrata, entrata nel futuro, operazioni senza sessione', async () => {
    const t = await creaAmbiente();
    await expect(t.s.workday.registraEntrata()).rejects.toBeInstanceOf(AppError);
    await t.come(t.op);
    await expect(t.s.workday.registraEntrata(t.now() + 2 * H)).rejects.toThrow(/futuro/);
    const p = await t.s.workday.registraEntrata();
    await expect(t.s.workday.registraUscita(p.id, t.now() - H)).rejects.toThrow(/successiva/);
  });
});
