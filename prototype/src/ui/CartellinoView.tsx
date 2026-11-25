/** Visualizzazione di un cartellino (snapshot di versione o anteprima dal vivo): calendario + tabella + storico. */
import { useState } from 'react';
import { useData } from '../app/AppContext';
import { formatDurata } from '../domain/hours-engine';
import { formatData, formatOra, giornoSettimanaBreve, isWeekend, parseDate } from '../domain/time';
import { ETICHETTE_AZIONE, ETICHETTE_STATO } from '../domain/timesheet-workflow';
import type { ApprovazioneCartellino, CartellinoStato, GiornoCartellino, TotaliCartellino } from '../domain/types';
import { Badge, Card, Segmented, Stat } from './components';
import { RichiesteLista } from './RichiesteCorrezione';
import { ETICHETTE_CATEGORIA } from '../reports/modello';
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

/**
 * Dettaglio del mese (Fase 3): giornate senza presenza o incomplete, attività giorno per giorno,
 * storico delle correzioni e richieste di correzione. Riusa il modello dei PDF della Fase 2
 * (stesso calcolo, nessuna logica duplicata) applicato ai dati attuali.
 */
export function DettaglioMese({ operaioId, anno, mese, gestione }: { operaioId: string; anno: number; mese: number; gestione?: boolean }) {
  const s = useData();
  const [vista, setVista] = useState<'attivita' | 'correzioni' | 'richieste'>('attivita');
  const m = s.riepiloghi.mensile(operaioId, anno, mese);
  const richieste = s.richieste.elenco({ operaioId, anno, mese });
  const t = m.totali;
  return (
    <Card
      title="Dettaglio del mese"
      testId="dettaglio-mese"
      actions={<Segmented value={vista} onChange={setVista} options={[
        { value: 'attivita', label: 'Attività' },
        { value: 'correzioni', label: `Correzioni (${m.correzioni.length})` },
        { value: 'richieste', label: `Richieste (${richieste.length})` },
      ]} />}
    >
      <div className="card-body row">
        <Badge tono="primary">{t.giorniLavorati} giorni con presenza</Badge>
        <Badge testId="giorni-senza-presenza">{t.giorniSenzaPresenza} senza presenza ({t.giorniFerialiSenzaPresenza} feriali)</Badge>
        {t.giorniIncompleti > 0 && <Badge tono="danger">{t.giorniIncompleti} con uscita mancante (esclusi dai totali)</Badge>}
        {m.datiNonSincronizzati > 0 ? <Badge tono="warn">{m.datiNonSincronizzati} dati non sincronizzati</Badge> : <Badge tono="ok">Dati sincronizzati</Badge>}
        <span className="subtle">Calcolato dai dati attuali, con lo stesso calcolo dei PDF.</span>
      </div>
      {vista === 'attivita' && (
        m.attivitaPerGiorno.length === 0 ? <div className="empty">Nessuna attività nel mese.</div> : (
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="table" data-testid="dettaglio-attivita">
              <thead><tr><th>Giorno</th><th>Orario</th><th>Categoria</th><th>Cliente / attività</th><th>Intervento</th><th className="num">Durata</th></tr></thead>
              <tbody>{m.attivitaPerGiorno.flatMap((g) => g.attivita.map((a, i) => (
                <tr key={a.id}>
                  <td>{i === 0 ? <strong>{formatData(g.data, { breve: true })}</strong> : ''}</td>
                  <td className="tabular">{formatOra(a.inizio)}–{a.fine !== null ? formatOra(a.fine) : '…'}</td>
                  <td>{ETICHETTE_CATEGORIA[a.categoria]}</td>
                  <td>{a.categoria === 'interna' ? a.tipo : a.cliente || a.tipo}{a.note.length > 0 && <div className="subtle">{a.note.join(' · ')}</div>}</td>
                  <td className="ellipsis" style={{ maxWidth: 220 }}>{a.intervento || '—'}</td>
                  <td className="num"><strong>{a.durataMs === null ? '—' : formatDurata(a.durataMs)}</strong></td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        )
      )}
      {vista === 'correzioni' && (
        m.correzioni.length === 0 ? <div className="empty">Nessuna correzione nel mese.</div> : (
          <div className="list" data-testid="storico-correzioni">
            {m.correzioni.map((c, i) => (
              <div key={i} className="list-row" style={{ cursor: 'default' }}>
                <div className="grow"><div className="title">{formatData(c.data, { breve: true })} · {c.descrizione}</div><div className="subtle">Registrata il {new Date(c.quando).toLocaleString('it-IT')} · motivo: {c.motivo}</div></div>
              </div>
            ))}
          </div>
        )
      )}
      {vista === 'richieste' && <RichiesteLista richieste={richieste} gestione={gestione} vuoto="Nessuna richiesta di correzione in questo mese." />}
    </Card>
  );
}
