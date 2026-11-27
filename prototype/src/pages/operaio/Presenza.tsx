import { LogIn, LogOut, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { addDays, formatData, formatOra } from '../../domain/time';
import type { Presenza as PresenzaT } from '../../domain/types';
import { Alert, Badge, Card, PageHead, Stat, SyncBadge } from '../../ui/components';
import { CorreggiPresenzaSheet } from '../../ui/CorreggiPresenzaSheet';
import { useGiornata } from './useGiornata';

export function Presenza() {
  const { s, u, now, oggi, aperta, presenzeOggi, riepilogo, nonChiusa, attivitaInCorso } = useGiornata();
  const { run } = useApp();
  const [modifica, setModifica] = useState<PresenzaT | null>(null);
  const ultimi = Array.from({ length: 7 }, (_, k) => addDays(oggi, -k - 1));

  return (
    <div className="stack">
      <PageHead title="Registrazione presenza" eyebrow={formatData(oggi)} back={{ to: '/op', label: 'Oggi' }} />
      {nonChiusa && <Alert tono="danger" title="Giornata precedente non chiusa" actions={<Link className="btn" to="/op">Chiudi da Oggi</Link>} />}

      <div className="grid-2">
        <button className="btn btn-xl btn-primary" disabled={!!aperta} data-testid="presenza-entrata" onClick={() => run(() => s.workday.registraEntrata(), 'Entrata registrata')}>
          <LogIn size={28} /> Entrata
        </button>
        <button className="btn btn-xl btn-danger" disabled={!aperta || !!nonChiusa} data-testid="presenza-uscita" onClick={() => aperta && run(() => s.workday.registraUscita(aperta.id), 'Uscita registrata')}>
          <LogOut size={28} /> Uscita
        </button>
      </div>
      {aperta && attivitaInCorso && <Alert tono="info">Registrando l'uscita, il timer in corso verrà fermato allo stesso orario. Per controllare prima le ore usa <Link to="/op/riepilogo">Riepilogo fine giornata</Link>.</Alert>}

      {riepilogo && (
        <div className="grid-4">
          <Stat label="Entrata" value={formatOra(presenzeOggi[0]?.entrata_at)} />
          <Stat label="Uscita" value={aperta ? '—' : formatOra(presenzeOggi.at(-1)?.uscita_at)} />
          <Stat label="Presenza lorda" value={formatDurata(riepilogo.lorda_ms)} />
          <Stat label="Presenza netta" value={formatDurata(riepilogo.netta_ms)} />
        </div>
      )}

      <Card title="Timbrature di oggi">
        {presenzeOggi.length === 0 ? <div className="empty">Nessuna timbratura oggi.</div> : presenzeOggi.map((p) => (
          <div className="list-row" key={p.id} style={{ cursor: 'default' }}>
            <div className="grow">
              <div className="title tabular">{formatOra(p.entrata_at)} → {p.uscita_at ? formatOra(p.uscita_at) : 'in corso'}</div>
              <div className="subtle">
                {p.entrata_at !== p.entrata_registrata_at && <>Entrata registrata {formatOra(p.entrata_registrata_at)} · </>}
                {p.uscita_registrata_at && p.uscita_at !== p.uscita_registrata_at && <>Uscita registrata {formatOra(p.uscita_registrata_at)} · </>}
                {p.uscita_automatica && 'Uscita indicata manualmente · '}
                dispositivo {p.device_id}
              </div>
            </div>
            <SyncBadge stato={p.sync_stato} />
            <button className="btn btn-sm" onClick={() => setModifica(p)}><Pencil size={16} /> Correggi</button>
          </div>
        ))}
      </Card>

      <Card title="Ultimi giorni">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Giorno</th><th>Entrata</th><th>Uscita</th><th className="num">Netta</th><th className="num">Non attribuite</th><th>Stato</th></tr></thead>
            <tbody>
              {ultimi.map((d) => {
                const ps = s.workday.presenzeDelGiorno(u.id, d);
                if (!ps.length) return <tr key={d} className="weekend"><td>{formatData(d, { breve: true })}</td><td colSpan={5}>—</td></tr>;
                const rs = ps.map((p) => s.workday.riepilogo(p.id, now));
                return (
                  <tr key={d}>
                    <td>{formatData(d, { breve: true })}</td>
                    <td className="tabular">{formatOra(ps[0].entrata_at)}</td>
                    <td className="tabular">{formatOra(ps.at(-1)!.uscita_at)}</td>
                    <td className="num">{formatDurata(rs.reduce((a, r) => a + r.netta_ms, 0))}</td>
                    <td className="num">{formatDurata(rs.reduce((a, r) => a + r.non_attribuite_ms, 0))}</td>
                    <td>{rs.some((r) => r.anomalie.some((x) => x.gravita !== 'info')) ? <Badge tono="warn">Da controllare</Badge> : <Badge tono="ok">OK</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {modifica && <CorreggiPresenzaSheet p={modifica} onClose={() => setModifica(null)} />}
    </div>
  );
}
