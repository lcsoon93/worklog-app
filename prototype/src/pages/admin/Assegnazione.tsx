import { AlertTriangle, Crown, Save } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { formatData } from '../../domain/time';
import { Avatar, Badge, Card, Empty, PageHead } from '../../ui/components';
import { nomeCliente } from '../../ui/labels';

/** Selezione operai con verifica degli impegni sovrapposti nello stesso orario. */
export function SceltaSquadra({ data, ora, durata, selezionati, onChange, escludiInterventoId, responsabile, onResponsabile }: {
  data: string | null; ora: string | null; durata: number | null; selezionati: string[]; onChange: (ids: string[]) => void; escludiInterventoId?: string; responsabile?: string | null; onResponsabile?: (id: string) => void;
}) {
  const s = useData();
  const conflitti = data && ora ? s.planning.conflittiAssegnazione(data, ora, durata ?? 60, escludiInterventoId) : new Map();
  return (
    <div className="list" data-testid="scelta-squadra">
      {s.planning.operai().filter((o) => o.attivo).map((o) => {
        const on = selezionati.includes(o.id);
        const occupato = conflitti.get(o.id) ?? [];
        return (
          <div key={o.id} className="list-row" style={{ cursor: 'default' }}>
            <input type="checkbox" checked={on} style={{ width: 26, height: 26 }} aria-label={`Assegna ${o.nome}`} onChange={() => onChange(on ? selezionati.filter((x) => x !== o.id) : [...selezionati, o.id])} data-testid="squadra-check" />
            <Avatar p={o} />
            <div className="grow">
              <div className="title">{o.nome} {o.cognome}</div>
              <div className="subtle">{o.qualifica}</div>
              {occupato.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> Già impegnato: {occupato.map((i: { ora_inizio: string | null; cliente_id: string }) => `${i.ora_inizio} ${nomeCliente(s, i.cliente_id)}`).join(', ')}</div>}
            </div>
            {on && onResponsabile && (
              <button className={`chip ${responsabile === o.id ? 'on' : ''}`} onClick={() => onResponsabile(o.id)}><Crown size={16} /> Responsabile</button>
            )}
            {occupato.length > 0 ? <Badge tono="warn">Sovrapposizione</Badge> : <Badge tono="ok">Libero</Badge>}
          </div>
        );
      })}
    </div>
  );
}

export function Assegnazione() {
  const { id } = useParams();
  const s = useData();
  const { runOk } = useApp();
  const navigate = useNavigate();
  const i = s.db.get('interventi', id);
  const attuali = i ? s.planning.assegnati(i.id) : [];
  const [sel, setSel] = useState<string[]>(attuali.map((a) => a.operaio_id));
  const [resp, setResp] = useState<string | null>(attuali.find((a) => a.ruolo === 'responsabile')?.operaio_id ?? null);
  if (!i) return <Empty>Intervento non trovato.</Empty>;
  return (
    <div className="stack">
      <PageHead title="Assegnazione operai" eyebrow={`${i.codice} · ${nomeCliente(s, i.cliente_id)}`} back={{ to: `/interventi/${i.id}`, label: 'Scheda intervento' }}>
        <div className="muted" style={{ marginTop: 6 }}>{i.titolo} · {i.data_programmata ? `${formatData(i.data_programmata)} ore ${i.ora_inizio}` : 'da programmare'}</div>
      </PageHead>
      <Card title={`Squadra (${sel.length} selezionati)`} foot={<div className="row-between"><span className="subtle">Le sovrapposizioni sono un avviso: l'assegnazione resta possibile (es. interventi brevi in sequenza).</span><button className="btn btn-primary btn-lg" data-testid="salva-squadra" onClick={async () => { const ok = await runOk(() => s.planning.assegnaOperai(i.id, sel, resp && sel.includes(resp) ? resp : sel[0] ?? null), 'Squadra aggiornata'); if (ok) navigate(`/interventi/${i.id}`); }}><Save /> Salva squadra</button></div>}>
        <SceltaSquadra data={i.data_programmata} ora={i.ora_inizio} durata={i.durata_prevista_min} selezionati={sel} onChange={setSel} escludiInterventoId={i.id} responsabile={resp} onResponsabile={setResp} />
      </Card>
    </div>
  );
}
