/**
 * Regole pure di magazzino e costi (Fase 5). Nessun accesso a dati o UI: ricevono i record e
 * restituiscono valori calcolati, così le stesse funzioni servono a servizi, dashboard e test.
 *
 * Principi:
 * - la giacenza è la SOMMA dei movimenti validi (nessun contatore da tenere allineato:
 *   due dispositivi offline non possono "sovrascriversi" la giacenza);
 * - un movimento non si modifica né si cancella: si corregge con un nuovo movimento collegato;
 * - il costo di un consumo è quantità × costo unitario FISSATO nel movimento, mai il prezzo
 *   attuale dell'anagrafica; il prezzo di vendita è tenuto separato.
 */
import type { Materiale, MovimentoMagazzino, MovimentoTipo } from './types';

export const TIPI_CONSUMO: MovimentoTipo[] = ['consumo', 'correzione_consumo'];

/** Arrotonda le quantità (3 decimali, come numeric(12,3) nel database). */
export function q3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/** Arrotonda gli importi al centesimo. */
export function euro(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** Un movimento conta nella giacenza e nei costi se non è eliminato né scartato come duplicato dal server. */
export function movimentoValido(m: MovimentoMagazzino): boolean {
  return !m.deleted_at && !m.duplicato_di;
}

export function isConsumo(m: MovimentoMagazzino): boolean {
  return TIPI_CONSUMO.includes(m.tipo);
}

export function giacenza(movimenti: MovimentoMagazzino[], materialeId: string, magazzinoId?: string | null): number {
  let tot = 0;
  for (const m of movimenti) {
    if (m.materiale_id !== materialeId || !movimentoValido(m)) continue;
    if (magazzinoId && m.magazzino_id !== magazzinoId) continue;
    tot += m.quantita;
  }
  return q3(tot);
}

export interface GiacenzaMateriale {
  materiale: Materiale;
  totale: number;
  perMagazzino: Record<string, number>;
  /** Valore a prezzo di acquisto attuale (le quantità negative non hanno valore). */
  valore: number;
  sottoScorta: boolean;
  negativa: boolean;
}

export function calcolaGiacenze(materiali: Materiale[], movimenti: MovimentoMagazzino[]): GiacenzaMateriale[] {
  const per = new Map<string, Record<string, number>>();
  for (const m of movimenti) {
    if (!movimentoValido(m)) continue;
    const r = per.get(m.materiale_id) ?? {};
    r[m.magazzino_id] = (r[m.magazzino_id] ?? 0) + m.quantita;
    per.set(m.materiale_id, r);
  }
  return materiali.map((mat) => {
    const perMagazzino: Record<string, number> = {};
    for (const [k, v] of Object.entries(per.get(mat.id) ?? {})) perMagazzino[k] = q3(v);
    const totale = q3(Object.values(perMagazzino).reduce((a, b) => a + b, 0));
    return {
      materiale: mat,
      totale,
      perMagazzino,
      valore: euro(Math.max(0, totale) * mat.prezzo_acquisto),
      sottoScorta: mat.attivo && totale < mat.scorta_minima,
      negativa: Object.values(perMagazzino).some((v) => v < 0),
    };
  });
}

/** Costo effettivo di un movimento di consumo (positivo = materiale usato, negativo = reso). */
export function costoConsumo(m: MovimentoMagazzino): number {
  return euro(-m.quantita * m.costo_unitario);
}

/** Valore a prezzo di vendita del consumo, o null se il materiale non ha prezzo di vendita. */
export function venditaConsumo(m: MovimentoMagazzino): number | null {
  return m.prezzo_vendita_unitario == null ? null : euro(-m.quantita * m.prezzo_vendita_unitario);
}

export interface VoceCosto {
  chiave: string;
  costo: number;
  vendita: number;
  quantita: number;
  utilizzi: number;
}

export interface RiepilogoConsumi {
  costo: number;
  vendita: number;
  righe: number;
  perIntervento: VoceCosto[];
  perCliente: VoceCosto[];
  perMateriale: VoceCosto[];
  perOperaio: VoceCosto[];
  perTipoIntervento: VoceCosto[];
}

/**
 * Aggrega i consumi (consumo + correzioni) già filtrati per periodo. Ogni movimento è contato
 * una sola volta in ciascuna dimensione; le correzioni si sommano al consumo originale.
 */
export function riepilogaConsumi(
  movimenti: MovimentoMagazzino[],
  tipoIntervento: (interventoId: string | null) => string,
): RiepilogoConsumi {
  const dims = {
    perIntervento: new Map<string, VoceCosto>(),
    perCliente: new Map<string, VoceCosto>(),
    perMateriale: new Map<string, VoceCosto>(),
    perOperaio: new Map<string, VoceCosto>(),
    perTipoIntervento: new Map<string, VoceCosto>(),
  };
  let costo = 0;
  let vendita = 0;
  let righe = 0;
  const add = (mappa: Map<string, VoceCosto>, chiave: string, m: MovimentoMagazzino, c: number, v: number) => {
    const x = mappa.get(chiave) ?? { chiave, costo: 0, vendita: 0, quantita: 0, utilizzi: 0 };
    x.costo += c;
    x.vendita += v;
    x.quantita += -m.quantita;
    if (m.tipo === 'consumo') x.utilizzi += 1;
    mappa.set(chiave, x);
  };
  for (const m of movimenti) {
    if (!movimentoValido(m) || !isConsumo(m)) continue;
    const c = costoConsumo(m);
    const v = venditaConsumo(m) ?? 0;
    costo += c;
    vendita += v;
    if (m.tipo === 'consumo') righe += 1;
    add(dims.perIntervento, m.intervento_id ?? '', m, c, v);
    add(dims.perCliente, m.cliente_id ?? '', m, c, v);
    add(dims.perMateriale, m.materiale_id, m, c, v);
    add(dims.perOperaio, m.operaio_id ?? '', m, c, v);
    add(dims.perTipoIntervento, tipoIntervento(m.intervento_id), m, c, v);
  }
  const fin = (mappa: Map<string, VoceCosto>) =>
    [...mappa.values()]
      .map((x) => ({ ...x, costo: euro(x.costo), vendita: euro(x.vendita), quantita: q3(x.quantita) }))
      .sort((a, b) => b.costo - a.costo || b.utilizzi - a.utilizzi);
  return {
    costo: euro(costo),
    vendita: euro(vendita),
    righe,
    perIntervento: fin(dims.perIntervento),
    perCliente: fin(dims.perCliente),
    perMateriale: fin(dims.perMateriale),
    perOperaio: fin(dims.perOperaio),
    perTipoIntervento: fin(dims.perTipoIntervento),
  };
}
