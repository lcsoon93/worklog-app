/**
 * Test del motore ore. Gli esempi E1–E17 coincidono con quelli di docs/06-motore-calcolo-ore.md.
 * Fuso: Europe/Rome (impostato in vite.config.ts).
 */
import { describe, expect, it } from 'vitest';
import { calcolaGiornata, type EngineAttivita, type EnginePausa, formatDurata } from '../../src/domain/hours-engine';
import { intersect, normalize, subtract, total } from '../../src/domain/intervals';
import { atLocal } from '../../src/domain/time';

const D = '2026-03-10';
const h = (hhmm: string, date = D) => atLocal(date, hhmm);
const H = 3600_000;
const M = 60_000;

let seq = 0;
function a(tipo: EngineAttivita['tipo'], inizio: number, fine: number | null, extra: Partial<EngineAttivita> = {}): EngineAttivita {
  seq++;
  return { id: `a${seq}`, tipo, cliente_id: null, intervento_id: null, codice_interno: null, inizio, fine, creata: inizio, ...extra };
}
function p(inizio: number, fine: number | null): EnginePausa {
  seq++;
  return { id: `p${seq}`, inizio, fine };
}
const codici = (r: ReturnType<typeof calcolaGiornata>) => r.anomalie.map((x) => x.codice);

describe('algebra intervalli', () => {
  it('unisce sovrapposti e adiacenti, sottrae e interseca', () => {
    expect(normalize([{ start: 5, end: 10 }, { start: 0, end: 5 }, { start: 8, end: 12 }])).toEqual([{ start: 0, end: 12 }]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 7 }])).toEqual([
      { start: 0, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 10 },
    ]);
    expect(intersect([{ start: 0, end: 10 }], [{ start: 5, end: 15 }])).toEqual([{ start: 5, end: 10 }]);
    expect(total([{ start: 0, end: 4 }, { start: 2, end: 6 }])).toBe(6);
  });
});

