import { useUtente } from '../../app/AppContext';
import { PageHead } from '../../ui/components';
import { RiepiloghiPanel } from '../../ui/RiepiloghiPanel';

/** "I miei riepiloghi": l'operaio esporta i PDF dei propri giorni e mesi. */
export function MieiRiepiloghi() {
  const u = useUtente();
  return (
    <div className="stack">
      <PageHead title="I miei riepiloghi" eyebrow="Esportazione PDF" back={{ to: '/op', label: 'Oggi' }} />
      <RiepiloghiPanel operaioId={u.id} />
    </div>
  );
}
