/** Fasi 6–7 nel browser: report con filtri ed esportazioni; menu su smartphone; notifiche; nessuna schermata vuota o rotta. */
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

test('report: filtri, grafici, esportazioni PDF/Excel/CSV con periodo e filtri', async ({ page }) => {
  await login(page, 'laura.bianchi@demo.local');
  await page.goto('/#/admin/analisi');
  await expect(page.getByTestId('analisi-indicatore').first()).toBeVisible();
  await expect(page.getByTestId('tabella-da-verificare')).toBeVisible();

  await page.getByTestId('analisi-vista').getByText('Presenze e personale').click();
  await page.getByTestId('filtro-periodo').selectOption('mese_prec');
  await page.getByTestId('filtro-operaio').selectOption({ label: 'Rossi Marco' });
  const tabOre = page.getByTestId('tabella-ore-dipendente');
  await expect(tabOre.getByTestId('analisi-tabella').locator('tbody tr')).toHaveCount(1);
  await expect(tabOre.getByTestId('analisi-grafico')).toBeVisible();
  const ore = (await tabOre.locator('tbody tr td').nth(4).textContent())!.trim();

  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  expect(csv.suggestedFilename()).toBe('report-personale_2026-10-01_2026-10-31.csv');
  const testo = (await (await csv.createReadStream()).toArray()).join('');
  expect(testo).toContain('"Periodo";"01/10/2026 – 31/10/2026"');
  expect(testo).toContain('"Lavoratore";"Rossi Marco"');
  expect(testo).toContain(`"${ore}"`);

  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('export-pdf').click()]);
  expect(pdf.suggestedFilename()).toBe('report-personale_2026-10-01_2026-10-31.pdf');

  // Economico: avviso esplicito sui ricavi non gestiti.
  await page.getByTestId('analisi-vista').getByText('Economico').click();
  await expect(page.getByText('Ricavi effettivi e margini non sono calcolati')).toBeVisible();
});

test('smartphone: menu completo, notifiche, indicatore di sincronizzazione', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'laura.bianchi@demo.local');
  await expect(page.getByTestId('sync-pill')).toBeVisible();
  await page.getByTestId('menu-altro').click();
  await page.getByTestId('menu-griglia').getByText('Magazzino').click();
  await expect(page.getByTestId('kpi-valore-giacenze')).toBeVisible();

  // Notifiche dell'amministratore: sotto scorta e cartellino da approvare.
  await expect(page.getByTestId('notifiche-non-lette')).toBeVisible();
  await page.getByTestId('campanella').click();
  await expect(page.getByTestId('notifica').filter({ hasText: 'Materiale sotto scorta' }).first()).toBeVisible();
  await expect(page.getByTestId('notifica').filter({ hasText: 'Cartellino da approvare' })).toHaveCount(1);
  await page.getByTestId('notifiche-tutte-lette').click();
  await expect(page.getByTestId('notifiche-non-lette')).toHaveCount(0);
});

test('lavoratore: il cartellino restituito e il promemoria compaiono tra le notifiche', async ({ page }) => {
  await login(page, 'paolo.greco@demo.local');
  await page.getByTestId('campanella').click();
  await expect(page.getByTestId('notifica').filter({ hasText: 'Cartellino restituito per correzione' })).toBeVisible();
  await page.getByTestId('notifica').filter({ hasText: 'Cartellino restituito' }).click();
  await expect(page).toHaveURL(/#\/op\/cartellino/);
});

test('tutte le schermate si aprono senza errori né pagine vuote', async ({ page }) => {
  const errori: string[] = [];
  page.on('pageerror', (e) => errori.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  const visita = async (rotte: string[]) => {
    for (const r of rotte) {
      await page.goto(`/#${r}`);
      await expect(page.locator('main.content')).not.toBeEmpty();
      await expect(page.getByTestId('errore-schermata')).toHaveCount(0);
    }
  };
  await login(page, 'laura.bianchi@demo.local');
  await visita(['/admin', '/agenda/settimana', '/agenda/giorno', '/agenda/mese', '/admin/presenze', '/rapportini', '/admin/ritorni', '/admin/cartellini', '/admin/analisi', '/admin/analisi?vista=interventi', '/admin/analisi?vista=economico', '/admin/report', '/admin/report-presenze', '/admin/magazzino', '/admin/magazzino?vista=materiali', '/admin/magazzino?vista=movimenti', '/admin/magazzino?vista=costi', '/admin/clienti', '/admin/sedi', '/admin/operai', '/admin/interventi/nuovo', '/sync', '/notifiche']);
  await page.getByTestId('logout').click();
  await login(page, 'marco.rossi@demo.local');
  await visita(['/op', '/op/timer', '/op/presenza', '/op/pause', '/op/riepilogo', '/op/cartellino', '/op/riepiloghi', '/op/imprevisto', '/rapportini', '/notifiche']);
  expect(errori).toEqual([]);
});
