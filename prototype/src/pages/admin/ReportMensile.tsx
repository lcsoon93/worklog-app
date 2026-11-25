/**
 * Report mensile aziendale. Tutti i valori derivano dal motore ore, calcolato UNA volta per
 * presenza; i totali sono somme di valori giornalieri (nessun doppio conteggio). Vedi docs/09.
 */
import { CheckCircle2, Download, Printer, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../app/AppContext';
import { calcolaDaRecord } from '../../domain/day-records';
import { formatDurata } from '../../domain/hours-engine';
import { etichettaMese, localDate, meseDi, mesePrecedente } from '../../domain/time';
import { CODICI_ATTIVITA_INTERNA, type CodiceAttivitaInterna } from '../../domain/types';
import { Alert, Badge, Card, CartellinoBadge, PageHead, Stat } from '../../ui/components';
import { nomeCliente, nomeOperaio } from '../../ui/labels';
import { formatEuro } from '../../ui/MaterialiRapportino';

export function ReportMensile() {
  const s = useData();
  const [params, setParams] = useSearchParams();
  const corrente = meseDi(localDate(s.db.now()));
  const prec = mesePrecedente(corrente.anno, corrente.mese);
  const anno = Number(params.get('anno') ?? prec.anno);
  const mese = Number(params.get('mese') ?? prec.mese);
  const prefisso = `${anno}-${String(mese).padStart(2, '0')}-`;
  const rev = s.db.getRevision();

  const dati = useMemo(() => {
    const now = s.db.now();
    const pause = s.db.all('pause_presenza');
    const att = s.db.all('attivita_lavoro', { includiEliminati: true });
    const perOperaio = new Map<string, { giorni: Set<string>; netta: number; attribuite: number; non: number; anomalie: number }>();
    const perCliente = new Map<string, { ore: number; trasf: number }>();
    const perInterna = new Map<string, number>();
    let tot = { lorda: 0, pause: 0, netta: 0, attribuite: 0, non: 0, daClass: 0, trasfNoCliente: 0 };
    for (const p of s.db.where('presenze', (x) => x.data_lavoro.startsWith(prefisso))) {
      const r = calcolaDaRecord(p, pause, att, now);
      const o = perOperaio.get(p.operaio_id) ?? { giorni: new Set(), netta: 0, attribuite: 0, non: 0, anomalie: 0 };
      o.giorni.add(p.data_lavoro);
      o.netta += r.netta_ms;
      o.attribuite += r.attribuite_ms;
      o.non += r.non_attribuite_ms;
      o.anomalie += r.anomalie.filter((a) => a.gravita !== 'info').length;
      perOperaio.set(p.operaio_id, o);
      tot = { lorda: tot.lorda + r.lorda_ms, pause: tot.pause + r.pause_ms, netta: tot.netta + r.netta_ms, attribuite: tot.attribuite + r.attribuite_ms, non: tot.non + r.non_attribuite_ms, daClass: tot.daClass + r.da_classificare_ms, trasfNoCliente: tot.trasfNoCliente };
      for (const d of r.attivita) {
        const a = att.find((x) => x.id === d.id)!;
        if (a.tipo === 'lavoro_cliente' || a.tipo === 'trasferimento') {
          if (!a.cliente_id) { tot.trasfNoCliente += d.effettiva_ms; continue; }
          const c = perCliente.get(a.cliente_id) ?? { ore: 0, trasf: 0 };
          if (a.tipo === 'trasferimento') c.trasf += d.effettiva_ms; else c.ore += d.effettiva_ms;
          perCliente.set(a.cliente_id, c);
        }
      }
      for (const [k, ms] of Object.entries(r.per_codice_interno)) perInterna.set(k, (perInterna.get(k) ?? 0) + ms);
    }
    const sommaClienti = [...perCliente.values()].reduce((a, c) => a + c.ore + c.trasf, 0);
    const sommaInterne = [...perInterna.values()].reduce((a, b) => a + b, 0);
    const quadra = sommaClienti + sommaInterne + tot.trasfNoCliente === tot.attribuite && tot.attribuite + tot.non === tot.netta;
    const rapportini = s.report.rapportini((r) => r.data_lavoro.startsWith(prefisso) && r.stato !== 'bozza');
    return { perOperaio, perCliente, perInterna, tot, quadra, rapportini };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, prefisso, rev]);

  const cartellini = s.db.where('cartellini_mensili', (c) => c.anno === anno && c.mese === mese);
  // Fase 5: costo dei materiali consumati nel mese, dallo stesso servizio della sezione Magazzino.
  const materiali = s.magazzino.riepilogoCosti({ da: `${prefisso}01`, a: `${prefisso}31` });
  const approvati = cartellini.filter((c) => c.stato === 'approvato').length;
  const operai = s.planning.operai();

  const esportaCsv = () => {
    const righe = [['Operaio', 'Giorni', 'Ore effettive', 'Ore attribuite', 'Ore non attribuite', 'Stato cartellino']];
    for (const o of operai) {
      const x = dati.perOperaio.get(o.id);
      const c = cartellini.find((k) => k.operaio_id === o.id);
      righe.push([`${o.nome} ${o.cognome}`, String(x?.giorni.size ?? 0), formatDurata(x?.netta ?? 0), formatDurata(x?.attribuite ?? 0), formatDurata(x?.non ?? 0), c?.stato ?? 'in_compilazione']);
    }
    righe.push([]);
    righe.push(['Cliente', 'Ore lavoro', 'Ore trasferimento', 'Rapportini']);
    for (const [id, c] of dati.perCliente) righe.push([nomeCliente(s, id), formatDurata(c.ore), formatDurata(c.trasf), String(dati.rapportini.filter((r) => r.cliente_id === id).length)]);
    const csv = '﻿' + righe.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${anno}-${String(mese).padStart(2, '0')}-ANTEPRIMA.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mesi = [mesePrecedente(prec.anno, prec.mese), prec, corrente];
  return (
    <div className="stack">
      <PageHead title={`Report ${etichettaMese(anno, mese)}`} eyebrow="Report mensile" actions={<>
        <div className="segmented">{mesi.map((m) => <button key={`${m.anno}-${m.mese}`} className={m.anno === anno && m.mese === mese ? 'on' : ''} onClick={() => setParams({ anno: String(m.anno), mese: String(m.mese) })}>{etichettaMese(m.anno, m.mese)}</button>)}</div>
        <button className="btn" onClick={esportaCsv}><Download /> Esporta CSV</button>
        <button className="btn" onClick={() => window.print()}><Printer /> Stampa</button>
      </>} />
      <Alert tono={approvati === operai.length ? 'ok' : 'warn'} title={approvati === operai.length ? 'Tutti i cartellini sono approvati' : `Dati non definitivi: ${approvati} cartellini approvati su ${operai.length}`}>
        I valori sono calcolati dai dati attuali. Le esportazioni ufficiali (PDF ed Excel, Fase 2) useranno solo le versioni approvate dei cartellini. Il CSV è un'anteprima di verifica.
      </Alert>
      <div className="grid-4">
        <Stat label="Ore effettive (nette)" value={formatDurata(dati.tot.netta)} sub={`Lorde ${formatDurata(dati.tot.lorda)} · pause ${formatDurata(dati.tot.pause)}`} />
        <Stat label="Ore attribuite" value={formatDurata(dati.tot.attribuite)} tono="ok" sub={`${dati.tot.netta ? Math.round((dati.tot.attribuite / dati.tot.netta) * 100) : 0}% delle ore effettive`} />
        <Stat label="Ore non attribuite" value={formatDurata(dati.tot.non)} tono={dati.tot.non ? 'warn' : undefined} sub={`di cui ${formatDurata(dati.tot.daClass)} da classificare`} />
        <Stat label="Rapportini" value={dati.rapportini.length} sub={`${dati.rapportini.filter((r) => r.esito !== 'completato').length} con seguito`} />
      </div>
      <div className="row">{dati.quadra ? <Badge tono="ok"><CheckCircle2 size={14} /> Quadratura verificata: clienti + interne = attribuite; attribuite + non attribuite = effettive</Badge> : <Badge tono="danger"><XCircle size={14} /> Quadratura non verificata</Badge>}</div>
      <div className="split">
        <Card title="Per operaio">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Operaio</th><th className="num">Giorni</th><th className="num">Effettive</th><th className="num">Attribuite</th><th className="num">Non attr.</th><th className="num">Anom.</th><th>Cartellino</th></tr></thead>
            <tbody>{operai.map((o) => { const x = dati.perOperaio.get(o.id); const c = cartellini.find((k) => k.operaio_id === o.id); return (
              <tr key={o.id}><td>{nomeOperaio(s, o.id)}</td><td className="num">{x?.giorni.size ?? 0}</td><td className="num">{formatDurata(x?.netta ?? 0)}</td><td className="num">{formatDurata(x?.attribuite ?? 0)}</td><td className="num">{formatDurata(x?.non ?? 0)}</td><td className="num">{x?.anomalie ?? 0}</td><td>{c ? <CartellinoBadge stato={c.stato} /> : <Badge>In compilazione</Badge>}</td></tr>
            ); })}</tbody>
            <tfoot><tr><td>Totale</td><td /><td className="num">{formatDurata(dati.tot.netta)}</td><td className="num">{formatDurata(dati.tot.attribuite)}</td><td className="num">{formatDurata(dati.tot.non)}</td><td /><td /></tr></tfoot>
          </table></div>
        </Card>
        <div className="stack">
          <Card title="Per cliente">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Cliente</th><th className="num">Lavoro</th><th className="num">Viaggio</th><th className="num">Rapp.</th><th className="num">Materiali</th></tr></thead>
              <tbody>{[...dati.perCliente.entries()].sort((a, b) => b[1].ore - a[1].ore).map(([id, c]) => <tr key={id}><td>{nomeCliente(s, id)}</td><td className="num">{formatDurata(c.ore)}</td><td className="num">{formatDurata(c.trasf)}</td><td className="num">{dati.rapportini.filter((r) => r.cliente_id === id).length}</td><td className="num">{formatEuro(materiali.perCliente.find((v) => v.chiave === id)?.costo ?? 0)}</td></tr>)}</tbody>
            </table></div>
          </Card>
          <Card title="Attività interne">
            <table className="table"><tbody>{[...dati.perInterna.entries()].map(([k, ms]) => <tr key={k}><td>{CODICI_ATTIVITA_INTERNA[k as CodiceAttivitaInterna] ?? k}</td><td className="num">{formatDurata(ms)}</td></tr>)}</tbody></table>
          </Card>
        </div>
      </div>
    </div>
  );
}
