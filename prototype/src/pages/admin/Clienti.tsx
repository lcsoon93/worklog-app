import { Building2, MapPin, Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { calcolaDaRecord } from '../../domain/day-records';
import { formatData } from '../../domain/time';
import type { Cliente } from '../../domain/types';
import { Badge, Card, Empty, Field, InterventoBadge, PageHead, Sheet, Stat, SyncBadge } from '../../ui/components';
import { SedeSheet } from './Sedi';

export function Clienti() {
  const s = useData();
  const { run } = useApp();
  const permesso = s.planning.operaiCreanoClienti();
  const [q, setQ] = useState('');
  const [nuovo, setNuovo] = useState(false);
  const lista = s.planning.clienti().filter((c) => c.ragione_sociale.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <PageHead title="Clienti" eyebrow="Anagrafica" actions={<button className="btn btn-primary" onClick={() => setNuovo(true)}><Plus /> Nuovo cliente</button>} />
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: 14, top: 17, color: 'var(--text-3)' }} />
        <input className="input" style={{ paddingLeft: 40 }} placeholder="Cerca cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <label className="row permesso" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" className="spunta" checked={permesso} onChange={() => run(() => s.planning.impostaOperaiCreanoClienti(!permesso), permesso ? 'Solo l\'amministratore può creare clienti' : 'Gli operai possono creare clienti dal rapporto autonomo')} data-testid="permesso-operai-clienti" />
        <span>Gli operai possono aggiungere un nuovo cliente dal rapporto autonomo <span className="subtle">(i clienti creati dal campo sono segnalati nelle note)</span></span>
      </label>
      <Card title={`${lista.length} clienti`}>
        {lista.length === 0 ? <Empty>Nessun cliente.</Empty> : lista.map((c) => {
          const sedi = s.planning.sedi(c.id).length;
          const aperti = s.db.where('interventi', (i) => i.cliente_id === c.id && ['programmato', 'in_corso', 'da_ultimare', 'da_programmare'].includes(i.stato)).length;
          return (
            <Link key={c.id} className="list-row" to={`/admin/clienti/${c.id}`} data-testid="cliente-riga">
              <span className="tile-icon" style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' }}><Building2 size={20} /></span>
              <div className="grow"><div className="title">{c.ragione_sociale}</div><div className="subtle">P.IVA {c.partita_iva || '—'} · {c.referente}</div></div>
              {c.note.startsWith('Creato dal campo') && <Badge tono="warn">Da completare</Badge>}
              <Badge>{sedi} sedi</Badge>
              <Badge tono={aperti ? 'info' : 'neutral'}>{aperti} interventi aperti</Badge>
              {!c.attivo && <Badge tono="danger">Non attivo</Badge>}
            </Link>
          );
        })}
      </Card>
      {nuovo && <ClienteSheet onClose={() => setNuovo(false)} />}
    </div>
  );
}

