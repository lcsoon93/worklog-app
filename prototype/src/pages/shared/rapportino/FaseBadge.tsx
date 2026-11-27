/** Etichetta colorata della fase di invio del rapporto. */
import type { FaseInvio } from '../../../domain/types';
import { ETICHETTE_FASE } from '../../../services/report-service';
import { Badge, type Tono } from '../../../ui/components';

const TONO_FASE: Record<FaseInvio, Tono> = { bozza: 'neutral', pronto: 'info', inviato: 'primary', da_correggere: 'warn', approvato: 'ok' };
export function FaseBadge({ fase }: { fase: FaseInvio }) {
  return <Badge tono={TONO_FASE[fase]} testId="badge-fase">{ETICHETTE_FASE[fase]}</Badge>;
}
