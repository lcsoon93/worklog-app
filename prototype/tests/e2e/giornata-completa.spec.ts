/**
 * Simulazione completa richiesta dalla Fase 1, eseguita nel browser reale sul prototipo compilato.
 * L'orologio del browser è controllato (Playwright clock): martedì 24/11/2026, ore 08:00.
 */
import { expect, test, type Page } from '@playwright/test';

const INIZIO = new Date('2026-11-24T08:00:00+01:00');

async function login(page: Page, email: string) {
  await page.goto('/#/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page.getByTestId('utente-corrente')).toBeVisible();
}

async function logout(page: Page) {
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/#\/login/);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: INIZIO });
});

test('giornata operaio completa e verifica/approvazione amministratore', async ({ page }) => {
  const errori: string[] = [];
  page.on('pageerror', (e) => errori.push(e.message));

  // ---------------- OPERAIO ----------------
  await login(page, 'marco.rossi@demo.local');
  await expect(page.getByTestId('utente-corrente')).toHaveText('Marco Rossi');
  await expect(page.getByTestId('demo-strip')).toContainText('dati dimostrativi');

  // Inizio giornata
  await page.getByTestId('btn-entrata').click();
  await expect(page.getByTestId('hero')).toContainText('Nessun timer attivo');

  // Avvio attività per un cliente
  await page.getByTestId('btn-avvia').click();
  await page.getByTestId('dest-modo').getByRole('tab', { name: 'Cliente', exact: true }).click();
  await page.getByTestId('dest-cliente').filter({ hasText: 'Condominio Via Roma 12' }).click();
  await page.getByTestId('timer-avvia').click();
  await page.getByRole('link', { name: 'Oggi' }).first().click();
  await expect(page.getByTestId('hero')).toContainText('Condominio Via Roma 12');

  // Dopo un'ora: ferma il timer
  await page.clock.fastForward('01:00:00');
  await expect(page.getByTestId('timer-clock')).toContainText('1:00:');
  await page.getByTestId('btn-ferma').click();
  await expect(page.getByTestId('hero')).toContainText('Nessun timer attivo');

  // Cambio cliente
  await page.getByTestId('btn-avvia').click();
  await page.getByTestId('dest-modo').getByRole('tab', { name: 'Cliente', exact: true }).click();
  await page.getByTestId('dest-cliente').filter({ hasText: 'FrescoPiù' }).click();
  await page.getByTestId('timer-avvia').click();
  await page.getByRole('link', { name: 'Oggi' }).first().click();
  await expect(page.getByTestId('hero')).toContainText('FrescoPiù');

  // Ricarica della pagina con timer attivo: il timer si ricostruisce dai timestamp salvati
  await page.clock.fastForward('01:30:00');
  await page.reload();
  await expect(page.getByTestId('timer-clock')).toContainText('1:30:');

  // Pausa con timer attivo (sospende l'attività), poi fine pausa e ripresa
  await page.getByTestId('btn-pausa').click();
  await expect(page.getByTestId('hero')).toContainText('In pausa');
  await page.clock.fastForward('00:30:00');
  await expect(page.getByTestId('pausa-clock')).toContainText('0:30:');
  await page.getByTestId('btn-riprendi').click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await expect(page.getByTestId('hero')).toContainText('FrescoPiù');
  await page.clock.fastForward('00:45:00');

  // Imprevisto
  await page.getByTestId('tile-imprevisto').click();
  await page.getByTestId('imprevisto-materiale_mancante').click();
  await page.getByTestId('imprevisto-descrizione').fill('Ventola sostitutiva non compatibile con il modello installato');
  await page.getByTestId('imprevisto-ritorno').click();
  await page.getByTestId('imprevisto-salva').click();
  await expect(page.getByTestId('toast-ok').filter({ hasText: 'Imprevisto registrato' })).toBeVisible();

  // Rapportino rapido sul cliente
  await page.getByTestId('tile-rapportino').click();
  await page.getByTestId('rapportino-cliente').filter({ hasText: 'FrescoPiù' }).click();
  await page.getByTestId('rapportino-inizia').click();
  await page.getByTestId('rapportino-descrizione').fill('Smontata la ventola della cella, verificato il motore: serve ricambio compatibile.');
  await page.getByTestId('esito-ritorno_necessario').click();
  await page.getByTestId('rapportino-note').fill('Montare ventola nuova codice VX-200');
  await page.getByTestId('rapportino-completa').click();
  await expect(page.getByTestId('rapportino-esito')).toHaveText('Serve un ritorno');
  await expect(page.getByTestId('rapportino-ore')).toHaveText(/^2:1[45]$/); // 1h30 + 45 min sul cliente
  // Il numero definitivo arriva solo dopo la conferma del server simulato
  await expect(page.getByRole('heading', { name: /Rapportino R-2026-\d{4}/ })).toBeVisible({ timeout: 15_000 });

  // Fine giornata
  await page.goto('/#/op/riepilogo');
  await page.getByTestId('btn-termina').click();
  await page.getByTestId('conferma-uscita').click();
  await expect(page.getByTestId('toast-ok').filter({ hasText: 'Giornata terminata' })).toBeVisible();

  // Riepilogo: 08:00 → 11:45 = 3:45 lorde, 0:30 pausa, 3:15 nette, tutte attribuite
  await expect(page.getByTestId('dd-netta')).toContainText('3:15');
  await expect(page.getByTestId('dd-attribuite')).toHaveText(/^3:1[45]$/);
  await expect(page.getByTestId('attivita-riga')).toHaveCount(3);

  // Correzione: divido l'ultima attività e ne attribuisco una parte a un altro cliente
  await page.getByTestId('btn-dividi').last().click();
  await page.getByTestId('activity-divisione').fill('11:30');
  await page.getByTestId('dest-modo').getByRole('tab', { name: 'Interna', exact: true }).click();
  await page.getByTestId('dest-interna-magazzino').click();
  await page.getByTestId('activity-motivo').fill('Ultimo quarto d\'ora in magazzino a scaricare');
  await page.getByTestId('activity-salva').click();
  await expect(page.getByTestId('attivita-riga')).toHaveCount(4);
  await page.getByTestId('toggle-storico').click();
  await expect(page.getByTestId('attivita-riga')).toHaveCount(5); // l'originale resta nello storico

  // Cartellino del mese precedente: conferma dell'operaio
  await page.goto('/#/op/cartellino');
  await expect(page.getByTestId('cartellino-stato')).toHaveText("Da confermare dall'operaio");
  await page.getByTestId('cart-conferma').click();
  await page.getByTestId('dlg-conferma-ok').click();
  // Passa a "In attesa di approvazione" solo dopo la ricezione da parte del server simulato
  await expect(page.getByTestId('cartellino-stato')).toHaveText('In attesa di approvazione', { timeout: 15_000 });
  await expect(page.getByTestId('storico-approvazioni')).toContainText('Ricevuto dal server');

  await page.goto('/#/sync');
  await expect(page.getByTestId('sync-pill')).toHaveText('Tutto sincronizzato', { timeout: 15_000 });
  await logout(page);

  // ---------------- AMMINISTRATORE ----------------
  await login(page, 'laura.bianchi@demo.local');
  await expect(page.getByTestId('utente-corrente')).toHaveText('Laura Bianchi');

  // Giornata dell'operaio e sue attività
  await page.getByTestId('squadra-riga').filter({ hasText: 'Marco Rossi' }).click();
  await expect(page.getByRole('heading', { name: 'Giornata di Marco Rossi' })).toBeVisible();
  await expect(page.getByTestId('dd-netta')).toContainText('3:15');
  await expect(page.getByTestId('attivita-riga')).toHaveCount(4);

  // Rapportino dell'operaio
  await page.goto('/#/rapportini');
  await page.getByTestId('riga-rapportino').filter({ hasText: 'FrescoPiù' }).first().click();
  await expect(page.getByTestId('rapportino-esito')).toHaveText('Serve un ritorno');

  // Il ritorno è comparso tra quelli da pianificare, collegato al rapportino
  await page.goto('/#/admin/ritorni');
  await expect(page.getByTestId('ritorno-riga').filter({ hasText: 'VX-200' })).toBeVisible();

  // Cartellino mensile: verifica e approvazione
  await page.goto('/#/admin/cartellini');
  await page.getByTestId('cartellino-riga').filter({ hasText: 'Marco Rossi' }).click();
  await expect(page.getByTestId('cartellino-stato')).toHaveText('In attesa di approvazione');
  await expect(page.getByTestId('tabella-cartellino')).toBeVisible();
  await page.getByTestId('azione-approva').click();
  await page.getByTestId('dlg-approva-ok').click();
  await expect(page.getByTestId('cartellino-stato')).toHaveText('Approvato');
  await expect(page.getByTestId('storico-approvazioni')).toContainText('Approvato');
  await expect(page.getByTestId('storico-approvazioni')).toContainText('Laura Bianchi');

  expect(errori).toEqual([]);
});

