/** Rapporto in sola lettura con azioni di approvazione, restituzione e correzione (amministratore). */
import { Link2, Pencil, ShieldCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useData, useUtente } from '../../../app/AppContext';
import { formatDurata } from '../../../domain/hours-engine';
import { formatData, formatOra, toMs } from '../../../domain/time';
import type { Rapportino } from '../../../domain/types';
import { ETICHETTE_ESITO } from '../../../services/report-service';
import { Alert, Badge, Card, ConfirmSheet, Empty, PageHead, SyncBadge } from '../../../ui/components';
import { MaterialiVista } from '../../../ui/MaterialiRapportino';
import { nomeCliente, nomeOperaio, nomeSede } from '../../../ui/labels';
import { FaseBadge } from './FaseBadge';

export function VistaRapportino({ r }: { r: Rapportino }) {
  const s = useData();
  const u = useUtente();
  const { run } = useApp();
  const navigate = useNavigate();
  const autonomo = !r.intervento_id;
  const completato = r.stato === 'completato' || r.stato === 'firmato';
  const fase = s.report.fase(r);
  const [restituisci, setRestituisci] = useState(false);
  const catena = s.report.catena(r.id)!;
  const ore = s.report.oreRapportino(r);
  return (
    <div className="stack">
      <PageHead title={`Rapportino ${r.numero ?? r.numero_provvisorio}`} eyebrow={`${r.tipo} · ${formatData(r.data_lavoro)}`} back={{ to: '/rapportini', label: 'Rapportini' }} actions={<SyncBadge stato={r.sync_stato} />}>
        <div className="row" style={{ marginTop: 8 }}>
          <Badge tono={r.esito === 'completato' ? 'ok' : 'warn'} testId="rapportino-esito">{ETICHETTE_ESITO[r.esito]}</Badge>
          <Badge>{r.stato}</Badge>
          {autonomo && <Badge tono="info" testId="badge-autonomo">Intervento autonomo</Badge>}
          {completato && <FaseBadge fase={fase} />}
          {(r.revisione ?? 0) > 0 && <Badge tono="info">Revisione {r.revisione}</Badge>}
          {!r.numero && <span className="subtle">Numero definitivo assegnato dal server alla sincronizzazione (provvisorio {r.numero_provvisorio})</span>}
        </div>
      </PageHead>
      {u.ruolo === 'admin' && completato && (
        <Card title={fase === 'inviato' ? 'Rapporto da approvare' : 'Gestione del rapporto'} pad testId="azioni-approvazione">
          <div className="stack-sm">
            {fase === 'inviato' && <p className="muted" style={{ margin: 0 }}>Controlla cliente, orari, materiali, foto e firma. Puoi approvarlo o restituirlo a {nomeOperaio(s, r.redatto_da)} per correzioni.</p>}
            {fase === 'da_correggere' && <p className="muted" style={{ margin: 0 }}>Restituito per correzioni: “{r.motivo_restituzione}”. In attesa del redattore.</p>}
            <div className="row">
              {fase === 'inviato' && <button className="btn btn-primary" data-testid="rapportino-approva" onClick={() => run(() => s.report.approva(r.id), 'Rapporto approvato')}><ShieldCheck /> Approva</button>}
              {fase === 'inviato' && <button className="btn" data-testid="rapportino-restituisci" onClick={() => setRestituisci(true)}><Undo2 /> Restituisci per correzioni</button>}
              <button className="btn btn-ghost" data-testid="rapportino-correggi" onClick={() => navigate(`/rapportini/${r.id}?correggi=1`)}><Pencil /> Correzione tracciata</button>
            </div>
          </div>
        </Card>
      )}
      {u.ruolo !== 'admin' && fase === 'inviato' && <Alert tono="info">Inviato all'amministrazione il {r.inviato_at ? new Date(toMs(r.inviato_at)).toLocaleString('it-IT') : '—'}: in attesa di approvazione. Per modificarlo serve la restituzione dell'amministrazione.</Alert>}
      {fase === 'approvato' && <Alert tono="ok">Approvato da {nomeOperaio(s, r.verificato_da ?? null)}{r.verificato_at ? ` il ${new Date(toMs(r.verificato_at)).toLocaleString('it-IT')}` : ''}. Eventuali modifiche solo con correzione tracciata.</Alert>}
      {restituisci && <ConfirmSheet title="Restituire il rapporto?" message={`Il rapporto torna a ${nomeOperaio(s, r.redatto_da)} da correggere e reinviare.`} conferma="Restituisci" motivazione="obbligatoria" testId="conferma-restituzione" onClose={() => setRestituisci(false)} onConfirm={async (m) => { const ok = await run(() => s.report.restituisci(r.id, m), 'Rapporto restituito per correzioni'); if (ok) setRestituisci(false); }} />}
      <StoricoRapporto id={r.id} />
      {catena.rapportinoOrigine && <Alert tono="warn" title="Rapportino di un ritorno">Origine: <Link to={`/rapportini/${catena.rapportinoOrigine.id}`}>{catena.rapportinoOrigine.numero ?? catena.rapportinoOrigine.numero_provvisorio}</Link> del {formatData(catena.rapportinoOrigine.data_lavoro)} — “{catena.origine?.motivo}”</Alert>}
      {catena.generati.map((f) => (
        <Alert key={f.id} tono="warn" title={f.tipo === 'ritorno' ? 'Ha generato un ritorno' : 'Lavoro da ultimare'}>
          “{f.motivo}” · stato: <strong>{f.stato}</strong>
          {f.intervento_ritorno_id && <> · <Link to={`/interventi/${f.intervento_ritorno_id}`}>intervento di ritorno</Link></>}
          {f.rapportino_chiusura_id && <> · chiuso dal <Link to={`/rapportini/${f.rapportino_chiusura_id}`}>rapportino</Link></>}
          {u.ruolo === 'operaio' && f.stato === 'aperto' && <div style={{ marginTop: 8 }}><button className="btn btn-sm" data-testid="apri-rapporto-ritorno" onClick={() => navigate(`/rapportini/nuovo?tipo=${r.tipo}&cliente=${r.cliente_id}${r.sede_id ? `&sede=${r.sede_id}` : ''}&followup=${f.id}`)}>Apri il rapporto del ritorno</button></div>}
        </Alert>
      ))}
      <div className="split">
        <div className="stack">
          <Card title="Lavoro svolto" pad>
            <dl className="kv">
              <dt>Cliente</dt><dd>{nomeCliente(s, r.cliente_id)}</dd>
              <dt>Sede</dt><dd>{nomeSede(s, r.sede_id) || '—'}</dd>
              <dt>Intervento</dt><dd>{r.intervento_id ? <Link to={`/interventi/${r.intervento_id}`}>{s.db.get('interventi', r.intervento_id)?.codice}</Link> : 'Autonomo'}</dd>
              {r.indirizzo_intervento && <><dt>Indirizzo</dt><dd>{r.indirizzo_intervento}</dd></>}
              <dt>Operai</dt><dd>{r.operai_ids.map((x) => nomeOperaio(s, x)).join(', ')}</dd>
              <dt>Ore</dt><dd className="tabular" data-testid="rapportino-ore">{formatDurata(ore)}</dd>
            </dl>
            {r.richiesta && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}><strong>Richiesta:</strong> {r.richiesta}</p>}
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.descrizione_lavoro}</p>
            {r.note_interne && <p className="muted">Note: {r.note_interne}</p>}
          </Card>
          <MaterialiVista r={r} />
        </div>
        <div className="stack">
          <Card title="Attività collegate">
            {r.attivita_ids.length === 0 ? <Empty>Nessuna.</Empty> : r.attivita_ids.map((aid) => { const a = s.db.get('attivita_lavoro', aid); return a ? <div key={aid} className="act"><div className={`bar bg-${a.tipo}`} /><div><div style={{ fontWeight: 650 }}>{nomeOperaio(s, a.operaio_id)}</div><div className="subtle">{formatOra(a.inizio_at)}–{a.fine_at ? formatOra(a.fine_at) : '…'} {a.superata_da_id ? '(corretta)' : ''}</div></div><Link2 size={16} /></div> : null; })}
          </Card>
          {(r.foto_ids.length > 0 || r.firma_cliente_id || r.firma_operaio_id) && (
            <Card title="Foto e firme" pad>
              <div className="thumbs">{r.foto_ids.map((fid) => <img key={fid} src={s.db.get('allegati', fid)?.data_url} alt="Foto" />)}</div>
              {r.firma_cliente_id && <div style={{ marginTop: 12 }}><div className="subtle">Firma di {r.firma_cliente_nome}</div><img src={s.db.get('allegati', r.firma_cliente_id)?.data_url} alt="Firma cliente" style={{ maxHeight: 100, background: '#fff', borderRadius: 8 }} /></div>}
              {r.firma_operaio_id && <div style={{ marginTop: 12 }}><div className="subtle">Firma dell'operaio ({nomeOperaio(s, r.redatto_da)})</div><img src={s.db.get('allegati', r.firma_operaio_id)?.data_url} alt="Firma operaio" style={{ maxHeight: 100, background: '#fff', borderRadius: 8 }} /></div>}
            </Card>
          )}
          <Card title="Tracciabilità" pad>
            <dl className="kv small">
              <dt>Creato</dt><dd>{new Date(toMs(r.created_at)).toLocaleString('it-IT')}</dd>
              <dt>Redatto da</dt><dd>{nomeOperaio(s, r.redatto_da)}</dd>
              <dt>Dispositivo</dt><dd>{r.device_id}</dd>
              <dt>Versione server</dt><dd>{r.row_version || 'non ancora ricevuta'}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Storico delle modifiche del rapporto (audit): invio, restituzioni, correzioni, approvazione. */
function StoricoRapporto({ id }: { id: string }) {
  const s = useData();
  const voci = s.db.audit().filter((a) => a.entita === 'rapportini' && a.entita_id === id && a.azione !== 'crea' && (a.azione !== 'modifica' || a.motivo));
  if (voci.length === 0) return null;
  const AZ: Record<string, string> = { modifica: 'Modifica', correzione: 'Correzione', transizione: 'Cambio di stato', elimina: 'Eliminazione', crea: 'Creazione' };
  return (
    <Card title="Storico del rapporto" testId="storico-rapporto">
      <div className="list">
        {voci.map((a) => (
          <div key={a.id} className="list-row" style={{ cursor: 'default' }}>
            <div className="grow"><div className="title">{AZ[a.azione] ?? a.azione}{a.motivo ? `: ${a.motivo}` : ''}</div><div className="subtle">{nomeOperaio(s, a.utente_id)} · {new Date(toMs(a.eseguita_at)).toLocaleString('it-IT')}</div></div>
          </div>
        ))}
      </div>
    </Card>
  );
}
