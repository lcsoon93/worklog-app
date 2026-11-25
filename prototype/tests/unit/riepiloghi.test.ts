/**
 * Test funzionali dei riepiloghi PDF: modello (dati e totali) e contenuto del PDF generato
 * (testo estratto con pdfjs). Nessun test di sicurezza.
 */
import { describe, expect, it } from 'vitest';
import { seedDemo } from '../../src/data/demo-seed';
import { LocalDb } from '../../src/data/local-db';
import { MemoryStorage } from '../../src/data/storage';
import { costruisciSnapshotMese, calcolaDaRecord, contaCorrezioni } from '../../src/domain/day-records';
import { atLocal, daysInMonth, toIso } from '../../src/domain/time';
import type { AttivitaLavoro, Presenza } from '../../src/domain/types';
import { layoutGiornaliero, layoutMensile } from '../../src/reports/layout-pdf';
import { oreMinuti } from '../../src/reports/formato';
import { generaPdfGiornaliero, generaPdfMensile, nomeFilePdf } from '../../src/reports/pdf-report-service';
import { AppServices } from '../../src/services/app-services';
import { creaAmbiente, H, M } from './fixture';
import { testoPdf } from './pdf-helpers';

const dest = (cliente_id: string | null, tipo: AttivitaLavoro['tipo'] = 'lavoro_cliente', codice_interno: AttivitaLavoro['codice_interno'] = null) => ({
  tipo, cliente_id, sede_id: null, intervento_id: null, codice_interno, descrizione: '',
});

/** Giornata di riferimento (T01 della Fase 1): 08:00–16:00, pausa 12:00–12:45. */
async function giornataCompleta() {
  const t = await creaAmbiente();
  await t.come(t.op);
  t.alle('08:00');
  const p = await t.s.workday.registraEntrata();
  await t.s.workday.avviaAttivita(p.id, dest(t.cliA.id));
  t.alle('10:00');
  await t.s.workday.fermaAttivita(p.id);
  t.alle('10:10');
  await t.s.workday.avviaAttivita(p.id, dest(t.cliB.id));
  t.alle('12:00');
  await t.s.workday.iniziaPausa(p.id, 'pranzo');
  t.alle('12:45');
  await t.s.workday.terminaPausa(p.id);
  await t.s.workday.riprendiAttivita(p.id, t.s.workday.pause(p.id)[0].attivita_sospesa_id!);
  t.alle('15:00');
  await t.s.workday.avviaAttivita(p.id, dest(null, 'interna', 'magazzino'));
  t.alle('16:00');
  await t.s.workday.registraUscita(p.id);
  return { t, p };
}

