/**
 * Magazzino, materiali e costi (Fase 5) – sezione amministrativa.
 * Viste: panoramica (dashboard), materiali e giacenze, movimenti, costi e consumi.
 * Tutti i numeri vengono dal servizio di magazzino (giacenze = somma dei movimenti; costi =
 * costi unitari storici dei movimenti di consumo): nessun calcolo duplicato nella UI.
 */
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardPen, Package, Plus, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import type { VoceCosto } from '../../domain/magazzino';
import { addDays, formatData, localDate } from '../../domain/time';
import type { InterventoTipo, Magazzino, Materiale, MovimentoMagazzino, MovimentoTipo } from '../../domain/types';
import { ETICHETTE_MOVIMENTO, UNITA_MISURA, type DatiMateriale } from '../../services/magazzino-service';
import { Alert, Badge, Card, Empty, Field, PageHead, Segmented, Sheet, Stat, SyncBadge } from '../../ui/components';
import { nomeCliente, nomeOperaio } from '../../ui/labels';
import { formatEuro, formatQuantita, nomeMagazzino } from '../../ui/MaterialiRapportino';

type Vista = 'panoramica' | 'materiali' | 'movimenti' | 'costi';
type TipoManuale = 'carico' | 'scarico' | 'rettifica' | 'trasferimento';

const TIPO_INTERVENTO: Record<InterventoTipo | 'senza_intervento' | 'altro', string> = {
  manutenzione: 'Manutenzione', installazione: 'Installazione', riparazione: 'Riparazione', sopralluogo: 'Sopralluogo', ritorno: 'Ritorno',
  senza_intervento: 'Rapportino autonomo', altro: 'Altro',
};

function inizioMese(oggi: string) {
  return `${oggi.slice(0, 7)}-01`;
}

export function MagazzinoAdmin() {
  const s = useData();
  const [params, setParams] = useSearchParams();
  const vista = (params.get('vista') as Vista) ?? 'panoramica';
  s.db.getRevision();
  const imposta = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <div className="stack">
      <PageHead title="Magazzino e materiali" eyebrow="Giacenze, movimenti e costi">
        <div style={{ marginTop: 10 }}>
          <Segmented<Vista> value={vista} onChange={(v) => imposta({ vista: v, materiale: null })} testId="magazzino-vista" options={[
            { value: 'panoramica', label: 'Panoramica' },
            { value: 'materiali', label: 'Materiali e giacenze' },
            { value: 'movimenti', label: 'Movimenti' },
            { value: 'costi', label: 'Costi e consumi' },
          ]} />
        </div>
      </PageHead>
      {vista === 'panoramica' && <Panoramica />}
      {vista === 'materiali' && <Materiali />}
      {vista === 'movimenti' && <Movimenti materialeId={params.get('materiale') ?? ''} onMateriale={(id) => imposta({ materiale: id || null })} />}
      {vista === 'costi' && <Costi />}
    </div>
  );
}

