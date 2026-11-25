import { FilePlus2, FileText, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useUtente } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { formatData } from '../../domain/time';
import type { RapportinoEsito } from '../../domain/types';
import { ETICHETTE_ESITO } from '../../services/report-service';
import { Badge, Card, Empty, PageHead, Segmented, SyncBadge } from '../../ui/components';
import { nomeCliente, nomeOperaio } from '../../ui/labels';

export function Rapportini() {
  const s = useData();
  const u = useUtente();
  const admin = u.ruolo === 'admin';
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'tutti' | 'bozze' | 'seguito'>('tutti');
  const [operaio, setOperaio] = useState('');
  const [limite, setLimite] = useState(40);

  const lista = s.report.rapportini((r) => {
    if (!admin && !r.operai_ids.includes(u.id)) return false;
    if (admin && operaio && !r.operai_ids.includes(operaio)) return false;
    if (filtro === 'bozze' && r.stato !== 'bozza') return false;
    if (filtro === 'seguito' && !(r.esito === 'da_ultimare' || r.esito === 'ritorno_necessario')) return false;
    if (admin && r.stato === 'bozza' && r.redatto_da !== u.id) return false; // le bozze restano sul dispositivo dell'operaio
    if (q) {
      const t = `${r.numero ?? ''} ${r.numero_provvisorio} ${nomeCliente(s, r.cliente_id)} ${r.descrizione_lavoro}`.toLowerCase();
      if (!t.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const tono = (e: RapportinoEsito) => (e === 'completato' ? 'ok' : e === 'non_eseguito' ? 'danger' : 'warn');

  return (
    <div className="stack">
      <PageHead title="Rapportini" eyebrow={admin ? 'Tutti i rapportini' : 'I miei rapportini'} actions={!admin && <>
        <Link className="btn" to="/rapportini/nuovo?tipo=rapido"><FilePlus2 /> Rapido</Link>
        <Link className="btn btn-primary" to="/rapportini/nuovo?tipo=completo"><FileText /> Completo</Link>
      </>} />
      <div className="row">
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: 17, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingLeft: 40 }} placeholder="Cerca per numero, cliente, descrizione…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented value={filtro} onChange={setFiltro} options={[{ value: 'tutti', label: 'Tutti' }, { value: 'bozze', label: 'Bozze' }, { value: 'seguito', label: 'Con seguito' }]} />
        {admin && (
          <select className="select" style={{ width: 220 }} value={operaio} onChange={(e) => setOperaio(e.target.value)} aria-label="Filtra per operaio">
            <option value="">Tutti gli operai</option>
            {s.planning.operai().map((o) => <option key={o.id} value={o.id}>{o.nome} {o.cognome}</option>)}
          </select>
        )}
      </div>
      <Card title={`${lista.length} rapportini`}>
        {lista.length === 0 ? <Empty icon={<FileText />}>Nessun rapportino trovato.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Operai</th><th>Tipo</th><th className="num">Ore</th><th>Esito</th><th>Stato</th></tr></thead>
              <tbody>
                {lista.slice(0, limite).map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => (window.location.hash = `#/rapportini/${r.id}`)} data-testid="riga-rapportino">
                    <td><Link to={`/rapportini/${r.id}`} style={{ fontWeight: 700 }}>{r.numero ?? r.numero_provvisorio}</Link></td>
                    <td>{formatData(r.data_lavoro, { breve: true })}</td>
                    <td className="ellipsis" style={{ maxWidth: 220 }}>{nomeCliente(s, r.cliente_id)}</td>
                    <td className="ellipsis" style={{ maxWidth: 180 }}>{r.operai_ids.map((id) => nomeOperaio(s, id).split(' ')[0]).join(', ')}</td>
                    <td>{r.tipo}</td>
                    <td className="num">{formatDurata(s.report.oreRapportino(r))}</td>
                    <td><Badge tono={tono(r.esito)}>{ETICHETTE_ESITO[r.esito]}</Badge></td>
                    <td>{r.stato === 'bozza' ? <Badge>Bozza</Badge> : <SyncBadge stato={r.sync_stato} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lista.length > limite && <div className="card-foot"><button className="btn btn-block" onClick={() => setLimite(limite + 40)}>Mostra altri {Math.min(40, lista.length - limite)}</button></div>}
      </Card>
    </div>
  );
}
