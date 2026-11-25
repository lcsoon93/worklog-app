import { Ban, FilePlus2, MapPin, Pencil, Play, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatEuro } from '../../ui/MaterialiRapportino';
import { useApp, useData, useUtente } from '../../app/AppContext';
import { calcolaDaRecord } from '../../domain/day-records';
import { formatDurata } from '../../domain/hours-engine';
import { formatData, formatOra } from '../../domain/time';
import { Avatar, Badge, Card, ConfirmSheet, Empty, InterventoBadge, PageHead, Stat, SyncBadge } from '../../ui/components';
import { IMPREVISTO_TIPO, nomeCliente, nomeOperaio } from '../../ui/labels';
import { ETICHETTE_ESITO } from '../../services/report-service';

export function InterventoScheda() {
  const { id } = useParams();
  const s = useData();
  const u = useUtente();
  const { run, runOk } = useApp();
  const [annulla, setAnnulla] = useState(false);
  const i = s.db.get('interventi', id);
  if (!i) return <Empty>Intervento non trovato.</Empty>;
  const admin = u.ruolo === 'admin';
  const sede = s.db.get('sedi_cliente', i.sede_id);
  const squadra = s.planning.assegnati(i.id);
  const rapportini = s.report.rapportini((r) => r.intervento_id === i.id);
  const imprevisti = s.db.where('imprevisti', (x) => x.intervento_id === i.id);
  const origine = i.followup_origine_id ? s.db.get('followup', i.followup_origine_id) : undefined;
  const generati = s.db.where('followup', (f) => f.intervento_origine_id === i.id);

  // Ore effettive sull'intervento: somma delle quote calcolate dal motore per ogni giornata coinvolta.
  const presenzeIds = [...new Set(s.db.where('attivita_lavoro', (a) => a.intervento_id === i.id).map((a) => a.presenza_id))];
  const perOperaio = new Map<string, number>();
  for (const pid of presenzeIds) {
    const p = s.db.get('presenze', pid);
    if (!p) continue;
    const r = calcolaDaRecord(p, s.db.all('pause_presenza'), s.db.where('attivita_lavoro', (a) => a.presenza_id === pid), s.db.now());
    const ms = r.per_intervento[i.id] ?? 0;
    perOperaio.set(p.operaio_id, (perOperaio.get(p.operaio_id) ?? 0) + ms);
  }
  const totale = [...perOperaio.values()].reduce((a, b) => a + b, 0);
  const aperta = !admin ? s.workday.presenzaAperta(u.id) : undefined;

  return (
    <div className="stack">
      <PageHead title={i.titolo} eyebrow={`${i.codice} · ${i.tipo}`} back={{ to: admin ? '/agenda/settimana' : '/op', label: admin ? 'Agenda' : 'Oggi' }} actions={admin ? <>
        <Link className="btn" to={`/admin/interventi/${i.id}/modifica`}><Pencil size={18} /> Modifica</Link>
        <Link className="btn" to={`/admin/interventi/${i.id}/assegna`} data-testid="btn-assegna"><Users size={18} /> Squadra</Link>
        {i.stato !== 'annullato' && i.stato !== 'completato' && <button className="btn btn-ghost" onClick={() => setAnnulla(true)}><Ban size={18} /> Annulla</button>}
      </> : <>
        {aperta && i.stato !== 'completato' && <button className="btn btn-primary" onClick={() => run(() => s.workday.avviaAttivita(aperta.id, { tipo: 'lavoro_cliente', intervento_id: i.id, cliente_id: null, sede_id: null, codice_interno: null, descrizione: '' }), 'Timer avviato')}><Play /> Avvia timer</button>}
        <Link className="btn" to={`/rapportini/nuovo?tipo=rapido&intervento=${i.id}`}><FilePlus2 /> Rapportino rapido</Link>
        <Link className="btn" to={`/rapportini/nuovo?tipo=completo&intervento=${i.id}`}><FilePlus2 /> Completo</Link>
      </>}>
        <div className="row" style={{ marginTop: 8 }}><InterventoBadge stato={i.stato} /><Badge tono={i.priorita === 'urgente' || i.priorita === 'alta' ? 'danger' : 'neutral'}>Priorità {i.priorita}</Badge><SyncBadge stato={i.sync_stato} /></div>
      </PageHead>

      {origine && (
        <div className="alert warn"><div className="small"><strong>Ritorno</strong> generato dal rapportino {(() => { const r = s.db.get('rapportini', origine.rapportino_origine_id); return r ? <Link to={`/rapportini/${r.id}`}>{r.numero ?? r.numero_provvisorio} del {formatData(r.data_lavoro)}</Link> : '—'; })()}: “{origine.motivo}”</div></div>
      )}

      <div className="grid-4">
        <Stat label="Data" value={i.data_programmata ? formatData(i.data_programmata, { breve: true }) : '—'} sub={i.ora_inizio ? `ore ${i.ora_inizio}` : 'da programmare'} />
        <Stat label="Durata prevista" value={i.durata_prevista_min ? formatDurata(i.durata_prevista_min * 60_000) : '—'} />
        <Stat label="Ore registrate" value={formatDurata(totale)} sub="dalle attività degli operai" />
        {admin ? <Stat label="Costo materiali" value={formatEuro(s.magazzino.riepilogoCosti({ interventoId: i.id }).costo)} sub={`${rapportini.length} rapportini`} testId="intervento-costo-materiali" /> : <Stat label="Rapportini" value={rapportini.length} />}
      </div>

      <div className="split">
        <div className="stack">
          <Card title="Cliente e sede" pad>
            <div className="stack-sm">
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{nomeCliente(s, i.cliente_id)}</div>
              {sede && <div className="row" style={{ gap: 6 }}><MapPin size={18} /> {sede.indirizzo}, {sede.cap} {sede.citta} ({sede.provincia}) · {sede.nome}</div>}
              {sede?.note_accesso && <div className="alert info"><div className="small"><strong>Accesso:</strong> {sede.note_accesso}</div></div>}
              {i.descrizione && <p className="muted" style={{ margin: 0 }}>{i.descrizione}</p>}
            </div>
          </Card>
          <Card title="Rapportini">
            {rapportini.length === 0 ? <Empty>Nessun rapportino.</Empty> : rapportini.map((r) => (
              <Link key={r.id} className="list-row" to={`/rapportini/${r.id}`}>
                <div className="grow"><div className="title">{r.numero ?? r.numero_provvisorio} · {formatData(r.data_lavoro, { breve: true })}</div><div className="subtle ellipsis">{r.descrizione_lavoro || 'Bozza'}</div></div>
                <Badge tono={r.esito === 'completato' ? 'ok' : 'warn'}>{ETICHETTE_ESITO[r.esito]}</Badge>
              </Link>
            ))}
          </Card>
          {(imprevisti.length > 0 || generati.length > 0) && (
            <Card title="Imprevisti e ritorni">
              {imprevisti.map((x) => <div key={x.id} className="list-row" style={{ cursor: 'default' }}><div className="grow"><div className="title">{IMPREVISTO_TIPO[x.tipo]} · {nomeOperaio(s, x.operaio_id)}</div><div className="subtle">{formatOra(x.avvenuto_at)} · {x.descrizione}</div></div><Badge tono={x.gravita === 'alta' ? 'danger' : 'warn'}>{x.gravita}</Badge></div>)}
              {generati.map((f) => <Link key={f.id} to={admin ? '/admin/ritorni' : `/rapportini/${f.rapportino_origine_id}`} className="list-row"><div className="grow"><div className="title">{f.tipo === 'ritorno' ? 'Ritorno' : 'Da ultimare'}: {f.motivo}</div><div className="subtle">Stato: {f.stato}</div></div></Link>)}
            </Card>
          )}
        </div>
        <Card title={`Squadra (${squadra.length})`} actions={admin && <Link className="btn btn-sm" to={`/admin/interventi/${i.id}/assegna`}>Modifica</Link>}>
          {squadra.length === 0 && <Empty>Nessun operaio assegnato.</Empty>}
          {squadra.map((a) => {
            const p = s.db.get('profili', a.operaio_id);
            return p ? (
              <div key={a.id} className="list-row" style={{ cursor: 'default' }}>
                <Avatar p={p} />
                <div className="grow"><div className="title">{p.nome} {p.cognome}</div><div className="subtle">{a.ruolo === 'responsabile' ? 'Responsabile' : 'Squadra'}</div></div>
                <strong className="tabular">{formatDurata(perOperaio.get(p.id) ?? 0)}</strong>
              </div>
            ) : null;
          })}
        </Card>
      </div>
      {annulla && <ConfirmSheet title="Annullare l'intervento?" tono="danger" conferma="Annulla intervento" motivazione="obbligatoria" onClose={() => setAnnulla(false)} onConfirm={async (m) => { const ok = await runOk(() => s.planning.cambiaStatoIntervento(i.id, 'annullato', m), 'Intervento annullato'); if (ok) setAnnulla(false); }} />}
    </div>
  );
}
