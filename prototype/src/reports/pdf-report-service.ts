/**
 * Servizio centralizzato di generazione PDF (pdfmake).
 *
 * Riceve modelli GIÀ calcolati e validati (reports/modello.ts): qui avviene solo il rendering
 * e la consegna (download, anteprima). Nessun calcolo di ore.
 *
 * pdfmake e i font Roboto (con caratteri accentati) sono caricati solo al primo utilizzo
 * (import dinamico) per non appesantire l'avvio; il Service Worker li tiene in cache per
 * l'uso offline.
 */
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { AZIENDA } from '../config/azienda';
import { layoutGiornaliero, layoutMensile, layoutReport } from './layout-pdf';
import type { ReportDoc } from './report-tabellare';
import type { RiepilogoDoc, RiepilogoGiornalieroDoc, RiepilogoMensileDoc } from './modello';
import { AppError } from '../services/errors';

interface PdfMakeStatic {
  vfs: Record<string, string>;
  createPdf(def: TDocumentDefinitions): { getBuffer(cb: (b: Uint8Array) => void): void };
}

let caricamento: Promise<PdfMakeStatic> | null = null;

async function pdfMake(): Promise<PdfMakeStatic> {
  caricamento ??= (async () => {
    const [mod, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
    const pm = ((mod as unknown as { default?: PdfMakeStatic }).default ?? mod) as PdfMakeStatic;
    const vfsMod = (fonts as unknown as { default?: Record<string, unknown> }).default ?? fonts;
    pm.vfs = ((vfsMod as { pdfMake?: { vfs: Record<string, string> } }).pdfMake?.vfs ?? vfsMod) as Record<string, string>;
    return pm;
  })();
  return caricamento;
}

async function render(def: TDocumentDefinitions): Promise<Uint8Array> {
  const pm = await pdfMake();
  const buffer = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      pm.createPdf(def).getBuffer((b: Uint8Array) => resolve(b));
    } catch (e) {
      reject(e);
    }
  });
  if (!buffer || buffer.length < 100) throw new AppError('PERSISTENZA', 'Generazione del PDF non riuscita.');
  return new Uint8Array(buffer);
}

function verificaEsportabile(m: RiepilogoDoc) {
  if (!m.esportabile) throw new AppError('VALIDAZIONE', m.motivoNonEsportabile ?? 'Documento non esportabile.');
}

export async function generaPdfGiornaliero(m: RiepilogoGiornalieroDoc): Promise<Uint8Array> {
  verificaEsportabile(m);
  return render(layoutGiornaliero(m));
}

export async function generaPdfMensile(m: RiepilogoMensileDoc): Promise<Uint8Array> {
  verificaEsportabile(m);
  return render(layoutMensile(m));
}

/** Report aziendali (Fase 6): stesso motore di rendering dei riepiloghi. */
export async function generaPdfReport(r: ReportDoc): Promise<Uint8Array> {
  return render(layoutReport(r, AZIENDA));
}

export function generaPdf(m: RiepilogoDoc): Promise<Uint8Array> {
  return m.tipo === 'giornaliero' ? generaPdfGiornaliero(m) : generaPdfMensile(m);
}

/** Nome file leggibile e senza caratteri problematici: riepilogo-giornaliero_2026-11-24_rossi-marco.pdf */
export function nomeFilePdf(m: RiepilogoDoc): string {
  const chi = m.intestazione.operaio.nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const quando = m.tipo === 'giornaliero' ? m.data : `${m.anno}-${String(m.mese).padStart(2, '0')}`;
  const prov = m.tipo === 'mensile' && m.provvisorio ? '_PROVVISORIO' : '';
  return `riepilogo-${m.tipo}_${quando}_${chi}${prov}.pdf`;
}

export function blobPdf(bytes: Uint8Array): Blob {
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Avvia il download nel browser. */
export function scaricaPdf(bytes: Uint8Array, nomeFile: string): void {
  scaricaFile(blobPdf(bytes), nomeFile);
}

/** Download generico (PDF, Excel, CSV). */
export function scaricaFile(blob: Blob, nomeFile: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
