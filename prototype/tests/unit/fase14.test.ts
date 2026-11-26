/** Fase 14: storico amministrativo, esclusioni e doppia esportazione (operativa / per fatturazione). */
import { describe, expect, it } from 'vitest';
import { generaPdfReport } from '../../src/reports/pdf-report-service';
import { creaAmbiente, H } from './fixture';

/** Due giornate presso il Cliente A: 08-10 (rapporto 1) e 10-11 senza rapporto il 10/3; 08-12 (rapporto 2) l'11/3. */
async function scenario() {
  const t = await creaAmbiente();
  await t.come(t.op);
  const giornata = async (data: string, blocchi: Array<[string, string]>) => {
    t.alle(blocchi[0][0], data);
    const p = await t.s.workday.registraEntrata();
    const ids: string[] = [];
    for (const [da, a] of blocchi) {
      t.alle(da, data);
      ids.push((await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: null, codice_interno: null, descrizione: '' })).id);
      t.alle(a, data);
      await t.s.workday.fermaAttivita(p.id);
    }
    await t.s.workday.registraUscita(p.id);
    return { p, ids };
  };
  const g1 = await giornata('2026-03-10', [['08:00', '10:00'], ['10:00', '11:00']]);
  t.alle('18:00', '2026-03-10');
  let r1 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: null });
  r1 = await t.s.report.invia({ ...r1, attivita_ids: [g1.ids[0]], descrizione_lavoro: 'Manutenzione caldaia', materiali: [{ id: 'm1', descrizione: 'Guarnizione', quantita: 2, unita: 'pz' }] });
  const g2 = await giornata('2026-03-11', [['08:00', '12:00']]);
  t.alle('18:00', '2026-03-11');
  let r2 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: null });
  r2 = await t.s.report.invia({ ...r2, descrizione_lavoro: 'Sostituzione pompa', materiali: [{ id: 'm2', descrizione: 'Guarnizione', quantita: 1, unita: 'pz' }, { id: 'm3', descrizione: 'Pompa', quantita: 1, unita: 'pz' }] });
  await t.come(t.admin);
  const f = { da: '2026-03-01', a: '2026-03-31', cliente_id: t.cliA.id };
  return { t, g1, g2, r1, r2, f };
}

