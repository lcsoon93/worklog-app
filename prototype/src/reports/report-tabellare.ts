/**
 * Modello comune dei report aziendali (Fase 6). Un report è un insieme di indicatori e
 * tabelle GIÀ calcolati: la UI, il PDF, l'Excel e il CSV leggono lo stesso oggetto, quindi
 * le esportazioni riportano esattamente i dati mostrati nell'app (stessi filtri, stessi valori).
 */
import { oreMinuti } from './formato';

export type TipoColonna = 'testo' | 'intero' | 'durata' | 'euro' | 'data' | 'percentuale' | 'quantita';
export type Valore = string | number | null;

export interface Colonna {
  chiave: string;
  titolo: string;
  tipo: TipoColonna;
}

export interface TabellaReport {
  id: string;
  titolo: string;
  nota?: string;
  colonne: Colonna[];
  righe: Array<Record<string, Valore>>;
  totale?: Record<string, Valore>;
  /** Grafico a barre suggerito per la tabella (colonna etichetta → colonna valore). */
  grafico?: { etichetta: string; valore: string; max?: number };
}

export interface Indicatore {
  etichetta: string;
  valore: Valore;
  tipo: TipoColonna;
  nota?: string;
  tono?: 'ok' | 'warn' | 'danger';
}

export interface ReportDoc {
  id: string;
  /** Fase 14: codice univoco del documento esportato (sostituisce quello ricavato dal periodo). */
  codiceDocumento?: string;
  titolo: string;
  /** Periodo e filtri in forma leggibile, riportati in ogni esportazione. */
  filtri: Array<[string, string]>;
  periodo: { da: string; a: string };
  generatoIl: number;
  generatoDa: string;
  indicatori: Indicatore[];
  tabelle: TabellaReport[];
  avvisi: string[];
}

const fmtEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fmtNum = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 });
const fmtPerc = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export function formattaData(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Formattazione unica usata da schermo, PDF e CSV. */
export function formatta(v: Valore, tipo: TipoColonna): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return tipo === 'data' ? formattaData(v) : v;
  switch (tipo) {
    case 'durata': return oreMinuti(v);
    case 'euro': return fmtEuro.format(v);
    case 'percentuale': return `${fmtPerc.format(v)}%`;
    case 'intero': return String(Math.round(v));
    case 'quantita': return fmtNum.format(v);
    default: return String(v);
  }
}

export function istanteLeggibile(ms: number): string {
  return new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function nomeFileReport(r: ReportDoc, estensione: string): string {
  return `report-${r.id}_${r.periodo.da}_${r.periodo.a}.${estensione}`;
}

// --- CSV --------------------------------------------------------------------------------

function cellaCsv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV (separatore ";" e BOM, come si aspetta Excel in italiano). Una tabella per file quando
 * `tabellaId` è indicato, altrimenti tutte in sequenza separate da una riga vuota.
 * Le prime righe riportano report, periodo, filtri e data di generazione.
 */
export function reportCsv(r: ReportDoc, tabellaId?: string): string {
  const righe: string[][] = [
    [r.titolo],
    ['Periodo', `${formattaData(r.periodo.da)} – ${formattaData(r.periodo.a)}`],
    ...r.filtri.filter(([k]) => k !== 'Periodo').map(([k, v]) => [k, v]),
    ['Generato il', istanteLeggibile(r.generatoIl)],
  ];
  for (const t of r.tabelle.filter((x) => !tabellaId || x.id === tabellaId)) {
    righe.push([], [t.titolo], t.colonne.map((c) => c.titolo));
    for (const riga of t.righe) righe.push(t.colonne.map((c) => formatta(riga[c.chiave] ?? null, c.tipo)));
    if (t.totale) righe.push(t.colonne.map((c) => formatta(t.totale![c.chiave] ?? null, c.tipo)));
  }
  return '﻿' + righe.map((r) => r.map(cellaCsv).join(';')).join('\r\n');
}
