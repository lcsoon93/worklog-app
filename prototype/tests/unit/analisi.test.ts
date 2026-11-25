/** Fase 6: report aziendali coerenti con motore ore e magazzino; filtri; esportazioni PDF/Excel/CSV con gli stessi dati. */
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../../src/data/demo-seed';
import { MemoryStorage } from '../../src/data/storage';
import { calcolaDaRecord } from '../../src/domain/day-records';
import { atLocal } from '../../src/domain/time';
import { generaPdfReport } from '../../src/reports/pdf-report-service';
import { formatta, reportCsv, type ReportDoc } from '../../src/reports/report-tabellare';
import { reportXlsx } from '../../src/reports/xlsx';
import { AppServices } from '../../src/services/app-services';
import { testoPdf } from './pdf-helpers';

let s: AppServices;
const F = { da: '2026-10-01', a: '2026-10-31' };

beforeAll(async () => {
  s = await AppServices.crea(new MemoryStorage(), { sleep: async () => {} });
  const now = atLocal('2026-11-24', '08:00');
  s.db.clock = () => now;
  await seedDemo(s.db, now);
  await s.login('laura.bianchi@demo.local', 'demo');
});

const tab = (r: ReportDoc, id: string) => r.tabelle.find((t) => t.id === id)!;
const ind = (r: ReportDoc, e: string) => r.indicatori.find((x) => x.etichetta === e)!.valore;

/** Estrae i file da uno ZIP "stored". */
function unzip(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const n = dv.getUint32(p + 18, true);
    const ln = dv.getUint16(p + 26, true);
    const nome = new TextDecoder().decode(b.subarray(p + 30, p + 30 + ln));
    out[nome] = new TextDecoder().decode(b.subarray(p + 30 + ln, p + 30 + ln + n));
    p += 30 + ln + n;
  }
  return out;
}

