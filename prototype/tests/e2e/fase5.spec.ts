/** Fase 5 nel browser: materiale nel rapportino → scarico → correzione → dashboard magazzino, carico e costi. */
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

test('materiali: scelta dal magazzino, avviso di insufficienza, scarico, correzione e dashboard', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.goto('/#/rapportini/nuovo?tipo=rapido');
  await page.getByTestId('rapportino-cliente').filter({ hasText: 'Condominio' }).click();
  await page.getByTestId('rapportino-inizia').click();
  await page.getByTestId('rapportino-descrizione').fill('Sostituite due valvole a sfera sul collettore della centrale termica.');

  await page.getByTestId('materiale-da-magazzino').click();
  await page.getByTestId('materiale-cerca').fill('valvola');
  await page.getByTestId('materiale-opzione').first().click();
  const riga = page.getByTestId('materiale-riga');
  await expect(riga).toContainText('Valvola a sfera');
  // Il furgone di Marco non ha valvole: avviso prima del completamento.
  await riga.getByTestId('materiale-quantita').fill('2');
  await expect(page.getByTestId('materiale-insufficiente')).toContainText('Furgone Marco Rossi');
  await riga.getByTestId('materiale-magazzino').selectOption({ label: 'Magazzino centrale' });
  await expect(page.getByTestId('materiale-insufficiente')).toHaveCount(0);

  await page.getByTestId('rapportino-completa').click();
  const vista = page.getByTestId('materiali-vista');
  await expect(vista.getByTestId('materiale-scaricato')).toHaveText('2 pz');
  await expect(vista).toContainText('da Magazzino centrale');

  // Correzione del consumo: storico visibile, documento invariato.
  await vista.getByTestId('materiale-correggi').click();
  await page.getByTestId('correzione-quantita').fill('1');
  await expect(page.getByTestId('correzione-conferma')).toBeDisabled();
  await page.getByTestId('correzione-motivo').fill('Una valvola non è stata montata ed è rientrata');
  await page.getByTestId('correzione-conferma').click();
  await expect(vista.getByTestId('materiale-scaricato')).toContainText('1 pz');
  await expect(vista.getByTestId('materiale-correzione')).toContainText('rientrata');
  await expect(vista.getByTestId('materiale-vista-riga')).toContainText('2 pz'); // quantità del documento
  await page.getByTestId('logout').click();

  // Amministrazione: dashboard, storico, giacenze, carico e costi.
  await login(page, 'laura.bianchi@demo.local');
  await expect(page.getByTestId('todo-sotto-scorta')).toContainText('Gas refrigerante R32');
  await page.getByTestId('todo-sotto-scorta').click();
  await expect(page.getByTestId('sotto-scorta')).toContainText('Interruttore magnetotermico');
  await expect(page.getByTestId('movimenti-tabella').getByTestId('movimento-riga').first()).toContainText('Correzione consumo');

  await page.getByTestId('magazzino-vista').getByText('Materiali e giacenze').click();
  await page.getByTestId('materiali-cerca').fill('valvola');
  await expect(page.getByTestId('giacenza-riga')).toHaveCount(1);
  await expect(page.getByTestId('giacenza-riga')).toContainText('22 pz'); // 25 − 2 reso − 2 consumo + 1 correzione

  await page.getByTestId('magazzino-vista').getByText('Movimenti').click();
  await page.getByTestId('mov-carico').click();
  await page.getByTestId('movimento-materiale').selectOption({ label: 'FRG-002 – Gas refrigerante R32' });
  await page.getByTestId('movimento-quantita').fill('10');
  await page.getByTestId('movimento-conferma').click();
  await page.getByTestId('magazzino-vista').getByText('Panoramica').click();
  await expect(page.getByTestId('sotto-scorta')).not.toContainText('Gas refrigerante R32');

  await page.getByTestId('magazzino-vista').getByText('Costi e consumi').click();
  await expect(page.getByTestId('costi-totale')).toContainText('€');
  await expect(page.getByTestId('voce-costo').filter({ hasText: 'Condominio Via Roma 12' }).first()).toBeVisible();
});