describe('riepilogo giornaliero – modello', () => {
  it('R01 giornata completa: totali identici al motore centrale e ripartiti per categoria', async () => {
    const { t, p } = await giornataCompleta();
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    const motore = t.s.workday.riepilogo(p.id);
    expect(m.statoGiornata).toBe('chiusa');
    expect(m.totali).toEqual({
      lordaMs: motore.lorda_ms, pauseMs: motore.pause_ms, nettaMs: motore.netta_ms,
      clientiMs: motore.per_tipo.lavoro_cliente, interneMs: motore.per_tipo.interna, trasferimentiMs: motore.per_tipo.trasferimento,
      attribuiteMs: motore.attribuite_ms, nonAttribuiteMs: motore.non_attribuite_ms, daClassificareMs: motore.da_classificare_ms,
    });
    expect(m.totali!.nettaMs).toBe(7 * H + 15 * M);
    expect(m.totali!.clientiMs).toBe(6 * H + 5 * M);
    expect(m.totali!.interneMs).toBe(1 * H);
    expect(m.totali!.nonAttribuiteMs).toBe(10 * M);
    expect(m.attivita.map((a) => a.categoria)).toEqual(['cliente', 'cliente', 'cliente', 'interna']);
    expect(m.intervalliScoperti).toEqual([{ inizio: atLocal('2026-03-10', '10:00'), fine: atLocal('2026-03-10', '10:10') }]);
    expect(m.presenze[0].pause).toHaveLength(1);
    expect(m.esportabile).toBe(true);
  });

  it('R02 pause multiple: tutte elencate, totale come da motore', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    for (const [i, f] of [['10:00', '10:15'], ['12:30', '13:15'], ['15:00', '15:10']]) {
      t.alle(i); await t.s.workday.iniziaPausa(p.id, 'breve');
      t.alle(f); await t.s.workday.terminaPausa(p.id);
    }
    t.alle('17:00');
    await t.s.workday.registraUscita(p.id);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.presenze[0].pause.map((x) => x.durataMs)).toEqual([15 * M, 45 * M, 10 * M]);
    expect(m.totali!.pauseMs).toBe(70 * M);
    expect(m.totali!.nettaMs).toBe(9 * H - 70 * M);
  });

  it('R03 ore non attribuite: timer senza cliente e tempo scoperto, segnalati come anomalie', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, dest(null, 'da_definire'));
    t.alle('10:00');
    await t.s.workday.fermaAttivita(p.id);
    t.alle('12:00');
    await t.s.workday.registraUscita(p.id);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.totali!.nonAttribuiteMs).toBe(4 * H);
    expect(m.totali!.daClassificareMs).toBe(2 * H);
    expect(m.attivita[0].categoria).toBe('non_attribuita');
    expect(m.anomalie.map((a) => a.testo)).toEqual(expect.arrayContaining(['Attività da classificare', 'Ore non attribuite oltre soglia']));
  });

  it('R04 rapportini multipli inclusi, bozze escluse e contate; giornata senza rapportini', async () => {
    const { t } = await giornataCompleta();
    expect(t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10').rapportini).toEqual([]);
    for (const c of [t.cliA, t.cliB]) {
      const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: c.id, sede_id: null, intervento_id: null });
      await t.s.report.completa({ ...r, descrizione_lavoro: `Lavoro eseguito per ${c.ragione_sociale}` });
    }
    await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.rapportini.map((r) => r.cliente)).toEqual(['Cliente A', 'Cliente B']);
    expect(m.rapportini[0].intervento).toBe('Rapportino autonomo');
    expect(m.bozzeEscluse).toBe(1);
  });

  it('R05 dati incompleti: uscita mancante → nessun totale inventato; giornata in corso → provvisoria', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, dest(t.cliA.id));
    t.alle('10:30');
    const inCorso = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(inCorso.statoGiornata).toBe('in_corso');
    expect(inCorso.calcolatoFinoA).toBe(atLocal('2026-03-10', '10:30'));
    expect(inCorso.totali!.clientiMs).toBe(150 * M);

    t.alle('09:00', '2026-03-11'); // il giorno dopo, nessun segnale dall'app
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.statoGiornata).toBe('non_chiusa');
    expect(m.totali).toBeNull();
    expect(m.presenze[0]).toMatchObject({ uscita: null, lordaMs: null, nettaMs: null });
    expect(m.attivita[0]).toMatchObject({ fine: null, durataMs: null });
    expect(m.anomalie[0].livello).toBe('errore');
  });

  it('R06 turno oltre mezzanotte: appartiene al giorno di entrata, escluso dal giorno dopo', async () => {
    const t = await creaAmbiente(atLocal('2026-03-10', '22:00'));
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, dest(t.cliA.id));
    t.alle('06:00', '2026-03-11');
    await t.s.workday.registraUscita(p.id);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.totali!.nettaMs).toBe(8 * H);
    expect(m.anomalie.map((a) => a.testo)).toContain('Turno oltre mezzanotte');
    const dopo = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-11');
    expect(dopo.statoGiornata).toBe('assente');
    expect(dopo.esportabile).toBe(false);
  });

  it('R07 intervalli sovrapposti (due dispositivi): tempo comune contato una sola volta', async () => {
    const { t, p } = await giornataCompleta();
    // Attività sovrapposta arrivata da un altro dispositivo (scrittura diretta, come la sincronizzazione).
    const altra = { ...t.s.workday.attivita(p.id)[0], id: '00000000-0000-4000-8000-0000000000ff', inizio_at: toIso(atLocal('2026-03-10', '09:00')), fine_at: toIso(atLocal('2026-03-10', '10:00')), cliente_id: t.cliB.id, created_at: toIso(atLocal('2026-03-10', '09:00')) };
    await t.s.db.applyBatch([{ tipo: 'put', store: 'attivita_lavoro', value: altra }]);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.totali!.clientiMs).toBe(6 * H + 5 * M); // invariato: l'ora comune non è contata due volte
    const a = m.attivita.find((x) => x.inizio === atLocal('2026-03-10', '08:00'))!;
    expect(a.durataMs).toBe(1 * H);
    expect(a.note.join(' ')).toMatch(/Registrata 02:00, conteggiata 01:00/);
    expect(m.anomalie.map((x) => x.testo)).toContain('Attività sovrapposte (tempo comune contato una volta)');
  });

  it('R08 filtri: esclusi altri operai e altri giorni', async () => {
    const { t } = await giornataCompleta();
    // stesso operaio, giorno successivo
    t.alle('08:00', '2026-03-11');
    const p2 = await t.s.workday.registraEntrata();
    t.alle('09:00', '2026-03-11');
    await t.s.workday.registraUscita(p2.id);
    // altro operaio, stesso giorno (scrittura diretta)
    const estranea: Presenza = { ...t.s.db.get('presenze', p2.id)!, id: '00000000-0000-4000-8000-0000000000ee', operaio_id: t.admin.id, data_lavoro: '2026-03-10', entrata_at: toIso(atLocal('2026-03-10', '07:00')), uscita_at: toIso(atLocal('2026-03-10', '19:00')) };
    await t.s.db.applyBatch([{ tipo: 'put', store: 'presenze', value: estranea }]);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    expect(m.presenze).toHaveLength(1);
    expect(m.totali!.lordaMs).toBe(8 * H);
    expect(m.attivita.every((a) => a.data === '2026-03-10')).toBe(true);
  });
});

