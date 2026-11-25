import { CalendarPlus, Save } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import type { InterventoTipo, Priorita } from '../../domain/types';
import type { DatiIntervento } from '../../services/planning-service';
import { Card, Field, PageHead, Segmented } from '../../ui/components';
import { nomeSede } from '../../ui/labels';
import { SceltaSquadra } from './Assegnazione';

export function InterventoForm() {
  const { id } = useParams();
  const s = useData();
  const { run, runOk } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const esistente = s.db.get('interventi', id);
  const [d, setD] = useState<DatiIntervento>(esistente ? {
    cliente_id: esistente.cliente_id, sede_id: esistente.sede_id, titolo: esistente.titolo, descrizione: esistente.descrizione, tipo: esistente.tipo, priorita: esistente.priorita,
    data_programmata: esistente.data_programmata, ora_inizio: esistente.ora_inizio, durata_prevista_min: esistente.durata_prevista_min, note: esistente.note,
  } : {
    cliente_id: params.get('cliente') ?? '', sede_id: null, titolo: '', descrizione: '', tipo: 'manutenzione', priorita: 'normale',
    data_programmata: params.get('data'), ora_inizio: '08:00', durata_prevista_min: 120, note: '',
  });
  const [squadra, setSquadra] = useState<string[]>([]);
  const set = (p: Partial<DatiIntervento>) => setD((x) => ({ ...x, ...p }));
  const sedi = d.cliente_id ? s.planning.sedi(d.cliente_id) : [];

  const salva = async () => {
    if (esistente) {
      const ok = await runOk(() => s.planning.aggiornaIntervento(esistente.id, d), 'Intervento aggiornato');
      if (ok) navigate(`/interventi/${esistente.id}`);
    } else {
      const i = await run(() => s.planning.creaIntervento(d, squadra), 'Intervento programmato');
      if (i) navigate(`/interventi/${i.id}`);
    }
  };

  return (
    <div className="stack">
      <PageHead title={esistente ? `Modifica ${esistente.codice}` : 'Programma intervento'} eyebrow="Programmazione" back={{ to: esistente ? `/interventi/${esistente.id}` : '/agenda/settimana', label: esistente ? 'Scheda intervento' : 'Agenda' }} />
      <div className="split">
        <div className="stack">
          <Card title="Cosa e dove" pad>
            <div className="stack">
              <div className="grid-2">
                <Field label="Cliente" htmlFor="i-cli">
                  <select id="i-cli" className="select" value={d.cliente_id} onChange={(e) => { const sd = s.planning.sedi(e.target.value); set({ cliente_id: e.target.value, sede_id: sd.length === 1 ? sd[0].id : null }); }} data-testid="int-cliente">
                    <option value="">— Seleziona —</option>
                    {s.planning.clienti().filter((c) => c.attivo).map((c) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
                  </select>
                </Field>
                <Field label="Sede" htmlFor="i-sede">
                  <select id="i-sede" className="select" value={d.sede_id ?? ''} onChange={(e) => set({ sede_id: e.target.value || null })} disabled={!d.cliente_id}>
                    <option value="">— Non indicata —</option>
                    {sedi.map((x) => <option key={x.id} value={x.id}>{nomeSede(s, x.id)}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Titolo" htmlFor="i-tit"><input id="i-tit" className="input" value={d.titolo} onChange={(e) => set({ titolo: e.target.value })} placeholder="Es. Manutenzione caldaia" data-testid="int-titolo" /></Field>
              <Field label="Descrizione per gli operai" htmlFor="i-desc"><textarea id="i-desc" className="textarea" value={d.descrizione} onChange={(e) => set({ descrizione: e.target.value })} /></Field>
              <div className="field"><span className="label">Tipo</span>
                <Segmented<InterventoTipo> value={d.tipo} onChange={(v) => set({ tipo: v })} options={[{ value: 'manutenzione', label: 'Manutenzione' }, { value: 'riparazione', label: 'Riparazione' }, { value: 'installazione', label: 'Installazione' }, { value: 'sopralluogo', label: 'Sopralluogo' }]} />
              </div>
              <div className="field"><span className="label">Priorità</span>
                <Segmented<Priorita> value={d.priorita} onChange={(v) => set({ priorita: v })} options={[{ value: 'bassa', label: 'Bassa' }, { value: 'normale', label: 'Normale' }, { value: 'alta', label: 'Alta' }, { value: 'urgente', label: 'Urgente' }]} />
              </div>
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Quando" pad>
            <div className="stack">
              <Field label="Data" htmlFor="i-data" hint="Lascia vuoto per “da programmare”."><input id="i-data" type="date" className="input" value={d.data_programmata ?? ''} onChange={(e) => set({ data_programmata: e.target.value || null })} data-testid="int-data" /></Field>
              <div className="grid-2">
                <Field label="Ora inizio" htmlFor="i-ora"><input id="i-ora" type="time" className="input" value={d.ora_inizio ?? ''} onChange={(e) => set({ ora_inizio: e.target.value || null })} /></Field>
                <Field label="Durata (min)" htmlFor="i-dur"><input id="i-dur" type="number" min={15} step={15} className="input" value={d.durata_prevista_min ?? ''} onChange={(e) => set({ durata_prevista_min: Number(e.target.value) || null })} /></Field>
              </div>
            </div>
          </Card>
          {!esistente && (
            <Card title="Squadra" pad>
              <SceltaSquadra data={d.data_programmata} ora={d.ora_inizio} durata={d.durata_prevista_min} selezionati={squadra} onChange={setSquadra} />
            </Card>
          )}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" onClick={() => void salva()} data-testid="int-salva">{esistente ? <><Save /> Salva modifiche</> : <><CalendarPlus /> Programma intervento</>}</button>
      </div>
    </div>
  );
}
