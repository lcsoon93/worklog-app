/**
 * Materiali nei rapportini (Fase 5): scelta dall'anagrafica o a testo libero, verifica della
 * disponibilità, e nella vista del rapportino lo scarico effettivo con le eventuali correzioni.
 */
import { AlertTriangle, PackagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp, useData, useUtente } from '../app/AppContext';
import { uuid } from '../domain/ids';
import type { MaterialeRapportino, Rapportino } from '../domain/types';
import { ETICHETTE_MOVIMENTO, UNITA_MISURA } from '../services/magazzino-service';
import { Alert, Badge, Card, Empty, Field, Sheet, SyncBadge } from './components';
import { nomeOperaio } from './labels';

const fmtEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const formatEuro = (n: number | null | undefined) => (n == null ? '—' : fmtEuro.format(n));
export const formatQuantita = (n: number, unita?: string) => `${n.toLocaleString('it-IT', { maximumFractionDigits: 3 })}${unita ? ` ${unita}` : ''}`;

export function nomeMagazzino(s: ReturnType<typeof useData>, id: string | null | undefined): string {
  return (id && s.db.get('magazzini', id)?.nome) || '—';
}

/** Editor delle righe materiale nella bozza del rapportino. */
export function MaterialiEditor({ r, onChange }: { r: Rapportino; onChange: (m: MaterialeRapportino[]) => void }) {
  const s = useData();
  const [picker, setPicker] = useState(false);
  const magazzini = s.magazzino.magazzini(true);
  const predefinito = s.magazzino.magazzinoPredefinito(r.redatto_da);
  const mancanze = s.magazzino.verificaDisponibilita(r);
  const aggiorna = (k: number, patch: Partial<MaterialeRapportino>) => {
    const x = [...r.materiali];
    x[k] = { ...x[k], ...patch };
    onChange(x);
  };
  return (
    <Card title="Materiali" testId="materiali-card" actions={<div className="row" style={{ gap: 6 }}>
      <button className="btn btn-sm" onClick={() => setPicker(true)} data-testid="materiale-da-magazzino"><PackagePlus size={16} /> Da magazzino</button>
      <button className="btn btn-sm btn-ghost" onClick={() => onChange([...r.materiali, { id: uuid(), descrizione: '', quantita: 1, unita: 'pz', materiale_id: null, magazzino_id: null }])} data-testid="materiale-aggiungi"><Plus size={16} /> Testo libero</button>
    </div>}>
      {mancanze.length > 0 && (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Alert tono="warn" title="Materiale insufficiente">
            {mancanze.map((m) => <div key={m.rigaId} data-testid="materiale-insufficiente">{m.materiale.nome}: servono {formatQuantita(m.richiesta, m.materiale.unita)}, disponibili {formatQuantita(m.disponibile, m.materiale.unita)} in {nomeMagazzino(s, m.magazzinoId)}.</div>)}
            <div className="small" style={{ marginTop: 4 }}>Puoi completare comunque: lo scarico viene registrato e segnalato all'amministrazione per il riordino o la rettifica.</div>
          </Alert>
        </div>
      )}
      {r.materiali.length === 0 && <Empty>Nessun materiale. Scegli gli articoli dal magazzino: vengono scaricati quando completi il rapportino.</Empty>}
      {r.materiali.map((m, k) => {
        const mat = m.materiale_id ? s.db.get('materiali', m.materiale_id) : undefined;
        const magId = m.magazzino_id ?? predefinito?.id ?? null;
        return (
          <div key={m.id} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }} data-testid="materiale-riga">
            {mat ? (
              <div style={{ flex: '3 1 200px' }}>
                <div style={{ fontWeight: 650 }}>{mat.nome}</div>
                <div className="subtle">{mat.codice} · disponibili {formatQuantita(s.magazzino.giacenza(mat.id, magId), mat.unita)}</div>
              </div>
            ) : (
              <input className="input" style={{ flex: '3 1 200px' }} placeholder="Descrizione" value={m.descrizione} onChange={(e) => aggiorna(k, { descrizione: e.target.value })} data-testid="materiale-descrizione" />
            )}
            <input className="input" style={{ flex: '0 0 96px' }} type="number" min={0} step="0.5" value={m.quantita} onChange={(e) => aggiorna(k, { quantita: Number(e.target.value) })} aria-label="Quantità" data-testid="materiale-quantita" />
            {mat ? <span style={{ flex: '0 0 40px' }}>{mat.unita}</span> : (
              <select className="select" style={{ flex: '0 0 96px' }} value={m.unita} onChange={(e) => aggiorna(k, { unita: e.target.value })} aria-label="Unità">{UNITA_MISURA.map((u) => <option key={u}>{u}</option>)}</select>
            )}
            {mat && (
              <select className="select" style={{ flex: '1 1 160px' }} value={magId ?? ''} onChange={(e) => aggiorna(k, { magazzino_id: e.target.value })} aria-label="Magazzino" data-testid="materiale-magazzino">
                {magazzini.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </select>
            )}
            <button className="btn btn-ghost icon-btn" aria-label="Rimuovi" onClick={() => onChange(r.materiali.filter((x) => x.id !== m.id))}><Trash2 size={18} /></button>
          </div>
        );
      })}
      {picker && <SceltaMateriale magazzinoId={predefinito?.id ?? null} onClose={() => setPicker(false)} onScegli={(id) => {
        const mat = s.db.get('materiali', id)!;
        onChange([...r.materiali, { id: uuid(), descrizione: mat.nome, quantita: 1, unita: mat.unita, materiale_id: mat.id, magazzino_id: predefinito?.id ?? null }]);
        setPicker(false);
      }} />}
    </Card>
  );
}