describe('riepilogo giornaliero – PDF', () => {
  it('R09 contenuto del PDF corrispondente al modello, caratteri accentati e numerazione', async () => {
    const { t } = await giornataCompleta();
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliB.id, sede_id: null, intervento_id: null });
    await t.s.report.completa({ ...r, descrizione_lavoro: 'Sostituita la valvola, verificata la tenuta' });
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    const pagine = await testoPdf(await generaPdfGiornaliero(m));
    const testo = pagine.join(' ');
    expect(testo).toContain('Riepilogo giornata lavorativa');
    expect(testo).toContain('martedì 10 marzo 2026');
    expect(testo).toContain('Otto Operaio');
    expect(testo).toContain(m.intestazione.idDocumento);
    for (const s of ['08:00', '16:00', '12:00', '12:45']) expect(testo).toContain(s);
    // Totali (stessi valori del modello / motore)
    expect(testo).toMatch(/Presenza lorda 08:00/);
    expect(testo).toMatch(/Pause 00:45/);
    expect(testo).toMatch(/Ore nette lavorate 07:15/);
    expect(testo).toMatch(/Ore attribuite ai clienti 06:05/);
    expect(testo).toMatch(/Ore interne 01:00/);
    expect(testo).toMatch(/Ore di trasferimento 00:00/);
    expect(testo).toMatch(/Ore non attribuite 00:10/);
    // Sezioni e caratteri accentati
    for (const s of ['Lavori presso clienti', 'Attività interne', 'Attività non attribuite', 'Tempo di presenza senza attività registrata', 'Firma dell\'operaio', 'Rapportini della giornata', 'Sostituita la valvola']) expect(testo).toContain(s);
    expect(testo).not.toContain('Trasferimenti '); // nessun trasferimento registrato → nessuna sezione inventata
    pagine.forEach((p, i) => expect(p).toContain(`Pagina ${i + 1} di ${pagine.length}`));
    expect(nomeFilePdf(m)).toBe('riepilogo-giornaliero_2026-03-10_otto-operaio.pdf');
  });

  it('R10 giornata con uscita mancante: il PDF lo dichiara e non riporta totali', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.alle('08:00');
    await t.s.workday.registraEntrata();
    t.alle('09:00', '2026-03-11');
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    const testo = (await testoPdf(await generaPdfGiornaliero(m))).join(' ');
    expect(testo).toContain('non registrata');
    expect(testo).toContain('Totali non calcolabili');
    expect(testo).not.toMatch(/Ore nette lavorate \d/);
  });

  it('R11 giornata senza presenze: esportazione bloccata con messaggio comprensibile', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    const m = t.s.riepiloghi.giornaliero(t.op.id, '2026-03-10');
    await expect(generaPdfGiornaliero(m)).rejects.toThrow(/Nessuna presenza registrata/);
  });
});

// ---------------------------------------------------------------------------------------
// Mensile su dati demo (mese di ottobre 2026 completo, cartellini in stati diversi)
// ---------------------------------------------------------------------------------------

async function ambienteDemo() {
  const storage = new MemoryStorage();
  const db = new LocalDb(storage);
  await db.init();
  const now = atLocal('2026-11-24', '10:15');
  db.clock = () => now;
  await seedDemo(db, now);
  const s = new AppServices(db, { sleep: async () => {} });
  const profilo = (nome: string) => db.all('profili').find((p) => p.nome === nome)!;
  return { s, db, now, profilo };
}