describe('motore ore – esempi della specifica', () => {
  it('E1 giornata standard con pausa pranzo e due clienti', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('17:00') },
      [p(h('12:00'), h('13:00'))],
      [a('lavoro_cliente', h('08:00'), h('12:00'), { cliente_id: 'A' }), a('lavoro_cliente', h('13:00'), h('17:00'), { cliente_id: 'B' })],
      h('18:00'),
    );
    expect(r.lorda_ms).toBe(9 * H);
    expect(r.pause_ms).toBe(1 * H);
    expect(r.netta_ms).toBe(8 * H);
    expect(r.attribuite_ms).toBe(8 * H);
    expect(r.non_attribuite_ms).toBe(0);
    expect(r.per_cliente).toEqual({ A: 4 * H, B: 4 * H });
    expect(r.anomalie).toEqual([]);
  });

  it('E2 cambio cliente consecutivo: nessun buco e nessun doppio conteggio', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('12:00') },
      [],
      [a('lavoro_cliente', h('08:00'), h('10:00'), { cliente_id: 'A' }), a('lavoro_cliente', h('10:00'), h('12:00'), { cliente_id: 'B' })],
      h('12:00'),
    );
    expect(r.attribuite_ms).toBe(4 * H);
    expect(r.per_cliente).toEqual({ A: 2 * H, B: 2 * H });
    expect(codici(r)).not.toContain('attivita_sovrapposte');
  });

  it('E3 attività sovrapposte: tempo comune contato una volta, assegnato all\'ultima iniziata', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('12:00') },
      [],
      [a('lavoro_cliente', h('08:00'), h('11:00'), { cliente_id: 'A' }), a('lavoro_cliente', h('10:00'), h('12:00'), { cliente_id: 'B' })],
      h('12:00'),
    );
    expect(r.coperta_ms).toBe(4 * H);
    expect(r.per_cliente).toEqual({ A: 2 * H, B: 2 * H });
    const ov = r.anomalie.find((x) => x.codice === 'attivita_sovrapposte');
    expect(ov?.durata_ms).toBe(1 * H);
  });

  it('E4 trasferimento verso cliente e attività interna', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('09:30') },
      [],
      [
        a('trasferimento', h('08:00'), h('08:30'), { cliente_id: 'A' }),
        a('interna', h('08:30'), h('09:30'), { codice_interno: 'magazzino' }),
      ],
      h('10:00'),
    );
    expect(r.attribuite_ms).toBe(90 * M);
    expect(r.per_tipo.trasferimento).toBe(30 * M);
    expect(r.per_cliente).toEqual({ A: 30 * M });
    expect(r.per_codice_interno).toEqual({ magazzino: 1 * H });
  });

  it('E5 timer senza cliente ("da definire") e tempo scoperto', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('12:00') },
      [],
      [a('da_definire', h('08:00'), h('10:00'))],
      h('12:00'),
    );
    expect(r.attribuite_ms).toBe(0);
    expect(r.da_classificare_ms).toBe(2 * H);
    expect(r.scoperta_ms).toBe(2 * H);
    expect(r.non_attribuite_ms).toBe(4 * H);
    expect(r.intervalli_scoperti).toEqual([{ start: h('10:00'), end: h('12:00') }]);
    expect(codici(r)).toEqual(expect.arrayContaining(['attivita_da_classificare', 'ore_non_attribuite']));
  });

  it('E6 pause multiple', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('17:00') },
      [p(h('10:00'), h('10:15')), p(h('12:30'), h('13:15')), p(h('15:00'), h('15:10'))],
      [a('lavoro_cliente', h('08:00'), h('17:00'), { cliente_id: 'A' })],
      h('18:00'),
    );
    expect(r.pause_ms).toBe(70 * M);
    expect(r.netta_ms).toBe(9 * H - 70 * M);
    expect(r.attribuite_ms).toBe(r.netta_ms);
    expect(codici(r)).toContain('attivita_durante_pausa');
  });

  it('E7 turno oltre la mezzanotte', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('22:00'), uscita: h('06:00', '2026-03-11') },
      [p(h('02:00', '2026-03-11'), h('02:30', '2026-03-11'))],
      [
        a('lavoro_cliente', h('22:00'), h('02:00', '2026-03-11'), { cliente_id: 'A' }),
        a('lavoro_cliente', h('02:30', '2026-03-11'), h('06:00', '2026-03-11'), { cliente_id: 'A' }),
      ],
      h('07:00', '2026-03-11'),
    );
    expect(r.lorda_ms).toBe(8 * H);
    expect(r.netta_ms).toBe(7.5 * H);
    expect(r.attribuite_ms).toBe(7.5 * H);
    expect(codici(r)).toContain('turno_oltre_mezzanotte');
  });

  it('E8 timer attivo: durata ricostruita da inizio e "adesso", non da un contatore', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: null }, [], [a('lavoro_cliente', h('08:00'), null, { cliente_id: 'A' })], h('10:30'));
    expect(r.aperta).toBe(true);
    expect(r.attribuite_ms).toBe(150 * M);
    expect(codici(r)).toEqual(expect.arrayContaining(['presenza_aperta', 'timer_attivo']));
  });

  it('E9 timer non fermato a giornata chiusa: concluso all\'uscita', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('17:00') },
      [p(h('12:00'), h('13:00'))],
      [a('lavoro_cliente', h('08:00'), h('12:00'), { cliente_id: 'A' }), a('interna', h('15:00'), null, { codice_interno: 'magazzino' })],
      h('23:00'),
    );
    expect(r.per_codice_interno.magazzino).toBe(2 * H);
    expect(codici(r)).toContain('timer_non_fermato');
  });

  it('E10 attività fuori dalla presenza non viene conteggiata', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: h('12:00') }, [], [a('lavoro_cliente', h('07:30'), h('09:00'), { cliente_id: 'A' })], h('12:00'));
    expect(r.attribuite_ms).toBe(1 * H);
    expect(r.anomalie.find((x) => x.codice === 'attivita_fuori_presenza')?.durata_ms).toBe(30 * M);
  });

  it('E11 attività che attraversa una pausa: la pausa è esclusa', () => {
    const r = calcolaGiornata(
      { id: 'P', entrata: h('08:00'), uscita: h('17:00') },
      [p(h('12:00'), h('13:00'))],
      [a('lavoro_cliente', h('11:00'), h('14:00'), { cliente_id: 'A' })],
      h('17:00'),
    );
    expect(r.attribuite_ms).toBe(2 * H);
    expect(r.anomalie.find((x) => x.codice === 'attivita_durante_pausa')?.durata_ms).toBe(1 * H);
  });

  it('E12 pause sovrapposte contate una sola volta', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: h('17:00') }, [p(h('12:00'), h('13:00')), p(h('12:30'), h('13:30'))], [], h('17:00'));
    expect(r.pause_ms).toBe(90 * M);
    expect(codici(r)).toContain('pause_sovrapposte');
  });

  it('E13 uscita precedente all\'entrata: giornata non valida e non conteggiata', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('17:00'), uscita: h('08:00') }, [], [], h('18:00'));
    expect(r.netta_ms).toBe(0);
    expect(codici(r)).toContain('presenza_invalida');
  });

  it('E14 cambio ora legale (29/03/2026): conta il tempo reale trascorso', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('01:00', '2026-03-29'), uscita: h('05:00', '2026-03-29') }, [], [], h('06:00', '2026-03-29'));
    expect(r.lorda_ms).toBe(3 * H);
  });

  it('E15 lavoro oltre 6 ore senza pausa: avviso', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: h('15:00') }, [], [a('lavoro_cliente', h('08:00'), h('15:00'), { cliente_id: 'A' })], h('16:00'));
    expect(codici(r)).toContain('pausa_obbligatoria_mancante');
  });

  it('E16 pausa aperta in giornata chiusa: chiusa d\'ufficio all\'uscita', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: h('12:00') }, [p(h('11:30'), null)], [], h('20:00'));
    expect(r.pause_ms).toBe(30 * M);
    expect(r.anomalie.find((x) => x.codice === 'pausa_aperta')?.gravita).toBe('avviso');
  });

  it('E17 presenza oltre 24 ore: dato non valido', () => {
    const r = calcolaGiornata({ id: 'P', entrata: h('08:00'), uscita: h('09:00', '2026-03-11') }, [], [], h('10:00', '2026-03-11'));
    expect(r.netta_ms).toBe(0);
    expect(codici(r)).toContain('presenza_invalida');
  });

  it('formatta le durate arrotondando solo in presentazione', () => {
    expect(formatDurata(7 * H + 50 * M)).toBe('7:50');
    expect(formatDurata(29_999)).toBe('0:00');
    expect(formatDurata(30_000)).toBe('0:01');
  });
});

