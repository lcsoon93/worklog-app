/** Fase 5: magazzino, consumi da rapportino, correzioni, costi storici, offline e duplicati. */
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/data/storage';
import { seedDemo } from '../../src/data/demo-seed';
import { costoConsumo } from '../../src/domain/magazzino';
import { atLocal } from '../../src/domain/time';
import type { DatiMateriale } from '../../src/services/magazzino-service';
import { AppServices } from '../../src/services/app-services';
import { creaAmbiente } from './fixture';

const dati = (codice: string, nome: string, extra: Partial<DatiMateriale> = {}): DatiMateriale => ({
  codice, nome, descrizione: '', categoria: 'Idraulica', unita: 'pz', prezzo_acquisto: 10, prezzo_vendita: 20, fornitore: 'Fornitore X', scorta_minima: 5, attivo: true, ...extra,
});

async function ambienteMagazzino() {
  const t = await creaAmbiente();
  await t.come(t.admin);
  const sede = await t.s.magazzino.salvaMagazzino({ codice: 'MAG', nome: 'Centrale', tipo: 'sede', responsabile_id: null, attivo: true });
  const furgone = await t.s.magazzino.salvaMagazzino({ codice: 'F1', nome: 'Furgone Otto', tipo: 'automezzo', responsabile_id: t.op.id, attivo: true });
  const valvola = await t.s.magazzino.salvaMateriale(dati('v-1', 'Valvola'));
  const cavo = await t.s.magazzino.salvaMateriale(dati('C-1', 'Cavo', { unita: 'm', categoria: 'Elettrico', prezzo_acquisto: 1.5, prezzo_vendita: null }));
  await t.s.magazzino.registraCarico({ materiale_id: valvola.id, magazzino_id: furgone.id, quantita: 10, documento: 'DDT 1' });
  await t.s.magazzino.registraCarico({ materiale_id: cavo.id, magazzino_id: sede.id, quantita: 100 });
  return { t, sede, furgone, valvola, cavo };
}

/** Il lavoratore compila e completa un rapportino con le righe indicate. */
async function rapportinoConMateriali(e: Awaited<ReturnType<typeof ambienteMagazzino>>, righe: Array<{ materiale_id: string; quantita: number; magazzino_id?: string }>) {
  const { t } = e;
  await t.come(t.op);
  const b = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
  const materiali = righe.map((r, k) => {
    const m = t.s.db.get('materiali', r.materiale_id)!;
    return { id: `riga-${k}`, descrizione: m.nome, quantita: r.quantita, unita: m.unita, materiale_id: m.id, magazzino_id: r.magazzino_id ?? null };
  });
  const r = { ...b, descrizione_lavoro: 'Sostituzione valvole e cablaggio', materiali };
  return { bozza: r, completa: () => t.s.report.completa(r) };
}

describe('Fase 5 – anagrafica e movimenti', () => {
  it('M01 anagrafica validata; giacenza = somma dei movimenti; rettifica e scarico motivati; storico immutato', async () => {
    const { t, sede, furgone, valvola, cavo } = await ambienteMagazzino();
    expect(valvola.codice).toBe('V-1');
    await expect(t.s.magazzino.salvaMateriale(dati('V-1', 'Doppione'))).rejects.toThrow(/già usato/);
    await expect(t.s.magazzino.salvaMateriale(dati('X', 'Neg', { prezzo_acquisto: -1 }))).rejects.toThrow(/negativo/);
    await expect(t.s.magazzino.salvaMateriale({ ...valvola, unita: 'kg' }, valvola.id)).rejects.toThrow(/unità di misura/);

    expect(t.s.magazzino.giacenza(valvola.id)).toBe(10);
    await expect(t.s.magazzino.registraScarico({ materiale_id: cavo.id, magazzino_id: sede.id, quantita: 5 })).rejects.toThrow(/motivo/);
    await expect(t.s.magazzino.registraScarico({ materiale_id: cavo.id, magazzino_id: sede.id, quantita: 500, motivo: 'Reso fornitore' })).rejects.toThrow(/insufficiente/);
    await t.s.magazzino.registraScarico({ materiale_id: cavo.id, magazzino_id: sede.id, quantita: 12.5, motivo: 'Reso fornitore' });
    await expect(t.s.magazzino.rettifica({ materiale_id: cavo.id, magazzino_id: sede.id, giacenzaContata: 80, motivo: '' })).rejects.toThrow(/motivazione/);
    const r = await t.s.magazzino.rettifica({ materiale_id: cavo.id, magazzino_id: sede.id, giacenzaContata: 85, motivo: 'Inventario di marzo' });
    expect(r.quantita).toBe(-2.5);
    expect(t.s.magazzino.giacenza(cavo.id)).toBe(85);

    const tr = await t.s.magazzino.trasferisci({ materiale_id: valvola.id, da_magazzino_id: furgone.id, a_magazzino_id: sede.id, quantita: 4 });
    expect(tr.map((m) => m.quantita)).toEqual([-4, 4]);
    expect(tr[0].trasferimento_id).toBe(tr[1].trasferimento_id);
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(6);
    expect(t.s.magazzino.giacenza(valvola.id)).toBe(10);

    // Nessun movimento è mai stato riscritto: ogni audit dei movimenti è una creazione.
    const audit = t.s.db.audit().filter((a) => a.entita === 'movimenti_magazzino');
    expect(audit.length).toBe(t.s.db.all('movimenti_magazzino').length);
    expect(audit.every((a) => a.prima === null)).toBe(true);

    // Sotto scorta: cavo 85 < 100 dopo aver alzato la soglia.
    await t.s.magazzino.salvaMateriale({ ...cavo, scorta_minima: 100 }, cavo.id);
    expect(t.s.magazzino.sottoScorta().map((g) => g.materiale.id)).toEqual([cavo.id]);
  });
});