test('richiesta di correzione e riapertura motivata', async ({ page }) => {
  await login(page, 'laura.bianchi@demo.local');
  await page.goto('/#/admin/cartellini');
  // Luca Ferri è in attesa di approvazione nei dati demo
  await page.getByTestId('cartellino-riga').filter({ hasText: 'Luca Ferri' }).click();
  await page.getByTestId('azione-richiedi_correzione').click();
  await expect(page.getByTestId('dlg-richiedi_correzione-ok')).toBeDisabled(); // motivazione obbligatoria
  await page.getByTestId('dlg-richiedi_correzione-motivo').fill('Classificare le ore non attribuite del giorno 2');
  await page.getByTestId('dlg-richiedi_correzione-ok').click();
  await expect(page.getByTestId('cartellino-stato')).toHaveText('Da correggere');

  // Andrea Conti è approvato: riapertura con motivazione, la versione approvata resta
  await page.goto('/#/admin/cartellini');
  await page.getByTestId('cartellino-riga').filter({ hasText: 'Andrea Conti' }).click();
  await page.getByTestId('azione-riapri').click();
  await page.getByTestId('dlg-riapri-motivo').fill('Rettifica richiesta dal consulente del lavoro');
  await page.getByTestId('dlg-riapri-ok').click();
  await expect(page.getByTestId('cartellino-stato')).toHaveText('Riaperto');
  await page.getByTestId('azione-rigenera').click();
  await page.getByTestId('dlg-rigenera-ok').click();
  await expect(page.getByTestId('cartellino-stato')).toHaveText("Da confermare dall'operaio");
  await expect(page.getByText('approvata v1')).toBeVisible();
});

test('offline: le operazioni restano in coda e vengono inviate al ritorno della rete', async ({ page }) => {
  await login(page, 'marco.rossi@demo.local');
  await page.goto('/#/sync');
  await page.getByTestId('sim-offline').click();
  await expect(page.getByTestId('sync-connessione')).toContainText('Offline');

  await page.goto('/#/op');
  await page.getByTestId('btn-entrata').click();
  await page.getByTestId('btn-avvia-intervento').first().click();
  await expect(page.getByTestId('hero')).toContainText('Timer attivo');
  await page.clock.fastForward('00:00:10');
  await expect(page.getByTestId('sync-pill')).toContainText('Offline');
  await expect(page.getByTestId('sync-pill')).toContainText('in coda');

  await page.goto('/#/sync');
  await expect(page.getByTestId('riga-op').first()).toContainText('In attesa di invio');
  await page.getByTestId('sim-offline').click();
  await page.getByTestId('sync-ora').click();
  await expect(page.getByTestId('sync-pill')).toHaveText('Tutto sincronizzato', { timeout: 15_000 });
  await expect(page.getByTestId('riga-op').first()).toContainText('Sincronizzato');
});
