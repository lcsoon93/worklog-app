/** Fase 3 nel browser: riprendi ultima attività, verifica della giornata, richiesta di correzione e gestione. */
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T08:00:00+01:00') });
});

test('richiesta di correzione: lavoratore → amministratore → risposta visibile; riprendi ultima attività', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.getByTestId('btn-entrata').click();
  await page.getByTestId('btn-avvia-intervento').first().click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await page.clock.fastForward('01:00:00');
  await page.getByTestId('btn-ferma').click();
  // Sospensione e ripresa con un tocco
  await expect(page.getByTestId('btn-riprendi-ultima')).toContainText('Condominio Via Roma 12');
  await page.clock.fastForward('00:15:00');
  await page.getByTestId('btn-riprendi-ultima').click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await page.clock.fastForward('01:00:00');

  // Verifica della giornata e richiesta di correzione
  await page.goto('/#/op/riepilogo');
  await expect(page.getByTestId('verifica-giornata')).toBeVisible();
  await expect(page.getByTestId('sync-giornata')).toHaveText('Tutto sincronizzato', { timeout: 15_000 });
  await expect(page.getByTestId('ripartizione-intervento')).toHaveCount(1);
  await page.getByTestId('btn-richiedi-correzione').click();
  await expect(page.getByTestId('richiesta-invia')).toBeDisabled();
  await page.getByTestId('richiesta-messaggio').fill('Sono entrato alle 07:30: ho caricato il furgone in magazzino');
  await page.getByTestId('richiesta-invia').click();
  await expect(page.getByTestId('verifica-giornata').getByTestId('richiesta-stato')).toHaveText('Aperta');
  await expect(page.getByTestId('link-pdf-giorno')).toHaveAttribute('href', '#/op/riepiloghi?vista=giornaliero&data=2026-11-24');
  await page.getByTestId('logout').click();

  // L'amministratore la trova tra le cose da fare e la risolve
  await login(page, 'laura.bianchi@demo.local');
  const todo = page.getByTestId('todo-richieste');
  await expect(todo).toContainText('Sono entrato alle 07:30');
  await todo.getByTestId('richiesta-gestisci').click();
  await expect(page.getByTestId('richiesta-risolvi')).toBeDisabled();
  await page.getByTestId('richiesta-risposta').fill('Ok: correggi l\'entrata dal riepilogo, il mese è ancora aperto');
  await page.getByTestId('richiesta-risolvi').click();
  await expect(page.getByTestId('todo-richieste')).toHaveCount(0);
  await page.getByTestId('logout').click();

  // Il lavoratore vede esito, autore e risposta
  await login(page, 'marco.rossi@demo.local');
  await page.goto('/#/op/riepilogo');
  const v = page.getByTestId('verifica-giornata');
  await expect(v.getByTestId('richiesta-stato')).toHaveText('Risolta');
  await expect(v).toContainText('Laura Bianchi');
  await expect(v).toContainText('il mese è ancora aperto');
});
