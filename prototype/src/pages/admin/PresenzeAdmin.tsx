import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useData, useNow } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { addDays, formatData, formatOra, localDate } from '../../domain/time';
import { Avatar, Badge, Card, Empty, PageHead } from '../../ui/components';
import { DayDetail } from '../../ui/DayDetail';

/** Consultazione presenze: riepilogo di tutti gli operai in un giorno e dettaglio del singolo (sola lettura). */
export function PresenzeAdmin() {
  const s = useData();
  const now = useNow(5000);
  const [params, setParams] = useSearchParams();
  const data = params.get('data') ?? localDate(now);
  const operaioId = params.get('operaio') ?? '';
  const operai = s.planning.operai().filter((o) => o.attivo);
  const set = (patch: Record<string, string>) => setParams({ data, ...(operaioId ? { operaio: operaioId } : {}), ...patch });

  return (
    <div className="stack">
      <PageHead title="Presenze" eyebrow={formatData(data)} actions={<>
        <button className="btn icon-btn" aria-label="Giorno precedente" onClick={() => set({ data: addDays(data, -1) })}><ChevronLeft /></button>
        <input type="date" className="input" style={{ width: 180 }} value={data} onChange={(e) => e.target.value && set({ data: e.target.value })} aria-label="Data" />
        <button className="btn icon-btn" aria-label="Giorno successivo" onClick={() => set({ data: addDays(data, 1) })}><ChevronRight /></button>
      </>} />

      <Card title="Operai">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Operaio</th><th>Entrata</th><th>Uscita</th><th className="num">Pause</th><th className="num">Netta</th><th className="num">Attribuite</th><th className="num">Non attr.</th><th>Stato</th></tr></thead>
            <tbody>
              {operai.map((o) => {
                const ps = s.workday.presenzeDelGiorno(o.id, data);
                const rs = ps.map((p) => s.workday.riepilogo(p.id, now));
                const sum = (k: 'pause_ms' | 'netta_ms' | 'attribuite_ms' | 'non_attribuite_ms') => rs.reduce((a, r) => a + r[k], 0);
                const anom = rs.flatMap((r) => r.anomalie.filter((x) => x.gravita !== 'info'));
                return (
                  <tr key={o.id} className={`clickable ${operaioId === o.id ? 'weekend' : ''}`} onClick={() => set({ operaio: o.id })} data-testid="presenze-riga">
                    <td><div className="row" style={{ gap: 10 }}><Avatar p={o} size={32} /><strong>{o.nome} {o.cognome}</strong></div></td>
                    <td className="tabular">{ps.length ? formatOra(ps[0].entrata_at) : '—'}</td>
                    <td className="tabular">{ps.length ? (ps.at(-1)!.uscita_at ? formatOra(ps.at(-1)!.uscita_at) : 'in corso') : '—'}</td>
                    <td className="num">{ps.length ? formatDurata(sum('pause_ms')) : ''}</td>
                    <td className="num">{ps.length ? formatDurata(sum('netta_ms')) : ''}</td>
                    <td className="num">{ps.length ? formatDurata(sum('attribuite_ms')) : ''}</td>
                    <td className="num">{ps.length ? formatDurata(sum('non_attribuite_ms')) : ''}</td>
                    <td>{!ps.length ? <Badge>Assente</Badge> : anom.length ? <Badge tono="warn">{anom.length} anomalie</Badge> : <Badge tono="ok">OK</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {operaioId && (() => {
        const o = s.db.get('profili', operaioId);
        const ps = s.workday.presenzeDelGiorno(operaioId, data);
        return (
          <div className="stack">
            <h2>Giornata di {o?.nome} {o?.cognome}</h2>
            {ps.length === 0 ? <div className="card"><Empty>Nessuna presenza in questo giorno.</Empty></div> : ps.map((p) => <DayDetail key={p.id} presenzaId={p.id} editable={false} />)}
          </div>
        );
      })()}
    </div>
  );
}
