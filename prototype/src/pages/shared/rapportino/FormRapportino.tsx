/** Modifica del rapporto: dati, ore, materiali, foto, firme; salvataggio, pronto, invio, correzione. */
import { Camera, CheckCircle2, Pencil, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useData, useUtente } from '../../../app/AppContext';
import { formatData, toMs } from '../../../domain/time';
import type { Rapportino, RapportinoEsito } from '../../../domain/types';
import { ETICHETTE_ESITO } from '../../../services/report-service';
import { Alert, Badge, Card, ConfirmSheet, PageHead, Segmented, SyncBadge } from '../../../ui/components';
import { leggiFile } from '../../../ui/files';
import { MaterialiEditor } from '../../../ui/MaterialiRapportino';
import { IMPREVISTO_TIPO, nomeCliente, nomeOperaio, nomeSede } from '../../../ui/labels';
import { FirmaSchermoIntero } from '../../../ui/FirmaSchermoIntero';
import { FaseBadge } from './FaseBadge';
import { OreRapporto } from './OreRapporto';

const ESITI: RapportinoEsito[] = ['completato', 'da_ultimare', 'ritorno_necessario', 'non_eseguito'];

export function FormRapportino({ iniziale, correzione = false }: { iniziale: Rapportino; correzione?: boolean }) {
  const s = useData();
  const u = useUtente();
  const { run } = useApp();
  const navigate = useNavigate();
  const [r, setR] = useState<Rapportino>(iniziale);
  const [errori, setErrori] = useState<string[]>([]);
  const [motivoCorrezione, setMotivoCorrezione] = useState('');
  const [chiediElimina, setChiediElimina] = useState(false);
  const [firmaAperta, setFirmaAperta] = useState<'cliente' | 'operaio' | null>(null);
  const fase = s.report.fase(iniziale);
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
      <PageHead title={correzione ? `Correzione rapporto ${r.numero ?? r.numero_provvisorio}` : `Rapportino ${r.tipo}`} eyebrow={correzione ? `revisione ${(r.revisione ?? 0) + 1} · correzione tracciata` : `${r.numero_provvisorio} · ${fase === 'pronto' ? 'pronto per invio, ancora modificabile' : 'bozza sul dispositivo'}`} back={{ to: '/rapportini', label: 'Rapportini' }} actions={<><FaseBadge fase={fase} /><SyncBadge stato={r.sync_stato} /></>}>
        <div className="muted" style={{ marginTop: 6 }}>{nomeCliente(s, r.cliente_id)} {r.sede_id ? `· ${nomeSede(s, r.sede_id)}` : ''} · {formatData(r.data_lavoro)}</div>
        {!r.intervento_id && <div style={{ marginTop: 8 }}><Badge tono="info" testId="badge-autonomo">Intervento autonomo</Badge></div>}
      </PageHead>
      {intervento && <Alert tono="info">Collegato all'intervento <Link to={`/interventi/${intervento.id}`}>{intervento.codice} – {intervento.titolo}</Link>{r.followup_id ? ' (ritorno: completandolo con esito “Lavoro completato” il ritorno viene chiuso)' : ''}.</Alert>}
      {errori.length > 0 && <Alert tono="danger" title="Mancano alcune informazioni">{errori.join(' ')}</Alert>}
      {fase === 'da_correggere' && <Alert tono="warn" title="Restituito per correzioni" >“{r.motivo_restituzione}” — {nomeOperaio(s, r.restituito_da ?? null)}{r.restituito_at ? `, ${new Date(toMs(r.restituito_at)).toLocaleString('it-IT')}` : ''}. Correggi e reinvia: la modifica resta tracciata.</Alert>}
      {correzione && u.ruolo === 'admin' && <Alert tono="info" title="Correzione dell'amministrazione">Le modifiche vengono registrate nello storico con il motivo; esito e cliente non si modificano qui.</Alert>}
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
              {ESITI.map((e) => <button key={e} className={`choice ${r.esito === e ? 'on' : ''}`} disabled={correzione} onClick={() => set({ esito: e })} data-testid={`esito-${e}`}>{ETICHETTE_ESITO[e]}</button>)}
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
        <OreRapporto r={r} soloCollega={correzione} onAggiornato={(x) => set({ attivita_ids: x.attivita_ids })} suggerite={suggerite} onToggle={(id) => set({ attivita_ids: r.attivita_ids.includes(id) ? r.attivita_ids.filter((x) => x !== id) : [...r.attivita_ids, id] })} />
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

      <Card title="Firme (facoltative)" pad testId="firme-card">
        <div className="grid-2">
          <div className="firma-anteprima">
            <span className="label">Firma del cliente</span>
            {r.firma_cliente_id ? (
              <>
                <img src={s.db.get('allegati', r.firma_cliente_id)?.data_url} alt="Firma cliente" />
                <div className="row"><button className="btn btn-sm" onClick={() => setFirmaAperta('cliente')}>Rifai firma</button><button className="btn btn-sm btn-ghost" onClick={() => set({ firma_cliente_id: null, firma_cliente_nome: '' })}>Togli</button></div>
              </>
            ) : <button type="button" className="firma-vuota" onClick={() => setFirmaAperta('cliente')} data-testid="firma-cliente"><Pencil /> Tocca per far firmare il cliente</button>}
            <div className="field"><label htmlFor="r-firmatario">Nome di chi firma</label><input id="r-firmatario" className="input" value={r.firma_cliente_nome} onChange={(e) => set({ firma_cliente_nome: e.target.value })} data-testid="firma-nome" /></div>
          </div>
          <div className="firma-anteprima">
            <span className="label">Firma dell'operaio</span>
            {r.firma_operaio_id ? (
              <>
                <img src={s.db.get('allegati', r.firma_operaio_id)?.data_url} alt="Firma operaio" />
                <div className="row"><button className="btn btn-sm" onClick={() => setFirmaAperta('operaio')}>Rifai firma</button><button className="btn btn-sm btn-ghost" onClick={() => set({ firma_operaio_id: null })}>Togli</button></div>
              </>
            ) : <button type="button" className="firma-vuota" onClick={() => setFirmaAperta('operaio')} data-testid="firma-operaio"><Pencil /> Tocca per firmare</button>}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Le firme non sono obbligatorie: il rapporto si può completare anche senza. Si firma a schermo intero, con il telefono in orizzontale.</p>
      </Card>
      {firmaAperta && (
        <FirmaSchermoIntero
          titolo={firmaAperta === 'cliente' ? 'Firma del cliente' : `Firma dell'operaio`}
          nome={firmaAperta === 'cliente' ? r.firma_cliente_nome : undefined}
          onNome={firmaAperta === 'cliente' ? (v) => set({ firma_cliente_nome: v }) : undefined}
          onChiudi={() => setFirmaAperta(null)}
          onConferma={(u) => { const chi = firmaAperta; setFirmaAperta(null); void firma(chi, u); }}
        />
      )}

      {correzione ? (
        <Card title="Motivo della correzione" pad>
          <textarea className="textarea" style={{ minHeight: 70 }} value={motivoCorrezione} onChange={(e) => setMotivoCorrezione(e.target.value)} placeholder="Cosa è stato corretto e perché" data-testid="motivo-correzione" />
        </Card>
      ) : null}
      <div className="azioni-fisse">
        {correzione ? (
          <>
            {u.ruolo === 'admin' && <button className="btn btn-lg" onClick={() => navigate(`/rapportini/${r.id}`, { replace: true })}>Annulla</button>}
            <button className="btn btn-primary btn-lg" data-testid="rapportino-invia-correzione" onClick={async () => {
              const err = s.report.validaCompletamento(r);
              setErrori(err);
              if (err.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
              const ok = await run(() => s.report.correggi(r, motivoCorrezione), u.ruolo === 'admin' ? 'Correzione registrata nello storico' : 'Correzione inviata all\'amministrazione');
              if (ok) navigate(`/rapportini/${r.id}`, { replace: true });
            }}><Send /> {u.ruolo === 'admin' ? 'Registra correzione' : 'Reinvia corretto'}</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-lg" data-testid="rapportino-elimina" onClick={() => setChiediElimina(true)} aria-label="Elimina rapporto"><Trash2 /> Elimina</button>
            <button className="btn btn-lg" data-testid="rapportino-salva-bozza" onClick={async () => { const x = await run(() => s.report.salvaBozza(r), 'Salvato sul dispositivo'); if (x) setR(x); }}><Save /> Salva</button>
            <button className="btn btn-lg" data-testid="rapportino-pronto" onClick={async () => {
              const err = s.report.validaCompletamento(r);
              setErrori(err);
              if (err.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
              const x = await run(() => s.report.segnaPronto(r), 'Pronto per invio: puoi ancora modificarlo');
              if (x) setR(x);
            }}><CheckCircle2 /> Pronto per invio</button>
            <button className="btn btn-primary btn-lg" data-testid="rapportino-completa" onClick={async () => {
              const err = s.report.validaCompletamento(r);
              setErrori(err);
              if (err.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
              const ok = await run(() => s.report.invia(r), 'Rapporto inviato all\'amministrazione');
              if (ok) navigate(`/rapportini/${r.id}`, { replace: true });
            }}><Send /> Invia</button>
          </>
        )}
      </div>
      {chiediElimina && <ConfirmSheet title="Eliminare il rapporto?" message="Il rapporto non è ancora stato inviato: viene eliminato da questo dispositivo. Le ore registrate nella giornata restano." conferma="Elimina" tono="danger" testId="conferma-elimina" onClose={() => setChiediElimina(false)} onConfirm={async () => { const ok = await run(() => s.report.elimina(r.id), 'Rapporto eliminato'); if (ok) navigate(u.ruolo === 'admin' ? '/rapportini' : '/op', { replace: true }); }} />}
    </div>
  );
}
