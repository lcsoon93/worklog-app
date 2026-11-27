/**
 * Report aziendali e analisi gestionale (Fase 6).
 * Quattro viste (dashboard, personale, interventi e clienti, economico) con filtri comuni
 * salvati nell'indirizzo della pagina. Ogni vista mostra un ReportDoc calcolato da
 * AnalisiService; PDF, Excel e CSV esportano lo stesso oggetto, quindi gli stessi dati.
 */
import { AlertTriangle, BarChart3, Download, FileDown, FileSpreadsheet, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { addDays, localDate } from '../../domain/time';
import { CODICI_ATTIVITA_INTERNA } from '../../domain/types';
// Il modulo PDF carica pdfmake solo al primo export: l'import statico non appesantisce l'avvio.
import { generaPdfReport, scaricaFile } from '../../reports/pdf-report-service';
import { formatta, nomeFileReport, reportCsv, type ReportDoc, type TabellaReport } from '../../reports/report-tabellare';
import { ETICHETTE_STATO_CARTELLINO, ETICHETTE_STATO_INTERVENTO, ETICHETTE_TIPO_ATTIVITA, ETICHETTE_TIPO_INTERVENTO, type FiltroReport } from '../../services/analisi-service';
import { messaggioErrore } from '../../shared/errors';
import { Alert, Card, Empty, PageHead, Segmented, Stat } from '../../ui/components';

type Vista = 'dashboard' | 'personale' | 'interventi' | 'economico';
type Preset = 'mese' | 'mese_prec' | '30g' | 'anno' | 'libero';

function periodoDa(preset: Preset, oggi: string): { da: string; a: string } | null {
  const [y, m] = oggi.split('-').map(Number);
  const fineMese = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  switch (preset) {
    case 'mese': return { da: `${oggi.slice(0, 7)}-01`, a: oggi };
    case 'mese_prec': { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { da: `${py}-${String(pm).padStart(2, '0')}-01`, a: fineMese(py, pm) }; }
    case '30g': return { da: addDays(oggi, -29), a: oggi };
    case 'anno': return { da: `${y}-01-01`, a: oggi };
    default: return null;
  }
}

export function Analisi() {
  const s = useData();
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const oggi = localDate(s.db.now());
  const vista = (params.get('vista') as Vista) ?? 'dashboard';
  const preset = (params.get('periodo') as Preset) ?? 'mese';
  const p = periodoDa(preset, oggi);
  const filtro: FiltroReport = {
    da: p?.da ?? params.get('da') ?? `${oggi.slice(0, 7)}-01`,
    a: p?.a ?? params.get('a') ?? oggi,
    operaioId: params.get('operaio') || undefined,
    clienteId: params.get('cliente') || undefined,
    sedeId: params.get('sede') || undefined,
    interventoId: params.get('intervento') || undefined,
    tipo: params.get('tipo') || undefined,
    stato: params.get('stato') || undefined,
  };
  const imposta = (patch: Record<string, string | undefined>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };
  const rev = s.db.getRevision();
  const chiave = JSON.stringify({ vista, filtro });
  const esito = useMemo(() => {
    try {
      const r = vista === 'personale' ? s.analisi.personale(filtro) : vista === 'interventi' ? s.analisi.interventi(filtro) : vista === 'economico' ? s.analisi.economico(filtro) : s.analisi.dashboard(filtro);
      return { r, errore: null as string | null };
    } catch (e) {
      return { r: null, errore: messaggioErrore(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave, rev]);
  const [inEsportazione, setInEsportazione] = useState<string | null>(null);

  const esporta = async (formato: 'pdf' | 'xlsx' | 'csv', r: ReportDoc, tabella?: TabellaReport) => {
    setInEsportazione(formato + (tabella?.id ?? ''));
    try {
      if (formato === 'pdf') scaricaFile(new Blob([await generaPdfReport(r)], { type: 'application/pdf' }), nomeFileReport(r, 'pdf'));
      else if (formato === 'xlsx') {
        const { reportXlsx } = await import('../../reports/xlsx');
        scaricaFile(new Blob([reportXlsx(r)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeFileReport(r, 'xlsx'));
      } else scaricaFile(new Blob([reportCsv(r, tabella?.id)], { type: 'text/csv;charset=utf-8' }), tabella ? `report-${r.id}-${tabella.id}_${r.periodo.da}_${r.periodo.a}.csv` : nomeFileReport(r, 'csv'));
      toast(`Esportazione ${formato.toUpperCase()} pronta`, 'ok');
    } catch (e) {
      toast(messaggioErrore(e), 'error');
    } finally {
      setInEsportazione(null);
    }
  };

  // Opzioni dei filtri
  const operai = s.planning.operai();
  const clienti = s.planning.clienti();
  const sedi = filtro.clienteId ? s.planning.sedi(filtro.clienteId) : [];
  const interventi = s.db.where('interventi', (i) => (!filtro.clienteId || i.cliente_id === filtro.clienteId) && (!filtro.sedeId || i.sede_id === filtro.sedeId) && (i.data_programmata === null || (i.data_programmata >= filtro.da && i.data_programmata <= filtro.a))).sort((a, b) => a.codice.localeCompare(b.codice));
  const perAttivita = vista === 'personale' || vista === 'dashboard';
  const tipi: Array<[string, string]> = perAttivita
    ? [['lavoro_cliente', ETICHETTE_TIPO_ATTIVITA.lavoro_cliente], ['trasferimento', ETICHETTE_TIPO_ATTIVITA.trasferimento], ['interna', ETICHETTE_TIPO_ATTIVITA.interna], ...Object.keys(CODICI_ATTIVITA_INTERNA).map((k) => [`interna:${k}`, ETICHETTE_TIPO_ATTIVITA[`interna:${k}`]] as [string, string]), ['da_definire', ETICHETTE_TIPO_ATTIVITA.da_definire]]
    : Object.entries(ETICHETTE_TIPO_INTERVENTO);
  const stati: Array<[string, string]> = vista === 'personale' ? Object.entries(ETICHETTE_STATO_CARTELLINO) : vista === 'interventi' ? Object.entries(ETICHETTE_STATO_INTERVENTO) : [];

  const r = esito.r;
  return (
    <div className="stack">
      <PageHead title="Report e analisi" eyebrow="Andamento aziendale" actions={r && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!!inEsportazione} onClick={() => void esporta('pdf', r)} data-testid="export-pdf"><FileDown /> {inEsportazione === 'pdf' ? 'Generazione…' : 'PDF'}</button>
          <button className="btn" disabled={!!inEsportazione} onClick={() => void esporta('xlsx', r)} data-testid="export-xlsx"><FileSpreadsheet /> Excel</button>
          <button className="btn" disabled={!!inEsportazione} onClick={() => void esporta('csv', r)} data-testid="export-csv"><Download /> CSV</button>
        </div>
      )}>
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <Segmented<Vista> value={vista} onChange={(v) => imposta({ vista: v, tipo: undefined, stato: undefined })} testId="analisi-vista" options={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'personale', label: 'Presenze e personale' },
            { value: 'interventi', label: 'Interventi e clienti' },
            { value: 'economico', label: 'Economico' },
          ]} />
        </div>
      </PageHead>

      <Card pad testId="analisi-filtri">
        <div className="filtri-grid">
          <label className="field"><span className="label">Periodo</span>
            <select className="select" value={preset} onChange={(e) => { const v = e.target.value as Preset; imposta(v === 'libero' ? { periodo: v, da: filtro.da, a: filtro.a } : { periodo: v, da: undefined, a: undefined }); }} data-testid="filtro-periodo">
              <option value="mese">Mese corrente</option><option value="mese_prec">Mese precedente</option><option value="30g">Ultimi 30 giorni</option><option value="anno">Anno in corso</option><option value="libero">Personalizzato</option>
            </select>
          </label>
          <label className="field"><span className="label">Dal</span><input className="input" type="date" value={filtro.da} onChange={(e) => imposta({ periodo: 'libero', da: e.target.value, a: filtro.a })} data-testid="filtro-da" /></label>
          <label className="field"><span className="label">Al</span><input className="input" type="date" value={filtro.a} onChange={(e) => imposta({ periodo: 'libero', a: e.target.value, da: filtro.da })} data-testid="filtro-a" /></label>
          <label className="field"><span className="label">Lavoratore</span>
            <select className="select" value={filtro.operaioId ?? ''} onChange={(e) => imposta({ operaio: e.target.value })} data-testid="filtro-operaio"><option value="">Tutti</option>{operai.map((o) => <option key={o.id} value={o.id}>{o.cognome} {o.nome}</option>)}</select>
          </label>
          <label className="field"><span className="label">Cliente</span>
            <select className="select" value={filtro.clienteId ?? ''} onChange={(e) => imposta({ cliente: e.target.value, sede: undefined, intervento: undefined })} data-testid="filtro-cliente"><option value="">Tutti</option>{clienti.map((c) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}</select>
          </label>
          <label className="field"><span className="label">Sede</span>
            <select className="select" value={filtro.sedeId ?? ''} disabled={!filtro.clienteId} onChange={(e) => imposta({ sede: e.target.value, intervento: undefined })} data-testid="filtro-sede"><option value="">{filtro.clienteId ? 'Tutte' : 'Scegli prima il cliente'}</option>{sedi.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
          </label>
          <label className="field"><span className="label">Intervento</span>
            <select className="select" value={filtro.interventoId ?? ''} onChange={(e) => imposta({ intervento: e.target.value })} data-testid="filtro-intervento"><option value="">Tutti</option>{interventi.map((i) => <option key={i.id} value={i.id}>{i.codice} – {i.titolo}</option>)}</select>
          </label>
          <label className="field"><span className="label">{perAttivita ? 'Tipologia di attività' : 'Tipologia di intervento'}</span>
            <select className="select" value={filtro.tipo ?? ''} onChange={(e) => imposta({ tipo: e.target.value })} data-testid="filtro-tipo"><option value="">Tutte</option>{tipi.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          {stati.length > 0 && (
            <label className="field"><span className="label">{vista === 'personale' ? 'Stato cartellino' : 'Stato intervento'}</span>
              <select className="select" value={filtro.stato ?? ''} onChange={(e) => imposta({ stato: e.target.value })} data-testid="filtro-stato"><option value="">Tutti</option>{stati.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          )}
        </div>
        {(filtro.operaioId || filtro.clienteId || filtro.interventoId || filtro.tipo || filtro.stato) && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => imposta({ operaio: undefined, cliente: undefined, sede: undefined, intervento: undefined, tipo: undefined, stato: undefined })}>Azzera filtri</button>
        )}
      </Card>

      {esito.errore && <Alert tono="danger" title="Impossibile calcolare il report">{esito.errore}</Alert>}
      {r && <VistaReport r={r} onCsv={(t) => void esporta('csv', r, t)} />}
    </div>
  );
}

function VistaReport({ r, onCsv }: { r: ReportDoc; onCsv: (t: TabellaReport) => void }) {
  return (
    <>
      <div className="grid-4 kpi-grid" data-testid="analisi-kpi">
        {r.indicatori.map((k) => <Stat key={k.etichetta} label={k.etichetta} value={formatta(k.valore, k.tipo)} sub={k.nota} tono={k.tono} testId="analisi-indicatore" />)}
      </div>
      {r.avvisi.map((a) => <Alert key={a} tono="info">{a}</Alert>)}
      {r.tabelle.map((t) => <TabellaCard key={t.id} t={t} onCsv={() => onCsv(t)} />)}
    </>
  );
}

const RIGHE_INIZIALI = 25;

function TabellaCard({ t, onCsv }: { t: TabellaReport; onCsv: () => void }) {
  const [tutte, setTutte] = useState(false);
  const [grafico, setGrafico] = useState(Boolean(t.grafico));
  const righe = tutte ? t.righe : t.righe.slice(0, RIGHE_INIZIALI);
  return (
    <Card testId={`tabella-${t.id}`} title={<h2 className="row" style={{ gap: 8 }}>{t.id === 'da-verificare' && <AlertTriangle size={20} color="var(--warn)" />}{t.titolo} <span className="subtle">({t.righe.length})</span></h2>} actions={
      <div className="row" style={{ gap: 4 }}>
        {t.grafico && t.righe.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setGrafico(!grafico)} aria-pressed={grafico} aria-label={grafico ? 'Mostra solo la tabella' : 'Mostra il grafico'}>{grafico ? <Table2 size={16} /> : <BarChart3 size={16} />}</button>}
        <button className="btn btn-sm btn-ghost" onClick={onCsv} disabled={!t.righe.length} data-testid="export-csv-tabella"><Download size={16} /> CSV</button>
      </div>
    }>
      {t.nota && <div className="card-body subtle small" style={{ paddingBottom: 0 }}>{t.nota}</div>}
      {t.righe.length === 0 ? <Empty>Nessun dato nel periodo e con i filtri selezionati.</Empty> : (
        <>
          {grafico && t.grafico && <Barre t={t} />}
          <div className="table-wrap">
            <table className="table" data-testid="analisi-tabella">
              <thead><tr>{t.colonne.map((c) => <th key={c.chiave} className={c.tipo !== 'testo' && c.tipo !== 'data' ? 'num' : undefined}>{c.titolo}</th>)}</tr></thead>
              <tbody>{righe.map((riga, i) => <tr key={i}>{t.colonne.map((c) => <td key={c.chiave} className={c.tipo !== 'testo' && c.tipo !== 'data' ? 'num' : undefined}>{formatta(riga[c.chiave] ?? null, c.tipo)}</td>)}</tr>)}</tbody>
              {t.totale && <tfoot><tr>{t.colonne.map((c) => <td key={c.chiave} className={c.tipo !== 'testo' && c.tipo !== 'data' ? 'num' : undefined}>{formatta(t.totale![c.chiave] ?? null, c.tipo)}</td>)}</tr></tfoot>}
            </table>
          </div>
          {t.righe.length > RIGHE_INIZIALI && <div className="card-body" style={{ paddingTop: 8 }}><button className="btn btn-sm" onClick={() => setTutte(!tutte)}>{tutte ? `Mostra le prime ${RIGHE_INIZIALI}` : `Mostra tutte le ${t.righe.length} righe`}</button></div>}
        </>
      )}
    </Card>
  );
}

/** Barre orizzontali a serie singola: un colore, valori scritti, tooltip; la tabella sotto è la vista dati. */
function Barre({ t }: { t: TabellaReport }) {
  const g = t.grafico!;
  const col = t.colonne.find((c) => c.chiave === g.valore)!;
  const dati = t.righe.map((r) => ({ etichetta: String(r[g.etichetta] ?? '—'), v: Number(r[g.valore] ?? 0) })).filter((d) => d.v > 0).sort((a, b) => b.v - a.v).slice(0, 12);
  const max = Math.max(...dati.map((d) => d.v), 1);
  if (!dati.length) return null;
  return (
    <div className="barre" role="img" aria-label={`${t.titolo}: ${col.titolo}`} data-testid="analisi-grafico">
      {dati.map((d) => (
        <div key={d.etichetta} className="barra-riga" title={`${d.etichetta}: ${formatta(d.v, col.tipo)}`}>
          <span className="barra-etichetta ellipsis">{d.etichetta}</span>
          <span className="barra-traccia"><span className="barra" style={{ width: `${Math.max(1, (d.v / max) * 100)}%` }} /></span>
          <span className="barra-valore tabular">{formatta(d.v, col.tipo)}</span>
        </div>
      ))}
      {t.righe.filter((r) => Number(r[g.valore] ?? 0) > 0).length > 12 && <div className="subtle small">Mostrati i 12 valori più alti; l'elenco completo è nella tabella.</div>}
    </div>
  );
}
