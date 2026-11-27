/**
 * Dettaglio di una presenza: totali, linea del tempo, ripartizione, anomalie, attività
 * con storico delle correzioni. In modalità "editable" offre correzione, divisione,
 * annullamento e inserimento di intervalli dimenticati (sempre con motivo).
 */
import { AlertTriangle, History, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData, useNow } from '../app/AppContext';
import { storicoAttivita } from '../domain/day-records';
import { formatDurata } from '../domain/hours-engine';
import { atLocal, formatOra, toIso, toMs } from '../domain/time';
import type { AttivitaLavoro } from '../domain/types';
import type { Destinazione } from '../services/workday-service';
import { CorreggiPresenzaSheet } from './CorreggiPresenzaSheet';
import { Alert, Badge, Card, ConfirmSheet, DayTimeline, Legend, Sheet, Stat, SyncBadge, type TimelineSeg } from './components';
import { DestinationPicker } from './DestinationPicker';
import { ANOMALIE, IMPREVISTO_TIPO, nomeCliente, TIPO_ATTIVITA, titoloAttivita } from './labels';

type AzioneAttivita = { tipo: 'correggi'; a: AttivitaLavoro } | { tipo: 'dividi'; a: AttivitaLavoro } | { tipo: 'aggiungi' };
type Azione = AzioneAttivita | { tipo: 'annulla'; a: AttivitaLavoro } | { tipo: 'presenza' } | null;