describe('Fase 5 – materiali nei rapportini', () => {
  it('M02 scarico al completamento dal furgone, collegamenti, nessun doppio scarico su salvataggi o completamenti ripetuti', async () => {
    const e = await ambienteMagazzino();
    const { t, furgone, valvola } = e;
    const { bozza, completa } = await rapportinoConMateriali(e, [{ materiale_id: valvola.id, quantita: 3 }]);
    await t.s.report.salvaBozza(bozza);
    await t.s.report.salvaBozza(bozza);
    expect(t.s.magazzino.movimenti({ rapportinoId: bozza.id })).toHaveLength(0); // la bozza non scarica

    await completa();
    await expect(completa()).rejects.toThrow(/già stato completato/);
    const movs = t.s.magazzino.movimenti({ rapportinoId: bozza.id });
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ tipo: 'consumo', quantita: -3, magazzino_id: furgone.id, cliente_id: t.cliA.id, operaio_id: t.op.id, riga_rapportino_id: 'riga-0', costo_unitario: 10, prezzo_vendita_unitario: 20, chiave_univoca: `consumo:${bozza.id}:riga-0` });
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(7);
    // Ripianificare gli scarichi dello stesso rapportino non produce nulla.
    const uow = t.s.db.unitOfWork(t.op.id);
    expect(t.s.magazzino.pianificaConsumi(uow, t.s.db.get('rapportini', bozza.id)!)).toHaveLength(0);
    // L'outbox invia il rapportino prima dei suoi movimenti.
    const seq = (id: string) => t.s.db.outbox().find((o) => o.entita_id === id)!.seq;
    expect(seq(bozza.id)).toBeLessThan(seq(movs[0].id));
  });

  it('M03 materiale insufficiente segnalato prima e registrato al completamento', async () => {
    const e = await ambienteMagazzino();
    const { t, furgone, valvola } = e;
    const { bozza, completa } = await rapportinoConMateriali(e, [{ materiale_id: valvola.id, quantita: 6 }, { materiale_id: valvola.id, quantita: 6 }]);
    const mancanze = t.s.magazzino.verificaDisponibilita(bozza);
    expect(mancanze).toHaveLength(1);
    expect(mancanze[0]).toMatchObject({ rigaId: 'riga-1', richiesta: 12, disponibile: 10, magazzinoId: furgone.id });
    await completa();
    const movs = t.s.magazzino.movimenti({ rapportinoId: bozza.id }).sort((a, b) => (a.riga_rapportino_id ?? '').localeCompare(b.riga_rapportino_id ?? ''));
    expect(movs.map((m) => m.giacenza_insufficiente)).toEqual([false, true]);
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(-2);
    expect(t.s.magazzino.giacenze().find((g) => g.materiale.id === valvola.id)).toMatchObject({ negativa: true, valore: 0 });
  });

  it('M04 correzione del consumo: storico conservato, costo storico invariato anche dopo il cambio prezzo', async () => {
    const e = await ambienteMagazzino();
    const { t, furgone, valvola } = e;
    const { bozza, completa } = await rapportinoConMateriali(e, [{ materiale_id: valvola.id, quantita: 3 }]);
    await completa();
    await t.come(t.admin);
    await t.s.magazzino.salvaMateriale({ ...valvola, prezzo_acquisto: 15 }, valvola.id);
    expect(t.s.magazzino.riepilogoCosti().costo).toBe(30); // 3 × 10 €, non 3 × 15 €

    await expect(t.s.magazzino.correggiConsumo(bozza.id, 'riga-0', 3, 'Nessuna differenza')).rejects.toThrow(/uguale/);
    await expect(t.s.magazzino.correggiConsumo(bozza.id, 'riga-0', 2, '')).rejects.toThrow(/motivo/);
    const c = await t.s.magazzino.correggiConsumo(bozza.id, 'riga-0', 2, 'Una valvola è rientrata in furgone');
    expect(c).toMatchObject({ tipo: 'correzione_consumo', quantita: 1, costo_unitario: 10, magazzino_id: furgone.id });
    expect(c.corregge_id).toBe(t.s.magazzino.movimenti({ rapportinoId: bozza.id, tipo: 'consumo' })[0].id);
    expect(t.s.magazzino.consumoRiga(bozza.id, 'riga-0')).toMatchObject({ quantita: 2, costo: 20 });
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(8);
    expect(t.s.db.get('rapportini', bozza.id)!.materiali[0].quantita).toBe(3); // documento firmato invariato
    expect(t.s.magazzino.movimenti({ rapportinoId: bozza.id })).toHaveLength(2);
    expect(t.s.db.audit().some((a) => a.entita === 'movimenti_magazzino' && a.azione === 'correzione' && a.motivo.includes('rientrata'))).toBe(true);

    // I nuovi consumi usano il nuovo prezzo; il totale del periodo somma costi storici diversi.
    const altro = await rapportinoConMateriali(e, [{ materiale_id: valvola.id, quantita: 1 }]);
    await altro.completa();
    const rie = t.s.magazzino.riepilogoCosti();
    expect(rie.costo).toBe(35); // 2 × 10 + 1 × 15
    expect(rie.vendita).toBe(60); // prezzo di vendita separato: 3 × 20
    expect(rie.perCliente).toEqual([expect.objectContaining({ chiave: t.cliA.id, costo: 35 })]);
    expect(rie.perOperaio[0]).toMatchObject({ chiave: t.op.id, costo: 35, utilizzi: 2 });
    expect(rie.perTipoIntervento[0].chiave).toBe('senza_intervento');
  });
});

