/**
 * Rapportino rapido e completo (creazione, bozza, completamento) e visualizzazione.
 * Le ore non si digitano: derivano dalle attività collegate (motore ore).
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { useData, useUtente } from '../../app/AppContext';
import { Empty } from '../../ui/components';
import { FormRapportino } from './rapportino/FormRapportino';
import { NuovoRapportino } from './rapportino/NuovoRapportino';
import { VistaRapportino } from './rapportino/VistaRapportino';

export function RapportinoEditor() {
  const { id } = useParams();
  if (!id) return <NuovoRapportino />;
  return <RapportinoDettaglio id={id} />;
}

function RapportinoDettaglio({ id }: { id: string }) {
  const s = useData();
  const u = useUtente();
  const [params] = useSearchParams();
  const salvato = s.db.get('rapportini', id);
  if (!salvato) return <Empty>Rapportino non trovato.</Empty>;
  // Fase 13: il redattore modifica bozza, pronto e restituito; l'amministratore corregge (tracciato) gli inviati.
  const fase = s.report.fase(salvato);
  if (s.report.modificabileDa(salvato, u.id)) return <FormRapportino key={`${id}-${fase}`} iniziale={salvato} correzione={fase === 'da_correggere'} />;
  if (u.ruolo === 'admin' && params.get('correggi') === '1' && salvato.stato !== 'bozza' && salvato.stato !== 'annullato') return <FormRapportino key={`${id}-adm`} iniziale={salvato} correzione />;
  return <VistaRapportino r={salvato} />;
}
