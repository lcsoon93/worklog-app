import { CalendarPlus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { addDays, formatData, localDate } from '../../domain/time';
import type { Followup, FollowupStato, Priorita } from '../../domain/types';
import { Badge, Card, ConfirmSheet, Empty, Field, PageHead, Segmented, Sheet } from '../../ui/components';
import { nomeCliente, nomeOperaio, nomeSede } from '../../ui/labels';
import { SceltaSquadra } from './Assegnazione';

export function Ritorni() {
  const s = useData();
  const { runOk } = useApp();
  const [stato, setStato] = useState<FollowupStato>('aperto');
  const [pianifica, setPianifica] = useState<Followup | null>(null);
  const [annulla, setAnnulla] = useState<Followup | null>(null);
  const lista = s.report.followup((f) => f.stato === stato);
  return (
    <div className="stack">
      <PageHead title="Ritorni e lavori da ultimare" eyebrow="Gestione ritorni" actions={<Segmented value={stato} onChange={setStato} options={[{ value: 'aperto', label: 'Da pianificare' }, { value: 'pianificato', label: 'Pianificati' }, { value: 'chiuso', label: 'Chiusi' }, { value: 'annullato', label: 'Annullati' }]} />} />
      <Card title={`${lista.length} elementi`}>
        {lista.length === 0 ? <Empty icon={<RotateCcw />}>Nessun elemento.</Empty> : lista.map((f) => {
          const r = s.db.get('rapportini', f.rapportino_origine_id);
          return (
            <div key={f.id} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }} data-testid="ritorno-riga">
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><strong>{nomeCliente(s, f.cliente_id)}</strong><Badge tono={f.tipo === 'ritorno' ? 'warn' : 'danger'}>{f.tipo === 'ritorno' ? 'Ritorno' : 'Da ultimare'}</Badge><Badge tono={f.priorita === 'alta' || f.priorita === 'urgente' ? 'danger' : 'neutral'}>{f.priorita}</Badge></div>
                <div className="small" style={{ marginTop: 4 }}>“{f.motivo}”</div>
                <div className="subtle" style={{ marginTop: 4 }}>
                  Origine: {r ? <Link to={`/rapportini/${r.id}`}>{r.numero ?? r.numero_provvisorio}</Link> : '—'} del {r ? formatData(r.data_lavoro, { breve: true }) : '—'} ({r ? nomeOperaio(s, r.redatto_da) : ''}) · {nomeSede(s, f.sede_id)}
                  {f.intervento_origine_id && <> · <Link to={`/interventi/${f.intervento_origine_id}`}>intervento originale</Link></>}
                  {f.intervento_ritorno_id && <> · <Link to={`/interventi/${f.intervento_ritorno_id}`}>intervento di ritorno {f.data_suggerita ? `del ${formatData(f.data_suggerita, { breve: true })}` : ''}</Link></>}
                  {f.rapportino_chiusura_id && <> · <Link to={`/rapportini/${f.rapportino_chiusura_id}`}>rapportino di chiusura</Link></>}
                </div>
              </div>
              {f.stato === 'aperto' && <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-ghost" onClick={() => setAnnulla(f)}>Annulla</button>
                <button className="btn btn-primary" onClick={() => setPianifica(f)} data-testid="btn-pianifica"><CalendarPlus /> Pianifica</button>
              </div>}
            </div>
          );
        })}
      </Card>
      {pianifica && <PianificaSheet f={pianifica} onClose={() => setPianifica(null)} />}
      {annulla && <ConfirmSheet title="Annullare il ritorno?" tono="danger" conferma="Annulla ritorno" motivazione="obbligatoria" onClose={() => setAnnulla(null)} onConfirm={async (m) => { const ok = await runOk(() => s.report.annullaFollowup(annulla.id, m), 'Ritorno annullato'); if (ok) setAnnulla(null); }} />}
    </div>
  );
}

function PianificaSheet({ f, onClose }: { f: Followup; onClose: () => void }) {
  const { s, run } = useApp();
  const r = s.db.get('rapportini', f.rapportino_origine_id);
  const [data, setData] = useState(addDays(localDate(s.db.now()), 1));
  const [ora, setOra] = useState('09:00');
  const [durata, setDurata] = useState(90);
  const [priorita, setPriorita] = useState<Priorita>(f.priorita);
  const [operai, setOperai] = useState<string[]>(r ? [r.redatto_da] : []);
  return (
    <Sheet title={`Pianifica ritorno · ${nomeCliente(s, f.cliente_id)}`} wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" data-testid="conferma-pianifica" onClick={async () => { const ok = await run(() => s.report.pianificaRitorno(f.id, { data, ora, durata_min: durata, operai, priorita }), 'Ritorno pianificato: creato un nuovo intervento collegato'); if (ok) onClose(); }}>Crea intervento di ritorno</button>
    </>}>
      <p className="muted">Viene creato un nuovo intervento di tipo “ritorno” collegato al rapportino d'origine. Il rapportino del ritorno, se completato con esito positivo, chiuderà questo elemento.</p>
      <div className="grid-3">
        <Field label="Data" htmlFor="p-d"><input id="p-d" type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Ora" htmlFor="p-o"><input id="p-o" type="time" className="input" value={ora} onChange={(e) => setOra(e.target.value)} /></Field>
        <Field label="Durata (min)" htmlFor="p-m"><input id="p-m" type="number" className="input" value={durata} onChange={(e) => setDurata(Number(e.target.value))} /></Field>
      </div>
      <div className="field"><span className="label">Priorità</span><Segmented value={priorita} onChange={setPriorita} options={[{ value: 'bassa', label: 'Bassa' }, { value: 'normale', label: 'Normale' }, { value: 'alta', label: 'Alta' }, { value: 'urgente', label: 'Urgente' }]} /></div>
      <div className="field"><span className="label">Squadra</span><SceltaSquadra data={data} ora={ora} durata={durata} selezionati={operai} onChange={setOperai} /></div>
    </Sheet>
  );
}
