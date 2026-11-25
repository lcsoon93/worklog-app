import { AlertTriangle, CalendarPlus, ClipboardCheck, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useData, useNow } from '../../app/AppContext';
import { formatDurata, formatDurataSecondi } from '../../domain/hours-engine';
import { formatData, formatOra, localDate, toMs } from '../../domain/time';
import { Avatar, Badge, Card, Empty, InterventoBadge, PageHead, Stat } from '../../ui/components';
import { nomeCliente, nomeOperaio, titoloAttivita } from '../../ui/labels';

export function AdminHome() {
  const s = useData();
  const now = useNow(1000);
  const navigate = useNavigate();
  const oggi = localDate(now);
  const operai = s.planning.operai().filter((o) => o.attivo);
  const interventi = s.planning.interventiDelGiorno(oggi);
  const inAttesa = s.db.where('cartellini_mensili', (c) => c.stato === 'in_attesa_approvazione' || c.stato === 'confermato_operaio');
  const ritorni = s.db.where('followup', (f) => f.stato === 'aperto');
  const nonChiuse = s.db.where('presenze', (p) => p.uscita_at === null && p.data_lavoro < oggi);
  const stati = operai.map((o) => {
    const p = s.workday.presenzaAperta(o.id);
    const oggiP = s.workday.presenzeDelGiorno(o.id, oggi);
    const pres = p ?? oggiP.at(-1);
    return { o, p, pres, att: p ? s.workday.attivitaInCorso(p.id) : undefined, pausa: p ? s.workday.pausaInCorso(p.id) : undefined, r: pres ? s.workday.riepilogo(pres.id, now) : undefined };
  });
  const presenti = stati.filter((x) => x.p && x.p.data_lavoro === oggi).length;
  const daClassificare = stati.reduce((a, x) => a + (x.r?.da_classificare_ms ?? 0), 0);

  return (
    <div className="stack">
      <PageHead title="Dashboard aziendale" eyebrow={formatData(oggi)} actions={<>
        <Link className="btn" to="/admin/cartellini"><ClipboardCheck /> Cartellini</Link>
        <Link className="btn btn-primary" to={`/admin/interventi/nuovo?data=${oggi}`}><CalendarPlus /> Nuovo intervento</Link>
      </>} />

      <div className="grid-4">
        <Stat label="Operai presenti" value={`${presenti} / ${operai.length}`} sub={`${stati.filter((x) => x.att).length} con timer attivo`} testId="kpi-presenti" />
        <Stat label="Interventi oggi" value={interventi.length} sub={`${interventi.filter((i) => i.stato === 'completato').length} completati · ${interventi.filter((i) => i.stato === 'in_corso').length} in corso`} />
        <Stat label="Cartellini da approvare" value={inAttesa.length} tono={inAttesa.length ? 'warn' : undefined} />
        <Stat label="Ritorni da pianificare" value={ritorni.length} tono={ritorni.length ? 'warn' : undefined} />
      </div>

      {(nonChiuse.length > 0 || daClassificare > 0) && (
        <Card title={<h2 className="row" style={{ gap: 8 }}><AlertTriangle size={20} color="var(--warn)" /> Anomalie da verificare</h2>}>
          {nonChiuse.map((p) => (
            <Link key={p.id} className="list-row" to={`/admin/presenze?operaio=${p.operaio_id}&data=${p.data_lavoro}`}>
              <div className="grow"><div className="title">{nomeOperaio(s, p.operaio_id)}: giornata del {formatData(p.data_lavoro, { breve: true })} non chiusa</div><div className="subtle">Entrata {formatOra(p.entrata_at)} · ultimo segnale {formatOra(p.ultimo_segnale_at)}</div></div>
              <Badge tono="danger">Uscita mancante</Badge>
            </Link>
          ))}
          {daClassificare > 0 && <div className="list-row" style={{ cursor: 'default' }}><div className="grow"><div className="title">Attività senza cliente oggi: {formatDurata(daClassificare)}</div></div><Badge tono="warn">Da classificare</Badge></div>}
        </Card>
      )}

      <div className="split">
        <Card title="La squadra oggi">
          {stati.map(({ o, p, pres, att, pausa, r }) => (
            <button key={o.id} className="list-row" onClick={() => navigate(`/admin/presenze?operaio=${o.id}&data=${oggi}`)} data-testid="squadra-riga">
              <Avatar p={o} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">{o.nome} {o.cognome}</div>
                <div className="subtle ellipsis">
                  {!pres ? 'Non ha ancora timbrato' : !p ? `Uscito alle ${formatOra(pres.uscita_at)}` : pausa ? `In pausa dalle ${formatOra(pausa.inizio_at)}` : att ? `${titoloAttivita(s, att).titolo} · ${formatDurataSecondi(now - toMs(att.inizio_at))}` : `Presente dalle ${formatOra(p.entrata_at)} · nessun timer`}
                </div>
              </div>
              {r && <div style={{ textAlign: 'right' }}><div className="tabular" style={{ fontWeight: 750 }}>{formatDurata(r.netta_ms)}</div><div className="subtle tabular">{formatDurata(r.attribuite_ms)} attrib.</div></div>}
              {!pres ? <Badge>Assente</Badge> : !p ? <Badge tono="neutral">Uscito</Badge> : pausa ? <Badge tono="pause">Pausa</Badge> : att ? <Badge tono="ok"><span className="dot" /> Attivo</Badge> : <Badge tono="warn">Senza timer</Badge>}
            </button>
          ))}
        </Card>
        <div className="stack">
          <Card title="Da fare">
            {inAttesa.length === 0 && ritorni.length === 0 && <Empty>Niente in sospeso.</Empty>}
            {inAttesa.map((c) => (
              <Link key={c.id} className="list-row" to={`/admin/cartellini/${c.id}`} data-testid="todo-cartellino">
                <ClipboardCheck />
                <div className="grow"><div className="title">Cartellino {nomeOperaio(s, c.operaio_id)}</div><div className="subtle">{c.mese}/{c.anno} · versione {c.versione_corrente}</div></div>
                <Badge tono="info">Da approvare</Badge>
              </Link>
            ))}
            {ritorni.slice(0, 4).map((f) => (
              <Link key={f.id} className="list-row" to="/admin/ritorni">
                <RotateCcw />
                <div className="grow"><div className="title">{f.tipo === 'ritorno' ? 'Ritorno' : 'Da ultimare'}: {nomeCliente(s, f.cliente_id)}</div><div className="subtle ellipsis">{f.motivo}</div></div>
              </Link>
            ))}
          </Card>
          <Card title="Interventi di oggi" actions={<Link className="btn btn-sm btn-ghost" to="/agenda/giorno">Agenda</Link>}>
            {interventi.length === 0 ? <Empty>Nessun intervento.</Empty> : interventi.map((i) => (
              <Link key={i.id} className="list-row" to={`/interventi/${i.id}`}>
                <strong className="tabular" style={{ width: 48 }}>{i.ora_inizio}</strong>
                <div className="grow" style={{ minWidth: 0 }}><div className="title ellipsis">{nomeCliente(s, i.cliente_id)}</div><div className="subtle ellipsis">{s.planning.assegnati(i.id).map((a) => nomeOperaio(s, a.operaio_id).split(' ')[0]).join(', ')}</div></div>
                <InterventoBadge stato={i.stato} />
              </Link>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
