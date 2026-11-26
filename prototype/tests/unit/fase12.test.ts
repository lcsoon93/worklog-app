/** Fase 12: rapporto di lavoro autonomo (senza intervento programmato). */
import { describe, expect, it } from 'vitest';
import { atLocal } from '../../src/domain/time';
import { creaAmbiente, H } from './fixture';

describe('rapporto autonomo', () => {
  it('A01 senza intervento: richiesta, indirizzo, timer con entrata automatica, verifica admin', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('09:00');
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliB.id, sede_id: null, intervento_id: null, richiesta: 'Telefonata: perdita in cucina', indirizzo_intervento: 'Via Roma 1' });
    expect(r.richiesta).toBe('Telefonata: perdita in cucina');
    expect(r.indirizzo_intervento).toBe('Via Roma 1');
    expect(r.intervento_id).toBeNull();

    const conTimer = await t.s.report.avviaTimer(r); // nessuna presenza: registra l'entrata
    expect(t.s.workday.presenzaAperta(t.op.id)).toBeTruthy();
    expect(conTimer.attivita_ids).toHaveLength(1);
    t.alle('10:30');
    const fermato = await t.s.report.fermaTimer(conTimer);
    expect(t.s.report.oreRapportino(fermato)).toBe(1.5 * H);

    const fatto = await t.s.report.completa({ ...fermato, descrizione_lavoro: 'Sostituito sifone sotto il lavello' });
    expect(t.s.report.autonomiDaVerificare().map((x) => x.id)).toContain(fatto.id);
    await expect(t.s.report.verifica(fatto.id)).rejects.toThrow(/amministratore/);
    await t.come(t.admin);
    const v = await t.s.report.verifica(fatto.id);
    expect(v.verificato_da).toBe(t.admin.id);
    expect(t.s.report.autonomiDaVerificare()).toHaveLength(0);
  });

  it('A02 orario manuale: dentro la presenza, nessuna sovrapposizione e nessun doppio conteggio', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('09:00');
    await t.s.workday.fermaAttivita(p.id);
    t.alle('12:00');

    const r1 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    expect(r1.attivita_ids).toHaveLength(1); // l'attività del timer viene proposta
    // Secondo rapporto per lo stesso cliente: la stessa attività non viene ricollegata.
    const r2 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    expect(r2.attivita_ids).toHaveLength(0);

    await expect(t.s.report.aggiungiOrario(r2, atLocal('2026-03-10', '08:30'), atLocal('2026-03-10', '09:30'))).rejects.toThrow();
    await expect(t.s.report.aggiungiOrario(r2, atLocal('2026-03-10', '10:00'), atLocal('2026-03-10', '13:00'))).rejects.toThrow(/futuro/);
    const ok = await t.s.report.aggiungiOrario(r2, atLocal('2026-03-10', '10:00'), atLocal('2026-03-10', '11:00'));
    expect(t.s.report.oreRapportino(ok)).toBe(1 * H);
    const rie = t.s.workday.riepilogo(p.id);
    expect(rie.attribuite_ms).toBe(2 * H); // 1 h timer + 1 h manuale, contate una volta sola
  });

  it('A03 senza entrata: errore chiaro, oppure entrata registrata all\'orario di inizio', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('11:00');
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: null });
    await expect(t.s.report.aggiungiOrario(r, atLocal('2026-03-10', '09:00'), atLocal('2026-03-10', '10:00'))).rejects.toThrow(/entrata/);
    const ok = await t.s.report.aggiungiOrario(r, atLocal('2026-03-10', '09:00'), atLocal('2026-03-10', '10:00'), { registraEntrata: true });
    expect(t.s.workday.presenzaAperta(t.op.id)?.entrata_at).toBe(new Date(atLocal('2026-03-10', '09:00')).toISOString());
    expect(t.s.report.oreRapportino(ok)).toBe(1 * H);
  });

  it('A04 ritorno collegato al rapporto autonomo e chiuso dal rapporto del ritorno', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('09:00');
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliB.id, sede_id: null, intervento_id: null });
    await t.s.report.completa({ ...r, descrizione_lavoro: 'Diagnosi guasto pompa', esito: 'ritorno_necessario', note_interne: 'Serve pompa nuova' });
    const f = t.s.report.followup((x) => x.rapportino_origine_id === r.id)[0];
    expect(f.intervento_origine_id).toBeNull();
    const r2 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliB.id, sede_id: null, intervento_id: null, followup_id: f.id });
    await t.s.report.completa({ ...r2, descrizione_lavoro: 'Installata la pompa nuova' });
    expect(t.s.db.get('followup', f.id)?.stato).toBe('chiuso');
  });

  it('A05 nuovo cliente dal campo: consentito agli operai finché l\'amministratore non lo disattiva', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    const { cliente, sede } = await t.s.planning.creaClienteDaCampo({ ragione_sociale: 'Bar Centrale', telefono: '081 000000', indirizzo: 'Piazza Duomo 2', citta: 'Napoli' });
    expect(cliente.note).toMatch(/Creato dal campo/);
    expect(sede?.cliente_id).toBe(cliente.id);
    await expect(t.s.planning.creaClienteDaCampo({ ragione_sociale: 'bar centrale' })).rejects.toThrow(/esiste già/);
    await t.come(t.admin);
    await t.s.planning.impostaOperaiCreanoClienti(false);
    await t.come(t.op);
    await expect(t.s.planning.creaClienteDaCampo({ ragione_sociale: 'Altro Srl' })).rejects.toThrow(/riservata/);
  });
});