describe('riepilogo mensile – modello', () => {
  it('R12 mese completo: totali = somma dei giorni = snapshot del cartellino; quadratura', async () => {
    const { s, db, now, profilo } = await ambienteDemo();
    const marco = profilo('Marco');
    await s.login(marco.email, 'demo');
    const m = s.riepiloghi.mensile(marco.id, 2026, 10);
    const snap = costruisciSnapshotMese(marco.id, 2026, 10, db.all('presenze'), db.all('pause_presenza'), db.all('attivita_lavoro', { includiEliminati: true }), now);
    expect(m.totali.nettaMs).toBe(snap.totali.netta_ms);
    expect(m.totali.attribuiteMs).toBe(snap.totali.attribuite_ms);
    expect(m.totali.nonAttribuiteMs).toBe(snap.totali.non_attribuite_ms);
    expect(m.totali.giorniLavorati).toBe(snap.totali.giorni_lavorati);
    expect(m.giorni.reduce((n, g) => n + (g.nettaMs ?? 0), 0)).toBe(m.totali.nettaMs);
    expect(m.quadratura).toBe(true);
    expect(m.totali.clientiMs + m.totali.interneMs + m.totali.trasferimentiMs).toBe(m.totali.attribuiteMs);
    expect(m.giorni).toHaveLength(31);
  });

  it('R13 giorni senza presenza: non lavorati, valori assenti (non zero), feriali contati a parte', async () => {
    const { s, profilo } = await ambienteDemo();
    const marco = profilo('Marco');
    await s.login(marco.email, 'demo');
    const m = s.riepiloghi.mensile(marco.id, 2026, 10);
    const vuoti = m.giorni.filter((g) => !g.lavorato);
    expect(vuoti.length).toBe(m.totali.giorniSenzaPresenza);
    expect(vuoti.length + m.totali.giorniLavorati).toBe(31);
    for (const g of vuoti) expect(g).toMatchObject({ entrata: null, nettaMs: null, attribuiteMs: null });
    expect(vuoti.filter((g) => g.weekend).every((g) => g.stato === 'Non lavorativo')).toBe(true);
    expect(m.totali.giorniFerialiSenzaPresenza).toBe(vuoti.filter((g) => !g.weekend).length);
  });

  it('R14 più clienti e attività interne: ripartizioni coerenti con i totali', async () => {
    const { s, profilo } = await ambienteDemo();
    const luca = profilo('Luca');
    await s.login('laura.bianchi@demo.local', 'demo');
    const m = s.riepiloghi.mensile(luca.id, 2026, 10);
    expect(m.perCliente.length).toBeGreaterThan(2);
    expect(m.perInterna.length).toBeGreaterThan(0);
    expect(m.perInterna.reduce((n, x) => n + x.ms, 0)).toBe(m.totali.interneMs);
    expect(m.perCliente.reduce((n, c) => n + c.lavoroMs, 0)).toBe(m.totali.clientiMs);
    for (const c of m.perCliente) expect(c.giornate).toBeLessThanOrEqual(m.totali.giorniLavorati);
  });

  it('R15 correzioni: elencate come operazioni (non righe) e conteggiate per giorno', async () => {
    const { s, db } = await ambienteDemo();
    let trovato = false;
    await s.login('laura.bianchi@demo.local', 'demo');
    for (const op of db.where('profili', (p) => p.ruolo === 'operaio')) {
      const m = s.riepiloghi.mensile(op.id, 2026, 10);
      const ids = new Set(db.where('presenze', (p) => p.operaio_id === op.id && p.data_lavoro.startsWith('2026-10-')).map((p) => p.id));
      const attese = contaCorrezioni(db.all('attivita_lavoro').filter((a) => ids.has(a.presenza_id)));
      expect(m.correzioni.length).toBe(attese);
      expect(m.giorni.reduce((n, g) => n + g.correzioni, 0)).toBe(attese);
      if (attese) {
        trovato = true;
        expect(m.correzioni[0].motivo).toBeTruthy();
      }
    }
    expect(trovato).toBe(true);
  });

  it('R16 mese non approvato → provvisorio; mese approvato → autore e data dell\'approvazione', async () => {
    const { s, profilo } = await ambienteDemo();
    await s.login('laura.bianchi@demo.local', 'demo');
    const marco = s.riepiloghi.mensile(profilo('Marco').id, 2026, 10);
    expect(marco.cartellino.stato).toBe('da_confermare_operaio');
    expect(marco.provvisorio).toBe(true);
    const andrea = s.riepiloghi.mensile(profilo('Andrea').id, 2026, 10);
    expect(andrea.cartellino).toMatchObject({ stato: 'approvato', approvato: true, approvatoDa: 'Laura Bianchi', coerenteConApprovata: true, versioneApprovata: 1 });
    expect(andrea.cartellino.approvatoIl).toBeTypeOf('number');
    expect(andrea.provvisorio).toBe(false);
    const corrente = s.riepiloghi.mensile(profilo('Andrea').id, 2026, 11);
    expect(corrente.cartellino).toMatchObject({ esiste: false, stato: 'in_compilazione' });
    expect(corrente.provvisorio).toBe(true);
  });

  it('R17 dati incompleti nel mese: giornata con uscita mancante esclusa dai totali e segnalata', async () => {
    const t = await creaAmbiente(atLocal('2026-03-09', '08:00'));
    await t.come(t.op);
    const p1 = await t.s.workday.registraEntrata();
    t.alle('16:00', '2026-03-09');
    await t.s.workday.registraUscita(p1.id);
    t.alle('08:00');
    await t.s.workday.registraEntrata(); // mai chiusa
    t.alle('10:00', '2026-03-12');
    const m = t.s.riepiloghi.mensile(t.op.id, 2026, 3);
    expect(m.totali.giorniLavorati).toBe(2);
    expect(m.totali.giorniIncompleti).toBe(1);
    expect(m.totali.lordaMs).toBe(8 * H);
    expect(m.giorni.find((g) => g.data === '2026-03-10')).toMatchObject({ stato: 'Uscita mancante', nettaMs: null, uscita: null });
    expect(m.anomalie.some((a) => /uscita mancante sono escluse/.test(a.testo))).toBe(true);
  });

  it('R18 cambio mese e anno: turno 31/12 22:00 → 01/01 06:00 solo nel mese di entrata', async () => {
    const t = await creaAmbiente(atLocal('2025-12-31', '22:00'));
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, dest(t.cliA.id));
    t.alle('06:00', '2026-01-01');
    await t.s.workday.registraUscita(p.id);
    t.alle('08:00', '2026-01-02');
    const p2 = await t.s.workday.registraEntrata();
    t.alle('12:00', '2026-01-02');
    await t.s.workday.registraUscita(p2.id);
    const dic = t.s.riepiloghi.mensile(t.op.id, 2025, 12);
    const gen = t.s.riepiloghi.mensile(t.op.id, 2026, 1);
    expect(dic.totali).toMatchObject({ giorniLavorati: 1, nettaMs: 8 * H, clientiMs: 8 * H });
    expect(gen.totali).toMatchObject({ giorniLavorati: 1, nettaMs: 4 * H });
    expect(gen.giorni[0]).toMatchObject({ data: '2026-01-01', lavorato: false });
    expect(dic.giorni).toHaveLength(31);
    expect(gen.attivitaPerGiorno.map((g) => g.data)).toEqual(['2026-01-02']);
  });

  it('R19 esclusione di altri mesi: il mese contiene solo le presenze con data nel mese', async () => {
    const { s, db, now, profilo } = await ambienteDemo();
    const marco = profilo('Marco');
    await s.login(marco.email, 'demo');
    const nov = s.riepiloghi.mensile(marco.id, 2026, 11);
    const presenzeNov = db.where('presenze', (p) => p.operaio_id === marco.id && p.data_lavoro.startsWith('2026-11-'));
    const attesa = presenzeNov.reduce((n, p) => n + calcolaDaRecord(p, db.all('pause_presenza'), db.all('attivita_lavoro'), now).netta_ms, 0);
    expect(nov.totali.nettaMs).toBe(attesa);
    expect(nov.attivitaPerGiorno.every((g) => g.data.startsWith('2026-11-'))).toBe(true);
    expect(nov.giorni.map((g) => g.data)).toEqual(daysInMonth(2026, 11));
  });
});

