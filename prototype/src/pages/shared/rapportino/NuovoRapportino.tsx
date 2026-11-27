/** Nuovo rapporto di lavoro autonomo (Fase 12): cliente, luogo, richiesta, firma prevista. */
import { Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useData, useUtente } from '../../../app/AppContext';
import type { Rapportino } from '../../../domain/types';
import { Alert, Card, PageHead, Segmented, Sheet } from '../../../ui/components';

export function NuovoRapportino() {
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
