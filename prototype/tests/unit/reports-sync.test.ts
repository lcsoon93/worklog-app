import { describe, expect, it } from 'vitest';
import { atLocal } from '../../src/domain/time';
import { MemoryStorage } from '../../src/data/storage';
import { LocalDb } from '../../src/data/local-db';
import { seedDemo } from '../../src/data/demo-seed';
import { costruisciSnapshotMese, calcolaDaRecord } from '../../src/domain/day-records';
import { creaAmbiente, H } from './fixture';

async function giornataConIntervento() {
  const t = await creaAmbiente();
  await t.come(t.admin);
  const i = await t.s.planning.creaIntervento(
    { cliente_id: t.cliA.id, sede_id: t.sedeA.id, titolo: 'Manutenzione caldaia', descrizione: '', tipo: 'manutenzione', priorita: 'normale', data_programmata: '2026-03-10', ora_inizio: '08:00', durata_prevista_min: 120, note: '' },
    [t.op.id],
  );
  await t.come(t.op);
  t.alle('08:00');
  const p = await t.s.workday.registraEntrata();
  await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: null, sede_id: null, intervento_id: i.id, codice_interno: null, descrizione: '' });
  t.alle('10:00');
  await t.s.workday.fermaAttivita(p.id);
  return { t, i, p };
}

describe('rapportini e ritorni', () => {
  it('T21 rapportino da intervento: ore dalle attività, bozza solo locale, numero assegnato dal server', async () => {
    const { t, i } = await giornataConIntervento();
    expect(t.s.db.get('interventi', i.id)?.stato).toBe('in_corso');
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: i.id });
    expect(r.sync_stato).toBe('locale');
    expect(t.s.db.outbox().some((o) => o.entita_id === r.id)).toBe(false);
    expect(r.attivita_ids.length).toBe(1);
    expect(t.s.report.oreRapportino(r)).toBe(2 * H);

    await expect(t.s.report.completa(r)).rejects.toThrow(/Descrivi/);
    const fatto = await t.s.report.completa({ ...r, descrizione_lavoro: 'Pulizia bruciatore e verifica combustione' });
    expect(fatto.stato).toBe('completato');
    expect(t.s.db.get('interventi', i.id)?.stato).toBe('completato');
    expect(fatto.numero).toBeNull(); // il numero definitivo arriva solo dal server
    await t.s.sync.ciclo();
    expect(t.s.db.get('rapportini', r.id)?.numero).toMatch(/^R-2026-\d{4}$/);
    expect(t.s.db.get('rapportini', r.id)?.sync_stato).toBe('sincronizzato');
  });

  it('T22 rapportino autonomo (senza intervento) e rapportino completo che richiede la firma', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    const r = await t.s.report.creaBozza({ tipo: 'completo', cliente_id: t.cliB.id, sede_id: null, intervento_id: null });
    expect(r.intervento_id).toBeNull();
    await expect(t.s.report.completa({ ...r, descrizione_lavoro: 'Sostituito interruttore differenziale' })).rejects.toThrow(/firma/);
    const firma = await t.s.report.aggiungiAllegato('firma', 'rapportino', r.id, 'firma.png', 'image/png', 'data:image/png;base64,AAAA');
    expect(firma.sync_stato).toBe('locale');
    const ok = await t.s.report.completa({ ...r, descrizione_lavoro: 'Sostituito interruttore differenziale', firma_cliente_id: firma.id, firma_cliente_nome: 'Mario Bianchi' });
    expect(ok.stato).toBe('firmato');
    // L'allegato è accodato DOPO il rapportino
    const ordine = t.s.db.outbox().map((o) => o.entita);
    expect(ordine.indexOf('rapportini')).toBeLessThan(ordine.indexOf('allegati'));
  });

  it('T23 ritorno collegato: rapportino → followup → intervento di ritorno → rapportino che lo chiude', async () => {
    const { t, i } = await giornataConIntervento();
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: i.id });
    await expect(t.s.report.completa({ ...r, descrizione_lavoro: 'Smontata valvola difettosa', esito: 'ritorno_necessario' })).rejects.toThrow(/resta da fare/);
    await t.s.report.completa({ ...r, descrizione_lavoro: 'Smontata valvola difettosa', esito: 'ritorno_necessario', note_interne: 'Montare valvola nuova (ordinata)' });
    expect(t.s.db.get('interventi', i.id)?.stato).toBe('da_ultimare');
    const [f] = t.s.report.followup((x) => x.rapportino_origine_id === r.id);
    expect(f.tipo).toBe('ritorno');
    expect(f.intervento_origine_id).toBe(i.id);

    await t.come(t.admin);
    const ritorno = await t.s.report.pianificaRitorno(f.id, { data: '2026-03-12', ora: '09:00', durata_min: 60, operai: [t.op.id], priorita: 'alta' });
    expect(ritorno.tipo).toBe('ritorno');
    expect(ritorno.followup_origine_id).toBe(f.id);
    expect(t.s.db.get('followup', f.id)?.stato).toBe('pianificato');
    await expect(t.s.report.pianificaRitorno(f.id, { data: '2026-03-13', ora: '09:00', durata_min: 60, operai: [t.op.id], priorita: 'alta' })).rejects.toThrow();

    await t.come(t.op);
    t.alle('09:00', '2026-03-12');
    const r2 = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: t.sedeA.id, intervento_id: ritorno.id });
    expect(r2.followup_id).toBe(f.id);
    await t.s.report.completa({ ...r2, descrizione_lavoro: 'Montata valvola nuova, impianto ok' });
    expect(t.s.db.get('followup', f.id)?.stato).toBe('chiuso');
    expect(t.s.db.get('followup', f.id)?.rapportino_chiusura_id).toBe(r2.id);
    const catena = t.s.report.catena(r2.id)!;
    expect(catena.rapportinoOrigine?.id).toBe(r.id);
  });
});

