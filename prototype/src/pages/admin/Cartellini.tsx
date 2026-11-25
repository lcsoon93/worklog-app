import { CheckCircle2, FileCheck2, MessageSquareWarning, RefreshCw, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { etichettaMese, formatData, localDate, meseDi, mesePrecedente } from '../../domain/time';
import { azioniDisponibili, ETICHETTE_STATO } from '../../domain/timesheet-workflow';
import type { AzioneCartellino, CartellinoStato, GiornoCartellino } from '../../domain/types';
import { Alert, Avatar, Badge, Card, CartellinoBadge, ConfirmSheet, Empty, PageHead, Segmented, SyncBadge } from '../../ui/components';
import { GiorniCartellino, PassiCartellino, StoricoApprovazioni, TotaliCartellinoView } from '../../ui/CartellinoView';
import { nomeOperaio } from '../../ui/labels';

export function CartelliniAdmin() {
  const s = useData();
  const { run, toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const corrente = meseDi(localDate(s.db.now()));
  const prec = mesePrecedente(corrente.anno, corrente.mese);
  const anno = Number(params.get('anno') ?? prec.anno);
  const mese = Number(params.get('mese') ?? prec.mese);
  const [chiudi, setChiudi] = useState(false);
  const operai = s.planning.operai().filter((o) => o.attivo);
  const mesi = [mesePrecedente(prec.anno, prec.mese), prec, corrente];

  return (
    <div className="stack">
      <PageHead title={`Cartellini ${etichettaMese(anno, mese)}`} eyebrow="Approvazione mensile" actions={<>
        <div className="segmented">{mesi.map((m) => <button key={`${m.anno}-${m.mese}`} className={m.anno === anno && m.mese === mese ? 'on' : ''} onClick={() => setParams({ anno: String(m.anno), mese: String(m.mese) })}>{etichettaMese(m.anno, m.mese)}</button>)}</div>
        <button className="btn btn-primary" onClick={() => setChiudi(true)} data-testid="chiudi-mese"><FileCheck2 /> Chiudi mese e genera</button>
      </>} />
      <Card title="Operai">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Operaio</th><th>Stato</th><th className="num">Versione</th><th className="num">Giorni</th><th className="num">Effettive</th><th className="num">Attribuite</th><th className="num">Non attr.</th><th className="num">Anomalie</th><th>Sync</th></tr></thead>
            <tbody>
              {operai.map((o) => {
                const c = s.timesheet.cartellino(o.id, anno, mese);
                const v = c ? s.timesheet.versione(c.id, c.versione_corrente) : undefined;
                const t = v?.totali ?? s.timesheet.anteprima(o.id, anno, mese).totali;
                return (
                  <tr key={o.id} className={c ? 'clickable' : ''} onClick={() => c && navigate(`/admin/cartellini/${c.id}`)} data-testid="cartellino-riga">
                    <td><div className="row" style={{ gap: 10 }}><Avatar p={o} size={32} /><strong>{o.nome} {o.cognome}</strong></div></td>
                    <td>{c ? <CartellinoBadge stato={c.stato} /> : <Badge>In compilazione</Badge>}</td>
                    <td className="num">{c?.versione_corrente ?? '—'}</td>
                    <td className="num">{t.giorni_lavorati}</td>
                    <td className="num">{formatDurata(t.netta_ms)}</td>
                    <td className="num">{formatDurata(t.attribuite_ms)}</td>
                    <td className="num" style={{ color: t.non_attribuite_ms ? 'var(--warn)' : undefined }}>{formatDurata(t.non_attribuite_ms)}</td>
                    <td className="num">{t.anomalie}</td>
                    <td>{c && <SyncBadge stato={c.sync_stato} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {chiudi && (
        <ConfirmSheet title={`Chiudere ${etichettaMese(anno, mese)}?`} conferma="Genera cartellini" message="Per ogni operaio viene creato lo snapshot (versione) del mese e il cartellino passa in “Da confermare dall'operaio”. Da quel momento le ore del mese non sono più modificabili senza una segnalazione o riapertura. Gli operai con giornate ancora aperte vengono saltati e segnalati." onClose={() => setChiudi(false)}
          onConfirm={async () => {
            const esiti = await run(() => s.timesheet.chiudiMese(anno, mese));
            if (!esiti) return;
            setChiudi(false);
            const ko = esiti.filter((e) => !e.ok);
            toast(ko.length ? `Generati ${esiti.length - ko.length}, non generati ${ko.length}: ${ko.map((e) => `${nomeOperaio(s, e.operaioId)} (${e.messaggio})`).join('; ')}` : `Cartellini generati: ${esiti.filter((e) => e.messaggio === 'Generato').length}`, ko.length ? 'error' : 'ok');
          }} />
      )}
    </div>
  );
}

const ICONE: Partial<Record<AzioneCartellino, JSX.Element>> = { approva: <CheckCircle2 />, richiedi_correzione: <MessageSquareWarning />, rifiuta: <XCircle />, riapri: <Undo2 />, rigenera: <RefreshCw /> };
const ETICHETTA_PULSANTE: Partial<Record<AzioneCartellino, string>> = { approva: 'Approva', richiedi_correzione: 'Richiedi correzione', rifiuta: 'Rifiuta', riapri: 'Riapri', rigenera: 'Genera nuova versione' };

export function CartellinoVerifica() {
  const { id } = useParams();
  const s = useData();
  const { runOk } = useApp();
  const navigate = useNavigate();
  const [azione, setAzione] = useState<AzioneCartellino | null>(null);
  const [confronto, setConfronto] = useState<'nessuno' | 'precedente' | 'attuale'>('nessuno');
  const c = s.db.get('cartellini_mensili', id);
  const [verSel, setVerSel] = useState<number | null>(null);
  if (!c) return <Empty>Cartellino non trovato.</Empty>;
  const o = s.db.get('profili', c.operaio_id)!;
  const vn = verSel ?? c.versione_corrente;
  const v = s.timesheet.versione(c.id, vn);
  const versioni = s.timesheet.versioni(c.id);
  const azioni = azioniDisponibili(c.stato, 'admin');
  const live = s.timesheet.anteprima(c.operaio_id, c.anno, c.mese);
  const cambiato = v && vn === c.versione_corrente && v.impronta !== live.impronta;
  const precedente = s.timesheet.versione(c.id, vn - 1);
  const riferimento: GiornoCartellino[] | undefined = confronto === 'precedente' ? precedente?.giorni : confronto === 'attuale' ? live.giorni : undefined;
  const esegui = async (a: AzioneCartellino, m: string) => {
    const fn = { approva: () => s.timesheet.approva(c.id), richiedi_correzione: () => s.timesheet.richiediCorrezione(c.id, m), rifiuta: () => s.timesheet.rifiuta(c.id, m), riapri: () => s.timesheet.riapri(c.id, m), rigenera: () => s.timesheet.rigenera(c.id, m) }[a as 'approva'];
    const ok = await runOk(fn, `Operazione eseguita: ${ETICHETTA_PULSANTE[a]}`);
    if (ok) setAzione(null);
  };

  return (
    <div className="stack">
      <PageHead title={`${o.nome} ${o.cognome} · ${etichettaMese(c.anno, c.mese)}`} eyebrow="Verifica cartellino" back={{ to: `/admin/cartellini?anno=${c.anno}&mese=${c.mese}`, label: 'Cartellini' }} actions={
        azioni.map((a) => (
          <button key={a.azione} className={`btn btn-lg ${a.azione === 'approva' ? 'btn-primary' : a.azione === 'rifiuta' ? 'btn-danger' : ''}`} onClick={() => setAzione(a.azione)} data-testid={`azione-${a.azione}`}>{ICONE[a.azione]} {ETICHETTA_PULSANTE[a.azione]}</button>
        ))
      }>
        <div className="row" style={{ marginTop: 8 }}><Avatar p={o} size={28} /><CartellinoBadge stato={c.stato} /><span className="subtle">Versione corrente {c.versione_corrente}{c.versione_approvata ? ` · approvata v${c.versione_approvata}` : ''}</span><SyncBadge stato={c.sync_stato} /></div>
      </PageHead>
      <PassiCartellino stato={c.stato} />
      {c.stato === 'confermato_operaio' && <Alert tono="info">Confermato dall'operaio ma non ancora ricevuto dal server: l'approvazione è possibile solo dopo la ricezione (stato “In attesa di approvazione”).</Alert>}
      {c.stato === 'da_confermare_operaio' && <Alert tono="info">In attesa della conferma dell'operaio. L'amministratore non può confermare al suo posto.</Alert>}
      {c.ultima_motivazione && <Alert tono="warn" title="Ultima motivazione">“{c.ultima_motivazione}”</Alert>}
      {cambiato && <Alert tono="danger" title="I dati attuali differiscono da questa versione">Presenze o attività del mese sono state modificate dopo la generazione dello snapshot. Usa il confronto “Dati attuali” per vedere le differenze.</Alert>}

      <div className="row-between">
        <div className="row">
          <span className="label">Versione</span>
          <div className="segmented">{versioni.map((x) => <button key={x.versione} className={x.versione === vn ? 'on' : ''} onClick={() => setVerSel(x.versione)}>v{x.versione}{x.versione === c.versione_approvata ? ' ✓' : ''}</button>)}</div>
        </div>
        <Segmented value={confronto} onChange={setConfronto} options={[{ value: 'nessuno', label: 'Senza confronto' }, { value: 'precedente', label: 'Differenze con v. precedente' }, { value: 'attuale', label: 'Differenze con dati attuali' }]} />
      </div>
      {v ? <>
        <TotaliCartellinoView t={v.totali} />
        {riferimento && <Differenze attuale={v.giorni} riferimento={riferimento} etichetta={confronto === 'precedente' ? `v${vn - 1}` : 'dati attuali'} />}
        <GiorniCartellino giorni={v.giorni} onGiorno={(d) => navigate(`/admin/presenze?operaio=${c.operaio_id}&data=${d}`)} />
      </> : <Empty>Nessuna versione generata.</Empty>}
      <StoricoApprovazioni storico={s.timesheet.storico(c.id)} />
      <Card title="Versioni" pad>
        <div className="stack-sm">{versioni.map((x) => <div key={x.id} className="row-between"><span>v{x.versione} · {new Date(x.created_at).toLocaleString('it-IT')} · {x.motivo}</span><span className="subtle mono">impronta {x.impronta}</span></div>)}</div>
      </Card>

      {azione && (
        <ConfirmSheet
          title={`${ETICHETTA_PULSANTE[azione]} – ${o.nome} ${o.cognome}`}
          conferma={ETICHETTA_PULSANTE[azione]!}
          tono={azione === 'rifiuta' || azione === 'riapri' ? 'danger' : 'primary'}
          motivazione={azione === 'approva' || azione === 'rigenera' ? 'facoltativa' : 'obbligatoria'}
          testId={`dlg-${azione}`}
          message={azione === 'approva' ? `Approvi la versione ${c.versione_corrente}. Da questo momento il cartellino non è più modificabile senza riapertura motivata.` : azione === 'riapri' ? 'La versione approvata resta archiviata. Le correzioni produrranno una nuova versione da riconfermare.' : `Stato attuale: ${ETICHETTE_STATO[c.stato as CartellinoStato]}.`}
          onClose={() => setAzione(null)}
          onConfirm={(m) => esegui(azione, m)}
        />
      )}
    </div>
  );
}

function Differenze({ attuale, riferimento, etichetta }: { attuale: GiornoCartellino[]; riferimento: GiornoCartellino[]; etichetta: string }) {
  const somma = (gs: GiornoCartellino[], d: string, k: 'netta_ms' | 'attribuite_ms' | 'pause_ms') => gs.filter((g) => g.data === d).reduce((a, g) => a + g[k], 0);
  const date = [...new Set([...attuale, ...riferimento].map((g) => g.data))].sort();
  const diff = date.map((d) => ({ d, n: somma(attuale, d, 'netta_ms') - somma(riferimento, d, 'netta_ms'), a: somma(attuale, d, 'attribuite_ms') - somma(riferimento, d, 'attribuite_ms'), p: somma(attuale, d, 'pause_ms') - somma(riferimento, d, 'pause_ms') })).filter((x) => x.n || x.a || x.p);
  return (
    <Card title={`Differenze rispetto a ${etichetta}`}>
      {diff.length === 0 ? <Empty>Nessuna differenza.</Empty> : (
        <table className="table"><thead><tr><th>Giorno</th><th className="num">Δ Effettive</th><th className="num">Δ Attribuite</th><th className="num">Δ Pause</th></tr></thead>
          <tbody>{diff.map((x) => <tr key={x.d}><td>{formatData(x.d, { breve: true })}</td><td className="num">{x.n > 0 ? '+' : ''}{formatDurata(x.n)}</td><td className="num">{x.a > 0 ? '+' : ''}{formatDurata(x.a)}</td><td className="num">{x.p > 0 ? '+' : ''}{formatDurata(x.p)}</td></tr>)}</tbody>
        </table>
      )}
      <div className="card-foot subtle">Il dettaglio di ogni correzione (valore originale, nuovo valore, autore, motivo) è nel riepilogo giornaliero con “Storico correzioni”. <Link to="/admin/presenze">Apri presenze</Link></div>
    </Card>
  );
}
