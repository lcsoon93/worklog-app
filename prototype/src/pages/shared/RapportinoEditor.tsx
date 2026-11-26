/**
 * Rapportino rapido e completo (creazione, bozza, completamento) e visualizzazione.
 * Le ore non si digitano: derivano dalle attività collegate (motore ore).
 */
import { Camera, CheckCircle2, Link2, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useData, useUtente } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { formatData, formatOra, toMs } from '../../domain/time';
import type { Rapportino, RapportinoEsito } from '../../domain/types';
import { ETICHETTE_ESITO } from '../../services/report-service';
import { Alert, Badge, Card, Empty, PageHead, SyncBadge } from '../../ui/components';
import { leggiFile } from '../../ui/files';
import { MaterialiEditor, MaterialiVista } from '../../ui/MaterialiRapportino';
import { IMPREVISTO_TIPO, nomeCliente, nomeOperaio, nomeSede, titoloAttivita } from '../../ui/labels';
import { SignaturePad } from '../../ui/SignaturePad';

export function RapportinoEditor() {
  const { id } = useParams();
  if (!id) return <NuovoRapportino />;
  return <RapportinoDettaglio id={id} />;
}

function NuovoRapportino() {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tipo = (params.get('tipo') as Rapportino['tipo']) ?? 'rapido';
  const intervento = s.db.get('interventi', params.get('intervento'));
  const [cliente, setCliente] = useState(intervento?.cliente_id ?? params.get('cliente') ?? '');
  const [sede, setSede] = useState(intervento?.sede_id ?? '');
  const creato = useRef(false);

  const crea = async (clienteId: string, sedeId: string | null) => {
    if (creato.current) return;
    creato.current = true;
    const r = await run(() => s.report.creaBozza({ tipo, cliente_id: clienteId, sede_id: sedeId, intervento_id: intervento?.id ?? null, followup_id: params.get('followup') }));
    if (r) navigate(`/rapportini/${r.id}`, { replace: true });
    else creato.current = false;
  };
  useEffect(() => {
    if (intervento || params.get('cliente')) void crea(intervento?.cliente_id ?? params.get('cliente')!, intervento?.sede_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (intervento || params.get('cliente')) return <div className="empty">Preparazione del rapportino…</div>;

  const sedi = cliente ? s.planning.sedi(cliente) : [];
  return (
    <div className="stack">
      <PageHead title={`Nuovo rapportino ${tipo}`} eyebrow="Rapportino autonomo" back={{ to: '/rapportini', label: 'Rapportini' }} />
      <Card title="Per quale cliente?" pad foot={<div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary btn-lg" disabled={!cliente} data-testid="rapportino-inizia" onClick={() => void crea(cliente, sede || null)}>Inizia rapportino</button></div>}>
        <div className="stack">
          <div className="choices">
            {s.planning.clienti().map((c) => (
              <button key={c.id} className={`choice ${cliente === c.id ? 'on' : ''}`} onClick={() => { setCliente(c.id); const sd = s.planning.sedi(c.id); setSede(sd.length === 1 ? sd[0].id : ''); }} data-testid="rapportino-cliente">{c.ragione_sociale}</button>
            ))}
          </div>
          {sedi.length > 1 && (
            <div className="field"><label htmlFor="r-sede">Sede</label>
              <select id="r-sede" className="select" value={sede} onChange={(e) => setSede(e.target.value)}><option value="">— Non indicata —</option>{sedi.map((x) => <option key={x.id} value={x.id}>{nomeSede(s, x.id)}</option>)}</select>
            </div>
          )}
          <p className="subtle">Il rapportino autonomo non è collegato a un intervento programmato. Per collegarlo, aprilo dalla scheda dell'intervento.</p>
        </div>
      </Card>
    </div>
  );
}

const ESITI: RapportinoEsito[] = ['completato', 'da_ultimare', 'ritorno_necessario', 'non_eseguito'];

function RapportinoDettaglio({ id }: { id: string }) {
  const s = useData();
  const u = useUtente();
  const salvato = s.db.get('rapportini', id);
  if (!salvato) return <Empty>Rapportino non trovato.</Empty>;
  const modificabile = salvato.stato === 'bozza' && salvato.redatto_da === u.id;
  return modificabile ? <FormRapportino iniziale={salvato} /> : <VistaRapportino r={salvato} />;
}

function FormRapportino({ iniziale }: { iniziale: Rapportino }) {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const [r, setR] = useState<Rapportino>(iniziale);
  const [errori, setErrori] = useState<string[]>([]);
  const set = (patch: Partial<Rapportino>) => setR((x) => ({ ...x, ...patch }));
  // Fase 7: se l'app va in secondo piano (chiamata, tablet bloccato) la bozza viene salvata
  // sul dispositivo, così una chiusura improvvisa non fa perdere quanto compilato.
  const ultimo = useRef(r);
  ultimo.current = r;
  useEffect(() => {
    const salva = () => {
      if (document.visibilityState !== 'hidden') return;
      const cur = s.db.get('rapportini', ultimo.current.id);
      if (cur?.stato === 'bozza' && JSON.stringify(cur) !== JSON.stringify({ ...cur, ...ultimo.current, updated_at: cur.updated_at, sync_stato: cur.sync_stato })) void s.report.salvaBozza(ultimo.current).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', salva);
    return () => document.removeEventListener('visibilitychange', salva);
  }, [s]);
  const suggerite = s.report.attivitaSuggerite(r);
  const intervento = s.db.get('interventi', r.intervento_id);
  const completo = r.tipo === 'completo';
  const serveNota = r.esito === 'da_ultimare' || r.esito === 'ritorno_necessario';
  const operai = s.planning.operai().filter((o) => o.attivo);

  const aggiungiFoto = async (f: File) => {
    const url = await leggiFile(f);
    const a = await run(() => s.report.aggiungiAllegato('foto', 'rapportino', r.id, f.name, f.type, url), 'Foto salvata sul dispositivo');
    if (a) set({ foto_ids: [...r.foto_ids, a.id] });
  };
  const firma = async (chi: 'cliente' | 'operaio', url: string) => {
    const a = await run(() => s.report.aggiungiAllegato('firma', 'rapportino', r.id, `firma-${chi}.png`, 'image/png', url), 'Firma acquisita');
    if (a) set(chi === 'cliente' ? { firma_cliente_id: a.id } : { firma_operaio_id: a.id });
  };

  return (
    <div className="stack">
      <PageHead title={`Rapportino ${r.tipo}`} eyebrow={`${r.numero_provvisorio} · bozza sul dispositivo`} back={{ to: '/rapportini', label: 'Rapportini' }} actions={<SyncBadge stato={r.sync_stato} />}>
        <div className="muted" style={{ marginTop: 6 }}>{nomeCliente(s, r.cliente_id)} {r.sede_id ? `· ${nomeSede(s, r.sede_id)}` : ''} · {formatData(r.data_lavoro)}</div>
      </PageHead>
      {intervento && <Alert tono="info">Collegato all'intervento <Link to={`/interventi/${intervento.id}`}>{intervento.codice} – {intervento.titolo}</Link>{r.followup_id ? ' (ritorno: completandolo con esito “Lavoro completato” il ritorno viene chiuso)' : ''}.</Alert>}
      {errori.length > 0 && <Alert tono="danger" title="Mancano alcune informazioni">{errori.join(' ')}</Alert>}

      <Card title="Lavoro svolto" pad>
        <div className="stack">
          <div className="field">
            <label htmlFor="r-desc">Descrizione</label>
            <textarea id="r-desc" className="textarea" value={r.descrizione_lavoro} onChange={(e) => set({ descrizione_lavoro: e.target.value })} placeholder="Cosa è stato fatto" data-testid="rapportino-descrizione" />
          </div>
          <div className="field"><span className="label">Esito</span>
            <div className="choices">
              {ESITI.map((e) => <button key={e} className={`choice ${r.esito === e ? 'on' : ''}`} onClick={() => set({ esito: e })} data-testid={`esito-${e}`}>{ETICHETTE_ESITO[e]}</button>)}
            </div>
          </div>
          {(serveNota || completo) && (
            <div className="field">
              <label htmlFor="r-note">{serveNota ? 'Cosa resta da fare (genera un ritorno collegato)' : 'Note interne'}</label>
              <textarea id="r-note" className="textarea" style={{ minHeight: 80 }} value={r.note_interne} onChange={(e) => set({ note_interne: e.target.value })} data-testid="rapportino-note" />
            </div>
          )}
        </div>
      </Card>

      <div className="split">
        <Card title="Ore dalle attività" actions={<strong className="tabular">{formatDurata(s.report.oreRapportino(r))}</strong>}>
          {suggerite.length === 0 ? <Empty>Nessuna attività registrata oggi su questo {r.intervento_id ? 'intervento' : 'cliente'}. Le ore si collegano dalle attività del timer.</Empty> : suggerite.map((a) => {
            const on = r.attivita_ids.includes(a.id);
            return (
              <label key={a.id} className="act" style={{ cursor: 'pointer' }}>
                <div className={`bar bg-${a.tipo}`} />
                <div><div style={{ fontWeight: 650 }}>{nomeOperaio(s, a.operaio_id)} · {titoloAttivita(s, a).titolo}</div><div className="subtle">{formatOra(a.inizio_at)} – {a.fine_at ? formatOra(a.fine_at) : 'in corso'}</div></div>
                <input type="checkbox" style={{ width: 24, height: 24 }} checked={on} onChange={() => set({ attivita_ids: on ? r.attivita_ids.filter((x) => x !== a.id) : [...r.attivita_ids, a.id] })} />
              </label>
            );
          })}
        </Card>
        <Card title="Operai presenti" pad>
          <div className="row">
            {operai.map((o) => {
              const on = r.operai_ids.includes(o.id);
              return <button key={o.id} className={`chip ${on ? 'on' : ''}`} disabled={o.id === r.redatto_da} onClick={() => set({ operai_ids: on ? r.operai_ids.filter((x) => x !== o.id) : [...r.operai_ids, o.id] })}>{o.nome} {o.cognome[0]}.</button>;
            })}
          </div>
        </Card>
      </div>

      {r.imprevisti_ids.length > 0 && (
        <Card title="Imprevisti collegati">
          {r.imprevisti_ids.map((iid) => { const i = s.db.get('imprevisti', iid); return i ? <div key={iid} className="list-row" style={{ cursor: 'default' }}><div className="grow"><div className="title">{IMPREVISTO_TIPO[i.tipo]}</div><div className="subtle">{i.descrizione}</div></div>{i.richiede_ritorno && <Badge tono="warn">Richiede ritorno</Badge>}</div> : null; })}
        </Card>
      )}

      <MaterialiEditor r={r} onChange={(materiali) => set({ materiali })} />

      <Card title="Foto" pad>
        <div className="row">
          <label className="btn"><Camera /> Scatta o allega<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void aggiungiFoto(e.target.files[0])} /></label>
          <div className="thumbs">{r.foto_ids.map((fid) => <img key={fid} src={s.db.get('allegati', fid)?.data_url} alt="Foto lavoro" />)}</div>
        </div>
      </Card>

      {completo && (
        <div className="grid-2">
          <Card title="Firma del cliente" pad>
            {r.firma_cliente_id ? <div className="stack-sm"><img src={s.db.get('allegati', r.firma_cliente_id)?.data_url} alt="Firma cliente" style={{ maxHeight: 140, background: '#fff', borderRadius: 10 }} /><button className="btn btn-sm" onClick={() => set({ firma_cliente_id: null })}>Rifai firma</button></div> : <SignaturePad onConfirm={(u) => void firma('cliente', u)} testId="firma-cliente" />}
            <div className="field" style={{ marginTop: 12 }}><label htmlFor="r-firmatario">Nome di chi firma</label><input id="r-firmatario" className="input" value={r.firma_cliente_nome} onChange={(e) => set({ firma_cliente_nome: e.target.value })} data-testid="firma-nome" /></div>
          </Card>
          <Card title="Firma dell'operaio" pad>
            {r.firma_operaio_id ? <img src={s.db.get('allegati', r.firma_operaio_id)?.data_url} alt="Firma operaio" style={{ maxHeight: 140, background: '#fff', borderRadius: 10 }} /> : <SignaturePad onConfirm={(u) => void firma('operaio', u)} />}
          </Card>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', position: 'sticky', bottom: 12 }}>
        <button className="btn btn-lg" data-testid="rapportino-salva-bozza" onClick={() => run(() => s.report.salvaBozza(r), 'Bozza salvata sul dispositivo')}><Save /> Salva bozza</button>
        <button className="btn btn-primary btn-lg" data-testid="rapportino-completa" onClick={async () => {
          const err = s.report.validaCompletamento(r);
          setErrori(err);
          if (err.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
          const ok = await run(() => s.report.completa(r), 'Rapportino completato e messo in coda di invio');
          if (ok) navigate(`/rapportini/${r.id}`, { replace: true });
        }}><CheckCircle2 /> Completa rapportino</button>
      </div>
    </div>
  );
}

function VistaRapportino({ r }: { r: Rapportino }) {
  const s = useData();
  const catena = s.report.catena(r.id)!;
  const ore = s.report.oreRapportino(r);
  return (
    <div className="stack">
      <PageHead title={`Rapportino ${r.numero ?? r.numero_provvisorio}`} eyebrow={`${r.tipo} · ${formatData(r.data_lavoro)}`} back={{ to: '/rapportini', label: 'Rapportini' }} actions={<SyncBadge stato={r.sync_stato} />}>
        <div className="row" style={{ marginTop: 8 }}>
          <Badge tono={r.esito === 'completato' ? 'ok' : 'warn'} testId="rapportino-esito">{ETICHETTE_ESITO[r.esito]}</Badge>
          <Badge>{r.stato}</Badge>
          {!r.numero && <span className="subtle">Numero definitivo assegnato dal server alla sincronizzazione (provvisorio {r.numero_provvisorio})</span>}
        </div>
      </PageHead>
      {catena.rapportinoOrigine && <Alert tono="warn" title="Rapportino di un ritorno">Origine: <Link to={`/rapportini/${catena.rapportinoOrigine.id}`}>{catena.rapportinoOrigine.numero ?? catena.rapportinoOrigine.numero_provvisorio}</Link> del {formatData(catena.rapportinoOrigine.data_lavoro)} — “{catena.origine?.motivo}”</Alert>}
      {catena.generati.map((f) => (
        <Alert key={f.id} tono="warn" title={f.tipo === 'ritorno' ? 'Ha generato un ritorno' : 'Lavoro da ultimare'}>
          “{f.motivo}” · stato: <strong>{f.stato}</strong>
          {f.intervento_ritorno_id && <> · <Link to={`/interventi/${f.intervento_ritorno_id}`}>intervento di ritorno</Link></>}
          {f.rapportino_chiusura_id && <> · chiuso dal <Link to={`/rapportini/${f.rapportino_chiusura_id}`}>rapportino</Link></>}
        </Alert>
      ))}
      <div className="split">
        <div className="stack">
          <Card title="Lavoro svolto" pad>
            <dl className="kv">
              <dt>Cliente</dt><dd>{nomeCliente(s, r.cliente_id)}</dd>
              <dt>Sede</dt><dd>{nomeSede(s, r.sede_id) || '—'}</dd>
              <dt>Intervento</dt><dd>{r.intervento_id ? <Link to={`/interventi/${r.intervento_id}`}>{s.db.get('interventi', r.intervento_id)?.codice}</Link> : 'Autonomo'}</dd>
              <dt>Operai</dt><dd>{r.operai_ids.map((x) => nomeOperaio(s, x)).join(', ')}</dd>
              <dt>Ore</dt><dd className="tabular" data-testid="rapportino-ore">{formatDurata(ore)}</dd>
            </dl>
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
