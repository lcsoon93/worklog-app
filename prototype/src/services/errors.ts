/**
 * Gestione uniforme degli errori. I servizi lanciano solo AppError (o sottoclassi);
 * la UI mostra `messaggio` all'utente e registra `dettaglio` in console.
 */
export type CodiceErrore =
  | 'VALIDAZIONE'
  | 'STATO_NON_VALIDO'
  | 'NON_TROVATO'
  | 'NON_CONSENTITO'
  | 'MESE_BLOCCATO'
  | 'PERSISTENZA'
  | 'RETE'
  | 'SERVER'
  | 'CONFLITTO'
  | 'SENZA_PRESENZA';

export class AppError extends Error {
  constructor(
    public readonly codice: CodiceErrore,
    public readonly messaggio: string,
    public readonly dettaglio?: unknown,
  ) {
    super(messaggio);
    this.name = 'AppError';
  }
}

export function messaggioErrore(e: unknown): string {
  if (e instanceof AppError) return e.messaggio;
  if (e instanceof Error && e.name === 'ErroreValidazione') return e.message;
  if (e instanceof Error) return `Errore imprevisto: ${e.message}`;
  return 'Errore imprevisto.';
}

export function nonTrovato(cosa: string): AppError {
  return new AppError('NON_TROVATO', `${cosa} non trovato.`);
}
