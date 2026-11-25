import { Coffee, Play, Sandwich, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { formatDurata, formatDurataSecondi } from '../../domain/hours-engine';
import { formatOra, toMs } from '../../domain/time';
import type { PausaTipo } from '../../domain/types';
import { Alert, Card, Empty, PageHead, Stat } from '../../ui/components';
import { titoloAttivita } from '../../ui/labels';
import { useGiornata } from './useGiornata';

const TIPI: Array<{ tipo: PausaTipo; label: string; sotto: string; icon: JSX.Element }> = [
  { tipo: 'pranzo', label: 'Pausa pranzo', sotto: 'Di solito 30–60 minuti', icon: <Sandwich size={28} /> },
  { tipo: 'breve', label: 'Pausa breve', sotto: 'Caffè, 10–15 minuti', icon: <Coffee size={28} /> },
  { tipo: 'altro', label: 'Altra pausa', sotto: 'Motivi personali', icon: <Timer size={28} /> },
];

export function Pause() {
  const { s, now, aperta, pausaInCorso, attivitaInCorso, riepilogo } = useGiornata();
  const { run } = useApp();
  const pause = aperta ? s.workday.pause(aperta.id) : [];
  const sospesa = pausaInCorso ? s.db.get('attivita_lavoro', pausaInCorso.attivita_sospesa_id) : undefined;

  return (
    <div className="stack">
      <PageHead title="Pause" eyebrow="Gestione pause" back={{ to: '/op', label: 'Oggi' }} />
      {!aperta ? (
        <Alert tono="warn" title="Nessuna giornata aperta" actions={<Link className="btn" to="/op">Vai a Oggi</Link>}>Registra l'entrata per poter gestire le pause.</Alert>
      ) : pausaInCorso ? (
        <div className="hero paused">
          <div className="hero-label">In pausa · {TIPI.find((t) => t.tipo === pausaInCorso.tipo)?.label}</div>
          <div className="hero-clock tabular">{formatDurataSecondi(now - toMs(pausaInCorso.inizio_at))}</div>
          <div className="hero-sub">Iniziata alle {formatOra(pausaInCorso.inizio_at)}{sospesa ? ` · timer sospeso su ${titoloAttivita(s, sospesa).titolo}` : ''}</div>
          <div className="hero-actions">
            {sospesa && <button className="btn btn-xl btn-white" data-testid="pause-riprendi" onClick={() => run(async () => { await s.workday.terminaPausa(aperta.id); await s.workday.riprendiAttivita(aperta.id, sospesa.id); }, 'Attività ripresa')}><Play size={26} /> Termina e riprendi</button>}
            <button className={`btn btn-lg ${sospesa ? '' : 'btn-white'}`} data-testid="pause-termina" onClick={() => run(() => s.workday.terminaPausa(aperta.id), 'Pausa terminata')}>Termina pausa</button>
          </div>
        </div>
      ) : (
        <Card title="Inizia una pausa" pad foot={attivitaInCorso ? <span className="subtle">Il timer su <strong>{titoloAttivita(s, attivitaInCorso).titolo}</strong> verrà sospeso e potrai riprenderlo con un tocco.</span> : undefined}>
          <div className="choices">
            {TIPI.map((t) => (
              <button key={t.tipo} className="choice" style={{ minHeight: 96 }} data-testid={`pausa-${t.tipo}`} onClick={() => run(() => s.workday.iniziaPausa(aperta.id, t.tipo), 'Pausa avviata')}>
                {t.icon}
                <span>{t.label}<small>{t.sotto}</small></span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {aperta && (
        <>
          <div className="grid-3">
            <Stat label="Pause di oggi" value={pause.length} />
            <Stat label="Tempo in pausa" value={formatDurata(riepilogo?.pause_ms ?? 0)} />
            <Stat label="Presenza netta" value={formatDurata(riepilogo?.netta_ms ?? 0)} />
          </div>
          <Card title="Pause registrate">
            {pause.length === 0 ? <Empty>Nessuna pausa registrata oggi.</Empty> : pause.map((p) => (
              <div className="act" key={p.id}>
                <div className="bar bg-pausa" />
                <div><div style={{ fontWeight: 650 }}>{TIPI.find((t) => t.tipo === p.tipo)?.label}</div><div className="subtle">{formatOra(p.inizio_at)} – {p.fine_at ? formatOra(p.fine_at) : 'in corso'}</div></div>
                <div className="tabular" style={{ fontWeight: 700 }}>{formatDurata((p.fine_at ? toMs(p.fine_at) : now) - toMs(p.inizio_at))}</div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
