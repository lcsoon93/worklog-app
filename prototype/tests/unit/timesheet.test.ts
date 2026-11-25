import { describe, expect, it } from 'vitest';
import { azioniDisponibili, valutaTransizione } from '../../src/domain/timesheet-workflow';
import { atLocal } from '../../src/domain/time';
import { creaAmbiente, H } from './fixture';

describe('macchina a stati del cartellino', () => {
  it('ammette solo le transizioni definite, con attore e motivazione corretti', () => {
    const base = { utenteId: 'op', titolareId: 'op' };
    expect(valutaTransizione({ ...base, stato: 'da_confermare_operaio', azione: 'conferma', attore: 'operaio' }).ok).toBe(true);
    expect(valutaTransizione({ ...base, stato: 'da_confermare_operaio', azione: 'conferma', attore: 'operaio', utenteId: 'altro' }).ok).toBe(false);
    expect(valutaTransizione({ ...base, stato: 'in_attesa_approvazione', azione: 'approva', attore: 'operaio' }).ok).toBe(false);
    expect(valutaTransizione({ ...base, stato: 'approvato', azione: 'riapri', attore: 'admin' }).ok).toBe(false); // manca motivazione
    expect(valutaTransizione({ ...base, stato: 'approvato', azione: 'riapri', attore: 'admin', motivazione: 'Errore ore' }).ok).toBe(true);
    expect(valutaTransizione({ ...base, stato: 'approvato', azione: 'conferma', attore: 'operaio' }).ok).toBe(false);
    expect(valutaTransizione({ ...base, stato: 'confermato_operaio', azione: 'approva', attore: 'admin' }).ok).toBe(false);
    expect(azioniDisponibili('in_attesa_approvazione', 'admin').map((a) => a.azione).sort()).toEqual(['approva', 'richiedi_correzione', 'rifiuta']);
  });
});

