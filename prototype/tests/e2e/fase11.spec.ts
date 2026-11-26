/** Fase 11: correzioni emerse dal collaudo su tablet (doppio tocco, sede proposta, firma operaio, barra laterale). */
import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

async function firma(page: Page, canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + 70, { steps: 8 });
  await page.mouse.up();
}

test.use({ viewport: { width: 768, height: 1024 } });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

test('tablet: doppio tocco senza duplicati, sede proposta, icone della barra laterale', async ({ page }) => {
  await login(page, 'laura.bianchi@demo.local');
  for (const icona of await page.locator('.rail a svg').all()) expect((await icona.boundingBox())!.height).toBeGreaterThanOrEqual(20);

  await page.goto('/#/admin/clienti');
  await page.getByRole('button', { name: 'Nuovo cliente' }).click();
  await page.fill('#c-rs', 'Doppio Tocco Srl');
  await page.getByRole('button', { name: 'Salva' }).dblclick();
  await expect(page.getByTestId('cliente-riga').filter({ hasText: 'Doppio Tocco Srl' })).toHaveCount(1);

  await page.getByTestId('cliente-riga').filter({ hasText: 'Doppio Tocco Srl' }).click();
  await page.getByRole('button', { name: 'Sede' }).click();
  await page.fill('#s-nome', 'Sede unica');
  await page.getByRole('button', { name: 'Salva' }).click();
  await page.getByRole('link', { name: 'Nuovo intervento' }).click();
  await expect(page.locator('#i-sede option:checked')).toContainText('Sede unica');
  await page.getByTestId('int-titolo').fill('Controllo doppio tocco');
  await page.getByTestId('int-data').fill('2026-11-26');
  await page.getByTestId('int-salva').dblclick();
  await expect(page).toHaveURL(/#\/interventi\//);
  await page.goto('/#/agenda/giorno?data=2026-11-26');
  await expect(page.getByText('Controllo doppio tocco')).toHaveCount(1);
});

test('rapportino completo: la firma dell\'operaio compare nella scheda', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.getByTestId('btn-entrata').click();
  await page.getByTestId('btn-avvia-intervento').first().click();
  await page.clock.fastForward('01:00:00');
  await page.locator('a[href*="/interventi/"]').first().click();
  await page.getByRole('link', { name: 'Completo' }).click();
  await page.getByTestId('rapportino-descrizione').fill('Sostituito filtro e verificata la pressione.');
  await page.getByTestId('esito-completato').click();
  await firma(page, page.getByTestId('firma-cliente'));
  await page.getByTestId('firma-cliente-ok').click();
  await page.getByTestId('firma-nome').fill('Mario Bianchi');
  await firma(page, page.locator('canvas').last());
  await page.getByRole('button', { name: 'Conferma firma' }).last().click();
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByAltText('Firma cliente')).toBeVisible();
  await expect(page.getByAltText('Firma operaio')).toBeVisible();
});
