/**
 * Correzione motivata degli orari di una presenza (operaio e amministratore).
 * L'orario registrato in origine resta conservato; la correzione compare nel cartellino.
 */
import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { atLocal, formatData, formatOra, localDate, toIso, toMs } from '../domain/time';
import type { Presenza } from '../domain/types';
import { Alert, Sheet } from './components';

export function CorreggiPresenzaSheet({ p, onClose }: { p: Presenza; onClose: () => void }) {
  const { s, runOk } = useApp();
  const [entrata, setEntrata] = useState(formatOra(p.entrata_at));
  const [uscita, setUscita] = useState(p.uscita_at ? formatOra(p.uscita_at) : '');
  const [motivo, setMotivo] = useState('');
  // Giorno di calendario dell'uscita (può essere il giorno dopo, per i turni oltre la mezzanotte).
  const dataUscita = p.uscita_at ? localDate(toMs(p.uscita_at)) : p.data_lavoro;
  return (
    <Sheet title={`Correggi presenza del ${formatData(p.data_lavoro)}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className="btn btn-primary" disabled={!motivo.trim()} onClick={async () => {
        const ok = await runOk(() => s.workday.correggiPresenza(p.id, { entrata_at: toIso(atLocal(p.data_lavoro, entrata)), ...(uscita && p.uscita_at ? { uscita_at: toIso(atLocal(dataUscita, uscita)) } : {}) }, motivo), 'Correzione salvata');
        if (ok) onClose();
      }}>Salva correzione</button>
    </>}>
      <Alert tono="info">L'orario registrato in origine dal dispositivo resta conservato e visibile. La correzione compare nel cartellino.</Alert>
      <div className="grid-2">
        <div className="field"><label htmlFor="c-entrata">Entrata</label><input id="c-entrata" type="time" className="input" value={entrata} onChange={(e) => setEntrata(e.target.value)} /></div>
        <div className="field"><label htmlFor="c-uscita">Uscita</label><input id="c-uscita" type="time" className="input" value={uscita} disabled={!p.uscita_at} onChange={(e) => setUscita(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="c-motivo">Motivo (obbligatorio)</label><input id="c-motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Es. timbrato in ritardo, ero già al lavoro" /></div>
    </Sheet>
  );
}
