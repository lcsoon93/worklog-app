/** Utilità di data/ora. Il fuso di riferimento è quello del dispositivo (in produzione: Europe/Rome). */

export function toMs(iso: string): number {
  return new Date(iso).getTime();
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Data di calendario locale 'YYYY-MM-DD'. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Istante epoch a partire da data locale e ora 'HH:MM'. */
export function atLocal(date: string, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

export function formatOra(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '--:--';
  const d = new Date(typeof iso === 'number' ? iso : iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const GIORNI_BREVI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
export const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatData(date: string, opts: { breve?: boolean } = {}): string {
  const d = parseDate(date);
  const g = opts.breve ? GIORNI_BREVI[d.getDay()] : GIORNI[d.getDay()];
  return `${g} ${d.getDate()} ${MESI[d.getMonth()].toLowerCase()}${opts.breve ? '' : ' ' + d.getFullYear()}`;
}

export function giornoSettimanaBreve(date: string): string {
  return GIORNI_BREVI[parseDate(date).getDay()];
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return localDate(d.getTime());
}

/** Lunedì della settimana che contiene la data. */
export function startOfWeek(date: string): string {
  const d = parseDate(date);
  const dow = (d.getDay() + 6) % 7;
  return addDays(date, -dow);
}

export function daysInMonth(anno: number, mese: number): string[] {
  const n = new Date(anno, mese, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${anno}-${pad(mese)}-${pad(i + 1)}`);
}

export function isWeekend(date: string): boolean {
  const g = parseDate(date).getDay();
  return g === 0 || g === 6;
}

export function meseDi(date: string): { anno: number; mese: number } {
  const [y, m] = date.split('-').map(Number);
  return { anno: y, mese: m };
}

export function etichettaMese(anno: number, mese: number): string {
  return `${MESI[mese - 1]} ${anno}`;
}

export function mesePrecedente(anno: number, mese: number): { anno: number; mese: number } {
  return mese === 1 ? { anno: anno - 1, mese: 12 } : { anno, mese: mese - 1 };
}
