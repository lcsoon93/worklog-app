/**
 * Pannello riepiloghi (giornaliero e mensile): selezione, anteprima a schermo, anteprima PDF
 * ed esportazione. L'anteprima a schermo e il PDF derivano dallo STESSO modello, quindi
 * mostrano gli stessi valori.
 */
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, FileText, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../app/AppContext';
import { addDays, localDate, meseDi, mesePrecedente, pad } from '../domain/time';
import { dataBreve, dataLunga, giornoBreve, istante, meseAnno, ora, oraRelativa, oreMinuti } from '../reports/formato';
import { ETICHETTE_CATEGORIA, type RiepilogoDoc, type RiepilogoGiornalieroDoc, type RiepilogoMensileDoc } from '../reports/modello';
import { blobPdf, generaPdf, nomeFilePdf, scaricaPdf } from '../reports/pdf-report-service';
import { messaggioErrore } from '../shared/errors';
import { Alert, Badge, Card, CartellinoBadge, Segmented, Sheet, Stat } from './components';

type Vista = 'giornaliero' | 'mensile';

export function RiepiloghiPanel({ operaioId, sceltaOperaio }: { operaioId: string | null; sceltaOperaio?: boolean }) {
  const s = useData();
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const oggi = localDate(s.db.now());
  const prec = mesePrecedente(meseDi(oggi).anno, meseDi(oggi).mese);
  const vista = (params.get('vista') as Vista) ?? 'giornaliero';
  const data = params.get('data') ?? oggi;
  const meseParam = params.get('mese') ?? `${prec.anno}-${pad(prec.mese)}`;
  const [anno, mese] = meseParam.split('-').map(Number);
  const operaio = sceltaOperaio ? params.get('operaio') ?? operaioId ?? '' : operaioId ?? '';
  const operai = s.planning.operai();
  const [busy, setBusy] = useState<'scarica' | 'anteprima' | null>(null);
  const [anteprimaUrl, setAnteprimaUrl] = useState<string | null>(null);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };

  const rev = s.db.getRevision();
  const risultato = useMemo((): { m: RiepilogoDoc | null; errore: string | null } => {
    if (!operaio) return { m: null, errore: null };
    try {
      return { m: vista === 'giornaliero' ? s.riepiloghi.giornaliero(operaio, data) : s.riepiloghi.mensile(operaio, anno, mese), errore: null };
    } catch (e) {
      return { m: null, errore: messaggioErrore(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, operaio, vista, data, anno, mese, rev]);
  const m = risultato.m;

  useEffect(() => () => { if (anteprimaUrl) URL.revokeObjectURL(anteprimaUrl); }, [anteprimaUrl]);

  const esegui = async (azione: 'scarica' | 'anteprima') => {
    if (!m) return;
    setBusy(azione);
    try {
      const bytes = await generaPdf(m);
      if (azione === 'scarica') {
        scaricaPdf(bytes, nomeFilePdf(m));
        toast(`PDF generato: ${nomeFilePdf(m)}`, 'ok');
      } else {
        setAnteprimaUrl(URL.createObjectURL(blobPdf(bytes)));
      }
    } catch (e) {
      toast(messaggioErrore(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row-between">
          <Segmented value={vista} onChange={(v) => set({ vista: v })} options={[{ value: 'giornaliero', label: 'Riepilogo giornaliero' }, { value: 'mensile', label: 'Riepilogo mensile' }]} testId="riepilogo-vista" />
          {sceltaOperaio && (
            <select className="select" style={{ maxWidth: 280 }} value={operaio} onChange={(e) => set({ operaio: e.target.value })} aria-label="Operaio" data-testid="riepilogo-operaio">
              <option value="">— Seleziona operaio —</option>
              {operai.map((o) => <option key={o.id} value={o.id}>{o.nome} {o.cognome}{o.attivo ? '' : ' (non attivo)'}</option>)}
            </select>
          )}
        </div>
        {vista === 'giornaliero' ? (
          <div className="row">
            <button className="btn btn-lg icon-btn" aria-label="Giorno precedente" onClick={() => set({ data: addDays(data, -1) })}><ChevronLeft /></button>
            <input type="date" className="input" style={{ maxWidth: 220, minHeight: 68, fontSize: '1.1rem' }} value={data} max={oggi} onChange={(e) => e.target.value && set({ data: e.target.value })} aria-label="Giorno" data-testid="riepilogo-data" />
            <button className="btn btn-lg icon-btn" aria-label="Giorno successivo" disabled={data >= oggi} onClick={() => set({ data: addDays(data, 1) })}><ChevronRight /></button>
            <button className="btn btn-lg" onClick={() => set({ data: oggi })}>Oggi</button>
            <span className="muted">{dataLunga(data)}</span>
          </div>
        ) : (
          <div className="row">
            <button className="btn btn-lg icon-btn" aria-label="Mese precedente" onClick={() => { const p = mesePrecedente(anno, mese); set({ mese: `${p.anno}-${pad(p.mese)}` }); }}><ChevronLeft /></button>
            <input type="month" className="input" style={{ maxWidth: 220, minHeight: 68, fontSize: '1.1rem' }} value={meseParam} onChange={(e) => e.target.value && set({ mese: e.target.value })} aria-label="Mese" data-testid="riepilogo-mese" />
            <button className="btn btn-lg icon-btn" aria-label="Mese successivo" onClick={() => { const n = mese === 12 ? { a: anno + 1, m: 1 } : { a: anno, m: mese + 1 }; set({ mese: `${n.a}-${pad(n.m)}` }); }}><ChevronRight /></button>
            <span className="muted">{meseAnno(anno, mese)}</span>
          </div>
        )}
      </div>

      {!operaio && <Alert tono="info">Seleziona un operaio.</Alert>}
      {risultato.errore && <Alert tono="danger">{risultato.errore}</Alert>}

      {m && (
        <>
          {!s.online() && <Alert tono="info" title="Sei offline">Il PDF viene generato dai dati presenti su questo dispositivo.</Alert>}
          {m.datiNonSincronizzati > 0 && (
            <Alert tono="warn" title="Dati non ancora sincronizzati">{m.datiNonSincronizzati} elementi di questo riepilogo non sono ancora confermati dal server. Il PDF lo indicherà espressamente.</Alert>
          )}
          {!m.esportabile && <Alert tono="warn" title="Esportazione non disponibile">{m.motivoNonEsportabile}</Alert>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-lg" disabled={!m.esportabile || !!busy} onClick={() => void esegui('anteprima')} data-testid="pdf-anteprima">
              {busy === 'anteprima' ? <Loader2 className="spin" /> : <Eye />} Anteprima PDF
            </button>
            <button className="btn btn-primary btn-xl" disabled={!m.esportabile || !!busy} onClick={() => void esegui('scarica')} data-testid="pdf-scarica">
              {busy === 'scarica' ? <Loader2 className="spin" /> : <Download size={26} />} {m.tipo === 'giornaliero' ? 'Esporta riepilogo giornaliero PDF' : 'Esporta riepilogo mensile PDF'}
            </button>
          </div>

          {m.tipo === 'giornaliero' ? <AnteprimaGiornaliera m={m} /> : <AnteprimaMensile m={m} />}
        </>
      )}

      {anteprimaUrl && m && (
        <Sheet title={`Anteprima – ${nomeFilePdf(m)}`} wide onClose={() => { URL.revokeObjectURL(anteprimaUrl); setAnteprimaUrl(null); }} footer={<>
          <a className="btn" href={anteprimaUrl} target="_blank" rel="noreferrer">Apri in una nuova scheda</a>
          <button className="btn btn-primary" onClick={() => void esegui('scarica')}><Download /> Scarica PDF</button>
        </>}>
          <iframe title="Anteprima PDF" src={anteprimaUrl} style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 12 }} data-testid="pdf-iframe" />
        </Sheet>
      )}
    </div>
  );
}

const STATO_GIORNATA: Record<RiepilogoGiornalieroDoc['statoGiornata'], { testo: string; tono: 'ok' | 'info' | 'danger' | 'neutral' }> = {
  chiusa: { testo: 'Giornata chiusa', tono: 'ok' },
  in_corso: { testo: 'Giornata in corso – totali provvisori', tono: 'info' },
  non_chiusa: { testo: 'Uscita mancante – dati incompleti', tono: 'danger' },
  assente: { testo: 'Nessuna presenza', tono: 'neutral' },
};

function AnteprimaGiornaliera({ m }: { m: RiepilogoGiornalieroDoc }) {
  const t = m.totali;
  return (
    <div className="stack" data-testid="anteprima-giornaliera">
      <Card title={<h2 className="row" style={{ gap: 8 }}><FileText size={20} /> {m.intestazione.titolo}</h2>} actions={<Badge tono={STATO_GIORNATA[m.statoGiornata].tono} testId="anteprima-stato">{STATO_GIORNATA[m.statoGiornata].testo}</Badge>} pad>
        <div className="stack-sm">
          <div className="muted">{m.intestazione.operaio.nome} · {dataLunga(m.data)} · documento {m.intestazione.idDocumento}</div>
          {m.presenze.map((p) => (
            <div key={p.id} className="row">
              <Badge tono="primary">Entrata {ora(p.entrata)}</Badge>
              <Badge tono={p.uscita === null ? (p.stato === 'non_chiusa' ? 'danger' : 'info') : 'primary'}>Uscita {p.uscita !== null ? oraRelativa(p.uscita, m.data) : p.stato === 'in_corso' ? 'in corso' : 'non registrata'}</Badge>
              {p.pause.map((x, i) => <Badge key={i} tono="pause">Pausa {ora(x.inizio)}–{x.fine !== null ? ora(x.fine) : '…'}</Badge>)}
            </div>
          ))}
        </div>
      </Card>
      {t ? (
        <div className="grid-4">
          <Stat label="Presenza lorda" value={oreMinuti(t.lordaMs)} sub={`Pause ${oreMinuti(t.pauseMs)}`} testId="ant-lorda" />
          <Stat label="Ore nette" value={oreMinuti(t.nettaMs)} testId="ant-netta" />
          <Stat label="Attribuite" value={oreMinuti(t.attribuiteMs)} tono="ok" sub={`Clienti ${oreMinuti(t.clientiMs)} · interne ${oreMinuti(t.interneMs)} · trasf. ${oreMinuti(t.trasferimentiMs)}`} testId="ant-attribuite" />
          <Stat label="Non attribuite" value={oreMinuti(t.nonAttribuiteMs)} tono={t.nonAttribuiteMs ? 'warn' : undefined} testId="ant-non-attribuite" />
        </div>
      ) : m.presenze.length ? <Alert tono="danger" title="Totali non calcolabili">Manca l'uscita: nessun valore viene stimato.</Alert> : null}
      {m.attivita.length > 0 && (
        <Card title={`Attività (${m.attivita.length})`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Inizio</th><th>Fine</th><th className="num">Durata</th><th>Categoria</th><th>Cliente</th><th>Intervento</th></tr></thead>
              <tbody>{m.attivita.map((a) => (
                <tr key={a.id}><td className="tabular">{ora(a.inizio)}</td><td className="tabular">{oraRelativa(a.fine, m.data)}</td><td className="num"><strong>{oreMinuti(a.durataMs)}</strong></td><td>{ETICHETTE_CATEGORIA[a.categoria]}</td><td>{a.cliente || '—'}</td><td className="ellipsis" style={{ maxWidth: 220 }}>{a.intervento || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="grid-2">
        <Card title={`Rapportini (${m.rapportini.length})`} pad>
          {m.rapportini.length ? m.rapportini.map((r) => <div key={r.numero} className="small"><strong>{r.numero}</strong> · {r.cliente} · {r.esito}</div>) : <span className="muted">Nessun rapportino registrato.</span>}
          {m.bozzeEscluse > 0 && <div className="subtle">{m.bozzeEscluse} bozze non incluse</div>}
        </Card>
        <Card title="Anomalie e correzioni" pad>
          {m.anomalie.length + m.correzioni.length === 0 ? <span className="muted">Nessuna.</span> : (
            <div className="stack-sm">
              {m.anomalie.map((a, i) => <Badge key={i} tono={a.livello === 'errore' ? 'danger' : 'warn'}>{a.testo}</Badge>)}
              {m.correzioni.map((c, i) => <div key={i} className="small">{c.descrizione} – <em>{c.motivo}</em></div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function AnteprimaMensile({ m }: { m: RiepilogoMensileDoc }) {
  const t = m.totali;
  return (
    <div className="stack" data-testid="anteprima-mensile">
      <Card title={<h2 className="row" style={{ gap: 8 }}><CalendarDays size={20} /> {meseAnno(m.anno, m.mese)} · {m.intestazione.operaio.nome}</h2>} actions={<CartellinoBadge stato={m.cartellino.stato} />} pad>
        {m.cartellino.approvato && !m.provvisorio ? (
          <Alert tono="ok" title="Cartellino approvato">Approvato il {m.cartellino.approvatoIl ? istante(m.cartellino.approvatoIl) : '—'} da {m.cartellino.approvatoDa} (versione {m.cartellino.versioneApprovata}).</Alert>
        ) : (
          <Alert tono="warn" title="Documento provvisorio – non approvato">
            Stato del cartellino: {m.cartellino.etichetta}{m.cartellino.versioneCorrente ? ` (versione ${m.cartellino.versioneCorrente})` : ''}. Il PDF riporterà la dicitura “PROVVISORIO”: esportarlo non equivale ad approvarlo.
          </Alert>
        )}
        {m.anomalie.filter((a) => a.livello !== 'avviso' || !a.testo.startsWith('Documento PROVVISORIO')).map((a, i) => <div key={i} style={{ marginTop: 8 }}><Badge tono={a.livello === 'errore' ? 'danger' : a.livello === 'avviso' ? 'warn' : 'info'}>{a.testo}</Badge></div>)}
      </Card>
      <div className="grid-4">
        <Stat label="Giorni lavorati" value={t.giorniLavorati} sub={`${t.giorniSenzaPresenza} senza presenza (${t.giorniFerialiSenzaPresenza} feriali)`} testId="ant-giorni" />
        <Stat label="Ore nette" value={oreMinuti(t.nettaMs)} sub={`Lorde ${oreMinuti(t.lordaMs)} · pause ${oreMinuti(t.pauseMs)}`} testId="ant-netta" />
        <Stat label="Attribuite" value={oreMinuti(t.attribuiteMs)} tono="ok" sub={`Clienti ${oreMinuti(t.clientiMs)} · interne ${oreMinuti(t.interneMs)} · trasf. ${oreMinuti(t.trasferimentiMs)}`} testId="ant-attribuite" />
        <Stat label="Non attribuite" value={oreMinuti(t.nonAttribuiteMs)} tono={t.nonAttribuiteMs ? 'warn' : undefined} testId="ant-non-attribuite" />
      </div>
      <div className="split">
        <Card title="Giorni del mese">
          <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Data</th><th>Entrata</th><th>Uscita</th><th className="num">Pause</th><th className="num">Nette</th><th className="num">Attribuite</th><th>Stato</th></tr></thead>
              <tbody>{m.giorni.map((g) => (
                <tr key={g.data} className={!g.lavorato ? 'weekend' : ''}>
                  <td>{giornoBreve(g.data)}</td><td className="tabular">{ora(g.entrata)}</td><td className="tabular">{g.uscita !== null ? oraRelativa(g.uscita, g.data) : g.lavorato ? (g.incompleto ? 'mancante' : 'in corso') : '—'}</td>
                  <td className="num">{oreMinuti(g.pauseMs)}</td><td className="num"><strong>{oreMinuti(g.nettaMs)}</strong></td><td className="num">{oreMinuti(g.attribuiteMs)}</td>
                  <td>{g.incompleto ? <Badge tono="danger">{g.stato}</Badge> : g.stato === 'Da verificare' ? <Badge tono="warn">{g.stato}</Badge> : g.stato}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <div className="stack">
          <Card title="Per cliente">
            <table className="table"><tbody>{m.perCliente.map((c) => <tr key={c.cliente}><td>{c.cliente}<div className="subtle">{c.giornate} giornate · {c.interventi} interventi</div></td><td className="num"><strong>{oreMinuti(c.totaleMs)}</strong></td></tr>)}</tbody></table>
          </Card>
          <Card title="Attività interne">
            <table className="table"><tbody>{m.perInterna.length ? m.perInterna.map((x) => <tr key={x.attivita}><td>{x.attivita}</td><td className="num">{oreMinuti(x.ms)}</td></tr>) : <tr><td className="muted">Nessuna</td></tr>}</tbody></table>
          </Card>
          <div className="subtle">{m.correzioni.length} correzioni registrate · documento {m.intestazione.idDocumento} · periodo {dataBreve(m.giorni[0].data)}–{dataBreve(m.giorni[m.giorni.length - 1].data)}</div>
        </div>
      </div>
    </div>
  );
}
