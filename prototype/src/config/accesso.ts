/**
 * Accesso con nome utente e PIN di 6 cifre (migrazione 0011, decisione D-42).
 * In Supabase Auth ogni account ha un'email tecnica non recapitabile ricavata dal nome utente
 * e il PIN è la sua password: l'app chiede solo nome utente e PIN.
 */
export const DOMINIO_EMAIL_TECNICA = 'utenti.worklog.invalid';
export const FORMATO_USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const FORMATO_PIN = /^\d{6}$/;

export const normalizzaUsername = (u: string) => u.trim().toLowerCase();
export const emailTecnica = (username: string) => `${normalizzaUsername(username)}@${DOMINIO_EMAIL_TECNICA}`;
/** Nome utente di un profilo: quello registrato, altrimenti la parte dell'email prima della @ (profili dimostrativi). */
/**
 * Fase 13: nomi utente con privilegi di amministratore operativo (es. "luca"), separati da virgola,
 * da VITE_AMMINISTRATORI_OPERATIVI. Vale finché la colonna profili.amministratore_operativo
 * (migrazione 0014) non è applicata sul server; non è un segreto.
 */
export const AMMINISTRATORI_OPERATIVI: string[] = String(import.meta.env?.VITE_AMMINISTRATORI_OPERATIVI ?? '')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

export const usernameDi = (p: { username?: string; email: string }) => p.username ?? p.email.split('@')[0].toLowerCase();
