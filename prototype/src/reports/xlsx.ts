/**
 * Esportazione Excel (.xlsx) senza dipendenze esterne (Fase 6).
 * Scrive un file Office Open XML minimale: un foglio "Riepilogo" (periodo, filtri, data di
 * generazione, indicatori, avvisi) e un foglio per ogni tabella del report. I numeri restano
 * numeri (importi in €, durate come tempo [h]:mm, date come date) così da poterli rielaborare.
 * Il contenitore ZIP è "stored" (senza compressione): valido per Excel, LibreOffice e Numbers.
 */
import { formatta, formattaData, istanteLeggibile, type Colonna, type ReportDoc, type TipoColonna, type Valore } from './report-tabellare';

// --- ZIP (stored) -------------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStored(files: Array<{ nome: string; dati: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parti: Uint8Array[] = [];
  const centrale: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nome = enc.encode(f.nome);
    const crc = crc32(f.dati);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true);
    loc.setUint16(6, 0x0800, true); // nomi UTF-8
    loc.setUint16(8, 0, true);
    loc.setUint16(10, 0, true);
    loc.setUint16(12, 0x21, true); // 1980-01-01
    loc.setUint32(14, crc, true);
    loc.setUint32(18, f.dati.length, true);
    loc.setUint32(22, f.dati.length, true);
    loc.setUint16(26, nome.length, true);
    loc.setUint16(28, 0, true);
    parti.push(new Uint8Array(loc.buffer), nome, f.dati);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.dati.length, true);
    cen.setUint32(24, f.dati.length, true);
    cen.setUint16(28, nome.length, true);
    cen.setUint32(42, offset, true);
    centrale.push(new Uint8Array(cen.buffer), nome);
    offset += 30 + nome.length + f.dati.length;
  }
  const lungCentrale = centrale.reduce((s, x) => s + x.length, 0);
  const fine = new DataView(new ArrayBuffer(22));
  fine.setUint32(0, 0x06054b50, true);
  fine.setUint16(8, files.length, true);
  fine.setUint16(10, files.length, true);
  fine.setUint32(12, lungCentrale, true);
  fine.setUint32(16, offset, true);
  const tutto = [...parti, ...centrale, new Uint8Array(fine.buffer)];
  const out = new Uint8Array(tutto.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of tutto) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

// --- XLSX ---------------------------------------------------------------------------------
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Stili: 0 normale, 1 intestazione, 2 euro, 3 durata, 4 data, 5 percentuale, 6 quantità, 7 titolo, 8 totale. */
const STILE: Record<TipoColonna, number> = { testo: 0, intero: 0, durata: 3, euro: 2, data: 4, percentuale: 5, quantita: 6 };