function SceltaMateriale({ magazzinoId, onClose, onScegli }: { magazzinoId: string | null; onClose: () => void; onScegli: (id: string) => void }) {
  const s = useData();
  const [testo, setTesto] = useState('');
  const [categoria, setCategoria] = useState('');
  const lista = s.magazzino.materiali({ testo, categoria, soloAttivi: true });
  return (
    <Sheet title="Scegli il materiale" onClose={onClose}>
      <div className="row">
        <div style={{ position: 'relative', flex: '2 1 200px' }}>
          <input className="input" placeholder="Cerca per nome o codice" value={testo} onChange={(e) => setTesto(e.target.value)} data-testid="materiale-cerca" autoFocus />
          <Search size={16} style={{ position: 'absolute', right: 12, top: 14, opacity: 0.5 }} />
        </div>
        <select className="select" style={{ flex: '1 1 140px' }} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
          <option value="">Tutte le categorie</option>
          {s.magazzino.categorie().map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {lista.length === 0 && <Empty>Nessun materiale trovato.</Empty>}
        {lista.map((m) => {
          const disp = s.magazzino.giacenza(m.id, magazzinoId);
          return (
            <button key={m.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => onScegli(m.id)} data-testid="materiale-opzione">
              <div className="grow"><div className="title">{m.nome}</div><div className="subtle">{m.codice} · {m.categoria}</div></div>
              <Badge tono={disp > 0 ? 'neutral' : 'warn'}>{formatQuantita(disp, m.unita)}</Badge>
            </button>
          );
        })}
      </div>
      <p className="subtle">Disponibilità nel magazzino proposto ({nomeMagazzino(s, magazzinoId)}); puoi cambiarlo sulla riga.</p>
    </Sheet>
  );
}

/** Materiali del rapportino completato: quantità del documento, scarico effettivo, correzioni. */
export function MaterialiVista({ r }: { r: Rapportino }) {
  const s = useData();
  const u = useUtente();
  const admin = u.ruolo === 'admin';
  const puoCorreggere = admin || r.redatto_da === u.id;
  const [corr, setCorr] = useState<MaterialeRapportino | null>(null);
  if (r.materiali.length === 0) return null;
  const costoTot = r.materiali.reduce((a, m) => a + (m.materiale_id ? s.magazzino.consumoRiga(r.id, m.id).costo : 0), 0);
  return (
    <Card title="Materiali" testId="materiali-vista" actions={admin ? <span className="subtle">Costo effettivo <strong className="tabular" data-testid="materiali-costo">{formatEuro(costoTot)}</strong></span> : undefined}>
      <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Materiale</th><th className="num">Indicato</th><th className="num">Scaricato</th>{admin && <th className="num">Costo</th>}<th /></tr></thead>
        <tbody>
          {r.materiali.map((m) => {
            const c = m.materiale_id ? s.magazzino.consumoRiga(r.id, m.id) : null;
            const corretto = c && c.movimenti.some((x) => x.tipo === 'correzione_consumo');
            const insufficiente = c?.movimenti.some((x) => x.giacenza_insufficiente);
            return (
              <tr key={m.id} data-testid="materiale-vista-riga">
                <td>
                  <div>{m.descrizione}</div>
                  {c ? <div className="subtle">da {nomeMagazzino(s, c.movimenti[0]?.magazzino_id ?? m.magazzino_id)} {c.movimenti.map((x) => <SyncBadge key={x.id} stato={x.sync_stato} />)}</div> : <div className="subtle">Testo libero: nessuno scarico di magazzino</div>}
                  {insufficiente && <div className="small" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> Giacenza insufficiente al momento dello scarico</div>}
                  {c?.movimenti.filter((x) => x.tipo === 'correzione_consumo').map((x) => (
                    <div key={x.id} className="small subtle" data-testid="materiale-correzione">Corretto da {nomeOperaio(s, x.created_by)} il {new Date(x.created_at).toLocaleString('it-IT')}: {x.quantita > 0 ? 'reso' : 'aggiunto'} {formatQuantita(Math.abs(x.quantita), m.unita)} – {x.motivo}</div>
                  ))}
                </td>
                <td className="num">{formatQuantita(m.quantita, m.unita)}</td>
                <td className="num" data-testid="materiale-scaricato">{c ? <>{formatQuantita(c.quantita, m.unita)}{corretto && <div><Badge tono="info">corretto</Badge></div>}</> : '—'}</td>
                {admin && <td className="num">{c ? formatEuro(c.costo) : '—'}</td>}
                <td className="num">{c && puoCorreggere && c.movimenti.some((x) => x.tipo === 'consumo' && !x.duplicato_di) && <button className="btn btn-sm btn-ghost" onClick={() => setCorr(m)} data-testid="materiale-correggi"><Pencil size={14} /> Correggi</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {corr && <CorreggiConsumoSheet r={r} riga={corr} onClose={() => setCorr(null)} />}
    </Card>
  );
}

function CorreggiConsumoSheet({ r, riga, onClose }: { r: Rapportino; riga: MaterialeRapportino; onClose: () => void }) {
  const s = useData();
  const { runOk } = useApp();
  const attuale = s.magazzino.consumoRiga(r.id, riga.id).quantita;
  const [q, setQ] = useState(String(attuale));
  const [motivo, setMotivo] = useState('');
  return (
    <Sheet title={`Correggi consumo – ${riga.descrizione}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={motivo.trim().length < 5} data-testid="correzione-conferma" onClick={async () => {
        if (await runOk(() => s.magazzino.correggiConsumo(r.id, riga.id, Number(q), motivo), 'Correzione registrata')) onClose();
      }}>Registra correzione</button>
    </>}>
      <p className="muted">Il rapportino firmato e il movimento originale restano invariati: viene aggiunto un movimento di correzione, valorizzato allo stesso costo del consumo originale.</p>
      <Field label={`Quantità effettivamente usata (registrata ora: ${formatQuantita(attuale, riga.unita)})`} htmlFor="c-q">
        <input id="c-q" className="input" type="number" min={0} step="0.5" value={q} onChange={(e) => setQ(e.target.value)} data-testid="correzione-quantita" />
      </Field>
      <Field label="Motivo" htmlFor="c-m"><textarea id="c-m" className="textarea" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="correzione-motivo" /></Field>
      <p className="subtle">{ETICHETTE_MOVIMENTO.correzione_consumo}: la differenza rientra o esce dallo stesso magazzino dello scarico.</p>
    </Sheet>
  );
}
