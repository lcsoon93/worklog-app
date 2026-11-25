/**
 * Esportazione PDF nel browser: download reale, estrazione del testo e confronto con i valori
 * mostrati nell'applicazione. Orologio fissato a martedì 24/11/2026.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function testoPdf(path: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').replace(/- (?=[A-Z0-9])/g, '-'));
  }
  return out;
}

async function scarica(page: Page): Promise<{ nome: string; pagine: string[] }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-scarica').click()]);
  return { nome: dl.suggestedFilename(), pagine: await testoPdf((await dl.path())!) };
}

const valore = async (page: Page, id: string) => (await page.getByTestId(id).locator('.stat-value').innerText()).trim();

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

test('operaio: PDF giornaliero coerente con il riepilogo dell\'app', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.getByTestId('btn-entrata').click();
  await page.getByTestId('btn-avvia-intervento').first().click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await page.clock.fastForward('03:00:00');
  await page.getByTestId('btn-pausa').click();
  await expect(page.getByTestId('hero')).toContainText('In pausa');
  await page.clock.fastForward('00:40:00');
  await page.getByTestId('btn-riprendi').click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await page.clock.fastForward('02:00:00');
  await page.goto('/#/op/riepilogo');
  await page.getByTestId('btn-termina').click();
  await page.getByTestId('conferma-uscita').click();
  await expect(page.getByTestId('toast-ok').filter({ hasText: 'Giornata terminata' })).toBeVisible();
  const nettaApp = (await page.getByTestId('dd-netta').locator('.stat-value').innerText()).trim();

  // "I miei riepiloghi" dalla dashboard
  await page.goto('/#/op');
  await page.getByTestId('tile-riepiloghi').click();
  await expect(page.getByTestId('anteprima-giornaliera')).toBeVisible();
  await expect(page.getByTestId('anteprima-stato')).toHaveText('Giornata chiusa');
  const netta = await valore(page, 'ant-netta');
  const lorda = await valore(page, 'ant-lorda');
  const attribuite = await valore(page, 'ant-attribuite');
  const non = await valore(page, 'ant-non-attribuite');
  // L'anteprima usa HH:mm, il riepilogo dell'app H:MM: stessi minuti.
  expect(netta.replace(/^0/, '')).toBe(nettaApp);

  // Anteprima PDF
  await page.getByTestId('pdf-anteprima').click();
  await expect(page.getByTestId('pdf-iframe')).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  const { nome, pagine } = await scarica(page);
  const testo = pagine.join(' ');
  expect(nome).toBe('riepilogo-giornaliero_2026-11-24_marco-rossi.pdf');
  expect(testo).toContain('Riepilogo giornata lavorativa');
  expect(testo).toContain('martedì 24 novembre 2026');
  expect(testo).toContain('Marco Rossi');
  expect(testo).toContain(`Presenza lorda ${lorda}`);
  expect(testo).toContain(`Ore nette lavorate ${netta}`);
  expect(testo).toContain(`Totale ore attribuite ${attribuite}`);
  expect(testo).toContain(`Ore non attribuite ${non}`);
  expect(testo).toContain('Condominio Via Roma 12');
  expect(testo).toContain('Dettaglio attività');
  pagine.forEach((p, i) => expect(p).toContain(`Pagina ${i + 1} di ${pagine.length}`));
});

test('operaio: PDF mensile provvisorio; offline segnalato nel documento', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.goto('/#/op/riepiloghi?vista=mensile&mese=2026-10');
  await expect(page.getByTestId('anteprima-mensile')).toContainText('Documento provvisorio');
  const giorni = await valore(page, 'ant-giorni');
  const netta = await valore(page, 'ant-netta');
  const { nome, pagine } = await scarica(page);
  expect(nome).toBe('riepilogo-mensile_2026-10_marco-rossi_PROVVISORIO.pdf');
  expect(pagine.length).toBeGreaterThanOrEqual(4);
  expect(pagine[0]).toContain('DOCUMENTO PROVVISORIO – NON APPROVATO');
  expect(pagine[0]).toContain(`Giorni lavorati ${giorni}`);
  expect(pagine[0]).toContain(`Ore nette lavorate ${netta}`);
  expect(pagine.join(' ')).not.toMatch(/novembre 2026 (Entrata|Uscita)/);

  // Offline: la giornata di oggi (non sincronizzata) si esporta comunque, con l'avviso nel PDF.
  await page.goto('/#/sync');
  await page.getByTestId('sim-offline').click();
  await page.goto('/#/op');
  await page.getByTestId('btn-entrata').click();
  await page.clock.fastForward('01:00:00');
  await page.goto('/#/op/riepiloghi?vista=giornaliero');
  await expect(page.getByText('Sei offline')).toBeVisible();
  await expect(page.getByText('Dati non ancora sincronizzati')).toBeVisible();
  const off = await scarica(page);
  expect(off.pagine.join(' ')).toContain('Documento generato da dati non ancora sincronizzati con il server');
  expect(off.pagine.join(' ')).toContain('In corso (dati provvisori)');
});

test('amministratore: report presenze di qualsiasi operaio, mese approvato e giorno', async ({ page }) => {
  await login(page, 'laura.bianchi@demo.local');
  await page.getByTestId('link-report-presenze').click();
  await expect(page.getByText('Seleziona un operaio.')).toBeVisible();
  await page.getByTestId('riepilogo-vista').getByRole('tab', { name: 'Riepilogo mensile' }).click();
  await page.getByTestId('riepilogo-operaio').selectOption({ label: 'Andrea Conti' });
  await page.getByTestId('riepilogo-mese').fill('2026-10');
  await expect(page.getByTestId('anteprima-mensile')).toContainText('Cartellino approvato');
  const netta = await valore(page, 'ant-netta');
  const { nome, pagine } = await scarica(page);
  expect(nome).toBe('riepilogo-mensile_2026-10_andrea-conti.pdf');
  const testo = pagine.join(' ');
  expect(testo).toContain('CARTELLINO APPROVATO');
  expect(testo).toMatch(/Approvato il \d{2}\/\d{2}\/2026 alle \d{2}:\d{2} da Laura Bianchi/);
  expect(testo).not.toContain('PROVVISORIO');
  expect(pagine[0]).toContain(`Ore nette lavorate ${netta}`);

  // Riepilogo giornaliero di un altro operaio
  await page.getByTestId('riepilogo-vista').getByRole('tab', { name: 'Riepilogo giornaliero' }).click();
  await page.getByTestId('riepilogo-operaio').selectOption({ label: 'Luca Ferri' });
  // Primo giorno di ottobre con presenza di Luca e primo giorno senza (letti dai dati demo).
  const { conPresenza, senza } = await page.evaluate(() => {
    const app = (window as unknown as { __app: { db: { all: (s: string) => Array<{ operaio_id: string; data_lavoro: string; nome?: string; id: string }> } } }).__app;
    const luca = app.db.all('profili').find((p) => p.nome === 'Luca')!;
    const giorni = new Set(app.db.all('presenze').filter((p) => p.operaio_id === luca.id).map((p) => p.data_lavoro));
    const ott = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    return { conPresenza: ott.find((d) => giorni.has(d))!, senza: ott.find((d) => !giorni.has(d))! };
  });
  await page.getByTestId('riepilogo-data').fill(conPresenza);
  await expect(page.getByTestId('anteprima-stato')).toHaveText('Giornata chiusa');
  const nettaGiorno = await valore(page, 'ant-netta');
  const g = await scarica(page);
  expect(g.nome).toBe(`riepilogo-giornaliero_${conPresenza}_luca-ferri.pdf`);
  expect(g.pagine.join(' ')).toContain(`${conPresenza.slice(8)}/10/2026`);
  expect(g.pagine.join(' ')).toContain('Luca Ferri');
  expect(g.pagine.join(' ')).toContain(`Ore nette lavorate ${nettaGiorno}`);

  // Giorno senza presenza: esportazione non disponibile, con spiegazione
  await page.getByTestId('riepilogo-data').fill(senza);
  await expect(page.getByText('Nessuna presenza registrata per questo giorno')).toBeVisible();
  await expect(page.getByTestId('pdf-scarica')).toBeDisabled();
});