export function DayDetail({ presenzaId, editable }: { presenzaId: string; editable: boolean }) {
  const s = useData();
  const now = useNow(5000);
  const [storico, setStorico] = useState(false);
  const [azione, setAzione] = useState<Azione>(null);
  const { runOk } = useApp();
  const p = s.db.get('presenze', presenzaId);
  if (!p) return null;
  const r = s.workday.riepilogo(p.id, now);
  const tutte = s.workday.tutteLeAttivita(p.id);
  const visibili = storico ? tutte : tutte.filter((a) => !a.superata_da_id && !a.annullata);
  const pause = s.workday.pause(p.id);
  const dettaglio = new Map(r.attivita.map((d) => [d.id, d]));
  const segmenti: TimelineSeg[] = [
    ...pause.map((x) => ({ intervallo: { start: toMs(x.inizio_at), end: x.fine_at ? toMs(x.fine_at) : now }, classe: 'pausa', titolo: `Pausa ${formatOra(x.inizio_at)}` })),
    ...r.attivita.flatMap((d) => {
      const a = tutte.find((x) => x.id === d.id)!;
      return d.segmenti.map((seg) => ({ intervallo: seg, classe: a.tipo, titolo: `${titoloAttivita(s, a).titolo} ${formatOra(seg.start)}–${formatOra(seg.end)}` }));
    }),
  ];
  const finestra = r.finestra ?? { start: toMs(p.entrata_at), end: now };
  const imprevisti = s.db.where('imprevisti', (i) => i.presenza_id === p.id);
  // Storico delle correzioni alla presenza (entrata/uscita): dal registro modifiche, valore prima → dopo.
  const correzioniPresenza = s.db.audit().filter((a) => a.entita === 'presenze' && a.entita_id === p.id && a.azione === 'correzione');
  const rapportini = s.report.rapportini((x) => x.data_lavoro === p.data_lavoro && x.operai_ids.includes(p.operaio_id));
  const anomalie = r.anomalie.filter((a) => a.codice !== 'presenza_aperta' && a.codice !== 'timer_attivo');

  return (
    <div className="stack" data-testid="day-detail">
      <div className="grid-4">
        <Stat label="Presenza lorda" value={formatDurata(r.lorda_ms)} sub={`${formatOra(p.entrata_at)} → ${p.uscita_at ? formatOra(p.uscita_at) : 'in corso'}`} />
        <Stat label="Pause" value={formatDurata(r.pause_ms)} sub={`${pause.length} ${pause.length === 1 ? 'pausa' : 'pause'}`} />
        <Stat label="Presenza netta" value={formatDurata(r.netta_ms)} testId="dd-netta" />
        <Stat label="Attribuite / non attribuite" value={<span><span style={{ color: 'var(--ok)' }} data-testid="dd-attribuite">{formatDurata(r.attribuite_ms)}</span> <span className="subtle">/</span> <span style={{ color: r.non_attribuite_ms > 0 ? 'var(--warn)' : undefined }} data-testid="dd-non-attribuite">{formatDurata(r.non_attribuite_ms)}</span></span>} sub={r.da_classificare_ms ? `di cui ${formatDurata(r.da_classificare_ms)} da classificare` : undefined} />
      </div>

      <Card title="Linea del tempo" pad actions={editable && <button className="btn btn-sm" onClick={() => setAzione({ tipo: 'presenza' })}><Pencil size={16} /> Entrata/uscita</button>}>
        <div className="stack-sm">
          <DayTimeline finestra={finestra} segmenti={segmenti} />
          <Legend />
          {r.intervalli_scoperti.some((x) => x.end - x.start >= 60_000) && (
            <div className="subtle">Tempo senza attività: {r.intervalli_scoperti.filter((x) => x.end - x.start >= 60_000).map((x) => `${formatOra(x.start)}–${formatOra(x.end)}`).join(', ')}</div>
          )}
        </div>
      </Card>

      {storico && correzioniPresenza.length > 0 && (
        <Card title="Correzioni a entrata e uscita" pad>
          <div className="stack-sm" data-testid="storico-presenza">
            {correzioniPresenza.map((c) => {
              const prima = c.prima as { entrata_at?: string; uscita_at?: string | null } | null;
              const dopo = c.dopo as { entrata_at?: string; uscita_at?: string | null } | null;
              return (
                <div key={c.id} className="small">
                  <strong>{new Date(c.eseguita_at).toLocaleString('it-IT')}</strong> · entrata {formatOra(prima?.entrata_at)} → {formatOra(dopo?.entrata_at)}, uscita {formatOra(prima?.uscita_at ?? null)} → {formatOra(dopo?.uscita_at ?? null)} · motivo: {c.motivo}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {anomalie.length > 0 && (
        <Card title={<h2 className="row" style={{ gap: 8 }}><AlertTriangle size={20} color="var(--warn)" /> Da controllare ({anomalie.length})</h2>} pad>
          <div className="stack-sm" data-testid="anomalie">
            {anomalie.map((a, i) => (
              <div key={i} className="row" style={{ gap: 10 }}>
                <Badge tono={a.gravita === 'errore' ? 'danger' : a.gravita === 'avviso' ? 'warn' : 'info'}>{ANOMALIE[a.codice]}</Badge>
                <span className="small">{a.messaggio}{a.durata_ms ? ` (${formatDurata(a.durata_ms)})` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="split">
        <Card
          title="Attività"
          actions={<>
            <button className={`btn btn-sm ${storico ? 'btn-soft' : 'btn-ghost'}`} onClick={() => setStorico(!storico)} data-testid="toggle-storico"><History size={16} /> Storico correzioni</button>
            {editable && <button className="btn btn-sm" onClick={() => setAzione({ tipo: 'aggiungi' })} data-testid="btn-aggiungi-intervallo"><Plus size={16} /> Aggiungi</button>}
          </>}
        >
          {visibili.length === 0 && <div className="empty">Nessuna attività registrata.</div>}
          {visibili.map((a) => {
            const t = titoloAttivita(s, a);
            const d = dettaglio.get(a.id);
            const superata = !!a.superata_da_id || a.annullata;
            return (
              <div key={a.id} className={`act ${superata ? 'superata' : ''}`} data-testid="attivita-riga">
                <div className={`bar bg-${a.tipo}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="title ellipsis" style={{ fontWeight: 650 }}>{t.titolo}</div>
                  <div className="subtle">
                    {formatOra(a.inizio_at)} – {a.fine_at ? formatOra(a.fine_at) : 'in corso'} · {TIPO_ATTIVITA[a.tipo]}
                    {a.origine !== 'timer' && <> · <Badge tono="info">{a.origine === 'manuale' ? 'Inserita a mano' : a.origine === 'divisione' ? 'Da divisione' : 'Corretta'}</Badge></>}
                    {a.chiusura_automatica && <> · <Badge tono="warn">Chiusa automaticamente</Badge></>}
                    {a.annullata && <> · <Badge tono="danger">Annullata</Badge></>}
                    {a.superata_da_id && <> · <Badge>Sostituita</Badge></>}
                  </div>
                  {a.motivo_correzione && <div className="subtle">Motivo: {a.motivo_correzione}</div>}
                  {storico && a.sostituisce_id && <div className="subtle">Catena: {storicoAttivita(a.id, tutte).length - 1} versioni precedenti</div>}
                  {editable && !superata && a.fine_at && (
                    <div className="row" style={{ marginTop: 8, gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => setAzione({ tipo: 'correggi', a })} data-testid="btn-correggi"><Pencil size={15} /> Correggi</button>
                      <button className="btn btn-sm" onClick={() => setAzione({ tipo: 'dividi', a })} data-testid="btn-dividi"><Scissors size={15} /> Dividi</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setAzione({ tipo: 'annulla', a })}><Trash2 size={15} /> Annulla</button>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tabular" style={{ fontWeight: 750 }}>{superata ? '—' : formatDurata(d?.effettiva_ms ?? 0)}</div>
                  {d && d.effettiva_ms !== d.registrata_ms && !superata && <div className="subtle tabular">reg. {formatDurata(d.registrata_ms)}</div>}
                  <SyncBadge stato={a.sync_stato} />
                </div>
              </div>
            );
          })}
        </Card>

        <div className="stack">
          <Card title="Ripartizione" pad>
            <div className="stack-sm">
              {Object.entries(r.per_cliente).map(([id, ms]) => <div key={id} className="row-between"><span>{nomeCliente(s, id)}</span><strong className="tabular">{formatDurata(ms)}</strong></div>)}
              {Object.entries(r.per_codice_interno).map(([k, ms]) => <div key={k} className="row-between"><span>Interna · {titoloAttivita(s, { tipo: 'interna', codice_interno: k as AttivitaLavoro['codice_interno'], cliente_id: null, intervento_id: null, sede_id: null }).titolo}</span><strong className="tabular">{formatDurata(ms)}</strong></div>)}
              {r.da_classificare_ms > 0 && <div className="row-between"><span>Da classificare</span><strong className="tabular" style={{ color: 'var(--warn)' }}>{formatDurata(r.da_classificare_ms)}</strong></div>}
              <div className="row-between"><span>Senza attività</span><strong className="tabular">{formatDurata(r.scoperta_ms)}</strong></div>
              {Object.keys(r.per_intervento).length > 0 && <div className="divider" />}
              {Object.entries(r.per_intervento).map(([id, ms]) => {
                const i = s.db.get('interventi', id);
                return <div key={id} className="row-between" data-testid="ripartizione-intervento"><span className="small">{i ? <Link to={`/interventi/${i.id}`}>{i.codice}</Link> : 'Intervento'} · {i?.titolo}</span><strong className="tabular">{formatDurata(ms)}</strong></div>;
              })}
            </div>
          </Card>
          {(imprevisti.length > 0 || rapportini.length > 0) && (
            <Card title="Documenti del giorno">
              <div className="list">
                {rapportini.map((x) => (
                  <Link key={x.id} className="list-row" to={`/rapportini/${x.id}`}>
                    <div className="grow"><div className="title">{x.numero ?? x.numero_provvisorio} · {nomeCliente(s, x.cliente_id)}</div><div className="subtle">Rapportino {x.tipo} · {x.stato}</div></div>
                  </Link>
                ))}
                {imprevisti.map((i) => (
                  <div key={i.id} className="list-row" style={{ cursor: 'default' }}>
                    <div className="grow"><div className="title">Imprevisto: {IMPREVISTO_TIPO[i.tipo]}</div><div className="subtle">{formatOra(i.avvenuto_at)} · {i.descrizione}</div></div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {azione?.tipo === 'presenza' && <CorreggiPresenzaSheet p={p} onClose={() => setAzione(null)} />}
      {azione?.tipo === 'annulla' && (
        <ConfirmSheet title="Annulla attività" tono="danger" conferma="Annulla attività" motivazione="obbligatoria" message="L'attività non conterà più nelle ore ma resterà visibile nello storico." onClose={() => setAzione(null)}
          onConfirm={async (m) => { const ok = await runOk(() => s.workday.annullaAttivita(azione.a.id, m), 'Attività annullata'); if (ok) setAzione(null); }} />
      )}
      {(azione?.tipo === 'correggi' || azione?.tipo === 'aggiungi' || azione?.tipo === 'dividi') && (
        <ActivitySheet azione={azione} presenzaId={p.id} data={p.data_lavoro} operaioId={p.operaio_id} onClose={() => setAzione(null)} />
      )}
    </div>
  );
}

function hhmm(iso: string | null): string {
  return iso ? formatOra(iso) : '';
}

/** Ora 'HH:MM' → istante, considerando che un turno può proseguire dopo mezzanotte. */
function istante(data: string, ora: string, entrataIso: string): number {
  let t = atLocal(data, ora);
  if (t < toMs(entrataIso)) t += 86400_000;
  return t;
}

function ActivitySheet({ azione, presenzaId, data, operaioId, onClose }: { azione: AzioneAttivita; presenzaId: string; data: string; operaioId: string; onClose: () => void }) {
  const { s, run } = useApp();
  const p = s.db.get('presenze', presenzaId)!;
  const a = 'a' in azione ? azione.a : null;
  const [dest, setDest] = useState<Destinazione | null>(a && azione.tipo === 'correggi' ? { tipo: a.tipo, cliente_id: a.cliente_id, sede_id: a.sede_id, intervento_id: a.intervento_id, codice_interno: a.codice_interno, descrizione: a.descrizione } : null);
  const [inizio, setInizio] = useState(a ? hhmm(a.inizio_at) : '');
  const [fine, setFine] = useState(a ? hhmm(a.fine_at) : '');
  const [divisione, setDivisione] = useState('');
  const [motivo, setMotivo] = useState('');
  const titolo = azione.tipo === 'correggi' ? 'Correggi attività' : azione.tipo === 'dividi' ? 'Dividi intervallo' : 'Aggiungi intervallo dimenticato';

  const salva = async () => {
    let ok: unknown;
    if (azione.tipo === 'correggi' && a) {
      ok = await run(() => s.workday.correggiAttivita(a.id, { ...(dest ?? {}), inizio_at: toIso(istante(data, inizio, p.entrata_at)), fine_at: toIso(istante(data, fine, p.entrata_at)) }, motivo), 'Correzione salvata');
    } else if (azione.tipo === 'dividi' && a) {
      ok = await run(() => s.workday.dividiAttivita(a.id, istante(data, divisione, p.entrata_at), dest ?? {}, motivo), 'Intervallo diviso');
    } else {
      ok = await run(() => s.workday.aggiungiAttivita(presenzaId, dest!, istante(data, inizio, p.entrata_at), istante(data, fine, p.entrata_at), motivo), 'Intervallo aggiunto');
    }
    if (ok !== undefined) onClose();
  };
  const pronto = motivo.trim() && (azione.tipo === 'dividi' ? divisione : inizio && fine) && (azione.tipo !== 'aggiungi' || dest);

  return (
    <Sheet title={titolo} wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={!pronto} onClick={() => void salva()} data-testid="activity-salva">Salva</button>
    </>}>
      {a && <Alert tono="info">Originale: <strong>{titoloAttivita(s, a).titolo}</strong> {formatOra(a.inizio_at)}–{formatOra(a.fine_at)}. Il dato originale non viene cancellato: resta nello storico delle correzioni.</Alert>}
      {azione.tipo === 'dividi' ? (
        <div className="field"><label htmlFor="a-div">Dividi alle ore</label><input id="a-div" type="time" className="input" value={divisione} onChange={(e) => setDivisione(e.target.value)} data-testid="activity-divisione" /><div className="hint">La prima parte mantiene la destinazione originale. Scegli sotto la destinazione della seconda parte (se non scegli nulla resta uguale).</div></div>
      ) : (
        <div className="grid-2">
          <div className="field"><label htmlFor="a-in">Inizio</label><input id="a-in" type="time" className="input" value={inizio} onChange={(e) => setInizio(e.target.value)} data-testid="activity-inizio" /></div>
          <div className="field"><label htmlFor="a-fi">Fine</label><input id="a-fi" type="time" className="input" value={fine} onChange={(e) => setFine(e.target.value)} data-testid="activity-fine" /></div>
        </div>
      )}
      <div className="field"><span className="label">{azione.tipo === 'dividi' ? 'Destinazione della seconda parte' : 'Destinazione'}</span>
        <DestinationPicker value={dest} onChange={setDest} operaioId={operaioId} data={data} escludiDaDefinire={azione.tipo !== 'correggi'} />
      </div>
      <div className="field"><label htmlFor="a-mot">Motivo (obbligatorio)</label><input id="a-mot" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Es. dimenticato di cambiare cliente" data-testid="activity-motivo" /></div>
    </Sheet>
  );
}
