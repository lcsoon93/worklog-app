/** Fase 12: rapporto di lavoro autonomo creato dall'operaio e verificato dall'amministratore, su iPhone. */
import { devices, expect, test, type Page } from '@playwright/test';

const { defaultBrowserType: _ignora, ...iphone } = devices['iPhone 13'];
test.use({ ...iphone });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}
async function senzaScorrimentoOrizzontale(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('iPhone: l\'operaio crea un rapporto autonomo con nuovo cliente, timer e ritorno; l\'amministratore lo verifica', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  // Dashboard: presenza, interventi assegnati, pulsante del rapporto autonomo.
  await expect(page.getByTestId('btn-entrata')).toBeVisible();
  await expect(page.getByTestId('card-interventi')).toBeVisible();
  const cta = page.getByTestId('btn-nuovo-rapporto');
  await expect(cta).toContainText('NUOVO RAPPORTO DI LAVORO');
  await senzaScorrimentoOrizzontale(page);
  await cta.click();

  await page.getByTestId('nuovo-cliente-campo').click();
  await page.getByTestId('nuovo-cliente-nome').fill('Pizzeria Da Gino');
  await page.getByTestId('nuovo-cliente-indirizzo').fill('Via Napoli 12');
  await page.getByTestId('nuovo-cliente-salva').click();
  await expect(page.getByTestId('rapportino-cliente').filter({ hasText: 'Pizzeria Da Gino' })).toHaveClass(/on/);
  await page.getByTestId('rapportino-richiesta').fill('Telefonata: forno elettrico non scalda');
  await page.getByTestId('firma-prevista').getByRole('tab', { name: 'Non prevista' }).click();
  await senzaScorrimentoOrizzontale(page);
  await page.getByTestId('rapportino-inizia').click();

  await expect(page.getByTestId('badge-autonomo')).toBeVisible();
  await page.getByTestId('rapportino-avvia-timer').click(); // registra anche l'entrata
  await expect(page.getByTestId('rapportino-ferma-timer')).toBeVisible();
  await page.clock.fastForward('01:30:00');
  await page.getByTestId('rapportino-ferma-timer').click();
  await expect(page.getByTestId('rapportino-ore-totali')).toHaveText('1:30');
  await page.getByTestId('rapportino-descrizione').fill('Sostituita resistenza del forno, provato il funzionamento.');
  await page.getByTestId('esito-ritorno_necessario').click();
  await page.getByTestId('rapportino-note').fill('Ordinare termostato di ricambio');
  await senzaScorrimentoOrizzontale(page);
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByTestId('rapportino-esito')).toContainText('Serve un ritorno');
  await expect(page.getByTestId('badge-fase')).toHaveText('Inviato');

  // Storico dell'operaio (elenco a schede su telefono).
  await page.goto('/#/rapportini');
  await expect(page.getByTestId('lista-rapportini-mobile').getByText('Pizzeria Da Gino')).toBeVisible();
  await senzaScorrimentoOrizzontale(page);
  // La giornata conta le ore una sola volta.
  await page.goto('/#/op');
  await expect(page.getByTestId('stat-attribuite')).toContainText('1:30');

  // Amministratore: rapporto autonomo da verificare.
  await page.getByTestId('menu-altro').click();
  await page.getByRole('button', { name: 'Esci' }).click();
  await login(page, 'laura.bianchi@demo.local');
  await page.getByTestId('todo-autonomo').filter({ hasText: 'Pizzeria Da Gino' }).click();
  await page.getByTestId('rapportino-approva').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Approvato');
  await senzaScorrimentoOrizzontale(page);
});
