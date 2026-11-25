import { useData, useNow, useUtente } from '../../app/AppContext';
import { localDate } from '../../domain/time';

/** Stato corrente della giornata dell'operaio autenticato, ricalcolato a ogni secondo. */
export function useGiornata() {
  const s = useData();
  const u = useUtente();
  const now = useNow(1000);
  const oggi = localDate(now);
  const aperta = s.workday.presenzaAperta(u.id);
  const presenzeOggi = s.workday.presenzeDelGiorno(u.id, oggi);
  const presenza = aperta ?? presenzeOggi[presenzeOggi.length - 1];
  const attivitaInCorso = aperta ? s.workday.attivitaInCorso(aperta.id) : undefined;
  const pausaInCorso = aperta ? s.workday.pausaInCorso(aperta.id) : undefined;
  const riepilogo = presenza ? s.workday.riepilogo(presenza.id, now) : undefined;
  const nonChiusa = s.workday.giornataNonChiusa(u.id);
  return { s, u, now, oggi, aperta, presenza, presenzeOggi, attivitaInCorso, pausaInCorso, riepilogo, nonChiusa };
}
