import { MapPin, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import type { SedeCliente } from '../../domain/types';
import { Badge, Card, Field, PageHead, Sheet } from '../../ui/components';
import { nomeCliente } from '../../ui/labels';

export function Sedi() {
  const s = useData();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<SedeCliente | 'nuova' | null>(null);
  const lista = s.planning.sedi().filter((x) => `${x.nome} ${x.citta} ${x.indirizzo} ${nomeCliente(s, x.cliente_id)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <PageHead title="Sedi operative" eyebrow="Anagrafica" actions={<button className="btn btn-primary" onClick={() => setSel('nuova')}><Plus /> Nuova sede</button>} />
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: 14, top: 17, color: 'var(--text-3)' }} />
        <input className="input" style={{ paddingLeft: 40 }} placeholder="Cerca per nome, città, cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card title={`${lista.length} sedi`}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Sede</th><th>Cliente</th><th>Indirizzo</th><th>Referente</th><th>Accesso</th><th /></tr></thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => setSel(x)}>
                  <td><div className="row" style={{ gap: 8 }}><MapPin size={18} /><strong>{x.nome}</strong></div></td>
                  <td><Link to={`/admin/clienti/${x.cliente_id}`} onClick={(e) => e.stopPropagation()}>{nomeCliente(s, x.cliente_id)}</Link></td>
                  <td>{x.indirizzo}, {x.cap} {x.citta} ({x.provincia})</td>
                  <td>{x.referente}</td>
                  <td className="small" style={{ maxWidth: 240 }}>{x.note_accesso || '—'}</td>
                  <td>{!x.attiva && <Badge tono="danger">Non attiva</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && <SedeSheet sede={sel === 'nuova' ? undefined : sel} onClose={() => setSel(null)} />}
    </div>
  );
}

export function SedeSheet({ sede, clienteId, onClose }: { sede?: SedeCliente; clienteId?: string; onClose: () => void }) {
  const { s, run } = useApp();
  const [x, setX] = useState<Partial<SedeCliente>>(sede ?? { cliente_id: clienteId ?? '', nome: '', indirizzo: '', cap: '', citta: '', provincia: '', referente: '', telefono: '', note_accesso: '', attiva: true });
  const set = (p: Partial<SedeCliente>) => setX((v) => ({ ...v, ...p }));
  return (
    <Sheet title={sede ? 'Modifica sede' : 'Nuova sede'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" onClick={async () => { const ok = await run(() => s.planning.salvaSede(x as SedeCliente), 'Sede salvata'); if (ok) onClose(); }}>Salva</button>
    </>}>
      <Field label="Cliente" htmlFor="s-cli">
        <select id="s-cli" className="select" value={x.cliente_id} disabled={!!sede || !!clienteId} onChange={(e) => set({ cliente_id: e.target.value })}>
          <option value="">— Seleziona —</option>
          {s.planning.clienti().map((c) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
        </select>
      </Field>
      <Field label="Nome sede" htmlFor="s-nome"><input id="s-nome" className="input" value={x.nome} onChange={(e) => set({ nome: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Indirizzo" htmlFor="s-ind"><input id="s-ind" className="input" value={x.indirizzo} onChange={(e) => set({ indirizzo: e.target.value })} /></Field>
        <Field label="Città" htmlFor="s-cit"><input id="s-cit" className="input" value={x.citta} onChange={(e) => set({ citta: e.target.value })} /></Field>
        <Field label="CAP" htmlFor="s-cap"><input id="s-cap" className="input" inputMode="numeric" value={x.cap} onChange={(e) => set({ cap: e.target.value })} /></Field>
        <Field label="Provincia" htmlFor="s-prov"><input id="s-prov" className="input" maxLength={2} value={x.provincia} onChange={(e) => set({ provincia: e.target.value.toUpperCase() })} /></Field>
        <Field label="Referente" htmlFor="s-ref"><input id="s-ref" className="input" value={x.referente} onChange={(e) => set({ referente: e.target.value })} /></Field>
        <Field label="Telefono" htmlFor="s-tel"><input id="s-tel" className="input" type="tel" value={x.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Field>
      </div>
      <Field label="Note di accesso" htmlFor="s-acc" hint="Chiavi, orari, DPI, parcheggio: visibili agli operai nella scheda intervento."><textarea id="s-acc" className="textarea" value={x.note_accesso} onChange={(e) => set({ note_accesso: e.target.value })} /></Field>
      <label className="row"><input type="checkbox" checked={x.attiva} onChange={(e) => set({ attiva: e.target.checked })} style={{ width: 22, height: 22 }} /> Sede attiva</label>
    </Sheet>
  );
}