function colonnaLettera(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function serialeData(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400_000;
}

function cella(rif: string, v: Valore, tipo: TipoColonna, grassetto = false): string {
  if (v === null || v === undefined || v === '') return '';
  const s = grassetto ? (tipo === 'testo' || tipo === 'intero' ? 8 : STILE[tipo]) : STILE[tipo];
  if (typeof v === 'number') {
    const n = tipo === 'durata' ? v / 86400_000 : v;
    return `<c r="${rif}" s="${s}"><v>${Number.isFinite(n) ? n : 0}</v></c>`;
  }
  if (tipo === 'data') {
    const d = serialeData(v);
    if (d !== null) return `<c r="${rif}" s="4"><v>${d}</v></c>`;
  }
  return `<c r="${rif}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

function foglio(righe: string[][], larghezze: number[]): string {
  const cols = larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, w))}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${righe.map((celle, i) => `<row r="${i + 1}">${celle.join('')}</row>`).join('')}</sheetData></worksheet>`;
}

function nomeFoglio(titolo: string, usati: Set<string>): string {
  let base = titolo.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Foglio';
  let nome = base;
  for (let k = 2; usati.has(nome.toLowerCase()); k++) nome = `${base.slice(0, 26)} ${k}`;
  usati.add(nome.toLowerCase());
  return nome;
}

export function reportXlsx(r: ReportDoc): Uint8Array {
  const fogli: Array<{ nome: string; xml: string }> = [];
  const usati = new Set<string>();
  const testo = (rif: string, s: string, stile = 0) => `<c r="${rif}" t="inlineStr" s="${stile}"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;

  // Riepilogo
  const rr: string[][] = [[testo('A1', r.titolo, 7)], [testo('A2', 'Periodo', 1), testo('B2', `${formattaData(r.periodo.da)} – ${formattaData(r.periodo.a)}`)]];
  for (const [k, v] of r.filtri.filter(([k]) => k !== 'Periodo')) rr.push([testo(`A${rr.length + 1}`, k, 1), testo(`B${rr.length + 1}`, v)]);
  rr.push([testo(`A${rr.length + 1}`, 'Generato il', 1), testo(`B${rr.length + 1}`, `${istanteLeggibile(r.generatoIl)}${r.generatoDa ? ` da ${r.generatoDa}` : ''}`)]);
  rr.push([]);
  rr.push([testo(`A${rr.length + 1}`, 'Indicatore', 1), testo(`B${rr.length + 1}`, 'Valore', 1), testo(`C${rr.length + 1}`, 'Nota', 1)]);
  for (const k of r.indicatori) {
    const n = rr.length + 1;
    rr.push([testo(`A${n}`, k.etichetta), cella(`B${n}`, k.valore, k.tipo), k.nota ? testo(`C${n}`, k.nota) : '']);
  }
  for (const a of r.avvisi) {
    rr.push([]);
    rr.push([testo(`A${rr.length + 1}`, a)]);
  }
  fogli.push({ nome: nomeFoglio('Riepilogo', usati), xml: foglio(rr, [34, 40, 50]) });

  // Un foglio per tabella
  for (const t of r.tabelle) {
    const righe: string[][] = [[testo('A1', t.titolo, 7)], [testo('A2', `Periodo ${formattaData(r.periodo.da)} – ${formattaData(r.periodo.a)} · generato il ${istanteLeggibile(r.generatoIl)}`)]];
    if (t.nota) righe.push([testo(`A${righe.length + 1}`, t.nota)]);
    righe.push([]);
    const h = righe.length + 1;
    righe.push(t.colonne.map((c, i) => testo(`${colonnaLettera(i)}${h}`, c.titolo + (c.tipo === 'durata' ? ' (h:mm)' : ''), 1)));
    for (const riga of t.righe) {
      const n = righe.length + 1;
      righe.push(t.colonne.map((c: Colonna, i) => cella(`${colonnaLettera(i)}${n}`, riga[c.chiave] ?? null, c.tipo)));
    }
    if (t.totale) {
      const n = righe.length + 1;
      righe.push(t.colonne.map((c, i) => cella(`${colonnaLettera(i)}${n}`, t.totale![c.chiave] ?? null, c.tipo, true)));
    }
    const larg = t.colonne.map((c) => Math.max(c.titolo.length + 2, ...t.righe.slice(0, 200).map((x) => formatta(x[c.chiave] ?? null, c.tipo).length + 2)));
    fogli.push({ nome: nomeFoglio(t.titolo, usati), xml: foglio(righe, larg) });
  }

  const enc = new TextEncoder();
  const file = (nome: string, s: string) => ({ nome, dati: enc.encode(s) });
  const stili = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;"/><numFmt numFmtId="165" formatCode="[h]:mm"/><numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="167" formatCode="#,##0.###"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F3F1"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf numFmtId="167" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipStored([
    file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli.map((f, i) => `<sheet name="${xml(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    file('xl/styles.xml', stili),
    ...fogli.map((f, i) => file(`xl/worksheets/sheet${i + 1}.xml`, f.xml)),
  ]);
}
