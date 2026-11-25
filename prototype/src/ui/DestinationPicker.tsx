/**
 * Selettore della destinazione di un'attività (intervento, cliente, interna, trasferimento,
 * da classificare). Usato da timer, classificazione e correzioni: stessa esperienza ovunque.
 */
import { Building2, Car, CircleHelp, Search, Warehouse, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '../app/AppContext';
import { CODICI_ATTIVITA_INTERNA, type CodiceAttivitaInterna } from '../domain/types';
import { localDate } from '../domain/time';
import type { Destinazione } from '../services/workday-service';
import { Segmented } from './components';
import { nomeSede } from './labels';

type Modo = 'interventi' | 'cliente' | 'interna' | 'trasferimento' | 'da_definire';

export function destinazioneVuota(): Destinazione {
  return { tipo: 'da_definire', cliente_id: null, sede_id: null, intervento_id: null, codice_interno: null, descrizione: '' };
}

export function DestinationPicker({ value, onChange, operaioId, data, escludiDaDefinire }: { value: Destinazione | null; onChange: (d: Destinazione | null) => void; operaioId: string; data?: string; escludiDaDefinire?: boolean }) {
  const s = useData();
  const giorno = data ?? localDate(s.db.now());
  const interventi = s.planning.interventiOperaio(operaioId, giorno);
  const [modo, setModo] = useState<Modo>(interventi.length ? 'interventi' : 'cliente');
  const [q, setQ] = useState('');
  const clienti = useMemo(() => s.planning.clienti().filter((c) => c.attivo && c.ragione_sociale.toLowerCase().includes(q.toLowerCase())), [s, q]);

  const set = (d: Partial<Destinazione>) => onChange({ ...destinazioneVuota(), ...d });
  const opzioni: Array<{ value: Modo; label: string }> = [
    { value: 'interventi', label: `Interventi di oggi (${interventi.length})` },
    { value: 'cliente', label: 'Cliente' },
    { value: 'interna', label: 'Interna' },
    { value: 'trasferimento', label: 'Trasferimento' },
  ];
  if (!escludiDaDefinire) opzioni.push({ value: 'da_definire', label: 'Senza cliente' });

  const clienteSel = value?.cliente_id ?? null;
  const sedi = clienteSel ? s.planning.sedi(clienteSel) : [];
  const interventiCliente = clienteSel ? s.db.where('interventi', (i) => i.cliente_id === clienteSel && ['programmato', 'in_corso', 'da_ultimare'].includes(i.stato)) : [];

  return (
    <div className="stack">
      <Segmented value={modo} options={opzioni} onChange={(m) => { setModo(m); onChange(m === 'da_definire' ? destinazioneVuota() : null); }} testId="dest-modo" />

      {modo === 'interventi' && (
        interventi.length ? (
          <div className="choices">
            {interventi.map((i) => (
              <button key={i.id} className={`choice ${value?.intervento_id === i.id ? 'on' : ''}`} onClick={() => set({ tipo: 'lavoro_cliente', intervento_id: i.id, cliente_id: i.cliente_id, sede_id: i.sede_id })} data-testid="dest-intervento">
                <Wrench size={22} />
                <span>
                  {s.db.get('clienti', i.cliente_id)?.ragione_sociale}
                  <small>{i.ora_inizio} · {i.titolo}</small>
                </span>
              </button>
            ))}
          </div>
        ) : <p className="muted">Nessun intervento assegnato per oggi. Scegli un cliente.</p>
      )}

      {(modo === 'cliente' || modo === 'trasferimento') && (
        <div className="stack">
          <div className="row" style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 14, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 40 }} placeholder="Cerca cliente…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca cliente" />
          </div>
          <div className="choices">
            {clienti.map((c) => (
              <button
                key={c.id}
                className={`choice ${clienteSel === c.id ? 'on' : ''}`}
                data-testid="dest-cliente"
                onClick={() => {
                  const sediC = s.planning.sedi(c.id);
                  set({ tipo: modo === 'trasferimento' ? 'trasferimento' : 'lavoro_cliente', cliente_id: c.id, sede_id: sediC.length === 1 ? sediC[0].id : null });
                }}
              >
                {modo === 'trasferimento' ? <Car size={22} /> : <Building2 size={22} />}
                <span>{c.ragione_sociale}<small>{s.planning.sedi(c.id).length} sedi</small></span>
              </button>
            ))}
          </div>
          {clienteSel && sedi.length > 1 && (
            <div className="field">
              <label htmlFor="sede">Sede</label>
              <select id="sede" className="select" value={value?.sede_id ?? ''} onChange={(e) => onChange({ ...value!, sede_id: e.target.value || null })}>
                <option value="">— Sede non indicata —</option>
                {sedi.map((x) => <option key={x.id} value={x.id}>{nomeSede(s, x.id)}</option>)}
              </select>
            </div>
          )}
          {clienteSel && interventiCliente.length > 0 && (
            <div className="field">
              <label htmlFor="int">Intervento (facoltativo)</label>
              <select id="int" className="select" value={value?.intervento_id ?? ''} onChange={(e) => {
                const i = s.db.get('interventi', e.target.value);
                onChange({ ...value!, intervento_id: i?.id ?? null, sede_id: i?.sede_id ?? value!.sede_id });
              }}>
                <option value="">— Nessun intervento —</option>
                {interventiCliente.map((i) => <option key={i.id} value={i.id}>{i.codice} · {i.titolo} ({i.data_programmata ?? 'da programmare'})</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {modo === 'interna' && (
        <div className="choices">
          {(Object.keys(CODICI_ATTIVITA_INTERNA) as CodiceAttivitaInterna[]).map((k) => (
            <button key={k} className={`choice ${value?.codice_interno === k ? 'on' : ''}`} onClick={() => set({ tipo: 'interna', codice_interno: k })} data-testid={`dest-interna-${k}`}>
              <Warehouse size={22} />
              <span>{CODICI_ATTIVITA_INTERNA[k]}</span>
            </button>
          ))}
        </div>
      )}

      {modo === 'da_definire' && (
        <div className="alert info">
          <CircleHelp className="alert-icon" size={22} />
          <div className="small">Il timer parte subito senza cliente. Potrai assegnarlo mentre è attivo o nel riepilogo di fine giornata. Finché non è classificato, il tempo resta tra le <strong>ore non attribuite</strong>.</div>
        </div>
      )}
    </div>
  );
}
