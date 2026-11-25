import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { localDate, meseDi } from '../../domain/time';
import { usernameDi } from '../../config/accesso';
import type { Profilo } from '../../domain/types';
import { Avatar, Badge, Card, Field, PageHead, Sheet } from '../../ui/components';

export function Operai() {
  const s = useData();
  const [sel, setSel] = useState<Profilo | 'nuovo' | null>(null);
  const { anno, mese } = meseDi(localDate(s.db.now()));
  return (
    <div className="stack">
      <PageHead title="Operai" eyebrow="Gestione personale" actions={<button className="btn btn-primary" onClick={() => setSel('nuovo')}><Plus /> Nuovo operaio</button>} />
      <Card title="Elenco">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Operaio</th><th>Qualifica</th><th>Contatti</th><th className="num">Ore mese corrente</th><th>Stato</th><th /></tr></thead>
            <tbody>
              {s.planning.operai().map((o) => {
                const t = s.timesheet.anteprima(o.id, anno, mese).totali;
                return (
                  <tr key={o.id}>
                    <td><div className="row" style={{ gap: 10 }}><Avatar p={o} size={36} /><strong>{o.nome} {o.cognome}</strong></div></td>
                    <td>{o.qualifica}</td>
                    <td className="small">Utente: <strong>{usernameDi(o)}</strong><br />{o.telefono}</td>
                    <td className="num">{formatDurata(t.netta_ms)}</td>
                    <td>{o.attivo ? <Badge tono="ok">Attivo</Badge> : <Badge tono="danger">Disattivato</Badge>}</td>
                    <td><div className="row" style={{ gap: 6 }}><Link className="btn btn-sm" to={`/admin/presenze?operaio=${o.id}`}>Presenze</Link><button className="btn btn-sm" onClick={() => setSel(o)}>Modifica</button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="subtle">Nel prototipo la creazione di un operaio crea solo il profilo. In produzione l'account (nome utente e PIN di 6 cifre) viene creato in Supabase Auth.</p>
      {sel && <OperaioSheet p={sel === 'nuovo' ? undefined : sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function OperaioSheet({ p, onClose }: { p?: Profilo; onClose: () => void }) {
  const { s, run } = useApp();
  const [x, setX] = useState<Partial<Profilo>>(p ?? { nome: '', cognome: '', email: '', telefono: '', qualifica: 'Operaio', attivo: true, ore_giornaliere_contratto: 8, colore: '#0f766e', ruolo: 'operaio' });
  const set = (v: Partial<Profilo>) => setX((o) => ({ ...o, ...v }));
  return (
    <Sheet title={p ? 'Modifica operaio' : 'Nuovo operaio'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" onClick={async () => { const ok = await run(() => s.planning.salvaOperaio(x as Profilo), 'Operaio salvato'); if (ok) onClose(); }}>Salva</button>
    </>}>
      <div className="grid-2">
        <Field label="Nome" htmlFor="o-n"><input id="o-n" className="input" value={x.nome} onChange={(e) => set({ nome: e.target.value })} /></Field>
        <Field label="Cognome" htmlFor="o-c"><input id="o-c" className="input" value={x.cognome} onChange={(e) => set({ cognome: e.target.value })} /></Field>
        <Field label="Nome utente (accesso con PIN)" htmlFor="o-u"><input id="o-u" className="input" autoCapitalize="none" value={x.username ?? ''} onChange={(e) => set({ username: e.target.value })} /></Field>
        <Field label="Email" htmlFor="o-e"><input id="o-e" className="input" type="email" value={x.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Telefono" htmlFor="o-t"><input id="o-t" className="input" type="tel" value={x.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Field>
        <Field label="Qualifica" htmlFor="o-q"><input id="o-q" className="input" value={x.qualifica} onChange={(e) => set({ qualifica: e.target.value })} /></Field>
        <Field label="Ore giornaliere da contratto" htmlFor="o-h"><input id="o-h" className="input" type="number" min={1} max={12} value={x.ore_giornaliere_contratto} onChange={(e) => set({ ore_giornaliere_contratto: Number(e.target.value) })} /></Field>
        <Field label="Colore agenda" htmlFor="o-col"><input id="o-col" className="input" type="color" value={x.colore} onChange={(e) => set({ colore: e.target.value })} /></Field>
      </div>
      <label className="row"><input type="checkbox" checked={x.attivo} onChange={(e) => set({ attivo: e.target.checked })} style={{ width: 22, height: 22 }} /> Attivo (può accedere e timbrare)</label>
    </Sheet>
  );
}
