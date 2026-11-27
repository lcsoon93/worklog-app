/** Fase 13: amministratore operativo (Luca) e flusso di invio/approvazione dei rapporti. */
import { describe, expect, it } from 'vitest';
import { profiloDaServer } from '../../src/sync/auth-supabase';
import { creaAmbiente } from './fixture';

async function ambiente() {
  const t = await creaAmbiente();
  const luca = { ...t.op, amministratore_operativo: true };
  await t.s.db.applyBatch([{ tipo: 'put', store: 'profili', value: luca }]);
  return { t, luca };
}
const intervento = (clienteId: string) => ({ cliente_id: clienteId, sede_id: null, titolo: 'Sopralluogo quadro', descrizione: '', tipo: 'sopralluogo' as const, priorita: 'normale' as const, data_programmata: '2026-03-11', ora_inizio: '09:00', durata_prevista_min: 60, note: '' });

describe('permessi', () => {
  it('P01 amministratore operativo: gestisce clienti, sedi, interventi e ritorni ma non approva', async () => {
    const { t, luca } = await ambiente();
    await t.come(luca);
    const c = await t.s.planning.salvaCliente({ ragione_sociale: 'Cliente di Luca' });
    await t.s.planning.salvaSede({ cliente_id: c.id, nome: 'Magazzino' });
    const i = await t.s.planning.creaIntervento(intervento(c.id), [luca.id]);
    await t.s.planning.aggiornaIntervento(i.id, { ...intervento(c.id), titolo: 'Sopralluogo quadro elettrico' });
    expect(t.s.db.get('interventi', i.id)?.titolo).toBe('Sopralluogo quadro elettrico');
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: c.id, sede_id: null, intervento_id: null });
    await t.s.report.invia({ ...r, descrizione_lavoro: 'Verificato quadro, serve tornare', esito: 'ritorno_necessario', note_interne: 'Portare interruttore' });
    const f = t.s.report.followup((x) => x.rapportino_origine_id === r.id)[0];
    await t.s.report.pianificaRitorno(f.id, { data: '2026-03-12', ora: '08:00', durata_min: 60, operai: [luca.id], priorita: 'normale' });
    await expect(t.s.report.approva(r.id)).rejects.toThrow(/amministratore/);
    await expect(t.s.report.restituisci(r.id, 'Manca la foto del quadro')).rejects.toThrow(/amministratore/);
    await expect(t.s.timesheet.chiudiMese(2026, 3)).rejects.toThrow(/amministratore/);
  });

  it('P02 operaio standard: niente gestione di interventi e clienti', async () => {
    const t = await creaAmbiente();
    await t.come(t.op);
    await expect(t.s.planning.creaIntervento(intervento(t.cliA.id), [t.op.id])).rejects.toThrow(/amministrazione/);
    await expect(t.s.planning.salvaSede({ cliente_id: t.cliA.id, nome: 'Nuova' })).rejects.toThrow(/amministrazione/);
  });

  it('P03 accesso reale: il flag arriva dal server o dalla configurazione, mai per l\'amministratore', () => {
    const base = { id: 'x', nome: 'Luca', cognome: 'Pinto', ruolo: 'operaio', username: 'luca' };
    expect(profiloDaServer(base, ['luca']).amministratore_operativo).toBe(true);
    expect(profiloDaServer({ ...base, username: 'mario' }, ['luca']).amministratore_operativo).toBe(false);
    expect(profiloDaServer({ ...base, username: 'mario', amministratore_operativo: true }, []).amministratore_operativo).toBe(true);
    expect(profiloDaServer({ ...base, ruolo: 'admin', username: 'comphas' }, ['comphas']).amministratore_operativo).toBe(false);
  });
});