describe('flusso mensile completo', () => {
  it('T15–T18 genera → conferma → ricezione server → correzione → v2 → approvazione → riapertura → v3', async () => {
    const t = await creaAmbiente(atLocal('2026-02-10', '08:00'));
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    await t.s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', cliente_id: t.cliA.id, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' });
    t.alle('12:00', '2026-02-10');
    await t.s.workday.fermaAttivita(p.id);
    t.alle('16:00', '2026-02-10');
    await t.s.workday.registraUscita(p.id);

    // Chiusura del mese (amministratore)
    t.alle('09:00', '2026-03-02');
    await t.come(t.admin);
    const c = await t.s.timesheet.genera(t.op.id, 2026, 2);
    expect(c.stato).toBe('da_confermare_operaio');
    const v1 = t.s.timesheet.versione(c.id, 1)!;
    expect(v1.totali.netta_ms).toBe(8 * H);
    expect(v1.totali.attribuite_ms).toBe(4 * H);
    expect(v1.totali.non_attribuite_ms).toBe(4 * H);

    // Il mese è bloccato: l'operaio non può correggere senza segnalare una discrepanza
    await t.come(t.op);
    const att = t.s.workday.attivita(p.id)[0];
    await expect(t.s.workday.correggiAttivita(att.id, { fine_at: new Date(atLocal('2026-02-10', '16:00')).toISOString() }, 'x')).rejects.toThrow(/verifica o approvato/);
    // L'amministratore non può confermare al posto dell'operaio
    await t.come(t.admin);
    await expect(t.s.timesheet.conferma(c.id)).rejects.toThrow();

    // Conferma operaio → confermato_operaio (locale) → ricezione server → in attesa di approvazione
    await t.come(t.op);
    await t.s.timesheet.conferma(c.id);
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('confermato_operaio');
    await t.s.sync.ciclo();
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('in_attesa_approvazione');
    expect(t.s.timesheet.storico(c.id).map((a) => a.azione)).toContain('ricezione_server');

    // L'amministratore richiede una correzione (motivazione obbligatoria)
    await t.come(t.admin);
    await expect(t.s.timesheet.richiediCorrezione(c.id, '  ')).rejects.toThrow(/motivazione/);
    await t.s.timesheet.richiediCorrezione(c.id, 'Classificare il pomeriggio del 10');
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('da_correggere');

    // L'operaio corregge e rigenera: nuova versione, la prima resta intatta
    await t.come(t.op);
    await t.s.workday.aggiungiAttivita(p.id, { tipo: 'interna', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: 'magazzino', descrizione: '' }, atLocal('2026-02-10', '12:00'), atLocal('2026-02-10', '16:00'), 'Pomeriggio in magazzino');
    await t.s.timesheet.rigenera(c.id);
    const v2 = t.s.timesheet.versione(c.id, 2)!;
    expect(v2.totali.attribuite_ms).toBe(8 * H);
    expect(t.s.timesheet.versione(c.id, 1)!.totali.attribuite_ms).toBe(4 * H);
    await t.s.timesheet.conferma(c.id);
    await t.s.sync.ciclo();

    await t.come(t.admin);
    await t.s.timesheet.approva(c.id);
    let cart = t.s.db.get('cartellini_mensili', c.id)!;
    expect(cart.stato).toBe('approvato');
    expect(cart.versione_approvata).toBe(2);

    // Un cartellino approvato non è modificabile silenziosamente
    await t.come(t.op);
    await expect(t.s.workday.annullaAttivita(att.id, 'errore')).rejects.toThrow(/verifica o approvato/);

    // Riapertura con motivazione → nuova versione; la v2 approvata resta
    await t.come(t.admin);
    await t.s.timesheet.riapri(c.id, 'Rettifica richiesta dal consulente del lavoro');
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('riaperto');
    await t.s.timesheet.rigenera(c.id, 'Rettifica');
    cart = t.s.db.get('cartellini_mensili', c.id)!;
    expect(cart.versione_corrente).toBe(3);
    expect(cart.versione_approvata).toBe(2);
    expect(t.s.timesheet.versioni(c.id).map((v) => v.versione)).toEqual([3, 2, 1]);

    // Ogni transizione registra utente, istante, stato precedente/nuovo, motivazione
    const storico = t.s.timesheet.storico(c.id);
    expect(storico.length).toBe(10);
    for (const s of storico) {
      expect(s.eseguita_at).toBeTruthy();
      expect(s.stato_precedente).not.toBe(s.stato_nuovo);
    }
    expect(storico.find((s) => s.azione === 'riapri')?.motivazione).toMatch(/consulente/);
    expect(storico.find((s) => s.azione === 'approva')?.utente_id).toBe(t.admin.id);
  });

  it('T19 segnalazione di discrepanza da parte dell\'operaio e rifiuto amministratore', async () => {
    const t = await creaAmbiente(atLocal('2026-02-10', '08:00'));
    await t.come(t.op);
    const p = await t.s.workday.registraEntrata();
    t.alle('16:00', '2026-02-10');
    await t.s.workday.registraUscita(p.id);
    t.alle('09:00', '2026-03-02');
    await t.come(t.admin);
    const c = await t.s.timesheet.genera(t.op.id, 2026, 2);
    await t.come(t.op);
    await expect(t.s.timesheet.segnalaDiscrepanza(c.id, '')).rejects.toThrow(/motivazione/);
    await t.s.timesheet.segnalaDiscrepanza(c.id, 'Il 10 sono uscito alle 17');
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('da_correggere');
    await t.s.workday.correggiPresenza(p.id, { uscita_at: new Date(atLocal('2026-02-10', '17:00')).toISOString() }, 'Uscita reale 17:00');
    await t.s.timesheet.rigenera(c.id);
    await t.s.timesheet.conferma(c.id);
    await t.s.sync.ciclo();
    await t.come(t.admin);
    await t.s.timesheet.rifiuta(c.id, 'Manca il dettaglio delle attività');
    expect(t.s.db.get('cartellini_mensili', c.id)?.stato).toBe('da_correggere');
  });

  it('T20 non si genera il cartellino con giornate ancora aperte', async () => {
    const t = await creaAmbiente(atLocal('2026-02-27', '08:00'));
    await t.come(t.op);
    await t.s.workday.registraEntrata();
    t.alle('09:00', '2026-03-02');
    await t.come(t.admin);
    await expect(t.s.timesheet.genera(t.op.id, 2026, 2)).rejects.toThrow(/giornate ancora aperte/);
    const esiti = await t.s.timesheet.chiudiMese(2026, 2);
    expect(esiti[0].ok).toBe(false);
  });
});