describe('offline e sincronizzazione', () => {
  it('T24 offline: i dati restano in coda; nulla risulta sincronizzato senza conferma del server', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    await t.s.impostaSimulazione({ offline: true });
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    const esito = await t.s.sync.ciclo();
    expect(esito.inviate).toBe(0);
    expect(t.s.db.get('presenze', p.id)?.sync_stato).toBe('in_attesa');
    expect(t.s.sync.pendenti().length).toBe(2);
    expect(t.s.api.stato().applicazioni).toBe(0);

    await t.s.impostaSimulazione({ offline: false });
    const e2 = await t.s.sync.ciclo();
    expect(e2.riuscite).toBe(2);
    expect(t.s.db.get('presenze', p.id)?.sync_stato).toBe('sincronizzato');
    expect(t.s.db.get('presenze', p.id)?.row_version).toBe(1);
  });

  it('T25 errore server: stato errore, backoff, ritentativo con lo stesso op_id', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.impostaSimulazione({ erroreServer: true });
    await t.s.sync.ciclo();
    const op = t.s.db.outbox()[0];
    expect(op.stato).toBe('errore');
    expect(op.ultimo_errore).toMatch(/500/);
    expect(t.s.db.get('presenze', p.id)?.sync_stato).toBe('errore');

    await t.s.impostaSimulazione({ erroreServer: false });
    expect((await t.s.sync.ciclo()).inviate).toBe(0); // backoff non ancora scaduto
    t.avanza(5000);
    await t.s.sync.ciclo();
    const dopo = t.s.db.outbox()[0];
    expect(dopo.id).toBe(op.id);
    expect(dopo.tentativi).toBe(2);
    expect(dopo.stato).toBe('sincronizzato');
  });

  it('T26 risposta persa: il ritentativo non duplica l\'operazione (idempotenza)', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.impostaSimulazione({ rispostaPersa: true });
    await t.s.sync.ciclo();
    expect(t.s.db.get('presenze', p.id)?.sync_stato).toBe('errore');
    expect(t.s.api.stato().applicazioni).toBe(1);
    await t.s.sync.ciclo({ forza: true });
    expect(t.s.api.stato().applicazioni).toBe(1);
    expect(t.s.db.get('presenze', p.id)?.sync_stato).toBe('sincronizzato');
  });

  it('T27 conflitto: rilevato con la versione, risolto mantenendo il dato locale o accettando il server', async () => {
    const t = await creaAmbiente();
    await t.come(t.admin);
    await t.s.planning.salvaCliente({ ...t.cliA, note: 'Nota dal tablet' });
    await t.s.impostaSimulazione({ conflittoProssimaOp: true });
    await t.s.sync.ciclo();
    const op = t.s.db.outbox().find((o) => o.entita === 'clienti')!;
    expect(op.stato).toBe('conflitto');
    expect(t.s.db.get('clienti', t.cliA.id)?.sync_stato).toBe('conflitto');
    expect(t.s.simulazione().conflittoProssimaOp).toBe(false);

    await t.s.sync.risolviMantieniLocale(op.id);
    await t.s.sync.ciclo();
    expect(t.s.db.get('clienti', t.cliA.id)?.sync_stato).toBe('sincronizzato');
    expect(t.s.db.get('clienti', t.cliA.id)?.note).toBe('Nota dal tablet');
    expect(t.s.db.get('clienti', t.cliA.id)?.row_version).toBe(3);

    // Secondo conflitto, risolto accettando il server
    await t.s.planning.salvaCliente({ ...t.s.db.get('clienti', t.cliA.id)!, note: 'Seconda nota' });
    await t.s.impostaSimulazione({ conflittoProssimaOp: true });
    await t.s.sync.ciclo();
    const op2 = t.s.db.outbox().find((o) => o.stato === 'conflitto')!;
    await t.s.sync.risolviAccettaServer(op2.id);
    expect(t.s.db.get('clienti', t.cliA.id)?.note).toMatch(/altro dispositivo/);
    expect(t.s.db.audit().some((a) => /accettando la versione del server/.test(a.motivo))).toBe(true);
  });

  it('T28 scrittura locale fallita: nessun dato mostrato come salvato', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    t.storage.failNextWrite = true;
    await expect(t.s.workday.registraEntrata()).rejects.toThrow(/dispositivo/);
    expect(t.s.workday.presenzaAperta(t.op.id)).toBeUndefined();
    expect(t.s.db.outbox().length).toBe(0);
  });
});

