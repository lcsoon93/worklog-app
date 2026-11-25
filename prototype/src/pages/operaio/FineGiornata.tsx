import { ChevronLeft, ChevronRight, FileDown, LogOut, MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { addDays, formatData, meseDi } from '../../domain/time';
import { meseModificabile } from '../../domain/timesheet-workflow';
import { Alert, Badge, Card, CartellinoBadge, Empty, PageHead, Sheet } from '../../ui/components';
import { RichiediCorrezioneSheet, RichiesteLista } from '../../ui/RichiesteCorrezione';
import { DayDetail } from '../../ui/DayDetail';
import { titoloAttivita } from '../../ui/labels';
import { useGiornata } from './useGiornata';

export function FineGiornata() {
  const { s, u, oggi, aperta, attivitaInCorso, pausaInCorso, riepilogo, nonChiusa } = useGiornata();
  const { run } = useApp();
  const [params, setParams] = useSearchParams();
  const data = params.get('data') ?? (nonChiusa ? nonChiusa.presenza.data_lavoro : oggi);
  const [conferma, setConferma] = useState(false);
  const [richiesta, setRichiesta] = useState(false);
  const presenze = s.workday.presenzeDelGiorno(u.id, data);
  const { anno, mese } = meseDi(data);
  const cart = s.timesheet.cartellino(u.id, anno, mese);
  const modificabile = meseModificabile(cart?.stato);
  const apertaQui = aperta && aperta.data_lavoro === data && !nonChiusa;

  return (
    <div className="stack">
      <PageHead
        title="Riepilogo giornata"
        eyebrow={formatData(data)}
        back={{ to: '/op', label: 'Oggi' }}
        actions={<>
          <button className="btn icon-btn" aria-label="Giorno precedente" onClick={() => setParams({ data: addDays(data, -1) })}><ChevronLeft /></button>
          <button className="btn" onClick={() => setParams({})}>Oggi</button>
          <button className="btn icon-btn" aria-label="Giorno successivo" disabled={data >= oggi} onClick={() => setParams({ data: addDays(data, 1) })}><ChevronRight /></button>
        </>}
      />
      {!modificabile && <Alert tono="info" title="Mese in verifica o approvato">Le correzioni dirette di questo mese sono bloccate. Se trovi un errore usa «Richiedi correzione»: l'amministrazione la verificherà e, se serve, riaprirà il cartellino.</Alert>}

      {presenze.length > 0 && (() => {
        // Stato di sincronizzazione della giornata: presenze, pause, attività e richieste del giorno.
        const ids = new Set(presenze.map((p) => p.id));
        const records = [
          ...presenze,
          ...s.db.where('pause_presenza', (x) => ids.has(x.presenza_id)),
          ...s.db.where('attivita_lavoro', (a) => ids.has(a.presenza_id)),
          ...s.richieste.elenco({ operaioId: u.id, data }),
        ];
        const nonSync = records.filter((r) => r.sync_stato !== 'sincronizzato');
        const problemi = nonSync.filter((r) => r.sync_stato === 'errore' || r.sync_stato === 'conflitto').length;
        const richieste = s.richieste.elenco({ operaioId: u.id, data });
        return (
          <Card title="Verifica della giornata" testId="verifica-giornata" actions={<>
            <Link className="btn btn-sm" to={`/op/riepiloghi?vista=giornaliero&data=${data}`} data-testid="link-pdf-giorno"><FileDown size={16} /> PDF della giornata</Link>
            <button className="btn btn-sm" onClick={() => setRichiesta(true)} data-testid="btn-richiedi-correzione"><MessageSquareWarning size={16} /> Richiedi correzione</button>
          </>}>
            <div className="card-body row">
              <span className="subtle">Sincronizzazione:</span>
              {problemi ? <Badge tono="danger" testId="sync-giornata">{problemi} da verificare</Badge> : nonSync.length ? <Badge tono="warn" testId="sync-giornata">{nonSync.length} in attesa di invio</Badge> : <Badge tono="ok" testId="sync-giornata">Tutto sincronizzato</Badge>}
              <span className="subtle">Cartellino del mese:</span>
              {cart ? <CartellinoBadge stato={cart.stato} /> : <Badge>In compilazione</Badge>}
            </div>
            {richieste.length > 0 && <RichiesteLista richieste={richieste} />}
          </Card>
        );
      })()}

      {apertaQui && (
        <div className="card card-pad row-between" style={{ borderColor: 'var(--primary)' }}>
          <div>
            <h2>La giornata è ancora aperta</h2>
            <div className="muted">Controlla le attività qui sotto, correggi se serve, poi termina la giornata.</div>
          </div>
          <button className="btn btn-danger btn-lg" data-testid="btn-termina" onClick={() => setConferma(true)}><LogOut /> Termina giornata</button>
        </div>
      )}

      {presenze.length === 0 ? <div className="card"><Empty>Nessuna presenza registrata in questo giorno.</Empty></div> : presenze.map((p) => <DayDetail key={p.id} presenzaId={p.id} editable={modificabile} />)}

      {richiesta && <RichiediCorrezioneSheet data={data} presenzaId={presenze.at(-1)?.id ?? null} onClose={() => setRichiesta(false)} />}
      {conferma && aperta && riepilogo && (
        <Sheet title="Terminare la giornata?" onClose={() => setConferma(false)} footer={<>
          <button className="btn" onClick={() => setConferma(false)}>Non ancora</button>
          <button className="btn btn-danger" data-testid="conferma-uscita" onClick={async () => { const ok = await run(() => s.workday.registraUscita(aperta.id), 'Giornata terminata'); if (ok) setConferma(false); }}>Registra uscita adesso</button>
        </>}>
          <div className="kv">
            <dt>Presenza netta</dt><dd className="tabular">{formatDurata(riepilogo.netta_ms)}</dd>
            <dt>Ore attribuite</dt><dd className="tabular">{formatDurata(riepilogo.attribuite_ms)}</dd>
            <dt>Ore non attribuite</dt><dd className="tabular">{formatDurata(riepilogo.non_attribuite_ms)}</dd>
          </div>
          {attivitaInCorso && <Alert tono="warn">Il timer su <strong>{titoloAttivita(s, attivitaInCorso).titolo}</strong> verrà fermato all'orario di uscita.</Alert>}
          {pausaInCorso && <Alert tono="warn">La pausa in corso verrà chiusa all'orario di uscita.</Alert>}
          {riepilogo.da_classificare_ms > 0 && <Alert tono="warn">Hai {formatDurata(riepilogo.da_classificare_ms)} di attività senza cliente: puoi classificarle anche dopo l'uscita.</Alert>}
        </Sheet>
      )}
    </div>
  );
}