describe('motore ore – invarianti su 1000 giornate casuali', () => {
  it('attribuite + non attribuite = netta; coperta ≤ netta; somma per attività = coperta', () => {
    let s = 42;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const tipi: EngineAttivita['tipo'][] = ['lavoro_cliente', 'trasferimento', 'interna', 'da_definire'];
    for (let n = 0; n < 1000; n++) {
      const base = h('06:00');
      const entrata = base + Math.floor(rnd() * 4 * H);
      const uscita = rnd() < 0.1 ? null : entrata + Math.floor(rnd() * 14 * H);
      const now = entrata + 15 * H;
      const pause: EnginePausa[] = Array.from({ length: Math.floor(rnd() * 4) }, () => {
        const i = entrata - H + Math.floor(rnd() * 15 * H);
        return p(i, rnd() < 0.1 ? null : i + Math.floor(rnd() * 90 * M));
      });
      const att: EngineAttivita[] = Array.from({ length: Math.floor(rnd() * 8) }, () => {
        const i = entrata - H + Math.floor(rnd() * 15 * H);
        return a(tipi[Math.floor(rnd() * 4)], i, rnd() < 0.1 ? null : i + Math.floor(rnd() * 4 * H), { cliente_id: 'X' });
      });
      const r = calcolaGiornata({ id: 'P', entrata, uscita }, pause, att, now);
      expect(r.attribuite_ms + r.non_attribuite_ms).toBe(r.netta_ms);
      expect(r.coperta_ms).toBeLessThanOrEqual(r.netta_ms);
      expect(r.attribuite_ms).toBeGreaterThanOrEqual(0);
      expect(r.attivita.reduce((acc, d) => acc + d.effettiva_ms, 0)).toBe(r.coperta_ms);
      expect(r.netta_ms + r.pause_ms).toBe(r.lorda_ms);
      for (const d of r.attivita) expect(d.effettiva_ms).toBeLessThanOrEqual(d.valida_ms);
    }
  });
});
