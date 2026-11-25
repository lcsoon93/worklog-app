/**
 * Formattazione italiana per documenti e anteprime. Solo presentazione: nessun calcolo.
 * Tutte le date/ore sono rese nel fuso del dispositivo (in produzione Europe/Rome):
 * non si usa mai toISOString() per ricavare un giorno, che darebbe il giorno UTC.
 */
import { MESI, pad, parseDate } from '../domain/time';

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export const NON_REGISTRATO = '—';

/** Durata in ore e minuti "HH:mm" (le ore possono superare 99). Arrotonda al minuto. */
export function oreMinuti(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NON_REGISTRATO;
  const tot = Math.round(Math.abs(ms) / 60_000);
  return `${ms < 0 ? '-' : ''}${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`;
}

/** Ora del giorno "HH:mm". */
export function ora(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NON_REGISTRATO;
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ora con indicazione del giorno quando diverso da quello di riferimento (turni oltre mezzanotte). */
export function oraRelativa(ms: number | null | undefined, giornoRiferimento: string): string {
  if (ms === null || ms === undefined) return NON_REGISTRATO;
  const d = new Date(ms);
  const giorno = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return giorno === giornoRiferimento ? ora(ms) : `${ora(ms)} (${pad(d.getDate())}/${pad(d.getMonth() + 1)})`;
}

/** "24/11/2026" */
export function dataBreve(data: string): string {
  const [y, m, d] = data.split('-');
  return `${d}/${m}/${y}`;
}

/** "martedì 24 novembre 2026" */
export function dataLunga(data: string): string {
  const d = parseDate(data);
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

/** "mar 24" */
export function giornoBreve(data: string): string {
  const d = parseDate(data);
  return `${GIORNI[d.getDay()].slice(0, 3)} ${pad(d.getDate())}`;
}

/** "24/11/2026 alle 10:35" */
export function istante(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} alle ${ora(ms)}`;
}

export function meseAnno(anno: number, mese: number): string {
  return `${MESI[mese - 1]} ${anno}`;
}
