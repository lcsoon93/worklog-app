/** Richieste di correzione (Fase 3): invio da parte del lavoratore, elenco e gestione da parte dell'amministratore. */
import { MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../app/AppContext';
import { formatData, formatOra, meseDi } from '../domain/time';
import type { RichiestaCorrezione, RichiestaCorrezioneStato } from '../domain/types';
import { ETICHETTE_RICHIESTA } from '../services/richieste-service';
import { Badge, Empty, Field, Sheet, SyncBadge, type Tono } from './components';
import { nomeOperaio, titoloAttivita } from './labels';

const TONO: Record<RichiestaCorrezioneStato, Tono> = { aperta: 'warn', presa_in_carico: 'info', risolta: 'ok', respinta: 'danger' };

export function RichiestaBadge({ stato }: { stato: RichiestaCorrezioneStato }) {
  return <Badge tono={TONO[stato]} testId="richiesta-stato">{ETICHETTE_RICHIESTA[stato]}</Badge>;
}

/** Il lavoratore descrive l'errore; facoltativamente indica l'attività interessata. */
export function RichiediCorrezioneSheet({ data, presenzaId, onClose }: { data: string; presenzaId: string | null; onClose: () => void }) {
  const { s, runOk } = useApp();
  const [messaggio, setMessaggio] = useState('');
  const [attivitaId, setAttivitaId] = useState('');
  const attivita = presenzaId ? s.workday.attivita(presenzaId) : [];
  return (
    <Sheet title={`Richiedi una correzione – ${formatData(data)}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={messaggio.trim().length < 10} data-testid="richiesta-invia" onClick={async () => {
        const ok = await runOk(() => s.richieste.richiedi({ data_lavoro: data, messaggio, presenza_id: presenzaId, attivita_id: attivitaId || null }), 'Richiesta inviata all\'amministrazione');
        if (ok) onClose();
      }}>Invia richiesta</button>
    </>}>
      <p className="muted">La richiesta non modifica i dati: l'amministrazione la verifica e, se necessario, corregge o riapre il cartellino. Tutto resta tracciato.</p>
      {attivita.length > 0 && (
        <Field label="Attività interessata (facoltativa)" htmlFor="r-att">
          <select id="r-att" className="select" value={attivitaId} onChange={(e) => setAttivitaId(e.target.value)}>
            <option value="">— Tutta la giornata —</option>
            {attivita.map((a) => <option key={a.id} value={a.id}>{formatOra(a.inizio_at)}–{a.fine_at ? formatOra(a.fine_at) : '…'} · {titoloAttivita(s, a).titolo}</option>)}
          </select>
        </Field>
      )}
      <Field label="Cosa va corretto" htmlFor="r-msg" hint="Indica orari corretti e motivo, es. «Sono uscito alle 17:30, non alle 16:30: ho finito l'intervento dal cliente».">
        <textarea id="r-msg" className="textarea" value={messaggio} onChange={(e) => setMessaggio(e.target.value)} data-testid="richiesta-messaggio" />
      </Field>
    </Sheet>
  );
}

export function RichiesteLista({ richieste, gestione, mostraOperaio, vuoto = 'Nessuna richiesta di correzione.' }: { richieste: RichiestaCorrezione[]; gestione?: boolean; mostraOperaio?: boolean; vuoto?: string }) {
  const s = useData();
  const [sel, setSel] = useState<RichiestaCorrezione | null>(null);
  if (!richieste.length) return <Empty icon={<MessageSquareWarning />}>{vuoto}</Empty>;
  return (
    <div className="list" data-testid="richieste-lista">
      {richieste.map((r) => {
        const a = r.attivita_id ? s.db.get('attivita_lavoro', r.attivita_id) : undefined;
        return (
          <div key={r.id} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }} data-testid="richiesta-riga">
            <div className="grow">
              <div className="row" style={{ gap: 8 }}>
                <strong>{mostraOperaio ? `${nomeOperaio(s, r.operaio_id)} · ` : ''}{formatData(r.data_lavoro, { breve: true })}</strong>
                <RichiestaBadge stato={r.stato} />
                <SyncBadge stato={r.sync_stato} />
              </div>
              {a && <div className="subtle">Attività: {formatOra(a.inizio_at)}–{a.fine_at ? formatOra(a.fine_at) : '…'} · {titoloAttivita(s, a).titolo}</div>}
              <div style={{ marginTop: 4 }}>“{r.messaggio}”</div>
              <div className="subtle">Inviata il {new Date(r.created_at).toLocaleString('it-IT')}</div>
              {r.gestita_at && <div className="small" style={{ marginTop: 4 }}><strong>{ETICHETTE_RICHIESTA[r.stato]}</strong> da {nomeOperaio(s, r.gestita_da)} il {new Date(r.gestita_at).toLocaleString('it-IT')}{r.risposta ? ` – ${r.risposta}` : ''}</div>}
            </div>
            {gestione && (r.stato === 'aperta' || r.stato === 'presa_in_carico') && (
              <button className="btn" onClick={() => setSel(r)} data-testid="richiesta-gestisci">Gestisci</button>
            )}
          </div>
        );
      })}
      {sel && <GestisciRichiestaSheet r={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function GestisciRichiestaSheet({ r, onClose }: { r: RichiestaCorrezione; onClose: () => void }) {
  const { s, runOk } = useApp();
  const [risposta, setRisposta] = useState('');
  const bloccato = s.richieste.meseBloccato(r);
  const { anno, mese } = meseDi(r.data_lavoro);
  const cart = s.timesheet.cartellino(r.operaio_id, anno, mese);
  const esegui = async (stato: RichiestaCorrezioneStato, msg: string) => {
    const ok = await runOk(() => s.richieste.gestisci(r.id, stato, risposta), msg);
    if (ok) onClose();
  };
  return (
    <Sheet title={`Richiesta di ${nomeOperaio(s, r.operaio_id)} – ${formatData(r.data_lavoro)}`} onClose={onClose} footer={<>
      {r.stato === 'aperta' && <button className="btn" onClick={() => void esegui('presa_in_carico', 'Richiesta presa in carico')} data-testid="richiesta-in-carico">Prendi in carico</button>}
      <button className="btn btn-danger" disabled={risposta.trim().length < 5} onClick={() => void esegui('respinta', 'Richiesta respinta')} data-testid="richiesta-respingi">Respingi</button>
      <button className="btn btn-primary" disabled={risposta.trim().length < 5} onClick={() => void esegui('risolta', 'Richiesta risolta')} data-testid="richiesta-risolvi">Segna come risolta</button>
    </>}>
      <div className="alert info"><div className="small">“{r.messaggio}”</div></div>
      {bloccato ? (
        <div className="alert warn"><div className="small">
          Il cartellino di questo mese è <strong>{cart ? cart.stato.replace(/_/g, ' ') : 'in verifica'}</strong>: le ore sono bloccate. Per correggerle restituisci il cartellino per correzione (se in attesa) o riaprilo con motivazione (se approvato): ogni modifica richiederà una nuova conferma e una nuova approvazione.
          {cart && <> <Link to={`/admin/cartellini/${cart.id}`} onClick={onClose}>Apri il cartellino</Link></>}
        </div></div>
      ) : (
        <div className="alert ok"><div className="small">Il mese è modificabile: il lavoratore può correggere la giornata dal proprio riepilogo, con motivazione tracciata.</div></div>
      )}
      <Link to={`/admin/presenze?operaio=${r.operaio_id}&data=${r.data_lavoro}`} onClick={onClose}>Vedi la giornata</Link>
      <Field label="Risposta al lavoratore (obbligatoria per risolvere o respingere)" htmlFor="r-risp">
        <textarea id="r-risp" className="textarea" value={risposta} onChange={(e) => setRisposta(e.target.value)} data-testid="richiesta-risposta" />
      </Field>
    </Sheet>
  );
}
