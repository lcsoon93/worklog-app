/** Visualizzazione di un cartellino (snapshot di versione o anteprima dal vivo): calendario + tabella + storico. */
import { useState } from 'react';
import { useData } from '../app/AppContext';
import { formatDurata } from '../domain/hours-engine';
import { formatData, formatOra, giornoSettimanaBreve, isWeekend, parseDate } from '../domain/time';
import { ETICHETTE_AZIONE, ETICHETTE_STATO } from '../domain/timesheet-workflow';
import type { ApprovazioneCartellino, CartellinoStato, GiornoCartellino, TotaliCartellino } from '../domain/types';
import { Badge, Card, Segmented, Stat } from './components';
import { ANOMALIE, nomeOperaio } from './labels';
import type { AnomaliaCodice } from '../domain/hours-engine';

export function TotaliCartellinoView({ t }: { t: TotaliCartellino }) {
  return (
    <div className="grid-4">
      <Stat label="Giorni lavorati" value={t.giorni_lavorati} />
      <Stat label="Ore effettive (nette)" value={formatDurata(t.netta_ms)} sub={`Lorde ${formatDurata(t.lorda_ms)} · pause ${formatDurata(t.pause_ms)}`} testId="cart-netta" />
      <Stat label="Ore attribuite" value={formatDurata(t.attribuite_ms)} tono="ok" testId="cart-attribuite" />
      <Stat label="Non attribuite" value={formatDurata(t.non_attribuite_ms)} tono={t.non_attribuite_ms > 0 ? 'warn' : undefined} sub={`${t.anomalie} anomalie · ${t.correzioni} correzioni`} />
    </div>
  );
}

export function GiorniCartellino({ giorni, onGiorno }: { giorni: GiornoCartellino[]; onGiorno?: (data: string) => void }) {
  const [vista, setVista] = useState<'tabella' | 'calendario'>('tabella');
  const perData = new Map<string, GiornoCartellino[]>();
  for (const g of giorni) perData.set(g.data, [...(perData.get(g.data) ?? []), g]);
  const date = [...perData.keys()];
  return (
    <Card title="Giorni del mese" actions={<Segmented value={vista} onChange={setVista} options={[{ value: 'tabella', label: 'Tabella' }, { value: 'calendario', label: 'Calendario' }]} />}>
      {vista === 'tabella' ? (
        <div className="table-wrap">
          <table className="table" data-testid="tabella-cartellino">
            <thead><tr><th>Giorno</th><th>Entrata</th><th>Uscita</th><th className="num">Pause</th><th className="num">Effettive</th><th className="num">Attribuite</th><th className="num">Non attr.</th><th>Note</th></tr></thead>
            <tbody>
              {date.map((d) => {
                const gs = perData.get(d)!;
                return gs.map((g, k) => (
                  <tr key={`${d}-${k}`} className={`${isWeekend(d) ? 'weekend' : ''} ${onGiorno && g.presenza_id ? 'clickable' : ''}`} onClick={() => g.presenza_id && onGiorno?.(d)}>
                    <td>{k === 0 ? formatData(d, { breve: true }) : ''}</td>
                    <td className="tabular">{g.entrata_at ? formatOra(g.entrata_at) : ''}</td>
                    <td className="tabular">{g.uscita_at ? formatOra(g.uscita_at) : g.presenza_id ? 'aperta' : ''}</td>
                    <td className="num">{g.presenza_id ? formatDurata(g.pause_ms) : ''}</td>
                    <td className="num">{g.presenza_id ? formatDurata(g.netta_ms) : ''}</td>
                    <td className="num">{g.presenza_id ? formatDurata(g.attribuite_ms) : ''}</td>
                    <td className="num" style={{ color: g.non_attribuite_ms > 0 ? 'var(--warn)' : undefined }}>{g.presenza_id ? formatDurata(g.non_attribuite_ms) : ''}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {g.anomalie.map((a) => <Badge key={a} tono="warn">{ANOMALIE[a as AnomaliaCodice] ?? a}</Badge>)}
                        {g.correzioni > 0 && <Badge tono="info">{g.correzioni} correz.</Badge>}
                      </div>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-body">
          <div className="cal">
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((x) => <div key={x} className="cal-h">{x}</div>)}
            {Array.from({ length: (parseDate(date[0]).getDay() + 6) % 7 }, (_, i) => <div key={`v${i}`} />)}
            {date.map((d) => {
              const gs = perData.get(d)!;
              const netta = gs.reduce((a, g) => a + g.netta_ms, 0);
              const anom = gs.some((g) => g.anomalie.length > 0);
              return (
                <button key={d} className={`cal-d ${isWeekend(d) ? 'we' : ''}`} onClick={() => gs[0].presenza_id && onGiorno?.(d)} title={giornoSettimanaBreve(d)}>
                  <span className="n">{parseDate(d).getDate()}</span>
                  {gs[0].presenza_id ? <>
                    <span className="tabular" style={{ fontWeight: 700 }}>{formatDurata(netta)}</span>
                    {anom ? <span className="cal-ev ritorno">da controllare</span> : <span className="cal-ev completato">ok</span>}
                  </> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

export function StoricoApprovazioni({ storico }: { storico: ApprovazioneCartellino[] }) {
  const s = useData();
  return (
    <Card title="Storico stati e approvazioni">
      <div className="list" data-testid="storico-approvazioni">
        {storico.length === 0 && <div className="empty">Nessuna operazione registrata.</div>}
        {storico.map((a) => (
          <div key={a.id} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="title">{ETICHETTE_AZIONE[a.azione]} <span className="subtle">· versione {a.versione}</span></div>
              <div className="subtle">{new Date(a.eseguita_at).toLocaleString('it-IT')} · {a.utente_id ? nomeOperaio(s, a.utente_id) : 'Sistema (server)'} · {ETICHETTE_STATO[a.stato_precedente as CartellinoStato]} → {ETICHETTE_STATO[a.stato_nuovo as CartellinoStato]}</div>
              {a.motivazione && <div className="small" style={{ marginTop: 4 }}>“{a.motivazione}”</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const PASSI: Array<{ stati: CartellinoStato[]; label: string }> = [
  { stati: ['in_compilazione'], label: 'Compilazione' },
  { stati: ['da_confermare_operaio', 'da_correggere', 'riaperto'], label: 'Conferma operaio' },
  { stati: ['confermato_operaio', 'in_attesa_approvazione'], label: 'Verifica amministratore' },
  { stati: ['approvato'], label: 'Approvato' },
];
export function PassiCartellino({ stato }: { stato: CartellinoStato }) {
  const idx = PASSI.findIndex((p) => p.stati.includes(stato));
  return (
    <div className="steps">
      {PASSI.map((p, i) => (
        <div key={p.label} className={`step ${i < idx || stato === 'approvato' ? 'done' : i === idx ? 'current' : ''}`}><span className="n">{i + 1}</span>{p.label}</div>
      ))}
    </div>
  );
}