describe('storico amministrativo', () => {
  it('S01 senza esclusioni i due riepiloghi coincidono', async () => {
    const { t, f } = await scenario();
    const m = t.s.storico.modello(f);
    expect(m.totaliOperativo.ms).toBe(7 * H);
    expect(m.totaliAmministrativo.ms).toBe(7 * H);
    expect(m.totaliAmministrativo.materiali).toEqual([{ descrizione: 'Guarnizione', unita: 'pz', quantita: 3 }, { descrizione: 'Pompa', unita: 'pz', quantita: 1 }]);
  });

  it('S02 esclusione di attività, rapporto e giornata: ricalcolo dei totali senza toccare presenze e originali', async () => {
    const { t, g1, g2, r2, f } = await scenario();
    const presenzaPrima = t.s.workday.riepilogo(g1.p.id);
    const attivitaPrima = JSON.stringify(t.s.db.get('attivita_lavoro', g1.ids[1]));
    await t.s.storico.escludi('attivita', g1.ids[1], 'Tempo di attesa non fatturabile');
    let m = t.s.storico.modello(f);
    expect(m.totaliAmministrativo.ms).toBe(6 * H);
    expect(m.totaliOperativo.ms).toBe(7 * H);
    // Rapporto escluso: escono il rapporto, le sue ore (attività collegate) e i suoi materiali.
    await t.s.storico.escludi('rapportino', r2.id, 'Intervento in garanzia');
    m = t.s.storico.modello(f);
    expect(m.totaliAmministrativo.ms).toBe(2 * H);
    expect(m.totaliAmministrativo.rapporti).toBe(1);
    expect(m.totaliAmministrativo.materiali).toEqual([{ descrizione: 'Guarnizione', unita: 'pz', quantita: 2 }]);
    // Giornata esclusa.
    await t.s.storico.escludi('giornata', `${t.cliA.id}|2026-03-10`, 'Sopralluogo gratuito');
    m = t.s.storico.modello(f);
    expect(m.totaliAmministrativo.ms).toBe(0);
    expect(m.totaliAmministrativo.rapporti).toBe(0);
    expect(m.totaliOperativo.ms).toBe(7 * H);
    // Originali, presenze e cartellini invariati.
    expect(JSON.stringify(t.s.db.get('attivita_lavoro', g1.ids[1]))).toBe(attivitaPrima);
    expect(t.s.workday.riepilogo(g1.p.id)).toEqual(presenzaPrima);
    expect(t.s.workday.riepilogo(g2.p.id).attribuite_ms).toBe(4 * H);
    // Ripristino.
    await t.s.storico.includi('giornata', `${t.cliA.id}|2026-03-10`);
    await t.s.storico.ripristina('rapportino', r2.id);
    expect(t.s.storico.modello(f).totaliAmministrativo.ms).toBe(6 * H);
  });

  it('S03 storico delle operazioni con utente, data e motivo; archiviazione ed eliminazione definitiva controllata', async () => {
    const { t, g1, r1, f } = await scenario();
    await expect(t.s.storico.eliminaDefinitivamente('attivita', g1.ids[1], 'Registrata per errore')).rejects.toThrow(/Archivia/);
    await t.s.storico.archivia('attivita', g1.ids[1], 'Duplicato');
    expect(t.s.storico.modello(f).giorni[0].attivita.find((a) => a.attivita.id === g1.ids[1])?.stato).toBe('archiviato');
    await expect(t.s.storico.eliminaDefinitivamente('attivita', g1.ids[1], '')).rejects.toThrow(/motivo/);
    await t.s.storico.eliminaDefinitivamente('attivita', g1.ids[1], 'Registrata per errore');
    expect(t.s.storico.modello(f).totaliOperativo.ms).toBe(6 * H);
    // Attività collegata a un rapporto: non eliminabile.
    await t.s.storico.archivia('attivita', g1.ids[0]);
    expect(t.s.storico.motivoNonEliminabile('attivita', g1.ids[0])).toMatch(/rapporto/);
    await t.s.storico.archivia('rapportino', r1.id, 'Annullato dal cliente');
    const reg = t.s.storico.registroOperazioni();
    const voce = reg.find((x) => x.operazione.startsWith('Eliminazione definitiva'))!;
    expect(voce).toMatchObject({ entita: 'attivita', entitaId: g1.ids[1], utente_id: t.admin.id });
    expect(voce.eseguita_at).toBeTruthy();
    expect(reg.some((x) => x.operazione === 'Archiviazione: Annullato dal cliente' && x.entita === 'rapportino')).toBe(true);
    // Il dato eliminato resta ricostruibile dall'audit.
    expect(t.s.db.audit().find((a) => a.entita === 'attivita_lavoro' && a.entita_id === g1.ids[1] && a.azione === 'elimina')?.prima).toBeTruthy();
  });

  it('S04 permessi: solo l\'amministratore gestisce lo storico e le esportazioni', async () => {
    const { t, g1, f } = await scenario();
    const luca = { ...t.op, amministratore_operativo: true };
    await t.s.db.applyBatch([{ tipo: 'put', store: 'profili', value: luca }]);
    await t.come(luca);
    await expect(t.s.storico.escludi('attivita', g1.ids[0])).rejects.toThrow(/amministratore/);
    await expect(t.s.storico.esporta('amministrativo', f)).rejects.toThrow(/amministratore/);
    expect(() => t.s.storico.documento('operativo', f)).toThrow(/amministratore/);
  });

  it('S05 due PDF distinti, totali coerenti con il contenuto, codice nuovo a ogni esportazione', async () => {
    const { t, g1, f } = await scenario();
    await t.s.storico.escludi('attivita', g1.ids[1], 'Attesa');
    const amm = await t.s.storico.esporta('amministrativo', f);
    const ope = await t.s.storico.esporta('operativo', f);
    expect(amm.doc.titolo).toBe('Riepilogo amministrativo per fatturazione');
    expect(ope.doc.titolo).toBe('Riepilogo operativo completo');
    const ore = (d: typeof amm.doc) => d.tabelle.find((x) => x.id === 'ore')!;
    expect(ore(amm.doc).righe).toHaveLength(2);
    expect(ore(amm.doc).totale?.ore).toBe(6 * H);
    expect(amm.doc.indicatori[0].valore).toBe(6 * H);
    expect(ore(ope.doc).righe).toHaveLength(3);
    expect(ore(ope.doc).totale?.ore).toBe(7 * H);
    expect(ore(ope.doc).righe.some((r) => r.stato === 'Escluso')).toBe(true);
    expect(ore(amm.doc).colonne.some((c) => c.chiave === 'stato')).toBe(false);
    expect(amm.esportazione.codice).toMatch(/^AMM-/);
    expect(ope.esportazione.codice).toMatch(/^OPE-/);
    // Nuova esportazione → nuovo codice; quella precedente resta invariata.
    t.avanza(60_000);
    const amm2 = await t.s.storico.esporta('amministrativo', f);
    expect(amm2.esportazione.codice).not.toBe(amm.esportazione.codice);
    expect(t.s.db.get('esportazioni', amm.esportazione.id)?.ore_ms).toBe(6 * H);
    expect(t.s.storico.esportazioni()).toHaveLength(3);
    for (const d of [amm.doc, ope.doc]) {
      const pdf = await generaPdfReport(d);
      expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-');
    }
  });
});