describe('dati dimostrativi', () => {
  it('T29 seed coerente: mese precedente chiuso, invarianti su ogni giornata, snapshot dei cartellini riproducibili', async () => {
    const db = new LocalDb(new MemoryStorage());
    await db.init();
    const now = atLocal('2026-11-24', '10:15');
    db.clock = () => now;
    await seedDemo(db, now);
    const presenze = db.all('presenze');
    expect(presenze.length).toBeGreaterThan(100);
    const pause = db.all('pause_presenza');
    const att = db.all('attivita_lavoro');
    for (const p of presenze) {
      const r = calcolaDaRecord(p, pause, att, now);
      expect(r.attribuite_ms + r.non_attribuite_ms).toBe(r.netta_ms);
      if (p.data_lavoro < '2026-11-24') expect(p.uscita_at).not.toBeNull();
    }
    const cart = db.all('cartellini_mensili');
    expect(cart.map((c) => c.stato).sort()).toEqual(['approvato', 'da_confermare_operaio', 'da_correggere', 'in_attesa_approvazione']);
    for (const c of cart) {
      const v = db.all('cartellino_versioni').find((x) => x.cartellino_id === c.id)!;
      const ricalcolo = costruisciSnapshotMese(c.operaio_id, c.anno, c.mese, presenze, pause, att, now);
      expect(ricalcolo.impronta).toBe(v.impronta);
    }
    expect(db.all('followup').some((f) => f.stato === 'pianificato' && f.intervento_ritorno_id)).toBe(true);
    expect(db.all('followup').some((f) => f.stato === 'aperto')).toBe(true);
    expect(presenze.some((p) => p.data_lavoro === '2026-11-24' && p.operaio_id === db.all('profili').find((x) => x.nome === 'Marco')!.id)).toBe(false);
  });
});
