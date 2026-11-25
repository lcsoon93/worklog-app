import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Estrae il testo di ogni pagina di un PDF (per verificare il contenuto reale, non solo la generazione). */
export async function testoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pagine: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pagine.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').replace(/- (?=[A-Z0-9])/g, '-'));  // pdfjs separa le parole spezzate al trattino
  }
  return pagine;
}