describe('Fase 5 – offline e sincronizzazione', () => {
  it('M05 consumi creati offline: un solo invio anche con risposta persa; un duplicato logico è scartato dal server', async () => {
    const e = await ambienteMagazzino();
    const { t, furgone, valvola } = e;
    await t.s.sync.ciclo();
    const { bozza, completa } = await rapportinoConMateriali(e, [{ materiale_id: valvola.id, quantita: 2 }]);
    await t.s.impostaSimulazione({ offline: true });
    await completa();
    await t.s.sync.ciclo();
    const [mov] = t.s.magazzino.movimenti({ rapportinoId: bozza.id });
    expect(mov.sync_stato).toBe('in_attesa');
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(8); // giacenza locale già aggiornata

    // Torna la rete ma la risposta del server si perde: il ritentativo non riapplica.
    await t.s.impostaSimulazione({ offline: false, rispostaPersa: true });
    await t.s.sync.ciclo();
    const applicazioni = t.s.api.stato().applicazioni;
    await t.s.sync.ciclo({ forza: true });
    expect(t.s.api.stato().applicazioni).toBe(applicazioni);
    expect(t.s.db.get('movimenti_magazzino', mov.id)?.sync_stato).toBe('sincronizzato');

    // Un secondo dispositivo invia lo stesso consumo (stessa chiave, id diverso): il server lo marca duplicato.
    const uow = t.s.db.unitOfWork(t.op.id);
    const copia = uow.save('movimenti_magazzino', { ...mov, id: '00000000-0000-4000-8000-00000000dd01', row_version: 0 });
    await uow.commit();
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(6); // prima della sincronizzazione conta
    await t.s.sync.ciclo();
    expect(t.s.db.get('movimenti_magazzino', copia.id)).toMatchObject({ duplicato_di: mov.id, sync_stato: 'sincronizzato' });
    expect(t.s.magazzino.giacenza(valvola.id, furgone.id)).toBe(8);
    expect(t.s.magazzino.riepilogoCosti().costo).toBe(costoConsumo(mov));
  });
});

describe('Fase 5 – dati dimostrativi', () => {
  it('M06 il seed è coerente: consumi collegati ai rapportini, nessuna giacenza negativa, prezzi storici diversi', async () => {
    const s = await AppServices.crea(new MemoryStorage(), { sleep: async () => {} });
    const now = atLocal('2026-11-24', '08:00');
    s.db.clock = () => now;
    await seedDemo(s.db, now);
    const g = s.magazzino.giacenze();
    expect(g.length).toBeGreaterThan(5);
    expect(g.some((x) => x.negativa)).toBe(false);
    expect(s.magazzino.sottoScorta().length).toBeGreaterThan(0);
    const consumi = s.magazzino.movimenti({ tipo: 'consumo' });
    expect(consumi.length).toBeGreaterThan(5);
    for (const m of consumi) {
      const r = s.db.get('rapportini', m.rapportino_id)!;
      expect(r.materiali.find((x) => x.id === m.riga_rapportino_id)).toMatchObject({ quantita: -m.quantita, materiale_id: m.materiale_id, magazzino_id: m.magazzino_id });
    }
    const filtro = s.magazzino.materiali({ testo: 'deidratatore' })[0];
    const costi = new Set(s.magazzino.movimenti({ materialeId: filtro.id, tipo: 'consumo' }).map((m) => m.costo_unitario));
    expect(costi.has(18.5)).toBe(true);
    expect(filtro.prezzo_acquisto).toBe(21);
    expect(s.db.outbox()).toHaveLength(0);
  });
});
