/** Ore del rapporto: timer avvia/ferma, inserimento manuale, collegamento delle attività. */
import { Play, Plus, Square } from 'lucide-react';
import { useState } from 'react';
import { useApp, useData, useNow, useUtente } from '../../../app/AppContext';
import { formatDurata } from '../../../domain/hours-engine';
import { atLocal, formatOra, localDate } from '../../../domain/time';
import type { AttivitaLavoro, Rapportino } from '../../../domain/types';
import { AppError } from '../../../shared/errors';
import { Card, Empty } from '../../../ui/components';
import { nomeOperaio, titoloAttivita } from '../../../ui/labels';

/**
 * Ore del rapporto (Fase 12): attività già registrate, timer o orario indicato a mano.
 * Le ore restano attività della presenza: il rapporto le collega soltanto (nessun doppio conteggio).
 */
export function OreRapporto({ r, suggerite, onToggle, onAggiornato, soloCollega = false }: { r: Rapportino; suggerite: AttivitaLavoro[]; onToggle: (id: string) => void; onAggiornato: (r: Rapportino) => void; soloCollega?: boolean }) {
  const s = useData();
  const u = useUtente();
  const { run } = useApp();
  const now = useNow(1000);
  const [inizio, setInizio] = useState('');
  const [fine, setFine] = useState('');
  const oggi = r.data_lavoro === localDate(now);
  const timer = s.report.timerInCorso(r);
  const senzaPresenza = oggi && s.workday.presenzeDelGiorno(u.id, r.data_lavoro).length === 0 && !s.workday.presenzaAperta(u.id);
  // Attività collegate + suggerite, senza ripetizioni.
  const righe = [...new Map([...r.attivita_ids.map((id) => s.db.get('attivita_lavoro', id)).filter((a): a is AttivitaLavoro => !!a && !a.superata_da_id && !a.annullata), ...suggerite].map((a) => [a.id, a])).values()].sort((a, b) => a.inizio_at.localeCompare(b.inizio_at));
  const aggiungi = async () => {
    if (!/^\d{2}:\d{2}$/.test(inizio) || !/^\d{2}:\d{2}$/.test(fine)) return void run(async () => { throw new AppError('VALIDAZIONE', 'Indica ora di inizio e di fine.'); });
    const x = await run(() => s.report.aggiungiOrario(r, atLocal(r.data_lavoro, inizio), atLocal(r.data_lavoro, fine), { registraEntrata: senzaPresenza }), senzaPresenza ? `Entrata registrata alle ${inizio} e orario aggiunto` : 'Orario aggiunto alle ore della giornata');
    if (x) { onAggiornato(x); setInizio(''); setFine(''); }
  };
  return (
    <Card title="Orari e ore" actions={<strong className="tabular" data-testid="rapportino-ore-totali">{formatDurata(s.report.oreRapportino(r))}</strong>}>
      {righe.length === 0 ? <Empty>Nessuna ora collegata. Usa il timer oppure indica l'orario di inizio e fine.</Empty> : righe.map((a) => {
        const on = r.attivita_ids.includes(a.id);
        return (
          <label key={a.id} className="act" style={{ cursor: 'pointer' }}>
            <div className={`bar bg-${a.tipo}`} />
            <div><div style={{ fontWeight: 650 }}>{nomeOperaio(s, a.operaio_id)} · {titoloAttivita(s, a).titolo}</div><div className="subtle">{formatOra(a.inizio_at)} – {a.fine_at ? formatOra(a.fine_at) : 'in corso'}{a.origine === 'manuale' ? ' · inserito a mano' : ''}</div></div>
            <input type="checkbox" className="spunta" checked={on} onChange={() => onToggle(a.id)} aria-label="Collega al rapporto" />
          </label>
        );
      })}
      {!soloCollega && <div className="card-body stack-sm" style={{ borderTop: '1px solid var(--border)' }}>
        {oggi && (timer ? (
          <button className="btn btn-lg btn-block" data-testid="rapportino-ferma-timer" onClick={async () => { const x = await run(() => s.report.fermaTimer(r), 'Timer fermato'); if (x) onAggiornato(x); }}><Square /> Ferma timer · {formatOra(timer.inizio_at)} – adesso</button>
        ) : (
          <button className="btn btn-soft btn-lg btn-block" data-testid="rapportino-avvia-timer" onClick={async () => { const x = await run(() => s.report.avviaTimer(r), s.workday.presenzaAperta(u.id) ? 'Timer avviato su questo rapporto' : 'Entrata registrata e timer avviato'); if (x) onAggiornato(x); }}><Play /> Avvia timer su questo lavoro</button>
        ))}
        <div className="label">Oppure indica l'orario</div>
        <div className="orari-riga">
          <div className="field"><label htmlFor="r-inizio">Inizio</label><input id="r-inizio" type="time" className="input" value={inizio} onChange={(e) => setInizio(e.target.value)} data-testid="rapportino-inizio" /></div>
          <div className="field"><label htmlFor="r-fine">Fine</label><input id="r-fine" type="time" className="input" value={fine} onChange={(e) => setFine(e.target.value)} data-testid="rapportino-fine" /></div>
          <button className="btn" onClick={() => void aggiungi()} data-testid="rapportino-aggiungi-orario"><Plus /> Aggiungi</button>
        </div>
        <p className="hint">{senzaPresenza ? "Non hai ancora registrato l'entrata oggi: verrà registrata all'orario di inizio." : "L'orario entra nelle ore della giornata. Se si sovrappone a un'attività già registrata (es. il timer) viene rifiutato: le ore non si contano due volte."}</p>
      </div>}
    </Card>
  );
}
