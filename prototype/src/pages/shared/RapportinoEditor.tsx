/**
 * Rapportino rapido e completo (creazione, bozza, completamento) e visualizzazione.
 * Le ore non si digitano: derivano dalle attività collegate (motore ore).
 */
import { Camera, CheckCircle2, Link2, Play, Plus, Save, Search, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useData, useNow, useUtente } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { atLocal, formatData, formatOra, localDate, toMs } from '../../domain/time';
import type { AttivitaLavoro, Rapportino, RapportinoEsito } from '../../domain/types';
import { AppError } from '../../services/errors';
import { ETICHETTE_ESITO } from '../../services/report-service';
import { Alert, Badge, Card, Empty, PageHead, Segmented, Sheet, SyncBadge } from '../../ui/components';
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
  const u = useUtente();
  const { run } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intervento = s.db.get('interventi', params.get('intervento'));
  const [tipo, setTipo] = useState<Rapportino['tipo']>((params.get('tipo') as Rapportino['tipo']) ?? 'completo');
  const [cliente, setCliente] = useState(intervento?.cliente_id ?? params.get('cliente') ?? '');
  const [sede, setSede] = useState(intervento?.sede_id ?? params.get('sede') ?? '');
  const [altroIndirizzo, setAltroIndirizzo] = useState(false);
  const [indirizzo, setIndirizzo] = useState('');
  const [richiesta, setRichiesta] = useState('');
  const [cerca, setCerca] = useState('');
  const [nuovoCliente, setNuovoCliente] = useState(false);
  const creato = useRef(false);

  const crea = async (clienteId: string, sedeId: string | null) => {
    if (creato.current) return;
    creato.current = true;
    const r = await run(() => s.report.creaBozza({ tipo, cliente_id: clienteId, sede_id: sedeId, intervento_id: intervento?.id ?? null, followup_id: params.get('followup'), richiesta, indirizzo_intervento: sedeId ? '' : indirizzo }));
    if (r) navigate(`/rapportini/${r.id}`, { replace: true });
    else creato.current = false;
  };
  useEffect(() => {
    if (intervento || params.get('cliente')) void crea(intervento?.cliente_id ?? params.get('cliente')!, intervento?.sede_id ?? (params.get('sede') || null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (intervento || params.get('cliente')) return <div className="empty">Preparazione del rapportino…</div>;

  const sedi = cliente ? s.planning.sedi(cliente) : [];
  const scegliCliente = (id: string) => { setCliente(id); const sd = s.planning.sedi(id); setSede(sd.length === 1 ? sd[0].id : ''); setAltroIndirizzo(false); };
  const q = cerca.trim().toLowerCase();
  const clienti = s.planning.clienti().filter((c) => c.attivo !== false && (!q || c.ragione_sociale.toLowerCase().includes(q) || c.id === cliente));
  const puoCreare = u.ruolo === 'admin' || s.planning.operaiCreanoClienti();
  const serveIndirizzo = !!cliente && (sedi.length === 0 || altroIndirizzo);
  const pronto = !!cliente && (!serveIndirizzo || indirizzo.trim().length >= 3 || sedi.length === 0);

  return (
    <div className="stack modulo-mobile">
      <PageHead title="Nuovo rapporto di lavoro" eyebrow="Intervento autonomo" back={{ to: u.ruolo === 'admin' ? '/rapportini' : '/op', label: u.ruolo === 'admin' ? 'Rapportini' : 'Oggi' }} />
      <Alert tono="info">Per un lavoro non programmato (es. richiesta telefonica). Non serve un intervento assegnato: il rapporto sarà verificato dall'amministratore.</Alert>

      <Card title="1 · Cliente" pad actions={puoCreare && <button className="btn btn-sm btn-soft" onClick={() => setNuovoCliente(true)} data-testid="nuovo-cliente-campo"><Plus size={18} /> Nuovo cliente</button>}>
        <div className="stack">
          <div className="campo-cerca">
            <Search size={18} aria-hidden />
            <input className="input" type="search" placeholder="Cerca cliente…" value={cerca} onChange={(e) => setCerca(e.target.value)} aria-label="Cerca cliente" data-testid="cerca-cliente" />
          </div>
          <div className="choices">
            {clienti.map((c) => (
              <button key={c.id} className={`choice ${cliente === c.id ? 'on' : ''}`} onClick={() => scegliCliente(c.id)} data-testid="rapportino-cliente">{c.ragione_sociale}</button>
            ))}
          </div>
          {clienti.length === 0 && <p className="subtle">Nessun cliente trovato{puoCreare ? ': usa “Nuovo cliente”.' : '. Chiedi all\'amministratore di aggiungerlo.'}</p>}
        </div>
      </Card>

      {cliente && (
        <Card title="2 · Luogo dell'intervento" pad>
          <div className="stack">
            {sedi.length > 0 && (
              <div className="choices">
                {sedi.map((x) => <button key={x.id} className={`choice ${sede === x.id && !altroIndirizzo ? 'on' : ''}`} onClick={() => { setSede(x.id); setAltroIndirizzo(false); }} data-testid="rapportino-sede">{x.nome}<small>{[x.indirizzo, x.citta].filter(Boolean).join(', ')}</small></button>)}
                <button className={`choice ${altroIndirizzo ? 'on' : ''}`} onClick={() => { setAltroIndirizzo(true); setSede(''); }} data-testid="rapportino-altro-indirizzo">Altro indirizzo<small>Non è una sede registrata</small></button>
              </div>
            )}
            {serveIndirizzo && (
              <div className="field">
                <label htmlFor="r-indirizzo">Indirizzo dell'intervento</label>
                <input id="r-indirizzo" className="input" autoComplete="street-address" value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} placeholder="Via, numero civico, città" data-testid="rapportino-indirizzo" />
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title={cliente ? '3 · Richiesta ricevuta' : 'Richiesta ricevuta'} pad>
        <div className="stack">
          <div className="field">
            <label htmlFor="r-richiesta">Cosa ha chiesto il cliente (es. al telefono)</label>
            <textarea id="r-richiesta" className="textarea" style={{ minHeight: 90 }} value={richiesta} onChange={(e) => setRichiesta(e.target.value)} placeholder="Es. caldaia in blocco, chiede intervento in giornata" data-testid="rapportino-richiesta" />
          </div>
          <div className="field"><span className="label">Firma del cliente</span>
            <Segmented value={tipo} onChange={setTipo} testId="firma-prevista" options={[{ value: 'completo', label: 'Prevista' }, { value: 'rapido', label: 'Non prevista' }]} />
          </div>
        </div>
      </Card>

      <div className="azioni-fisse">
        <button className="btn btn-primary btn-lg btn-block" disabled={!pronto} data-testid="rapportino-inizia" onClick={() => void crea(cliente, (!altroIndirizzo && sede) || null)}>Inizia rapporto</button>
      </div>

      {nuovoCliente && <NuovoClienteCampo onClose={() => setNuovoCliente(false)} onCreato={(id, sedeId) => { setCliente(id); setSede(sedeId ?? ''); setAltroIndirizzo(false); setCerca(''); setNuovoCliente(false); }} />}
    </div>
  );
}

function NuovoClienteCampo({ onClose, onCreato }: { onClose: () => void; onCreato: (clienteId: string, sedeId: string | null) => void }) {
  const s = useData();
  const { run } = useApp();
  const [d, setD] = useState({ ragione_sociale: '', telefono: '', indirizzo: '', citta: '' });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Sheet title="Nuovo cliente" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" data-testid="nuovo-cliente-salva" onClick={async () => {
        const res = await run(() => s.planning.creaClienteDaCampo(d), 'Cliente aggiunto: l\'amministratore completerà l\'anagrafica');
        if (res) onCreato(res.cliente.id, res.sede?.id ?? null);
      }}>Aggiungi cliente</button>
    </>}>
      <div className="field"><label htmlFor="nc-nome">Nome o ragione sociale</label><input id="nc-nome" className="input" autoComplete="organization" value={d.ragione_sociale} onChange={set('ragione_sociale')} data-testid="nuovo-cliente-nome" /></div>
      <div className="field"><label htmlFor="nc-tel">Telefono</label><input id="nc-tel" className="input" type="tel" inputMode="tel" autoComplete="tel" value={d.telefono} onChange={set('telefono')} /></div>
      <div className="field"><label htmlFor="nc-ind">Indirizzo</label><input id="nc-ind" className="input" autoComplete="street-address" value={d.indirizzo} onChange={set('indirizzo')} placeholder="Via e numero civico" data-testid="nuovo-cliente-indirizzo" /></div>
      <div className="field"><label htmlFor="nc-citta">Città</label><input id="nc-citta" className="input" autoComplete="address-level2" value={d.citta} onChange={set('citta')} /></div>
      <p className="subtle">Partita IVA e altri dati li completa l'amministratore.</p>
    </Sheet>
  );
}

/**
 * Ore del rapporto (Fase 12): attività già registrate, timer o orario indicato a mano.
 * Le ore restano attività della presenza: il rapporto le collega soltanto (nessun doppio conteggio).
 */
function OreRapporto({ r, suggerite, onToggle, onAggiornato }: { r: Rapportino; suggerite: AttivitaLavoro[]; onToggle: (id: string) => void; onAggiornato: (r: Rapportino) => void }) {
  const s = useData();
  const u = useUtente();
  const { run } = useApp();
  const now = useNow(1000);
  const [inizio, setInizio] = useState('');
  const [fine, setFine] = useState('');
  const oggi = r.data_lavoro === localDate(now);
  const timer = s.report.timerInCorso(r);
  const senzaPresenza = oggi && s.workday.presenzeDelGiorno(u.id, r.data_lavoro).length === 0 && !s.workday.presenzaAperta(u.id);
  // Attività collegate + suggerite, senza ripetizioni.
  const righe = [...new Map([...r.attivita_ids.map((id) => s.db.get('attivita_lavoro', id)).filter((a): a is AttivitaLavoro => !!a && !a.superata_da_id && !a.annullata), ...suggerite].map((a) => [a.id, a])).values()].sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
  const aggiungi = async () => {
    if (!/^\d{2}:\d{2}$/.test(inizio) || !/^\d{2}:\d{2}$/.test(fine)) return void run(async () => { throw new AppError('VALIDAZIONE', 'Indica ora di inizio e di fine.'); });
    const x = await run(() => s.report.aggiungiOrario(r, atLocal(r.data_lavoro, inizio), atLocal(r.data_lavoro, fine), { registraEntrata: senzaPresenza }), senzaPresenza ? `Entrata registrata alle ${inizio} e orario aggiunto` : 'Orario aggiunto alle ore della giornata');
    if (x) { onAggiornato(x); setInizio(''); setFine(''); }
  };
  return (
    <Card title="Orari e ore" actions={<strong className="tabular" data-testid="rapportino-ore-totali">{formatDurata(s.report.oreRapportino(r))}</strong>}>
      {righe.length === 0 ? <Empty>Nessuna ora collegata. Usa il timer oppure indica l'orario di inizio e fine.</Empty> : righe.map((a) => {
        const on = r.attivita_ids.includes(a.id);
        return (
          <label key={a.id} className="act" style={{ cursor: 'pointer' }}>
            <div className={`bar bg-${a.tipo}`} />
            <div><div style={{ fontWeight: 650 }}>{nomeOperaio(s, a.operaio_id)} · {titoloAttivita(s, a).titolo}</div><div className="subtle">{formatOra(a.inizio_at)} – {a.fine_at ? formatOra(a.fine_at) : 'in corso'}{a.origine === 'manuale' ? ' · inserito a mano' : ''}</div></div>
            <input type="checkbox" className="spunta" checked={on} onChange={() => onToggle(a.id)} aria-label="Collega al rapporto" />
          </label>
        );
      })}
      <div className="card-body stack-sm" style={{ borderTop: '1px solid var(--border)' }}>
        {oggi && (timer ? (
          <button className="btn btn-lg btn-block" data-testid="rapportino-ferma-timer" onClick={async () => { const x = await run(() => s.report.fermaTimer(r), 'Timer fermato'); if (x) onAggiornato(x); }}><Square /> Ferma timer · {formatOra(timer.inizio_at)} – adesso</button>
        ) : (
          <button className="btn btn-soft btn-lg btn-block" data-testid="rapportino-avvia-timer" onClick={async () => { const x = await run(() => s.report.avviaTimer(r), s.workday.presenzaAperta(u.id) ? 'Timer avviato su questo rapporto' : 'Entrata registrata e timer avviato'); if (x) onAggiornato(x); }}><Play /> Avvia timer su questo lavoro</button>
        ))}
        <div className="label">Oppure indica l'orario</div>
        <div className="orari-riga">
          <div className="field"><label htmlFor="r-inizio">Inizio</label><input id="r-inizio" type="time" className="input" value={inizio} onChange={(e) => setInizio(e.target.value)} data-testid="rapportino-inizio" /></div>
          <div className="field"><label htmlFor="r-fine">Fine</label><input id="r-fine" type="time" className="input" value={fine} onChange={(e) => setFine(e.target.value)} data-testid="rapportino-fine" /></div>
          <button className="btn" onClick={() => void aggiungi()} data-testid="rapportino-aggiungi-orario"><Plus /> Aggiungi</button>
        </div>
        <p className="hint">{senzaPresenza ? "Non hai ancora registrato l'entrata oggi: verrà registrata all'orario di inizio." : "L'orario entra nelle ore della giornata. Se si sovrappone a un'attività già registrata (es. il timer) viene rifiutato: le ore non si contano due volte."}</p>
      </div>
    </Card>
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
        {!r.intervento_id && <div style={{ marginTop: 8 }}><Badge tono="info" testId="badge-autonomo">Intervento autonomo</Badge></div>}
      </PageHead>
      {intervento && <Alert tono="info">Collegato all'intervento <Link to={`/interventi/${intervento.id}`}>{intervento.codice} – {intervento.titolo}</Link>{r.followup_id ? ' (ritorno: completandolo con esito “Lavoro completato” il ritorno viene chiuso)' : ''}.</Alert>}
      {errori.length > 0 && <Alert tono="danger" title="Mancano alcune informazioni">{errori.join(' ')}</Alert>}
      {!intervento && r.followup_id && <Alert tono="warn">Rapporto di un ritorno: completandolo con esito “Lavoro completato” il ritorno viene chiuso.</Alert>}

      {!r.intervento_id && (
        <Card title="Richiesta e luogo" pad>
          <div className="stack">
            <div className="field">
              <label htmlFor="r-richiesta">Richiesta ricevuta</label>
              <textarea id="r-richiesta" className="textarea" style={{ minHeight: 80 }} value={r.richiesta ?? ''} onChange={(e) => set({ richiesta: e.target.value })} placeholder="Cosa ha chiesto il cliente (es. al telefono)" data-testid="rapportino-richiesta" />
            </div>
            {!r.sede_id && (
              <div className="field">
                <label htmlFor="r-indirizzo">Indirizzo dell'intervento</label>
                <input id="r-indirizzo" className="input" autoComplete="street-address" value={r.indirizzo_intervento ?? ''} onChange={(e) => set({ indirizzo_intervento: e.target.value })} placeholder="Via, numero civico, città" />
              </div>
            )}
            <div className="field"><span className="label">Firma del cliente</span>
              <Segmented value={r.tipo} onChange={(tipo) => set({ tipo })} testId="firma-prevista" options={[{ value: 'completo', label: 'Prevista' }, { value: 'rapido', label: 'Non prevista' }]} />
            </div>
          </div>
        </Card>
      )}

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
        <OreRapporto r={r} onAggiornato={(x) => set({ attivita_ids: x.attivita_ids })} suggerite={suggerite} onToggle={(id) => set({ attivita_ids: r.attivita_ids.includes(id) ? r.attivita_ids.filter((x) => x !== id) : [...r.attivita_ids, id] })} />
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

      <div className="azioni-fisse">
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
  const u = useUtente();
  const { run } = useApp();
  const navigate = useNavigate();
  const autonomo = !r.intervento_id;
  const completato = r.stato === 'completato' || r.stato === 'firmato';
  const catena = s.report.catena(r.id)!;
  const ore = s.report.oreRapportino(r);
  return (
    <div className="stack">
      <PageHead title={`Rapportino ${r.numero ?? r.numero_provvisorio}`} eyebrow={`${r.tipo} · ${formatData(r.data_lavoro)}`} back={{ to: '/rapportini', label: 'Rapportini' }} actions={<SyncBadge stato={r.sync_stato} />}>
        <div className="row" style={{ marginTop: 8 }}>
          <Badge tono={r.esito === 'completato' ? 'ok' : 'warn'} testId="rapportino-esito">{ETICHETTE_ESITO[r.esito]}</Badge>
          <Badge>{r.stato}</Badge>
          {autonomo && <Badge tono="info" testId="badge-autonomo">Intervento autonomo</Badge>}
          {completato && (r.verificato_at ? <Badge tono="ok" testId="badge-verificato">Verificato</Badge> : <Badge tono="warn" testId="badge-da-verificare">Da verificare</Badge>)}
          {!r.numero && <span className="subtle">Numero definitivo assegnato dal server alla sincronizzazione (provvisorio {r.numero_provvisorio})</span>}
        </div>
      </PageHead>
      {u.ruolo === 'admin' && completato && !r.verificato_at && (
        <Alert tono="warn" title={autonomo ? 'Rapporto autonomo da verificare' : 'Rapporto da verificare'} actions={<button className="btn btn-primary" data-testid="rapportino-verifica" onClick={() => run(() => s.report.verifica(r.id), 'Rapporto segnato come verificato')}><ShieldCheck /> Segna come verificato</button>}>
          Controlla cliente, orari, materiali e firma. La verifica non modifica il rapporto.
        </Alert>
      )}
      {r.verificato_at && <Alert tono="ok">Verificato da {nomeOperaio(s, r.verificato_da ?? null)} il {new Date(toMs(r.verificato_at)).toLocaleString('it-IT')}.</Alert>}
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
