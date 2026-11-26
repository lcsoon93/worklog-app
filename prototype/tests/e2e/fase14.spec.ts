/** Fase 14: storico amministrativo, esclusione e doppia esportazione PDF (amministratore). */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1024, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T18:00:00+01:00') });
});

const minuti = (t: string) => { const [h, m] = t.trim().split(':').map(Number); return h * 60 + m; };

test('Comphas esclude un\'attività, confronta le anteprime ed esporta i due PDF', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByTestId('login-laura.bianchi@demo.local').click();
  await page.getByTestId('link-storico').click();
  await page.getByTestId('storico-cliente').selectOption({ label: 'Hotel Belvedere S.p.A.' });
  await expect(page.getByTestId('giorno-storico').first()).toBeVisible();
  const prima = minuti(await page.getByTestId('ore-amministrative').innerText());
  const oreOperativo = await page.getByTestId('totali-operativo').locator('.stat-value').first().innerText();

  // Esclusione di un'attività dal documento per fatturazione (con motivo).
  const att = page.getByTestId('attivita-storico').first();
  const oreAtt = minuti((await att.locator('.title').innerText()).split('·').pop()!);
  await att.getByTestId('storico-escludi').click();
  await page.getByTestId('conferma-storico-motivo').fill('Tempo di attesa non fatturabile');
  await page.getByTestId('conferma-storico-ok').click();
  await expect(att.getByTestId('stato-elemento')).toHaveText('Escluso');
  await expect(page.getByTestId('ore-amministrative')).not.toHaveText(String(prima));
  expect(minuti(await page.getByTestId('ore-amministrative').innerText())).toBe(prima - oreAtt);
  // Il riepilogo operativo resta completo.
  await expect(page.getByTestId('totali-operativo').locator('.stat-value').first()).toHaveText(oreOperativo);

  // Filtro "Esclusi" e anteprime dei due documenti.
  await page.getByTestId('filtro-storico').getByRole('tab', { name: 'Esclusi' }).click();
  await expect(page.getByTestId('attivita-storico')).toHaveCount(1);
  await page.getByTestId('anteprima-operativo').click();
  await expect(page.getByTestId('anteprima')).toContainText('Riepilogo operativo completo');
  await expect(page.getByTestId('anteprima-ore')).toContainText('Escluso');
  await page.getByTestId('anteprima-amministrativo').click();
  await expect(page.getByTestId('anteprima')).toContainText('Riepilogo amministrativo per fatturazione');
  await expect(page.getByTestId('anteprima-ore')).not.toContainText('Escluso');

  // Esportazioni: due PDF, codici diversi, registrati.
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByTestId('esporta-amministrativo').click()]);
  expect(d1.suggestedFilename()).toMatch(/^AMM-.*\.pdf$/);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('esporta-operativo').click()]);
  expect(d2.suggestedFilename()).toMatch(/^OPE-.*\.pdf$/);
  await expect(page.getByTestId('riga-esportazione')).toHaveCount(2);

  // Registro delle operazioni.
  await page.getByTestId('mostra-registro').click();
  await expect(page.getByTestId('registro-storico')).toContainText('Tempo di attesa non fatturabile');
  await expect(page.getByTestId('registro-storico')).toContainText('Laura Bianchi');
});
