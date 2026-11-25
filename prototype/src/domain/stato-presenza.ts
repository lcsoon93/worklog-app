/**
 * Stato di una presenza rispetto all'istante "adesso".
 *
 * Correzione di un'incongruenza della Fase 1: una presenza aperta veniva considerata
 * "non chiusa" appena cambiava la data, segnalando per errore i turni notturni ancora in
 * corso dopo mezzanotte. Ora una presenza aperta di un giorno precedente è "non chiusa" solo se:
 *  - è aperta da più di 16 ore (turno implausibile), oppure
 *  - l'app non dà segnali di vita da più di 3 ore (dispositivo spento / giornata dimenticata).
 * Un turno notturno con l'app attiva resta "in corso".
 *
 * Per le presenze "non chiuse" i totali NON vanno calcolati fino ad "adesso": sarebbe
 * un'uscita inventata. I riepiloghi le mostrano come dati incompleti.
 */
import { localDate, toMs } from './time';
import type { Presenza } from './types';

export const SOGLIA_DURATA_MAX_APERTA_MS = 16 * 3600_000;
export const SOGLIA_SILENZIO_MS = 3 * 3600_000;

export type StatoPresenza = 'chiusa' | 'in_corso' | 'non_chiusa';

export function statoPresenza(
  p: Pick<Presenza, 'entrata_at' | 'uscita_at' | 'data_lavoro' | 'ultimo_segnale_at'>,
  now: number,
): StatoPresenza {
  if (p.uscita_at) return 'chiusa';
  if (p.data_lavoro >= localDate(now)) return 'in_corso';
  const troppoLunga = now - toMs(p.entrata_at) > SOGLIA_DURATA_MAX_APERTA_MS;
  const silenziosa = now - toMs(p.ultimo_segnale_at) > SOGLIA_SILENZIO_MS;
  return troppoLunga || silenziosa ? 'non_chiusa' : 'in_corso';
}
