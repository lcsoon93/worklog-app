/**
 * Fase 14 – Storico amministrativo e doppia esportazione PDF (solo amministratore).
 * Inclusione/esclusione, archiviazione, ripristino ed eliminazione definitiva degli elementi;
 * anteprima ed esportazione del riepilogo operativo completo e di quello per fatturazione.
 */
import { Archive, Ban, CheckCircle2, Eye, FileDown, History, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { formatDurata } from '../../domain/hours-engine';
import { formatData, formatOra, localDate, toMs } from '../../domain/time';
import type { ElementoStorico } from '../../domain/types';
import { generaPdfReport, scaricaPdf } from '../../reports/pdf-report-service';
import { formatta, type ReportDoc } from '../../reports/report-tabellare';
import type { FiltroStorico, StatoElemento, TipoRiepilogo } from '../../services/storico-service';
import { Alert, Badge, Card, ConfirmSheet, Empty, PageHead, Segmented, Stat } from '../../ui/components';
import { nomeOperaio, nomeSede } from '../../ui/labels';

type Azione = { tipo: 'escludi' | 'includi' | 'archivia' | 'ripristina' | 'elimina'; entita: ElementoStorico; id: string; etichetta: string };
const TONO: Record<StatoElemento, 'ok' | 'warn' | 'neutral'> = { incluso: 'ok', escluso: 'warn', archiviato: 'neutral' };
const ETICHETTA: Record<StatoElemento, string> = { incluso: 'Incluso', escluso: 'Escluso', archiviato: 'Archiviato' };

export function Storico() {
  const s = useData();
  const { run } = useApp();
  const clienti = s.planning.clienti();
  const oggi = localDate(s.db.now());
  const [f, setF] = useState<FiltroStorico>({ da: `${oggi.slice(0, 7)}-01`, a: oggi, cliente_id: clienti[0]?.id ?? '', sede_id: null });
  const [vista, setVista] = useState<'tutti' | StatoElemento>('tutti');
  const [anteprima, setAnteprima] = useState<TipoRiepilogo | null>(null);
  const [azione, setAzione] = useState<Azione | null>(null);
  const [registro, setRegistro] = useState(false);
  const set = (p: Partial<FiltroStorico>) => setF((x) => ({ ...x, ...p }));

  let modello = null;
  let errore = '';
  try {
    modello = f.cliente_id ? s.storico.modello(f) : null;
  } catch (e) {
    errore = e instanceof Error ? e.message : String(e);
  }
  const doc = anteprima && modello ? s.storico.documento(anteprima, f) : null;
  const visibile = (st: StatoElemento) => vista === 'tutti' || st === vista;

  const esporta = async (tipo: TipoRiepilogo) => {
    await run(async () => {
      const { doc: d, esportazione } = await s.storico.esporta(tipo, f);
      scaricaPdf(await generaPdfReport(d), `${esportazione.codice}.pdf`);
    }, tipo === 'amministrativo' ? 'Riepilogo per fatturazione esportato' : 'Riepilogo operativo esportato');
  };

  const esegui = async (a: Azione, motivo: string) => {
    const fn: () => Promise<unknown> = {
      escludi: () => s.storico.escludi(a.entita, a.id, motivo),
      includi: () => s.storico.includi(a.entita, a.id, motivo),
      archivia: () => s.storico.archivia(a.entita, a.id, motivo),
      ripristina: () => s.storico.ripristina(a.entita, a.id, motivo),
      elimina: () => s.storico.eliminaDefinitivamente(a.entita, a.id, motivo),
    }[a.tipo];
    const ok = await run(fn, 'Operazione registrata nello storico');
    if (ok) setAzione(null);
  };

  const Azioni = ({ entita, id, stato, etichetta }: { entita: ElementoStorico; id: string; stato: StatoElemento; etichetta: string }) => (
    <div className="row azioni-storico" style={{ gap: 6 }}>
      <Badge tono={TONO[stato]} testId="stato-elemento">{ETICHETTA[stato]}</Badge>
      {stato === 'incluso' && <button className="btn btn-sm" data-testid="storico-escludi" onClick={() => setAzione({ tipo: 'escludi', entita, id, etichetta })}><Ban size={16} /> Escludi</button>}
      {stato === 'escluso' && <button className="btn btn-sm" data-testid="storico-includi" onClick={() => setAzione({ tipo: 'includi', entita, id, etichetta })}><CheckCircle2 size={16} /> Includi</button>}
      {stato !== 'archiviato' && <button className="btn btn-sm btn-ghost" data-testid="storico-archivia" onClick={() => setAzione({ tipo: 'archivia', entita, id, etichetta })}><Archive size={16} /> Archivia</button>}
      {stato === 'archiviato' && <button className="btn btn-sm" data-testid="storico-ripristina" onClick={() => setAzione({ tipo: 'ripristina', entita, id, etichetta })}><RotateCcw size={16} /> Ripristina</button>}
      {stato === 'archiviato' && entita !== 'giornata' && <button className="btn btn-sm btn-ghost" data-testid="storico-elimina" disabled={!!s.storico.motivoNonEliminabile(entita, id)} title={s.storico.motivoNonEliminabile(entita, id) ?? 'Eliminazione definitiva'} onClick={() => setAzione({ tipo: 'elimina', entita, id, etichetta })}><Trash2 size={16} /> Elimina</button>}
    </div>
  );

  const sedi = f.cliente_id ? s.planning.sedi(f.cliente_id) : [];
  return (
    <div className="stack">
      <PageHead title="Storico e fatturazione" eyebrow="Gestione amministrativa" actions={<button className="btn" onClick={() => setRegistro(!registro)} data-testid="mostra-registro"><History /> {registro ? 'Nascondi registro' : 'Registro operazioni'}</button>} />
      <Alert tono="info">Escludere o archiviare un elemento cambia solo il <strong>riepilogo amministrativo per fatturazione</strong>: attività, rapporti, presenze e cartellini restano invariati e compaiono sempre nel riepilogo operativo completo.</Alert>

      <Card title="Cliente e periodo" pad>
        <div className="filtri-grid">
          <div className="field"><label htmlFor="st-cliente">Cliente</label>
            <select id="st-cliente" className="select" value={f.cliente_id} onChange={(e) => set({ cliente_id: e.target.value, sede_id: null })} data-testid="storico-cliente">
              {clienti.map((c) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="st-sede">Sede</label>
            <select id="st-sede" className="select" value={f.sede_id ?? ''} onChange={(e) => set({ sede_id: e.target.value || null })}>
              <option value="">Tutte le sedi</option>
              {sedi.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="st-da">Dal</label><input id="st-da" type="date" className="input" value={f.da} onChange={(e) => e.target.value && set({ da: e.target.value })} data-testid="storico-da" /></div>
          <div className="field"><label htmlFor="st-a">Al</label><input id="st-a" type="date" className="input" value={f.a} onChange={(e) => e.target.value && set({ a: e.target.value })} data-testid="storico-a" /></div>
        </div>
      </Card>
      {errore && <Alert tono="danger">{errore}</Alert>}

      {modello && (
        <>
          <div className="grid-2">
            <Card title="Riepilogo operativo completo" pad testId="totali-operativo">
              <div className="grid-2">
                <Stat label="Ore" value={formatDurata(modello.totaliOperativo.ms)} />
                <Stat label="Rapporti" value={modello.totaliOperativo.rapporti} sub={`${modello.totaliOperativo.giornate} giornate · ${modello.totaliOperativo.materiali.length} materiali`} />
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setAnteprima(anteprima === 'operativo' ? null : 'operativo')} data-testid="anteprima-operativo"><Eye /> Anteprima</button>
                <button className="btn" onClick={() => void esporta('operativo')} data-testid="esporta-operativo"><FileDown /> PDF operativo</button>
              </div>
            </Card>
            <Card title="Riepilogo per fatturazione" pad testId="totali-amministrativo">
              <div className="grid-2">
                <Stat label="Ore incluse" value={<span data-testid="ore-amministrative">{formatDurata(modello.totaliAmministrativo.ms)}</span>} tono="ok" />
                <Stat label="Rapporti inclusi" value={modello.totaliAmministrativo.rapporti} sub={`${modello.totaliAmministrativo.giornate} giornate · ${modello.totaliAmministrativo.materiali.length} materiali`} />
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setAnteprima(anteprima === 'amministrativo' ? null : 'amministrativo')} data-testid="anteprima-amministrativo"><Eye /> Anteprima</button>
                <button className="btn btn-primary" onClick={() => void esporta('amministrativo')} data-testid="esporta-amministrativo"><FileDown /> PDF per fatturazione</button>
              </div>
            </Card>
          </div>

          {doc && <Anteprima doc={doc} onChiudi={() => setAnteprima(null)} />}

          <Card title={`Elementi del periodo (${modello.giorni.length} giornate)`} actions={<Segmented value={vista} onChange={setVista} testId="filtro-storico" options={[{ value: 'tutti', label: 'Tutti' }, { value: 'incluso', label: 'Inclusi' }, { value: 'escluso', label: 'Esclusi' }, { value: 'archiviato', label: 'Archiviati' }]} />}>
            {modello.giorni.length === 0 ? <Empty>Nessuna attività o rapporto per questo cliente nel periodo.</Empty> : modello.giorni.map((g) => {
              const att = g.attivita.filter((a) => visibile(a.stato));
              const rap = g.rapporti.filter((r) => visibile(r.stato));
              if (!visibile(g.stato) && att.length === 0 && rap.length === 0) return null;
              return (
                <div key={g.data} className="giorno-storico" data-testid="giorno-storico">
                  <div className="list-row" style={{ cursor: 'default', background: 'var(--surface-2)' }}>
                    <div className="grow"><div className="title">{formatData(g.data)}</div><div className="subtle">{formatDurata(g.attivita.reduce((t, a) => t + a.ms, 0))} registrate · {formatDurata(g.attivita.filter((a) => a.inclusa).reduce((t, a) => t + a.ms, 0))} incluse</div></div>
                    <Azioni entita="giornata" id={g.chiave} stato={g.stato} etichetta={`la giornata del ${formatData(g.data)}`} />
                  </div>
                  {rap.map((r) => (
                    <div key={r.rapportino.id} className="list-row" style={{ cursor: 'default' }} data-testid="rapporto-storico">
                      <div className="grow">
                        <div className="title ellipsis"><Link to={`/rapportini/${r.rapportino.id}`}>Rapporto {r.rapportino.numero ?? r.rapportino.numero_provvisorio}</Link> · {formatDurata(r.ms)}</div>
                        <div className="subtle ellipsis">{r.rapportino.descrizione_lavoro} · {r.rapportino.materiali.length} materiali{!r.incluso && r.stato === 'incluso' ? ' · fuori dal documento per la giornata esclusa' : ''}</div>
                      </div>
                      <Link className="btn btn-sm btn-ghost" to={`/rapportini/${r.rapportino.id}?correggi=1`} aria-label="Modifica rapporto"><Pencil size={16} /></Link>
                      <Azioni entita="rapportino" id={r.rapportino.id} stato={r.stato} etichetta={`il rapporto ${r.rapportino.numero ?? r.rapportino.numero_provvisorio}`} />
                    </div>
                  ))}
                  {att.map((a) => (
                    <div key={a.attivita.id} className="list-row" style={{ cursor: 'default' }} data-testid="attivita-storico">
                      <div className="grow">
                        <div className="title ellipsis">{nomeOperaio(s, a.operaio_id)} · {formatOra(a.attivita.inizio_at)}–{a.attivita.fine_at ? formatOra(a.attivita.fine_at) : '…'} · {formatDurata(a.ms)}</div>
                        <div className="subtle ellipsis">{a.attivita.tipo === 'trasferimento' ? 'Viaggio' : 'Lavoro'} · {nomeSede(s, a.attivita.sede_id) || 'sede non indicata'}{a.rapportino_id ? ' · collegata a un rapporto' : ''}{a.stato === 'incluso' && !a.inclusa ? ' · fuori dal documento (giornata o rapporto escluso)' : ''}</div>
                      </div>
                      <Link className="btn btn-sm btn-ghost" to={`/admin/presenze?operaio=${a.operaio_id}&data=${a.data}`} aria-label="Modifica attività"><Pencil size={16} /></Link>
                      <Azioni entita="attivita" id={a.attivita.id} stato={a.stato} etichetta={`l'attività delle ${formatOra(a.attivita.inizio_at)}`} />
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>
        </>
      )}

      <Card title="Esportazioni generate" testId="esportazioni">
        {s.storico.esportazioni().length === 0 ? <Empty>Nessuna esportazione.</Empty> : (
          <div className="list">
            {s.storico.esportazioni().slice(0, 20).map((e) => (
              <div key={e.id} className="list-row" style={{ cursor: 'default' }} data-testid="riga-esportazione">
                <div className="grow"><div className="title">{e.codice}</div><div className="subtle">{e.tipo === 'amministrativo' ? 'Per fatturazione' : 'Operativo completo'} · {s.db.get('clienti', e.cliente_id)?.ragione_sociale} · {formatData(e.da, { breve: true })} – {formatData(e.a, { breve: true })} · {new Date(toMs(e.generato_at)).toLocaleString('it-IT')} · {nomeOperaio(s, e.generato_da)}</div></div>
                <span className="tabular">{formatDurata(e.ore_ms)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {registro && (
        <Card title="Registro delle operazioni sullo storico" testId="registro-storico">
          {s.storico.registroOperazioni().length === 0 ? <Empty>Nessuna operazione.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Data e ora</th><th>Utente</th><th>Elemento</th><th>Operazione</th></tr></thead>
                <tbody>
                  {s.storico.registroOperazioni().map((x) => (
                    <tr key={x.id}><td>{new Date(toMs(x.eseguita_at)).toLocaleString('it-IT')}</td><td>{nomeOperaio(s, x.utente_id)}</td><td>{x.entita === 'giornata' ? `Giornata ${x.entitaId.split('|')[1] ?? ''}` : x.entita === 'rapportino' ? 'Rapporto' : 'Attività'}</td><td>{x.operazione}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {azione && (
        <ConfirmSheet
          title={{ escludi: 'Escludere dai documenti amministrativi?', includi: 'Includere nei documenti amministrativi?', archivia: 'Archiviare?', ripristina: 'Ripristinare?', elimina: 'Eliminare definitivamente?' }[azione.tipo]}
          message={azione.tipo === 'elimina' ? `Stai eliminando ${azione.etichetta}. L'operazione resta nel registro con una copia completa del dato.` : `Riguarda ${azione.etichetta}. Il dato originale non viene modificato.`}
          conferma={{ escludi: 'Escludi', includi: 'Includi', archivia: 'Archivia', ripristina: 'Ripristina', elimina: 'Elimina definitivamente' }[azione.tipo]}
          tono={azione.tipo === 'elimina' ? 'danger' : 'primary'}
          motivazione={azione.tipo === 'elimina' ? 'obbligatoria' : 'facoltativa'}
          testId="conferma-storico"
          onClose={() => setAzione(null)}
          onConfirm={(m) => esegui(azione, m)}
        />
      )}
    </div>
  );
}

/** Anteprima a schermo dello stesso documento che verrà stampato nel PDF. */
function Anteprima({ doc, onChiudi }: { doc: ReportDoc; onChiudi: () => void }) {
  return (
    <Card title={`Anteprima: ${doc.titolo}`} actions={<button className="btn btn-sm" onClick={onChiudi}>Chiudi</button>} testId="anteprima">
      <div className="card-body stack-sm">
        <dl className="kv small">{doc.filtri.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        <div className="row">{doc.indicatori.map((k) => <Badge key={k.etichetta} tono="info">{k.etichetta}: {formatta(k.valore, k.tipo)}</Badge>)}</div>
        {doc.avvisi.map((a) => <Alert key={a} tono="warn">{a}</Alert>)}
      </div>
      {doc.tabelle.map((t) => (
        <div key={t.id} className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <h3 style={{ marginBottom: 8 }}>{t.titolo}</h3>
          {t.righe.length === 0 ? <p className="subtle">Nessun elemento.</p> : (
            <div className="table-wrap">
              <table className="table" data-testid={`anteprima-${t.id}`}>
                <thead><tr>{t.colonne.map((c) => <th key={c.chiave} className={c.tipo === 'durata' || c.tipo === 'quantita' ? 'num' : ''}>{c.titolo}</th>)}</tr></thead>
                <tbody>{t.righe.map((r, i) => <tr key={i}>{t.colonne.map((c) => <td key={c.chiave} className={c.tipo === 'durata' || c.tipo === 'quantita' ? 'num' : ''}>{formatta(r[c.chiave] ?? null, c.tipo)}</td>)}</tr>)}</tbody>
                {t.totale && <tfoot><tr>{t.colonne.map((c) => <td key={c.chiave} className={c.tipo === 'durata' ? 'num' : ''}>{formatta(t.totale![c.chiave] ?? null, c.tipo)}</td>)}</tr></tfoot>}
              </table>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
