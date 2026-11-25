import { LogIn, Play, Square, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { formatDurata, formatDurataSecondi } from '../../domain/hours-engine';
import { formatOra, toMs } from '../../domain/time';
import type { Destinazione } from '../../services/workday-service';
import { Alert, Card, PageHead, Sheet } from '../../ui/components';
import { DestinationPicker } from '../../ui/DestinationPicker';
import { titoloAttivita } from '../../ui/labels';
import { useGiornata } from './useGiornata';

export function TimerPage() {
  const { s, u, now, aperta, attivitaInCorso, pausaInCorso, nonChiusa } = useGiornata();
  const { run } = useApp();
  const [dest, setDest] = useState<Destinazione | null>(null);
  const [classifica, setClassifica] = useState(false);

  if (nonChiusa) {
    return <Alert tono="danger" title="Chiudi prima la giornata precedente" actions={<Link className="btn" to="/op">Vai a Oggi</Link>} />;
  }
  const attivitaOggi = aperta ? s.workday.attivita(aperta.id).slice().reverse() : [];

  return (
    <div className="stack">
      <PageHead title="Timer attività" eyebrow="Registrazione ore" back={{ to: '/op', label: 'Oggi' }} />
      {!aperta && (
        <Alert tono="warn" title="Non hai ancora registrato l'entrata" actions={<button className="btn btn-primary" data-testid="timer-entrata" onClick={() => run(() => s.workday.registraEntrata(), 'Entrata registrata')}><LogIn /> Registra entrata</button>}>
          L'attività si registra solo durante la presenza.
        </Alert>
      )}
      {pausaInCorso && <Alert tono="info" title={`Sei in pausa dalle ${formatOra(pausaInCorso.inizio_at)}`}>Avviando un'attività la pausa verrà terminata automaticamente.</Alert>}

      {attivitaInCorso && aperta && (
        <div className="hero">
          <div className="hero-label row" style={{ gap: 8 }}><span className="pulse" /> In corso dalle {formatOra(attivitaInCorso.inizio_at)}</div>
          <div className="hero-clock tabular">{formatDurataSecondi(now - toMs(attivitaInCorso.inizio_at))}</div>
          <div className="hero-sub"><strong>{titoloAttivita(s, attivitaInCorso).titolo}</strong> · {titoloAttivita(s, attivitaInCorso).sotto}</div>
          <div className="hero-actions">
            <button className="btn btn-lg btn-white" data-testid="timer-ferma" onClick={() => run(() => s.workday.fermaAttivita(aperta.id), 'Timer fermato')}><Square /> Ferma timer</button>
            {attivitaInCorso.tipo === 'da_definire' && <button className="btn btn-lg" onClick={() => setClassifica(true)} data-testid="timer-classifica"><Tag /> Assegna cliente</button>}
          </div>
        </div>
      )}

      {aperta && (
        <Card title={attivitaInCorso ? 'Passa a un\'altra attività' : 'Avvia un\'attività'} pad foot={
          <div className="row-between">
            <span className="subtle">{attivitaInCorso ? 'L\'attività attuale si chiude nello stesso istante in cui parte la nuova: nessun buco, nessuna sovrapposizione.' : 'Seleziona cosa stai facendo e premi Avvia.'}</span>
            <button className="btn btn-primary btn-lg" disabled={!dest} data-testid="timer-avvia" onClick={async () => {
              const ok = await run(() => s.workday.avviaAttivita(aperta.id, dest!), attivitaInCorso ? 'Attività cambiata' : 'Timer avviato');
              if (ok) setDest(null);
            }}><Play /> {attivitaInCorso ? 'Cambia e avvia' : 'Avvia'}</button>
          </div>
        }>
          <DestinationPicker value={dest} onChange={setDest} operaioId={u.id} />
        </Card>
      )}

      {aperta && attivitaOggi.length > 0 && (
        <Card title="Attività di oggi" actions={<Link className="btn btn-sm btn-ghost" to="/op/riepilogo">Correggi</Link>}>
          {attivitaOggi.map((a) => {
            const t = titoloAttivita(s, a);
            const fine = a.fine_at ? toMs(a.fine_at) : now;
            return (
              <div className="act" key={a.id}>
                <div className={`bar bg-${a.tipo}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="title ellipsis" style={{ fontWeight: 650 }}>{t.titolo}</div>
                  <div className="subtle ellipsis">{formatOra(a.inizio_at)} – {a.fine_at ? formatOra(a.fine_at) : 'in corso'} · {t.sotto}</div>
                </div>
                <div className="tabular" style={{ fontWeight: 700 }}>{formatDurata(fine - toMs(a.inizio_at))}</div>
              </div>
            );
          })}
        </Card>
      )}

      {classifica && aperta && <ClassificaSheet presenzaId={aperta.id} operaioId={u.id} onClose={() => setClassifica(false)} />}
    </div>
  );
}

export function ClassificaSheet({ presenzaId, operaioId, onClose }: { presenzaId: string; operaioId: string; onClose: () => void }) {
  const { s, runOk } = useApp();
  const [dest, setDest] = useState<Destinazione | null>(null);
  return (
    <Sheet title="Assegna il timer in corso" wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={!dest} onClick={async () => { const ok = await runOk(() => s.workday.classificaInCorso(presenzaId, dest!), 'Timer classificato'); if (ok) onClose(); }}>Assegna</button>
    </>}>
      <p className="muted">L'orario di inizio non cambia: tutto il tempo già trascorso viene attribuito alla destinazione scelta. La modifica resta nel registro.</p>
      <DestinationPicker value={dest} onChange={setDest} operaioId={operaioId} escludiDaDefinire />
    </Sheet>
  );
}
