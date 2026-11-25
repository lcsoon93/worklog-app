/**
 * Macchina a stati del cartellino mensile (specifica in docs/07-cartellini-approvazioni.md).
 * Funzioni pure: validano una transizione e descrivono il risultato. La persistenza
 * (record di approvazione, nuova versione, audit) è responsabilità del servizio.
 */
import type { AzioneCartellino, CartellinoStato, Ruolo } from './types';

export type Attore = Ruolo | 'sistema';

export interface RegolaTransizione {
  azione: AzioneCartellino;
  da: CartellinoStato[];
  a: CartellinoStato;
  attori: Attore[];
  motivazioneObbligatoria: boolean;
  /** La transizione crea una nuova versione (snapshot) del cartellino. */
  nuovaVersione: boolean;
  /** Solo l'operaio titolare del cartellino può eseguirla. */
  soloTitolare: boolean;
  descrizione: string;
}

export const TRANSIZIONI: RegolaTransizione[] = [
  {
    azione: 'genera',
    da: ['in_compilazione'],
    a: 'da_confermare_operaio',
    attori: ['admin', 'sistema'],
    motivazioneObbligatoria: false,
    nuovaVersione: true,
    soloTitolare: false,
    descrizione: 'Chiusura del mese: viene generato lo snapshot del cartellino.',
  },
  {
    azione: 'conferma',
    da: ['da_confermare_operaio'],
    a: 'confermato_operaio',
    attori: ['operaio'],
    motivazioneObbligatoria: false,
    nuovaVersione: false,
    soloTitolare: true,
    descrizione: "L'operaio conferma che il cartellino è corretto.",
  },
  {
    azione: 'segnala_discrepanza',
    da: ['da_confermare_operaio'],
    a: 'da_correggere',
    attori: ['operaio'],
    motivazioneObbligatoria: true,
    nuovaVersione: false,
    soloTitolare: true,
    descrizione: "L'operaio segnala una discrepanza: il mese torna correggibile.",
  },
  {
    azione: 'ricezione_server',
    da: ['confermato_operaio'],
    a: 'in_attesa_approvazione',
    attori: ['sistema'],
    motivazioneObbligatoria: false,
    nuovaVersione: false,
    soloTitolare: false,
    descrizione: 'Il server ha ricevuto la conferma: il cartellino entra nella coda di approvazione.',
  },
  {
    azione: 'approva',
    da: ['in_attesa_approvazione'],
    a: 'approvato',
    attori: ['admin'],
    motivazioneObbligatoria: false,
    nuovaVersione: false,
    soloTitolare: false,
    descrizione: "L'amministratore approva la versione confermata.",
  },
  {
    azione: 'richiedi_correzione',
    da: ['in_attesa_approvazione'],
    a: 'da_correggere',
    attori: ['admin'],
    motivazioneObbligatoria: true,
    nuovaVersione: false,
    soloTitolare: false,
    descrizione: "L'amministratore chiede correzioni puntuali.",
  },
  {
    azione: 'rifiuta',
    da: ['in_attesa_approvazione'],
    a: 'da_correggere',
    attori: ['admin'],
    motivazioneObbligatoria: true,
    nuovaVersione: false,
    soloTitolare: false,
    descrizione: "L'amministratore rifiuta il cartellino con motivazione.",
  },
  {
    azione: 'rigenera',
    da: ['da_correggere', 'riaperto'],
    a: 'da_confermare_operaio',
    attori: ['admin', 'sistema', 'operaio'],
    motivazioneObbligatoria: false,
    nuovaVersione: true,
    soloTitolare: false,
    descrizione: 'Dopo le correzioni si genera una nuova versione da riconfermare.',
  },
  {
    azione: 'riapri',
    da: ['approvato'],
    a: 'riaperto',
    attori: ['admin'],
    motivazioneObbligatoria: true,
    nuovaVersione: false,
    soloTitolare: false,
    descrizione: 'Riapertura di un cartellino approvato: la versione approvata resta in archivio.',
  },
];

export const ETICHETTE_STATO: Record<CartellinoStato, string> = {
  in_compilazione: 'In compilazione',
  da_confermare_operaio: "Da confermare dall'operaio",
  confermato_operaio: "Confermato dall'operaio",
  in_attesa_approvazione: 'In attesa di approvazione',
  da_correggere: 'Da correggere',
  approvato: 'Approvato',
  riaperto: 'Riaperto',
};

export const ETICHETTE_AZIONE: Record<AzioneCartellino, string> = {
  genera: 'Generato',
  conferma: "Confermato dall'operaio",
  segnala_discrepanza: 'Discrepanza segnalata',
  ricezione_server: 'Ricevuto dal server',
  approva: 'Approvato',
  richiedi_correzione: 'Correzione richiesta',
  rifiuta: 'Rifiutato',
  rigenera: 'Nuova versione generata',
  riapri: 'Riaperto',
};

export interface RichiestaTransizione {
  stato: CartellinoStato;
  azione: AzioneCartellino;
  attore: Attore;
  utenteId: string | null;
  titolareId: string;
  motivazione?: string;
}

export type EsitoTransizione =
  | { ok: true; regola: RegolaTransizione; nuovoStato: CartellinoStato }
  | { ok: false; errore: string };

export function valutaTransizione(r: RichiestaTransizione): EsitoTransizione {
  const regola = TRANSIZIONI.find((t) => t.azione === r.azione);
  if (!regola) return { ok: false, errore: `Azione sconosciuta: ${r.azione}` };
  if (!regola.da.includes(r.stato)) {
    return {
      ok: false,
      errore: `Azione "${ETICHETTE_AZIONE[r.azione]}" non ammessa nello stato "${ETICHETTE_STATO[r.stato]}".`,
    };
  }
  if (!regola.attori.includes(r.attore)) {
    return { ok: false, errore: `Azione non consentita al ruolo ${r.attore}.` };
  }
  if (regola.soloTitolare && r.utenteId !== r.titolareId) {
    return { ok: false, errore: "Solo l'operaio titolare può eseguire questa azione." };
  }
  if (regola.motivazioneObbligatoria && !(r.motivazione ?? '').trim()) {
    return { ok: false, errore: 'La motivazione è obbligatoria.' };
  }
  return { ok: true, regola, nuovoStato: regola.a };
}

export function azioniDisponibili(stato: CartellinoStato, attore: Attore): RegolaTransizione[] {
  return TRANSIZIONI.filter((t) => t.da.includes(stato) && t.attori.includes(attore));
}

/**
 * Stati in cui presenze, pause e attività del mese possono essere modificate.
 * Negli altri stati il mese è bloccato: per correggere serve una transizione esplicita
 * (segnala discrepanza, richiesta di correzione o riapertura).
 */
export const STATI_MODIFICABILI: CartellinoStato[] = ['in_compilazione', 'da_correggere', 'riaperto'];

export function meseModificabile(stato: CartellinoStato | undefined): boolean {
  return stato === undefined || STATI_MODIFICABILI.includes(stato);
}