describe('riepilogo mensile – PDF', () => {
  it('R20 più pagine numerate, prima pagina di riepilogo, totali e stato corrispondenti al modello', async () => {
    const { s, profilo } = await ambienteDemo();
    await s.login('laura.bianchi@demo.local', 'demo');
    const m = s.riepiloghi.mensile(profilo('Marco').id, 2026, 10);
    const pagine = await testoPdf(await generaPdfMensile(m));
    expect(pagine.length).toBeGreaterThanOrEqual(4);
    pagine.forEach((p, i) => expect(p).toContain(`Pagina ${i + 1} di ${pagine.length}`));
    // Prima pagina: riepilogo generale e stato
    expect(pagine[0]).toContain('Riepilogo mensile presenze e attività');
    expect(pagine[0]).toContain('Ottobre 2026');
    expect(pagine[0]).toContain('DOCUMENTO PROVVISORIO – NON APPROVATO');
    expect(pagine[0]).toContain(`Giorni lavorati ${m.totali.giorniLavorati}`);
    expect(pagine[0]).toContain(`Ore nette lavorate ${oreMinuti(m.totali.nettaMs)}`);
    expect(pagine[0]).toContain(`Totale ore attribuite ${oreMinuti(m.totali.attribuiteMs)}`);
    expect(pagine[0]).toContain(`Ore interne ${oreMinuti(m.totali.interneMs)}`);
    expect(pagine[0]).not.toContain('Tabella giornaliera');
    // Tabella giornaliera su pagina successiva con totale
    const tutto = pagine.join(' ');
    expect(pagine[1]).toContain('Tabella giornaliera');
    expect(tutto).toContain(`Totale (${m.totali.giorniLavorati} giorni lavorati)`);
    expect(tutto).toContain('Nessuna presenza');
    expect(tutto).toContain('Non lavorativo');
    // Ogni giorno del mese compare
    for (const g of m.giorni) expect(tutto).toContain(`${g.data.slice(8, 10)}/10`);
    // Ultima sezione: clienti e stato approvazione
    const ultima = pagine.slice(-2).join(' ');
    expect(ultima).toContain('Riepilogo per cliente');
    expect(ultima).toContain('Stato del cartellino e approvazione');
    for (const c of m.perCliente) expect(tutto).toContain(c.cliente);
    expect(tutto).toContain('FrescoPiù Supermercati S.r.l.'); // carattere accentato
  });

  it('R21 mese approvato: il PDF riporta data e autore dell\'approvazione e non è provvisorio', async () => {
    const { s, profilo } = await ambienteDemo();
    await s.login('laura.bianchi@demo.local', 'demo');
    const m = s.riepiloghi.mensile(profilo('Andrea').id, 2026, 10);
    const testo = (await testoPdf(await generaPdfMensile(m))).join(' ');
    expect(testo).toContain('CARTELLINO APPROVATO');
    expect(testo).toMatch(/Approvato il \d{2}\/\d{2}\/\d{4} alle \d{2}:\d{2} da Laura Bianchi \(versione 1\)/);
    expect(testo).not.toContain('DOCUMENTO PROVVISORIO');
    // Il riquadro di stato compare sia in prima pagina sia nella sezione finale (non vuoto).
    expect(testo.match(/Stato del cartellino: Approvato · versione 1/g)?.length).toBe(2);
    expect(testo.match(/Approvato il /g)?.length).toBe(2);
    expect(nomeFilePdf(m)).toBe('riepilogo-mensile_2026-10_andrea-conti.pdf');
  });

  it('R22 layout: A4, intestazione e piè di pagina, tabelle con intestazione ripetuta e righe non spezzate', async () => {
    const { s, profilo } = await ambienteDemo();
    await s.login('laura.bianchi@demo.local', 'demo');
    const def = layoutMensile(s.riepiloghi.mensile(profilo('Marco').id, 2026, 10));
    expect(def.pageSize).toBe('A4');
    expect(typeof def.header).toBe('function');
    expect(typeof def.footer).toBe('function');
    const tabelle: Array<{ table: { headerRows?: number; dontBreakRows?: boolean } }> = [];
    const visita = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(visita);
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        if (o.table && (o.table as { body?: unknown }).body) tabelle.push(o as never);
        Object.values(o).forEach(visita);
      }
    };
    visita(def.content);
    const dati = tabelle.filter((t) => (t.table.headerRows ?? 0) > 0);
    expect(dati.length).toBeGreaterThan(5);
    expect(dati.every((t) => t.table.dontBreakRows === true)).toBe(true);
    const g = layoutGiornaliero((await giornataCompleta()).t.s.riepiloghi.giornaliero('00000000-0000-4000-8000-000000000002', '2026-03-10'));
    expect(g.watermark).toBeUndefined(); // giornata chiusa: nessuna dicitura provvisoria
    expect(def.watermark).toBeDefined(); // mese non approvato: filigrana "PROVVISORIO"
  });
});