describe('Fase 6 – report aziendali', () => {
  it('A01 personale: ore uguali al motore centrale, quadratura per tipologia, filtri per lavoratore', () => {
    const r = s.analisi.personale(F);
    const atteso = s.db.where('presenze', (p) => p.data_lavoro >= F.da && p.data_lavoro <= F.a)
      .reduce((a, p) => a + calcolaDaRecord(p, s.db.all('pause_presenza'), s.db.all('attivita_lavoro', { includiEliminati: true }), s.db.now()).netta_ms, 0);
    expect(ind(r, 'Ore lavorate')).toBe(atteso);
    expect(tab(r, 'ore-dipendente').totale!.netta).toBe(atteso);
    // Tipologie + non attribuite = ore lavorate
    const attr = tab(r, 'ore-tipologia').totale!.ore as number;
    expect(attr + (tab(r, 'ore-dipendente').totale!.non as number)).toBe(atteso);
    // Le ore per cliente non superano le ore attribuite.
    expect(tab(r, 'ore-clienti').totale!.totale as number).toBeLessThanOrEqual(attr);

    const marco = s.db.all('profili').find((p) => p.nome === 'Marco')!;
    const rm = s.analisi.personale({ ...F, operaioId: marco.id });
    expect(tab(rm, 'ore-dipendente').righe).toHaveLength(1);
    expect(tab(rm, 'ore-dipendente').righe[0].netta).toBe(tab(r, 'ore-dipendente').righe.find((x) => x.operaio === 'Rossi Marco')!.netta);
    expect(tab(rm, 'presenze-giornaliere').righe.every((x) => x.operaio === 'Rossi Marco')).toBe(true);
    // Cartellini: i quattro del mese precedente nei loro stati, filtrabili per stato.
    expect(tab(r, 'cartellini').righe).toHaveLength(4);
    expect(tab(s.analisi.personale({ ...F, stato: 'approvato' }), 'cartellini').righe.every((x) => x.stato === 'Approvato')).toBe(true);
    // Filtro per tipologia: solo le attività interne → colonna "ore attività filtrate" = totale tipologia.
    const ri = s.analisi.personale({ ...F, tipo: 'interna' });
    expect(tab(ri, 'ore-dipendente').totale!.filtrate).toBe(tab(ri, 'ore-tipologia').totale!.ore);
    expect(() => s.analisi.personale({ da: '2026-10-31', a: '2026-10-01' })).toThrow(/successiva/);
  });

  it('A02 interventi ed economico: costi uguali al registro di magazzino, filtri cliente/stato, nessun ricavo inventato', () => {
    const ri = s.analisi.interventi(F);
    const re = s.analisi.economico(F);
    const mag = s.magazzino.riepilogoCosti(F);
    expect(ind(re, 'Costo materiali consumati')).toBe(mag.costo);
    expect(tab(re, 'costi-cliente').totale!.costo).toBe(mag.costo);
    expect(re.avvisi.join(' ')).toMatch(/Ricavi effettivi e margini non sono calcolati/);
    const elenco = tab(ri, 'elenco-interventi');
    expect(elenco.righe.length).toBeGreaterThan(10);
    const cliente = s.db.all('clienti').find((c) => c.ragione_sociale.startsWith('Hotel'))!;
    const rc = s.analisi.interventi({ ...F, clienteId: cliente.id, stato: 'completato' });
    expect(tab(rc, 'elenco-interventi').righe.every((x) => x.cliente === cliente.ragione_sociale && x.stato === 'Completato')).toBe(true);
    const ec = s.analisi.economico({ ...F, clienteId: cliente.id });
    expect(ind(ec, 'Costo materiali consumati')).toBe(s.magazzino.riepilogoCosti({ ...F, clienteId: cliente.id }).costo);
    // Ritorni richiesti presenti e collegati a un intervento di origine.
    expect(tab(ri, 'ritorni').righe.length).toBeGreaterThan(0);
    const d = s.analisi.dashboard(F);
    expect(ind(d, 'Ore lavorate')).toBe(ind(s.analisi.personale(F), 'Ore lavorate'));
    expect(tab(d, 'da-verificare').righe.length).toBe(ind(d, 'Da verificare'));
  });

  it('A03 esportazioni: CSV, Excel e PDF riportano periodo, data di generazione e gli stessi valori', async () => {
    const marco = s.db.all('profili').find((p) => p.nome === 'Marco')!;
    const r = s.analisi.personale({ ...F, operaioId: marco.id });
    const valore = formatta(tab(r, 'ore-dipendente').righe[0].netta, 'durata');

    const csv = reportCsv(r);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Periodo";"01/10/2026 – 31/10/2026"');
    expect(csv).toContain('"Lavoratore";"Rossi Marco"');
    expect(csv).toContain('"Generato il"');
    expect(csv).toContain(`"Rossi Marco";"${tab(r, 'ore-dipendente').righe[0].giorni}"`);
    expect(csv).toContain(valore);
    const solo = reportCsv(r, 'cartellini');
    expect(solo).toContain('Cartellini mensili');
    expect(solo).not.toContain('Presenze giornaliere');

    const x = unzip(reportXlsx(r));
    expect(Object.keys(x)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    expect(Object.keys(x).filter((k) => k.startsWith('xl/worksheets/'))).toHaveLength(1 + r.tabelle.length);
    expect(x['xl/workbook.xml']).toContain('name="Riepilogo"');
    expect(x['xl/worksheets/sheet1.xml']).toContain('01/10/2026 – 31/10/2026');
    expect(x['xl/worksheets/sheet1.xml']).toContain('Generato il');
    // Le ore sono numeri (frazione di giorno) formattati [h]:mm: stesso valore dello schermo.
    const ms = tab(r, 'ore-dipendente').righe[0].netta as number;
    expect(x['xl/worksheets/sheet2.xml']).toContain(`<v>${ms / 86400_000}</v>`);

    const testo = (await testoPdf(await generaPdfReport(r))).join(' ');
    expect(testo).toContain('Report presenze e personale');
    expect(testo).toContain('Periodo 01/10/2026 – 31/10/2026');
    expect(testo).toContain('generato il');
    expect(testo).toContain('Rossi Marco');
    expect(testo).toContain(valore);
    expect(testo).toMatch(/Pagina 1 di \d+/);
  });
});
