/** Fase 13: Luca (amministratore operativo) e Comphas (amministratore): invio, restituzione, correzione, approvazione. */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 768, height: 1024 } });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});
async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}
async function esci(page: Page) {
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/#\/login/);
}

test('Luca gestisce clienti e rapporti; l\'amministratore restituisce, poi approva', async ({ page }) => {
  await login(page, 'luca.ferri@demo.local');
  await expect(page.locator('.rail').getByRole('link', { name: 'Clienti' })).toBeVisible();
  await expect(page.locator('.rail').getByRole('link', { name: 'Ritorni' })).toBeVisible();
  await expect(page.getByTestId('gestione-operativa')).toBeVisible();
  // Funzioni di gestione operativa: nuovo cliente dalla pagina Clienti.
  await page.goto('/#/admin/clienti');
  await expect(page.getByTestId('permesso-operai-clienti')).toHaveCount(0); // impostazione riservata all'amministratore
  await page.getByRole('button', { name: 'Nuovo cliente' }).click();
  await page.fill('#c-rs', 'Officina Luca Test');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByTestId('cliente-riga').filter({ hasText: 'Officina Luca Test' })).toHaveCount(1);

  // Rapporto autonomo: pronto per invio (ancora modificabile), poi invio.
  await page.goto('/#/rapportini/nuovo');
  await page.getByTestId('rapportino-cliente').filter({ hasText: 'Officina Luca Test' }).click();
  await page.getByTestId('firma-prevista').getByRole('tab', { name: 'Non prevista' }).click();
  await page.getByTestId('rapportino-inizia').click();
  await page.getByTestId('rapportino-descrizione').fill('Sostituito interruttore generale.');
  await page.getByTestId('rapportino-pronto').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Pronto per invio');
  await page.getByTestId('rapportino-descrizione').fill('Sostituito interruttore generale e verificato il quadro.');
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Inviato');
  await expect(page.getByTestId('rapportino-elimina')).toHaveCount(0);
  const url = page.url();
  await esci(page);

  // Comphas: restituisce per correzioni.
  await login(page, 'laura.bianchi@demo.local');
  await page.getByTestId('todo-autonomo').filter({ hasText: 'Officina Luca Test' }).click();
  await page.getByTestId('rapportino-restituisci').click();
  await page.getByTestId('conferma-restituzione-motivo').fill('Indica la portata dell\'interruttore');
  await page.getByTestId('conferma-restituzione-ok').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Da correggere');
  await esci(page);

  // Luca corregge e reinvia (correzione tracciata).
  await login(page, 'luca.ferri@demo.local');
  await expect(page.getByTestId('card-bozze')).toContainText('Indica la portata');
  await page.goto(url);
  await page.getByTestId('rapportino-descrizione').fill('Sostituito interruttore generale 63 A e verificato il quadro.');
  await page.getByTestId('motivo-correzione').fill('Aggiunta la portata richiesta');
  await page.getByTestId('rapportino-invia-correzione').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Inviato');
  await esci(page);

  // Comphas approva; lo storico mostra restituzione e correzione.
  await login(page, 'laura.bianchi@demo.local');
  await page.goto(url);
  await page.getByTestId('rapportino-approva').click();
  await expect(page.getByTestId('badge-fase')).toHaveText('Approvato');
  await expect(page.getByTestId('storico-rapporto')).toContainText('Aggiunta la portata richiesta');
  await expect(page.getByTestId('storico-rapporto')).toContainText("Indica la portata dell'interruttore");
});