describe('flusso dei rapporti', () => {
  it('F01 bozza → pronto (modificabile) → eliminabile prima dell\'invio', async () => {
    const { t, luca } = await ambiente();
    await t.come(luca);
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    await expect(t.s.report.segnaPronto(r)).rejects.toThrow(/Descrivi/);
    const pronto = await t.s.report.segnaPronto({ ...r, descrizione_lavoro: 'Sostituito interruttore differenziale' });
    expect(t.s.report.fase(pronto)).toBe('pronto');
    expect(t.s.report.modificabileDa(pronto, luca.id)).toBe(true);
    expect(t.s.db.outbox().some((o) => o.entita_id === r.id)).toBe(false); // non ancora inviato
    const modificato = await t.s.report.salvaBozza({ ...pronto, descrizione_lavoro: 'Sostituito interruttore differenziale 30 mA' });
    expect(t.s.report.fase(modificato)).toBe('pronto');
    expect(t.s.report.fase(await t.s.report.salvaBozza({ ...modificato, descrizione_lavoro: '' }))).toBe('bozza');
    await t.s.report.elimina(r.id);
    expect(t.s.report.rapportini().some((x) => x.id === r.id)).toBe(false);
    expect(t.s.db.get('rapportini', r.id)?.deleted_at).toBeTruthy();
  });

  it('F02 inviato → restituito → correzione tracciata → approvato; dopo l\'invio niente eliminazione', async () => {
    const { t, luca } = await ambiente();
    await t.come(luca);
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    const inviato = await t.s.report.invia({ ...r, descrizione_lavoro: 'Riparata perdita sul collettore' });
    expect(t.s.report.fase(inviato)).toBe('inviato');
    await expect(t.s.report.elimina(r.id)).rejects.toThrow(/già stato inviato/);
    await expect(t.s.report.correggi({ ...inviato, descrizione_lavoro: 'Modifica silenziosa' }, 'Prova di modifica')).rejects.toThrow(/restituzione/);

    await t.come(t.admin);
    expect(t.s.report.daApprovare().map((x) => x.id)).toContain(r.id);
    await t.s.report.restituisci(r.id, 'Indica il diametro del collettore');
    await expect(t.s.report.approva(r.id)).rejects.toThrow(/restituito/);

    await t.come(luca);
    const daCorreggere = t.s.db.get('rapportini', r.id)!;
    expect(t.s.report.modificabileDa(daCorreggere, luca.id)).toBe(true);
    const corretto = await t.s.report.correggi({ ...daCorreggere, descrizione_lavoro: 'Riparata perdita sul collettore da 1 pollice' }, 'Aggiunto il diametro richiesto');
    expect(t.s.report.fase(corretto)).toBe('inviato');
    expect(corretto.revisione).toBe(1);

    await t.come(t.admin);
    const ok = await t.s.report.approva(r.id);
    expect(t.s.report.fase(ok)).toBe('approvato');
    // Dopo l'approvazione: solo correzioni tracciate dell'amministrazione, con motivo.
    await expect(t.s.report.correggi({ ...ok, descrizione_lavoro: 'Testo cambiato' }, '')).rejects.toThrow(/motivo/);
    const c2 = await t.s.report.correggi({ ...ok, descrizione_lavoro: 'Riparata perdita sul collettore da 1" (ottone)' }, 'Precisato il materiale');
    expect(t.s.report.fase(c2)).toBe('approvato');
    const storia = t.s.db.audit().filter((a) => a.entita === 'rapportini' && a.entita_id === r.id && a.azione !== 'crea').map((a) => a.azione);
    expect(storia.filter((a) => a === 'correzione')).toHaveLength(2);
    expect(storia.filter((a) => a === 'transizione')).toHaveLength(2);
    await t.come(luca);
    await expect(t.s.report.correggi({ ...c2, descrizione_lavoro: 'Altro testo' }, 'Ripensamento')).rejects.toThrow();
  });

  it('F03 correzione dei materiali: la riga tolta storna lo scarico senza cancellare l\'originale', async () => {
    const { t, luca } = await ambiente();
    await t.come(t.admin);
    const mag = await t.s.magazzino.salvaMagazzino({ codice: 'M1', nome: 'Sede', tipo: 'sede', responsabile_id: null, attivo: true });
    const mat = await t.s.magazzino.salvaMateriale({ codice: 'FUS', nome: 'Fusibile', descrizione: '', categoria: '', unita: 'pz', prezzo_acquisto: 2, prezzo_vendita: null, fornitore: '', scorta_minima: 0, attivo: true });
    await t.s.magazzino.registraCarico({ materiale_id: mat.id, magazzino_id: mag.id, quantita: 10, motivo: 'Carico iniziale' });
    await t.come(luca);
    const r = await t.s.report.creaBozza({ tipo: 'rapido', cliente_id: t.cliA.id, sede_id: null, intervento_id: null });
    const riga = { id: 'riga-1', descrizione: 'Fusibile', quantita: 3, unita: 'pz', materiale_id: mat.id, magazzino_id: mag.id };
    await t.s.report.invia({ ...r, descrizione_lavoro: 'Sostituiti fusibili del quadro', materiali: [riga] });
    expect(t.s.magazzino.giacenza(mat.id, mag.id)).toBe(7);
    await t.come(t.admin);
    await t.s.report.restituisci(r.id, 'I fusibili erano del cliente');
    await t.come(luca);
    await t.s.report.correggi({ ...t.s.db.get('rapportini', r.id)!, materiali: [] }, 'Materiale fornito dal cliente');
    expect(t.s.magazzino.giacenza(mat.id, mag.id)).toBe(10);
    expect(t.s.db.where('movimenti_magazzino', (m) => m.rapportino_id === r.id)).toHaveLength(2);
  });
});