export function ClienteSheet({ cliente, onClose }: { cliente?: Cliente; onClose: () => void }) {
  const { s, run } = useApp();
  const [c, setC] = useState<Partial<Cliente>>(cliente ?? { ragione_sociale: '', partita_iva: '', email: '', telefono: '', referente: '', note: '', attivo: true });
  const set = (p: Partial<Cliente>) => setC((x) => ({ ...x, ...p }));
  return (
    <Sheet title={cliente ? 'Modifica cliente' : 'Nuovo cliente'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" onClick={async () => { const ok = await run(() => s.planning.salvaCliente(c as Cliente), 'Cliente salvato'); if (ok) onClose(); }}>Salva</button>
    </>}>
      <Field label="Ragione sociale" htmlFor="c-rs"><input id="c-rs" className="input" value={c.ragione_sociale} onChange={(e) => set({ ragione_sociale: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Partita IVA" htmlFor="c-piva" hint="11 cifre"><input id="c-piva" className="input" inputMode="numeric" value={c.partita_iva} onChange={(e) => set({ partita_iva: e.target.value })} /></Field>
        <Field label="Referente" htmlFor="c-ref"><input id="c-ref" className="input" value={c.referente} onChange={(e) => set({ referente: e.target.value })} /></Field>
        <Field label="Telefono" htmlFor="c-tel"><input id="c-tel" className="input" type="tel" value={c.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Field>
        <Field label="Email" htmlFor="c-mail"><input id="c-mail" className="input" type="email" value={c.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      </div>
      <Field label="Note" htmlFor="c-note"><textarea id="c-note" className="textarea" value={c.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      <label className="row"><input type="checkbox" checked={c.attivo} onChange={(e) => set({ attivo: e.target.checked })} style={{ width: 22, height: 22 }} /> Cliente attivo</label>
    </Sheet>
  );
}

export function ClienteScheda() {
  const { id } = useParams();
  const s = useData();
  const [modifica, setModifica] = useState(false);
  const [sede, setSede] = useState<string | 'nuova' | null>(null);
  const c = s.db.get('clienti', id);
  if (!c) return <Empty>Cliente non trovato.</Empty>;
  const sedi = s.planning.sedi(c.id);
  const interventi = s.db.where('interventi', (i) => i.cliente_id === c.id).sort((a, b) => (b.data_programmata ?? '9').localeCompare(a.data_programmata ?? '9'));
  const rapportini = s.report.rapportini((r) => r.cliente_id === c.id);
  // Ore attribuite al cliente negli ultimi 60 giorni (calcolate dal motore, giornata per giornata).
  const pids = [...new Set(s.db.where('attivita_lavoro', (a) => a.cliente_id === c.id).map((a) => a.presenza_id))];
  let ore = 0;
  for (const pid of pids) {
    const p = s.db.get('presenze', pid);
    if (p) ore += calcolaDaRecord(p, s.db.all('pause_presenza'), s.db.where('attivita_lavoro', (a) => a.presenza_id === pid), s.db.now()).per_cliente[c.id] ?? 0;
  }

  return (
    <div className="stack">
      <PageHead title={c.ragione_sociale} eyebrow="Scheda cliente" back={{ to: '/admin/clienti', label: 'Clienti' }} actions={<>
        <button className="btn" onClick={() => setModifica(true)}><Pencil size={18} /> Modifica</button>
        <Link className="btn btn-primary" to={`/admin/interventi/nuovo?cliente=${c.id}`}><Plus /> Nuovo intervento</Link>
      </>}>
        <div className="row" style={{ marginTop: 8 }}>{c.attivo ? <Badge tono="ok">Attivo</Badge> : <Badge tono="danger">Non attivo</Badge>}<SyncBadge stato={c.sync_stato} /></div>
      </PageHead>
      <div className="grid-4">
        <Stat label="Sedi" value={sedi.length} />
        <Stat label="Interventi" value={interventi.length} sub={`${interventi.filter((i) => i.stato === 'da_ultimare').length} da ultimare`} />
        <Stat label="Rapportini" value={rapportini.length} />
        <Stat label="Ore registrate" value={formatDurata(ore)} sub="lavoro + trasferimenti" />
      </div>
      <div className="split">
        <div className="stack">
          <Card title="Sedi operative" actions={<button className="btn btn-sm" onClick={() => setSede('nuova')}><Plus size={16} /> Sede</button>}>
            {sedi.map((x) => (
              <button key={x.id} className="list-row" onClick={() => setSede(x.id)}>
                <MapPin />
                <div className="grow"><div className="title">{x.nome}</div><div className="subtle">{x.indirizzo}, {x.cap} {x.citta} ({x.provincia})</div>{x.note_accesso && <div className="subtle">Accesso: {x.note_accesso}</div>}</div>
              </button>
            ))}
          </Card>
          <Card title="Interventi">
            {interventi.slice(0, 12).map((i) => (
              <Link key={i.id} className="list-row" to={`/interventi/${i.id}`}>
                <div className="grow"><div className="title">{i.titolo}</div><div className="subtle">{i.codice} · {i.data_programmata ? formatData(i.data_programmata, { breve: true }) : 'da programmare'}</div></div>
                <InterventoBadge stato={i.stato} />
              </Link>
            ))}
            {interventi.length > 12 && <div className="card-foot subtle">e altri {interventi.length - 12} interventi</div>}
          </Card>
        </div>
        <Card title="Dati" pad>
          <dl className="kv">
            <dt>P.IVA</dt><dd>{c.partita_iva || '—'}</dd>
            <dt>Referente</dt><dd>{c.referente}</dd>
            <dt>Telefono</dt><dd>{c.telefono}</dd>
            <dt>Email</dt><dd>{c.email}</dd>
            <dt>Note</dt><dd>{c.note || '—'}</dd>
          </dl>
        </Card>
      </div>
      {modifica && <ClienteSheet cliente={c} onClose={() => setModifica(false)} />}
      {sede && <SedeSheet clienteId={c.id} sede={sede === 'nuova' ? undefined : s.db.get('sedi_cliente', sede)} onClose={() => setSede(null)} />}
    </div>
  );
}