// --- panoramica ------------------------------------------------------------------------
function Panoramica() {
  const s = useData();
  const oggi = localDate(s.db.now());
  const giacenze = s.magazzino.giacenze({ soloAttivi: true });
  const sotto = giacenze.filter((g) => g.sottoScorta);
  const negative = giacenze.filter((g) => g.negativa);
  const valore = giacenze.reduce((a, g) => a + g.valore, 0);
  const mese = s.magazzino.riepilogoCosti({ da: inizioMese(oggi), a: oggi });
  const ultimi = s.magazzino.movimenti().slice(0, 10);
  const segnalati = s.magazzino.movimenti().filter((m) => m.giacenza_insufficiente && m.data_riferimento >= addDays(oggi, -30));
  return (
    <>
      <div className="grid-4">
        <Stat label="Valore giacenze" value={formatEuro(valore)} sub="a prezzo di acquisto attuale" testId="kpi-valore-giacenze" />
        <Stat label="Sotto scorta" value={sotto.length} tono={sotto.length ? 'warn' : 'ok'} sub={`${giacenze.length} articoli attivi`} testId="kpi-sotto-scorta" />
        <Stat label="Costo materiali del mese" value={formatEuro(mese.costo)} sub={`${mese.righe} consumi da rapportino`} testId="kpi-costo-mese" />
        <Stat label="Valore a prezzo di vendita" value={formatEuro(mese.vendita)} sub="consumi del mese, separato dai costi" />
      </div>
      {(negative.length > 0 || segnalati.length > 0) && (
        <Alert tono="warn" title="Da verificare">
          {negative.map((g) => <div key={g.materiale.id}>{g.materiale.nome}: giacenza negativa in {Object.entries(g.perMagazzino).filter(([, v]) => v < 0).map(([k, v]) => `${nomeMagazzino(s, k)} (${formatQuantita(v, g.materiale.unita)})`).join(', ')}: serve una rettifica o un carico.</div>)}
          {segnalati.length > 0 && <div>{segnalati.length} consumi registrati con giacenza insufficiente negli ultimi 30 giorni.</div>}
        </Alert>
      )}
      <div className="split">
        <Card title={<h2 className="row" style={{ gap: 8 }}><AlertTriangle size={20} color="var(--warn)" /> Materiali sotto scorta</h2>} testId="sotto-scorta">
          {sotto.length === 0 ? <Empty>Tutte le scorte sono sopra la soglia minima.</Empty> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Materiale</th><th className="num">Giacenza</th><th className="num">Minima</th><th>Fornitore</th></tr></thead>
              <tbody>{sotto.map((g) => <tr key={g.materiale.id} data-testid="sotto-scorta-riga"><td><strong>{g.materiale.nome}</strong><div className="subtle">{g.materiale.codice}</div></td><td className="num">{formatQuantita(g.totale, g.materiale.unita)}</td><td className="num">{formatQuantita(g.materiale.scorta_minima, g.materiale.unita)}</td><td>{g.materiale.fornitore}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Consumi del mese per cliente" actions={<Link className="btn btn-sm btn-ghost" to="/admin/magazzino?vista=costi">Dettaglio costi</Link>}>
          <TabellaVoci voci={mese.perCliente.slice(0, 6)} etichetta="Cliente" nome={(k) => nomeCliente(s, k)} />
        </Card>
      </div>
      <Card title="Ultimi movimenti" actions={<Link className="btn btn-sm btn-ghost" to="/admin/magazzino?vista=movimenti">Tutti</Link>}>
        <TabellaMovimenti movimenti={ultimi} />
      </Card>
      <Card title="Costi per intervento (mese, i più alti)">
        <TabellaVoci voci={mese.perIntervento.slice(0, 6)} etichetta="Intervento" nome={(k) => <NomeIntervento id={k} />} />
      </Card>
    </>
  );
}

function NomeIntervento({ id }: { id: string }) {
  const s = useData();
  const i = id ? s.db.get('interventi', id) : undefined;
  if (!i) return <span className="muted">Rapportini autonomi</span>;
  return <><Link to={`/interventi/${i.id}`}>{i.codice}</Link> <span className="subtle">{i.titolo} · {nomeCliente(s, i.cliente_id)}</span></>;
}

function TabellaVoci({ voci, etichetta, nome, quantita }: { voci: VoceCosto[]; etichetta: string; nome: (k: string) => React.ReactNode; quantita?: (v: VoceCosto) => string }) {
  if (voci.length === 0) return <Empty>Nessun consumo nel periodo.</Empty>;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>{etichetta}</th>{quantita && <th className="num">Quantità</th>}<th className="num">Utilizzi</th><th className="num">Costo</th><th className="num">A prezzo vendita</th></tr></thead>
      <tbody>{voci.map((v) => <tr key={v.chiave} data-testid="voce-costo"><td>{nome(v.chiave)}</td>{quantita && <td className="num">{quantita(v)}</td>}<td className="num">{v.utilizzi}</td><td className="num">{formatEuro(v.costo)}</td><td className="num">{formatEuro(v.vendita)}</td></tr>)}</tbody>
    </table></div>
  );
}

function TabellaMovimenti({ movimenti, conMateriale = true }: { movimenti: MovimentoMagazzino[]; conMateriale?: boolean }) {
  const s = useData();
  if (movimenti.length === 0) return <Empty>Nessun movimento.</Empty>;
  return (
    <div className="table-wrap"><table className="table" data-testid="movimenti-tabella">
      <thead><tr><th>Data</th><th>Tipo</th>{conMateriale && <th>Materiale</th>}<th>Magazzino</th><th className="num">Quantità</th><th className="num">Costo unit.</th><th>Riferimento</th><th /></tr></thead>
      <tbody>{movimenti.map((m) => {
        const mat = s.db.get('materiali', m.materiale_id);
        const rap = m.rapportino_id ? s.db.get('rapportini', m.rapportino_id) : undefined;
        return (
          <tr key={m.id} data-testid="movimento-riga" style={m.duplicato_di ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
            <td>{formatData(m.data_riferimento, { breve: true })}<div className="subtle">{nomeOperaio(s, m.created_by)}</div></td>
            <td><Badge tono={m.quantita > 0 ? 'ok' : m.tipo === 'consumo' ? 'info' : 'neutral'}>{ETICHETTE_MOVIMENTO[m.tipo]}</Badge>{m.giacenza_insufficiente && <div><Badge tono="warn">giacenza insufficiente</Badge></div>}{m.duplicato_di && <div><Badge tono="danger">duplicato scartato</Badge></div>}</td>
            {conMateriale && <td>{mat?.nome}<div className="subtle">{mat?.codice}</div></td>}
            <td>{nomeMagazzino(s, m.magazzino_id)}</td>
            <td className="num" style={{ color: m.quantita > 0 ? 'var(--ok)' : undefined }}>{m.quantita > 0 ? '+' : ''}{formatQuantita(m.quantita, mat?.unita)}</td>
            <td className="num">{formatEuro(m.costo_unitario)}</td>
            <td className="small">{rap ? <Link to={`/rapportini/${rap.id}`}>{rap.numero ?? rap.numero_provvisorio}</Link> : m.documento}{m.cliente_id && <div className="subtle">{nomeCliente(s, m.cliente_id)}</div>}{m.motivo && !rap && <div className="subtle">{m.motivo}</div>}{m.tipo === 'correzione_consumo' && <div className="subtle">{m.motivo}</div>}</td>
            <td><SyncBadge stato={m.sync_stato} /></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

// --- materiali e giacenze ----------------------------------------------------------------
function Materiali() {
  const s = useData();
  const [testo, setTesto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soloAttivi, setSoloAttivi] = useState(true);
  const [edit, setEdit] = useState<Materiale | 'nuovo' | null>(null);
  const [magazzinoEdit, setMagazzinoEdit] = useState<Magazzino | 'nuovo' | null>(null);
  const magazzini = s.magazzino.magazzini();
  const giacenze = s.magazzino.giacenze({ testo, categoria, soloAttivi });
  return (
    <>
      <Card pad>
        <div className="row">
          <input className="input" style={{ flex: '2 1 220px' }} placeholder="Cerca codice, nome, fornitore" value={testo} onChange={(e) => setTesto(e.target.value)} data-testid="materiali-cerca" />
          <select className="select" style={{ flex: '1 1 160px' }} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" data-testid="materiali-categoria">
            <option value="">Tutte le categorie</option>{s.magazzino.categorie().map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={soloAttivi} onChange={(e) => setSoloAttivi(e.target.checked)} /> Solo attivi</label>
          <button className="btn btn-primary" onClick={() => setEdit('nuovo')} data-testid="materiale-nuovo"><Plus /> Nuovo materiale</button>
        </div>
      </Card>
      <Card title="Giacenze attuali" actions={<span className="subtle">Somma dei movimenti registrati</span>}>
        {giacenze.length === 0 ? <Empty icon={<Package />}>Nessun materiale.</Empty> : (
          <div className="table-wrap"><table className="table" data-testid="giacenze-tabella">
            <thead><tr><th>Materiale</th><th>Categoria</th>{magazzini.map((m) => <th key={m.id} className="num">{m.nome}</th>)}<th className="num">Totale</th><th className="num">Minima</th><th className="num">Acquisto</th><th className="num">Vendita</th><th className="num">Valore</th></tr></thead>
            <tbody>{giacenze.map((g) => (
              <tr key={g.materiale.id} className="clickable" onClick={() => setEdit(g.materiale)} data-testid="giacenza-riga">
                <td><strong>{g.materiale.nome}</strong> {!g.materiale.attivo && <Badge>disattivato</Badge>}<div className="subtle">{g.materiale.codice} · {g.materiale.fornitore}</div></td>
                <td>{g.materiale.categoria}</td>
                {magazzini.map((m) => <td key={m.id} className="num" style={{ color: (g.perMagazzino[m.id] ?? 0) < 0 ? 'var(--danger)' : undefined }}>{g.perMagazzino[m.id] ? formatQuantita(g.perMagazzino[m.id]) : '—'}</td>)}
                <td className="num"><strong>{formatQuantita(g.totale, g.materiale.unita)}</strong>{g.sottoScorta && <div><Badge tono="warn">sotto scorta</Badge></div>}</td>
                <td className="num">{formatQuantita(g.materiale.scorta_minima)}</td>
                <td className="num">{formatEuro(g.materiale.prezzo_acquisto)}</td>
                <td className="num">{formatEuro(g.materiale.prezzo_vendita)}</td>
                <td className="num">{formatEuro(g.valore)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={magazzini.length + 6}>Valore totale (a prezzo di acquisto attuale)</td><td className="num">{formatEuro(giacenze.reduce((a, g) => a + g.valore, 0))}</td></tr></tfoot>
          </table></div>
        )}
      </Card>
      <Card title={<h2 className="row" style={{ gap: 8 }}><Warehouse size={20} /> Magazzini</h2>} actions={<button className="btn btn-sm" onClick={() => setMagazzinoEdit('nuovo')}><Plus size={16} /> Nuovo magazzino</button>}>
        <div className="list">{magazzini.map((m) => (
          <button key={m.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setMagazzinoEdit(m)}>
            <div className="grow"><div className="title">{m.nome} {!m.attivo && <Badge>disattivato</Badge>}</div><div className="subtle">{m.codice} · {m.tipo === 'sede' ? 'Sede' : 'Automezzo'}{m.responsabile_id ? ` · affidato a ${nomeOperaio(s, m.responsabile_id)}` : ''}</div></div>
          </button>
        ))}</div>
      </Card>
      {edit && <MaterialeSheet m={edit === 'nuovo' ? null : edit} onClose={() => setEdit(null)} />}
      {magazzinoEdit && <MagazzinoSheet m={magazzinoEdit === 'nuovo' ? null : magazzinoEdit} onClose={() => setMagazzinoEdit(null)} />}
    </>
  );
}

function MaterialeSheet({ m, onClose }: { m: Materiale | null; onClose: () => void }) {
  const s = useData();
  const { runOk } = useApp();
  const [d, setD] = useState<DatiMateriale>(m ?? { codice: '', nome: '', descrizione: '', categoria: '', unita: 'pz', prezzo_acquisto: 0, prezzo_vendita: null, fornitore: '', scorta_minima: 0, attivo: true });
  const set = (p: Partial<DatiMateriale>) => setD((x) => ({ ...x, ...p }));
  const num = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')));
  const prezzoCambiato = m && m.prezzo_acquisto !== d.prezzo_acquisto;
  return (
    <Sheet wide title={m ? `${m.codice} – ${m.nome}` : 'Nuovo materiale'} onClose={onClose} footer={<>
      {m && <Link className="btn btn-ghost" to={`/admin/magazzino?vista=movimenti&materiale=${m.id}`} onClick={onClose}>Storico movimenti</Link>}
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" data-testid="materiale-salva" onClick={async () => { if (await runOk(() => s.magazzino.salvaMateriale(d, m?.id), 'Materiale salvato')) onClose(); }}>Salva</button>
    </>}>
      <div className="grid-2">
        <Field label="Codice" htmlFor="m-cod"><input id="m-cod" className="input" value={d.codice} onChange={(e) => set({ codice: e.target.value })} data-testid="m-codice" /></Field>
        <Field label="Nome" htmlFor="m-nome"><input id="m-nome" className="input" value={d.nome} onChange={(e) => set({ nome: e.target.value })} data-testid="m-nome" /></Field>
        <Field label="Categoria" htmlFor="m-cat"><input id="m-cat" className="input" list="m-categorie" value={d.categoria} onChange={(e) => set({ categoria: e.target.value })} data-testid="m-categoria" /><datalist id="m-categorie">{s.magazzino.categorie().map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Unità di misura" htmlFor="m-um"><select id="m-um" className="select" value={d.unita} onChange={(e) => set({ unita: e.target.value })}>{UNITA_MISURA.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Prezzo di acquisto (€)" htmlFor="m-pa" hint={prezzoCambiato ? 'Il nuovo prezzo vale per i movimenti futuri: i costi già registrati non cambiano.' : undefined}><input id="m-pa" className="input" type="number" min={0} step="0.01" value={d.prezzo_acquisto} onChange={(e) => set({ prezzo_acquisto: num(e.target.value) })} data-testid="m-prezzo-acquisto" /></Field>
        <Field label="Prezzo di vendita (€, facoltativo)" htmlFor="m-pv"><input id="m-pv" className="input" type="number" min={0} step="0.01" value={d.prezzo_vendita ?? ''} onChange={(e) => set({ prezzo_vendita: e.target.value === '' ? null : num(e.target.value) })} /></Field>
        <Field label="Fornitore" htmlFor="m-forn"><input id="m-forn" className="input" value={d.fornitore} onChange={(e) => set({ fornitore: e.target.value })} /></Field>
        <Field label="Scorta minima" htmlFor="m-scorta"><input id="m-scorta" className="input" type="number" min={0} step="1" value={d.scorta_minima} onChange={(e) => set({ scorta_minima: num(e.target.value) })} data-testid="m-scorta" /></Field>
      </div>
      <Field label="Descrizione" htmlFor="m-desc"><textarea id="m-desc" className="textarea" style={{ minHeight: 60 }} value={d.descrizione} onChange={(e) => set({ descrizione: e.target.value })} /></Field>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.attivo} onChange={(e) => set({ attivo: e.target.checked })} data-testid="m-attivo" /> Attivo (i materiali disattivati non si scelgono nei nuovi rapportini; storico e giacenze restano)</label>
    </Sheet>
  );
}

function MagazzinoSheet({ m, onClose }: { m: Magazzino | null; onClose: () => void }) {
  const s = useData();
  const { runOk } = useApp();
  const [d, setD] = useState({ codice: m?.codice ?? '', nome: m?.nome ?? '', tipo: m?.tipo ?? 'automezzo' as Magazzino['tipo'], responsabile_id: m?.responsabile_id ?? null as string | null, attivo: m?.attivo ?? true });
  return (
    <Sheet title={m ? m.nome : 'Nuovo magazzino'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" onClick={async () => { if (await runOk(() => s.magazzino.salvaMagazzino(d, m?.id), 'Magazzino salvato')) onClose(); }}>Salva</button>
    </>}>
      <Field label="Codice" htmlFor="g-cod"><input id="g-cod" className="input" value={d.codice} onChange={(e) => setD({ ...d, codice: e.target.value })} /></Field>
      <Field label="Nome" htmlFor="g-nome"><input id="g-nome" className="input" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></Field>
      <Field label="Tipo" htmlFor="g-tipo"><select id="g-tipo" className="select" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as Magazzino['tipo'] })}><option value="sede">Sede</option><option value="automezzo">Automezzo</option></select></Field>
      <Field label="Affidato a (magazzino proposto per i suoi consumi)" htmlFor="g-resp">
        <select id="g-resp" className="select" value={d.responsabile_id ?? ''} onChange={(e) => setD({ ...d, responsabile_id: e.target.value || null })}>
          <option value="">— Nessuno —</option>{s.planning.operai().map((o) => <option key={o.id} value={o.id}>{o.nome} {o.cognome}</option>)}
        </select>
      </Field>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.attivo} onChange={(e) => setD({ ...d, attivo: e.target.checked })} /> Attivo</label>
    </Sheet>
  );
}

// --- movimenti -------------------------------------------------------------------------
function Movimenti({ materialeId, onMateriale }: { materialeId: string; onMateriale: (id: string) => void }) {
  const s = useData();
  const [magazzinoId, setMagazzinoId] = useState('');
  const [tipo, setTipo] = useState<MovimentoTipo | ''>('');
  const [nuovo, setNuovo] = useState<TipoManuale | null>(null);
  const movimenti = s.magazzino.movimenti({ materialeId: materialeId || undefined, magazzinoId: magazzinoId || undefined, tipo: tipo || undefined });
  return (
    <>
      <Card pad>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setNuovo('carico')} data-testid="mov-carico"><ArrowDownToLine /> Carico</button>
          <button className="btn" onClick={() => setNuovo('scarico')} data-testid="mov-scarico"><ArrowUpFromLine /> Scarico</button>
          <button className="btn" onClick={() => setNuovo('rettifica')} data-testid="mov-rettifica"><ClipboardPen /> Rettifica</button>
          <button className="btn" onClick={() => setNuovo('trasferimento')} data-testid="mov-trasferimento"><ArrowLeftRight /> Trasferimento</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <select className="select" style={{ flex: '2 1 200px' }} value={materialeId} onChange={(e) => onMateriale(e.target.value)} aria-label="Materiale" data-testid="filtro-materiale">
            <option value="">Tutti i materiali</option>{s.magazzino.materiali().map((m) => <option key={m.id} value={m.id}>{m.codice} – {m.nome}</option>)}
          </select>
          <select className="select" style={{ flex: '1 1 160px' }} value={magazzinoId} onChange={(e) => setMagazzinoId(e.target.value)} aria-label="Magazzino">
            <option value="">Tutti i magazzini</option>{s.magazzino.magazzini().map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <select className="select" style={{ flex: '1 1 160px' }} value={tipo} onChange={(e) => setTipo(e.target.value as MovimentoTipo | '')} aria-label="Tipo">
            <option value="">Tutti i tipi</option>{Object.entries(ETICHETTE_MOVIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {materialeId && <p className="subtle" style={{ marginBottom: 0 }}>Giacenza attuale: <strong>{formatQuantita(s.magazzino.giacenza(materialeId, magazzinoId || null), s.db.get('materiali', materialeId)?.unita)}</strong>{magazzinoId ? ` in ${nomeMagazzino(s, magazzinoId)}` : ' (tutti i magazzini)'}</p>}
      </Card>
      <Card title={`Storico movimenti (${movimenti.length})`} actions={<span className="subtle">I movimenti non si modificano: si correggono con un nuovo movimento</span>}>
        <TabellaMovimenti movimenti={movimenti.slice(0, 300)} conMateriale={!materialeId} />
      </Card>
      {nuovo && <MovimentoSheet tipo={nuovo} materialeIniziale={materialeId} onClose={() => setNuovo(null)} />}
    </>
  );
}

function MovimentoSheet({ tipo, materialeIniziale, onClose }: { tipo: TipoManuale; materialeIniziale: string; onClose: () => void }) {
  const s = useData();
  const { runOk } = useApp();
  const magazzini = s.magazzino.magazzini(true);
  const [materialeId, setMaterialeId] = useState(materialeIniziale);
  const [magazzinoId, setMagazzinoId] = useState(magazzini.find((m) => m.tipo === 'sede')?.id ?? magazzini[0]?.id ?? '');
  const [destinazione, setDestinazione] = useState('');
  const [quantita, setQuantita] = useState('');
  const [costo, setCosto] = useState('');
  const [aggiornaPrezzo, setAggiornaPrezzo] = useState(false);
  const [documento, setDocumento] = useState('');
  const [motivo, setMotivo] = useState('');
  const mat = s.db.get('materiali', materialeId);
  const giac = mat ? s.magazzino.giacenza(mat.id, magazzinoId) : 0;
  const q = Number(quantita.replace(',', '.'));
  const titolo = { carico: 'Registra carico', scarico: 'Registra scarico', rettifica: 'Rettifica inventario', trasferimento: 'Trasferimento tra magazzini' }[tipo];
  const esegui = () => {
    switch (tipo) {
      case 'carico': return s.magazzino.registraCarico({ materiale_id: materialeId, magazzino_id: magazzinoId, quantita: q, documento, motivo, costo_unitario: costo === '' ? undefined : Number(costo.replace(',', '.')), aggiornaPrezzo });
      case 'scarico': return s.magazzino.registraScarico({ materiale_id: materialeId, magazzino_id: magazzinoId, quantita: q, documento, motivo });
      case 'rettifica': return s.magazzino.rettifica({ materiale_id: materialeId, magazzino_id: magazzinoId, giacenzaContata: quantita === '' ? NaN : q, motivo });
      case 'trasferimento': return s.magazzino.trasferisci({ materiale_id: materialeId, da_magazzino_id: magazzinoId, a_magazzino_id: destinazione, quantita: q, motivo });
    }
  };
  return (
    <Sheet title={titolo} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={!materialeId || quantita === ''} data-testid="movimento-conferma" onClick={async () => { if (await runOk(esegui, 'Movimento registrato')) onClose(); }}>Registra</button>
    </>}>
      <Field label="Materiale" htmlFor="mv-mat">
        <select id="mv-mat" className="select" value={materialeId} onChange={(e) => setMaterialeId(e.target.value)} data-testid="movimento-materiale">
          <option value="">— Scegli —</option>{s.magazzino.materiali({ soloAttivi: tipo === 'carico' }).map((m) => <option key={m.id} value={m.id}>{m.codice} – {m.nome}</option>)}
        </select>
      </Field>
      <Field label={tipo === 'trasferimento' ? 'Da magazzino' : 'Magazzino'} htmlFor="mv-mag" hint={mat ? `Giacenza attuale: ${formatQuantita(giac, mat.unita)}` : undefined}>
        <select id="mv-mag" className="select" value={magazzinoId} onChange={(e) => setMagazzinoId(e.target.value)} data-testid="movimento-magazzino">{magazzini.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
      </Field>
      {tipo === 'trasferimento' && (
        <Field label="A magazzino" htmlFor="mv-dest"><select id="mv-dest" className="select" value={destinazione} onChange={(e) => setDestinazione(e.target.value)} data-testid="movimento-destinazione"><option value="">— Scegli —</option>{magazzini.filter((m) => m.id !== magazzinoId).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Field>
      )}
      <Field label={tipo === 'rettifica' ? `Quantità contata${mat ? ` (${mat.unita})` : ''}` : `Quantità${mat ? ` (${mat.unita})` : ''}`} htmlFor="mv-q" hint={tipo === 'rettifica' && mat && quantita !== '' ? `Differenza registrata: ${formatQuantita(Math.round((q - giac) * 1000) / 1000, mat.unita)}` : undefined}>
        <input id="mv-q" className="input" type="number" min={0} step="0.5" value={quantita} onChange={(e) => setQuantita(e.target.value)} data-testid="movimento-quantita" />
      </Field>
      {tipo === 'carico' && (
        <>
          <Field label="Costo unitario (€)" htmlFor="mv-costo" hint={mat ? `Vuoto = prezzo di anagrafica (${formatEuro(mat.prezzo_acquisto)})` : undefined}><input id="mv-costo" className="input" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></Field>
          {costo !== '' && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={aggiornaPrezzo} onChange={(e) => setAggiornaPrezzo(e.target.checked)} /> Aggiorna il prezzo di acquisto in anagrafica (solo per i movimenti futuri)</label>}
        </>
      )}
      {(tipo === 'carico' || tipo === 'scarico') && <Field label="Documento (DDT, fattura, reso)" htmlFor="mv-doc"><input id="mv-doc" className="input" value={documento} onChange={(e) => setDocumento(e.target.value)} /></Field>}
      <Field label={tipo === 'scarico' || tipo === 'rettifica' ? 'Motivo (obbligatorio)' : 'Note'} htmlFor="mv-mot"><textarea id="mv-mot" className="textarea" style={{ minHeight: 60 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="movimento-motivo" /></Field>
    </Sheet>
  );
}

// --- costi e consumi ---------------------------------------------------------------------
function Costi() {
  const s = useData();
  const oggi = localDate(s.db.now());
  const [da, setDa] = useState(inizioMese(oggi));
  const [a, setA] = useState(oggi);
  const [cliente, setCliente] = useState('');
  const [tutti, setTutti] = useState(false);
  const r = s.magazzino.riepilogoCosti({ da, a, clienteId: cliente || undefined });
  const unita = (id: string) => s.db.get('materiali', id)?.unita;
  return (
    <>
      <Card pad>
        <div className="row">
          <Field label="Dal" htmlFor="c-da"><input id="c-da" className="input" type="date" value={da} onChange={(e) => setDa(e.target.value)} data-testid="costi-da" /></Field>
          <Field label="Al" htmlFor="c-a"><input id="c-a" className="input" type="date" value={a} onChange={(e) => setA(e.target.value)} data-testid="costi-a" /></Field>
          <Field label="Cliente" htmlFor="c-cli"><select id="c-cli" className="select" value={cliente} onChange={(e) => setCliente(e.target.value)}><option value="">Tutti</option>{s.planning.clienti().map((c) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}</select></Field>
        </div>
        <p className="subtle" style={{ marginBottom: 0 }}>Periodo riferito alla data del rapportino. Costi = costo unitario registrato al momento dello scarico (le variazioni di prezzo successive non li modificano); il valore a prezzo di vendita è indicativo e separato.</p>
      </Card>
      <div className="grid-3">
        <Stat label="Costo materiali" value={formatEuro(r.costo)} testId="costi-totale" />
        <Stat label="Valore a prezzo di vendita" value={formatEuro(r.vendita)} />
        <Stat label="Consumi registrati" value={r.righe} />
      </div>
      <div className="split">
        <Card title="Per cliente"><TabellaVoci voci={r.perCliente} etichetta="Cliente" nome={(k) => nomeCliente(s, k)} /></Card>
        <Card title="Materiali più utilizzati"><TabellaVoci voci={r.perMateriale} etichetta="Materiale" nome={(k) => s.db.get('materiali', k)?.nome ?? '—'} quantita={(v) => formatQuantita(v.quantita, unita(v.chiave))} /></Card>
      </div>
      <Card title={`Per intervento (${r.perIntervento.length})`} actions={r.perIntervento.length > 15 ? <button className="btn btn-sm btn-ghost" onClick={() => setTutti(!tutti)}>{tutti ? 'Mostra i primi 15' : 'Mostra tutti'}</button> : undefined}>
        <TabellaVoci voci={tutti ? r.perIntervento : r.perIntervento.slice(0, 15)} etichetta="Intervento" nome={(k) => <NomeIntervento id={k} />} />
      </Card>
      <div className="split">
        <Card title="Per lavoratore"><TabellaVoci voci={r.perOperaio} etichetta="Lavoratore" nome={(k) => nomeOperaio(s, k)} /></Card>
        <Card title="Per tipologia di intervento"><TabellaVoci voci={r.perTipoIntervento} etichetta="Tipologia" nome={(k) => TIPO_INTERVENTO[k as keyof typeof TIPO_INTERVENTO] ?? k} /></Card>
      </div>
    </>
  );
}
