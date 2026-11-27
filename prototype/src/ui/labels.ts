import type { AnomaliaCodice } from '../domain/hours-engine';
import { CODICI_ATTIVITA_INTERNA, type AttivitaLavoro, type AttivitaTipo, type ImprevistoTipo } from '../domain/types';
import type { AppServices } from '../services/app-services';
import { nomeProfilo } from '../services/base';

export function nomeOperaio(s: AppServices, id: string | null | undefined): string {
  return nomeProfilo(s.db, id);
}
export function nomeCliente(s: AppServices, id: string | null | undefined): string {
  return s.db.get('clienti', id)?.ragione_sociale ?? '—';
}
export function nomeSede(s: AppServices, id: string | null | undefined): string {
  const x = s.db.get('sedi_cliente', id);
  return x ? `${x.nome} · ${x.citta}` : '';
}

export const TIPO_ATTIVITA: Record<AttivitaTipo, string> = {
  lavoro_cliente: 'Lavoro dal cliente',
  trasferimento: 'Trasferimento',
  interna: 'Attività interna',
  da_definire: 'Da classificare',
};

export function titoloAttivita(s: AppServices, a: Pick<AttivitaLavoro, 'tipo' | 'cliente_id' | 'intervento_id' | 'codice_interno' | 'sede_id'>): { titolo: string; sotto: string } {
  if (a.tipo === 'interna') return { titolo: CODICI_ATTIVITA_INTERNA[a.codice_interno ?? 'ufficio'] ?? 'Attività interna', sotto: 'Attività interna' };
  if (a.tipo === 'da_definire') return { titolo: 'Attività da classificare', sotto: 'Cliente non indicato' };
  const i = a.intervento_id ? s.db.get('interventi', a.intervento_id) : undefined;
  const cliente = nomeCliente(s, a.cliente_id);
  const prefisso = a.tipo === 'trasferimento' ? 'Viaggio verso ' : '';
  return { titolo: `${prefisso}${cliente}`, sotto: i ? `${i.codice} · ${i.titolo}` : nomeSede(s, a.sede_id) || TIPO_ATTIVITA[a.tipo] };
}

export const ANOMALIE: Record<AnomaliaCodice, string> = {
  presenza_aperta: 'Giornata aperta',
  presenza_invalida: 'Presenza non valida',
  presenza_lunga: 'Presenza molto lunga',
  turno_oltre_mezzanotte: 'Turno oltre mezzanotte',
  pausa_aperta: 'Pausa non chiusa',
  pausa_fuori_presenza: 'Pausa fuori presenza',
  pause_sovrapposte: 'Pause sovrapposte',
  timer_attivo: 'Timer attivo',
  timer_non_fermato: 'Timer non fermato',
  attivita_invalida: 'Attività non valida',
  attivita_fuori_presenza: 'Attività fuori presenza',
  attivita_durante_pausa: 'Attività durante pausa',
  attivita_sovrapposte: 'Attività sovrapposte',
  attivita_da_classificare: 'Attività da classificare',
  ore_non_attribuite: 'Ore non attribuite',
  nessuna_attivita: 'Nessuna attività',
  pausa_obbligatoria_mancante: 'Pausa mancante (>6h)',
};

export const IMPREVISTO_TIPO: Record<ImprevistoTipo, string> = {
  materiale_mancante: 'Materiale mancante',
  accesso_negato: 'Accesso non possibile',
  guasto_aggiuntivo: 'Guasto aggiuntivo',
  cliente_assente: 'Cliente assente',
  sicurezza: 'Problema di sicurezza',
  meteo: 'Maltempo',
  altro: 'Altro',
};
