import { PageHead } from '../../ui/components';
import { RiepiloghiPanel } from '../../ui/RiepiloghiPanel';

/** "Report presenze": l'amministratore genera i riepiloghi PDF di qualsiasi operaio. */
export function ReportPresenze() {
  return (
    <div className="stack">
      <PageHead title="Report presenze" eyebrow="Riepiloghi PDF per operaio" />
      <RiepiloghiPanel operaioId={null} sceltaOperaio />
    </div>
  );
}
