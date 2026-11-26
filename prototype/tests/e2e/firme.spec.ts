/** Firme a schermo intero su iPhone (area ruotata in orizzontale) e rapporto completato senza firme. */
import { devices, expect, test, type Page } from '@playwright/test';

const { defaultBrowserType: _ignora, ...iphone } = devices['iPhone 13'];
test.use({ ...iphone, colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

async function nuovoRapporto(page: Page) {
  await page.goto('/#/login');
  await page.getByTestId('login-marco.rossi@demo.local').click();
  await page.getByTestId('btn-nuovo-rapporto').click();
  await page.getByTestId('rapportino-cliente').first().click();
  await page.getByTestId('rapportino-inizia').click();
  await page.getByTestId('rapportino-descrizione').fill('Controllo impianto e pulizia filtri eseguiti.');
}

test('iPhone in verticale: la firma si apre a schermo intero in orizzontale e il tratto viene salvato', async ({ page }) => {
  await nuovoRapporto(page);
  await page.getByTestId('firma-cliente').click();
  const tela = page.getByTestId('firma-canvas');
  await expect(tela).toBeVisible();
  // Area ruotata: sullo schermo verticale è più alta che larga e occupa quasi tutto lo schermo.
  const b = (await tela.boundingBox())!;
  expect(b.height).toBeGreaterThan(b.width);
  expect(b.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1); // tutta l'altezza dello schermo
  // Firma tracciata col dito (in orizzontale per chi firma = dall'alto in basso sullo schermo).
  await page.mouse.move(b.x + b.width * 0.5, b.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (0.5 + (i % 2 ? 0.15 : -0.1)), b.y + 80 + i * 40);
  await page.mouse.up();
  // Pixel scuri sul foglio bianco anche con il tema scuro del telefono.
  const scuri = await tela.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) n++;
    return n;
  });
  expect(scuri).toBeGreaterThan(200);
  await page.getByTestId('firma-schermo-nome').fill('Anna Verdi');
  await page.getByTestId('firma-conferma').click();
  await expect(page.getByTestId('firma-schermo')).toHaveCount(0);
  await expect(page.getByAltText('Firma cliente')).toBeVisible();
  await expect(page.getByTestId('firma-nome')).toHaveValue('Anna Verdi');
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Inviato');
  await expect(page.getByAltText('Firma cliente')).toBeVisible();
});

test('rapporto completato senza nessuna firma', async ({ page }) => {
  await nuovoRapporto(page);
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Inviato');
  await expect(page.getByAltText('Firma cliente')).toHaveCount(0);
});
