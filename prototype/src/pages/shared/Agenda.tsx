import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData, useUtente } from '../../app/AppContext';
import { addDays, daysInMonth, etichettaMese, formatData, isWeekend, localDate, meseDi, parseDate, startOfWeek } from '../../domain/time';
import type { Intervento } from '../../domain/types';
import { Avatar, Card, Empty, InterventoBadge, PageHead, Segmented } from '../../ui/components';
import { nomeCliente, nomeSede } from '../../ui/labels';

type Vista = 'giorno' | 'settimana' | 'mese';

export function Agenda() {
  const s = useData();
  const u = useUtente();
  const navigate = useNavigate();
  const { vista = 'giorno' } = useParams<{ vista: Vista }>();
  const [params, setParams] = useSearchParams();
  const oggi = localDate(s.db.now());
  const data = params.get('data') ?? oggi;
  const admin = u.ruolo === 'admin';
  const [filtro, setFiltro] = useState<string | null>(null);
  const operai = s.planning.operai().filter((o) => o.attivo);

  const visibile = (i: Intervento) => {
    if (i.stato === 'annullato') return false;
    const squadra = s.planning.assegnati(i.id).map((a) => a.operaio_id);
    if (!admin) return squadra.includes(u.id);
    return !filtro || squadra.includes(filtro);
  };
  const delGiorno = (d: string) => s.planning.interventiDelGiorno(d).filter(visibile);
  const sposta = (dir: number) => {
    const n = vista === 'giorno' ? addDays(data, dir) : vista === 'settimana' ? addDays(data, dir * 7) : (() => { const d = parseDate(data); d.setMonth(d.getMonth() + dir, 1); return localDate(d.getTime()); })();
    setParams({ data: n });
  };
  const titolo = vista === 'giorno' ? formatData(data) : vista === 'settimana' ? `Settimana dal ${formatData(startOfWeek(data), { breve: true })}` : etichettaMese(meseDi(data).anno, meseDi(data).mese);
  const daProgrammare = admin ? s.db.where('interventi', (i) => i.stato === 'da_programmare') : [];

  return (
    <div className="stack">
      <PageHead title={titolo} eyebrow={admin ? 'Agenda interventi' : 'La mia agenda'} actions={<>
        <Segmented value={vista} onChange={(v) => navigate(`/agenda/${v}?data=${data}`)} options={[{ value: 'giorno', label: 'Giorno' }, { value: 'settimana', label: 'Settimana' }, { value: 'mese', label: 'Mese' }]} testId="agenda-vista" />
        <button className="btn icon-btn" aria-label="Precedente" onClick={() => sposta(-1)}><ChevronLeft /></button>
        <button className="btn" onClick={() => setParams({})}>Oggi</button>
        <button className="btn icon-btn" aria-label="Successivo" onClick={() => sposta(1)}><ChevronRight /></button>
        {admin && <Link className="btn btn-primary" to={`/admin/interventi/nuovo?data=${data}`} data-testid="nuovo-intervento"><Plus /> Nuovo intervento</Link>}
      </>} />

      {admin && (
        <div className="row">
          <button className={`chip ${!filtro ? 'on' : ''}`} onClick={() => setFiltro(null)}>Tutti</button>
          {operai.map((o) => <button key={o.id} className={`chip ${filtro === o.id ? 'on' : ''}`} onClick={() => setFiltro(o.id)}><span className="dot" style={{ color: o.colore }} /> {o.nome}</button>)}
        </div>
      )}

      {vista === 'giorno' && <VistaGiorno interventi={delGiorno(data)} admin={admin} />}
      {vista === 'settimana' && (
        <div className="week">
          {Array.from({ length: 5 }, (_, k) => addDays(startOfWeek(data), k)).map((d) => (
            <div key={d} className={`week-col ${d === oggi ? 'today' : ''}`}>
              <div className="wh"><span>{formatData(d, { breve: true })}</span><span className="subtle">{delGiorno(d).length}</span></div>
              {delGiorno(d).map((i) => (
                <Link key={i.id} to={`/interventi/${i.id}`} className={`ev-card ${i.tipo === 'ritorno' ? 'ritorno' : ''} ${i.stato}`}>
                  <div className="row-between"><strong className="tabular">{i.ora_inizio}</strong><Squadra id={i.id} /></div>
                  <div style={{ fontWeight: 650 }} className="ellipsis">{nomeCliente(s, i.cliente_id)}</div>
                  <div className="subtle ellipsis">{i.titolo}</div>
                </Link>
              ))}
              {delGiorno(d).length === 0 && <div className="empty subtle">Libero</div>}
            </div>
          ))}
        </div>
      )}
      {vista === 'mese' && (
        <div className="card card-pad">
          <div className="cal">
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((x) => <div key={x} className="cal-h">{x}</div>)}
            {(() => {
              const { anno, mese } = meseDi(data);
              const giorni = daysInMonth(anno, mese);
              const vuoti = (parseDate(giorni[0]).getDay() + 6) % 7;
              return [
                ...Array.from({ length: vuoti }, (_, i) => <div key={`v${i}`} />),
                ...giorni.map((d) => {
                  const ev = delGiorno(d);
                  return (
                    <button key={d} className={`cal-d ${isWeekend(d) ? 'we' : ''} ${d === oggi ? 'today' : ''}`} onClick={() => navigate(`/agenda/giorno?data=${d}`)}>
                      <span className="n">{parseDate(d).getDate()}</span>
                      {ev.slice(0, 3).map((i) => <span key={i.id} className={`cal-ev ${i.tipo === 'ritorno' ? 'ritorno' : ''} ${i.stato === 'completato' ? 'completato' : ''}`}>{i.ora_inizio} {nomeCliente(s, i.cliente_id)}</span>)}
                      {ev.length > 3 && <span className="subtle">+{ev.length - 3} altri</span>}
                    </button>
                  );
                }),
              ];
            })()}
          </div>
        </div>
      )}

      {admin && daProgrammare.length > 0 && (
        <Card title={`Da programmare (${daProgrammare.length})`}>
          {daProgrammare.map((i) => (
            <Link key={i.id} className="list-row" to={`/admin/interventi/${i.id}/modifica`}>
              <div className="grow"><div className="title">{nomeCliente(s, i.cliente_id)}</div><div className="subtle">{i.titolo}</div></div>
              <InterventoBadge stato={i.stato} />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function Squadra({ id }: { id: string }) {
  const s = useData();
  return (
    <span className="row" style={{ gap: 2 }}>
      {s.planning.assegnati(id).map((a) => { const p = s.db.get('profili', a.operaio_id); return p ? <Avatar key={a.id} p={p} size={24} /> : null; })}
    </span>
  );
}

function VistaGiorno({ interventi, admin }: { interventi: Intervento[]; admin: boolean }) {
  const s = useData();
  if (!interventi.length) return <div className="card"><Empty>Nessun intervento in programma.</Empty></div>;
  return (
    <Card title={`${interventi.length} interventi`}>
      {interventi.map((i) => (
        <Link key={i.id} className="list-row" to={`/interventi/${i.id}`} data-testid="agenda-intervento">
          <div style={{ width: 64 }}>
            <div className="tabular" style={{ fontWeight: 750, fontSize: '1.1rem' }}>{i.ora_inizio}</div>
            <div className="subtle">{i.durata_prevista_min ? `${Math.round(i.durata_prevista_min / 6) / 10} h` : ''}</div>
          </div>
          <div className="grow">
            <div className="title ellipsis">{nomeCliente(s, i.cliente_id)} {i.tipo === 'ritorno' && <span className="badge warn">Ritorno</span>}</div>
            <div className="subtle ellipsis">{i.codice} · {i.titolo} · {nomeSede(s, i.sede_id)}</div>
          </div>
          {admin && <Squadra id={i.id} />}
          <InterventoBadge stato={i.stato} />
        </Link>
      ))}
    </Card>
  );
}
