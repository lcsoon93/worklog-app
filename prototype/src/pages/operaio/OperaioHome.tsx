import { AlertOctagon, ClipboardCheck, FileDown, Coffee, FilePlus2, FileText, LogIn, LogOut, Pause as PauseIcon, Play, Plus, Square, Timer as TimerIcon, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { formatDurata, formatDurataSecondi } from '../../domain/hours-engine';
import { formatData, formatOra, toMs } from '../../domain/time';
import { Alert, Badge, Card, Empty, InterventoBadge, Sheet, Stat } from '../../ui/components';
import { nomeCliente, nomeSede, titoloAttivita } from '../../ui/labels';
import { useGiornata } from './useGiornata';

export function OperaioHome() {
  const g = useGiornata();
  const { s, u, now, aperta, attivitaInCorso, pausaInCorso, riepilogo, nonChiusa } = g;
  const { run } = useApp();
  const navigate = useNavigate();
  const [chiusura, setChiusura] = useState(false);
  const interventi = s.planning.interventiOperaio(u.id, g.oggi);
  const bozze = s.report.rapportini((r) => r.stato === 'bozza' && r.redatto_da === u.id);

  const avviaSuIntervento = (id: string) =>
    run(async () => {
      let p = aperta;
      if (!p) p = await s.workday.registraEntrata();
      await s.workday.avviaAttivita(p.id, { tipo: 'lavoro_cliente', intervento_id: id, cliente_id: null, sede_id: null, codice_interno: null, descrizione: '' });
    }, 'Timer avviato');

  let hero;
  if (nonChiusa) {
    hero = null;
  } else if (!aperta) {
    const chiusa = g.presenzeOggi.at(-1);
    hero = (
      <div className={`hero ${chiusa ? 'closed' : 'idle'}`} data-testid="hero">
        <div className="hero-label">{formatData(g.oggi)}</div>
        <div className="hero-clock">{chiusa ? `Uscita ${formatOra(chiusa.uscita_at)}` : 'Buongiorno'}</div>
        <div className="hero-sub">{chiusa ? `Giornata chiusa · ${formatDurata(riepilogo?.netta_ms ?? 0)} di presenza netta` : `${u.nome}, non hai ancora registrato l'entrata.`}</div>
        <div className="hero-actions">
          <button className="btn btn-xl btn-white" data-testid="btn-entrata" onClick={() => run(() => s.workday.registraEntrata(), 'Entrata registrata')}>
            <LogIn size={26} /> {chiusa ? 'Nuova entrata' : 'Registra entrata'}
          </button>
          {chiusa && <Link className="btn btn-lg" to="/op/riepilogo">Vedi riepilogo</Link>}
        </div>
      </div>
    );
  } else if (pausaInCorso) {
    const sospesa = s.db.get('attivita_lavoro', pausaInCorso.attivita_sospesa_id);
    hero = (
      <div className="hero paused" data-testid="hero">
        <div className="hero-label">In pausa · {pausaInCorso.tipo}</div>
        <div className="hero-clock tabular" data-testid="pausa-clock">{formatDurataSecondi(now - toMs(pausaInCorso.inizio_at))}</div>
        <div className="hero-sub">Iniziata alle {formatOra(pausaInCorso.inizio_at)}</div>
        <div className="hero-actions">
          {sospesa ? (
            <button className="btn btn-xl btn-white" data-testid="btn-riprendi" onClick={() => run(async () => { await s.workday.terminaPausa(aperta.id); await s.workday.riprendiAttivita(aperta.id, sospesa.id); }, 'Pausa terminata, attività ripresa')}>
              <Play size={26} /> Riprendi {titoloAttivita(s, sospesa).titolo}
            </button>
          ) : null}
          <button className={`btn btn-lg ${sospesa ? '' : 'btn-white'}`} data-testid="btn-fine-pausa" onClick={() => run(() => s.workday.terminaPausa(aperta.id), 'Pausa terminata')}>
            <Coffee /> Termina pausa
          </button>
        </div>
      </div>
    );
  } else if (attivitaInCorso) {
    const t = titoloAttivita(s, attivitaInCorso);
    hero = (
      <div className="hero" data-testid="hero">
        <div className="hero-label row" style={{ gap: 8 }}><span className="pulse" /> Timer attivo · dalle {formatOra(attivitaInCorso.inizio_at)}</div>
        <div className="hero-clock tabular" data-testid="timer-clock">{formatDurataSecondi(now - toMs(attivitaInCorso.inizio_at))}</div>
        <div className="hero-sub"><strong>{t.titolo}</strong> · {t.sotto}</div>
        <div className="hero-actions">
          <Link className="btn btn-lg btn-white" to="/op/timer" data-testid="btn-cambia"><TimerIcon /> Cambia attività</Link>
          <button className="btn btn-lg" data-testid="btn-ferma" onClick={() => run(() => s.workday.fermaAttivita(aperta.id), 'Timer fermato')}><Square /> Ferma</button>
          <button className="btn btn-lg" data-testid="btn-pausa" onClick={() => run(() => s.workday.iniziaPausa(aperta.id, 'pranzo'), 'Pausa avviata: timer sospeso')}><PauseIcon /> Pausa</button>
        </div>
      </div>
    );
  } else {
    hero = (
      <div className="hero idle" data-testid="hero">
        <div className="hero-label">Presente dalle {formatOra(aperta.entrata_at)}</div>
        <div className="hero-clock">Nessun timer attivo</div>
        <div className="hero-sub">Il tempo senza attività resta tra le ore non attribuite.</div>
        <div className="hero-actions">
          {(() => {
            const ultima = s.workday.ultimaRiprendibile(aperta.id);
            return ultima ? (
              <button className="btn btn-xl btn-white" data-testid="btn-riprendi-ultima" onClick={() => run(() => s.workday.riprendiAttivita(aperta.id, ultima.id), 'Attività ripresa')}>
                <Play size={26} /> Riprendi {titoloAttivita(s, ultima).titolo}
              </button>
            ) : null;
          })()}
          <Link className={`btn ${s.workday.ultimaRiprendibile(aperta.id) ? 'btn-lg' : 'btn-xl btn-white'}`} to="/op/timer" data-testid="btn-avvia"><Play size={26} /> {s.workday.ultimaRiprendibile(aperta.id) ? 'Altra attività' : 'Avvia attività'}</Link>
          <Link className="btn btn-lg" to="/op/pause"><PauseIcon /> Pausa</Link>
          <button className="btn btn-lg" data-testid="btn-termina-giornata" onClick={() => navigate('/op/riepilogo')}><LogOut /> Termina giornata</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {nonChiusa && (
        <Alert
          tono="danger"
          title={`La giornata di ${formatData(nonChiusa.presenza.data_lavoro)} non è stata chiusa`}
          actions={<button className="btn btn-danger" data-testid="btn-chiudi-precedente" onClick={() => setChiusura(true)}>Chiudi la giornata</button>}
        >
          Probabilmente l'app è stata chiusa o il tablet si è spento. Ultima attività rilevata alle <strong>{formatOra(nonChiusa.uscitaProposta)}</strong>: conferma o correggi l'orario di uscita prima di iniziare oggi.
        </Alert>
      )}
      {hero}

      <Card title={`Interventi assegnati oggi (${interventi.length})`} actions={<Link className="btn btn-sm btn-ghost" to="/agenda/giorno">Agenda</Link>} testId="card-interventi">
        {interventi.length === 0 ? (
          <Empty icon={<Wrench />}>Nessun intervento programmato per oggi.</Empty>
        ) : (
          <div className="list">
            {interventi.map((i) => {
              const attivo = attivitaInCorso?.intervento_id === i.id;
              return (
                <div key={i.id} className="list-row riga-intervento" style={{ cursor: 'default' }}>
                  <div className="tabular ora" style={{ fontWeight: 750 }}>{i.ora_inizio}</div>
                  <Link className="grow" to={`/interventi/${i.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="title ellipsis">{s.db.get('clienti', i.cliente_id)?.ragione_sociale}</div>
                    <div className="subtle ellipsis">{i.titolo} · {nomeSede(s, i.sede_id)}</div>
                  </Link>
                  <div className="azioni">
                    <InterventoBadge stato={i.stato} />
                    {attivo ? (
                      <span className="badge primary"><span className="dot" /> Timer attivo</span>
                    ) : (
                      <button className="btn btn-soft" data-testid="btn-avvia-intervento" onClick={() => void avviaSuIntervento(i.id)}><Play size={18} /> Avvia</button>
                    )}
                    <Link className="btn btn-ghost icon-btn" to={`/rapportini/nuovo?tipo=rapido&intervento=${i.id}`} aria-label="Rapportino"><FilePlus2 size={20} /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Link className="cta-rapporto" to="/rapportini/nuovo" data-testid="btn-nuovo-rapporto">
        <span className="cta-icona"><Plus size={30} strokeWidth={2.6} /></span>
        <span><strong>NUOVO RAPPORTO DI LAVORO</strong><small>Intervento autonomo · anche senza assegnazione</small></span>
      </Link>

      {bozze.length > 0 && (
        <Card title={`Rapporti da completare (${bozze.length})`} testId="card-bozze">
          <div className="list">
            {bozze.map((r) => (
              <Link key={r.id} className="list-row" to={`/rapportini/${r.id}`} data-testid="riga-bozza">
                <span className="tile-icon"><FileText size={20} /></span>
                <div className="grow">
                  <div className="title ellipsis">{nomeCliente(s, r.cliente_id)}</div>
                  <div className="subtle ellipsis">{r.numero_provvisorio} · {formatData(r.data_lavoro, { breve: true })} · {r.intervento_id ? 'da intervento' : 'autonomo'}</div>
                </div>
                <Badge>Bozza</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {riepilogo && (aperta || g.presenzeOggi.length > 0) && (
        <section className="stack-sm" aria-label="Riepilogo della giornata">
          <div className="row-between"><h2>Riepilogo della giornata</h2><Link className="btn btn-sm btn-ghost" to="/op/riepilogo">Dettaglio</Link></div>
          <div className="grid-4">
            <Stat label="Presenza netta" value={formatDurata(riepilogo.netta_ms)} sub={`Pause ${formatDurata(riepilogo.pause_ms)}`} testId="stat-netta" />
            <Stat label="Ore attribuite" value={formatDurata(riepilogo.attribuite_ms)} tono="ok" testId="stat-attribuite" />
            <Stat label="Non attribuite" value={formatDurata(riepilogo.non_attribuite_ms)} tono={riepilogo.non_attribuite_ms > 30 * 60_000 ? 'warn' : undefined} testId="stat-non-attribuite" />
            <Stat label="Attività" value={s.workday.attivita(riepilogo.presenza_id).length} sub={<Link to="/op/riepilogo">Dettaglio e correzioni</Link>} />
          </div>
        </section>
      )}

      <section className="stack-sm" aria-label="Altre funzioni">
        <h2>Altre funzioni</h2>
        <div className="tiles">
          <Link className="tile" to="/op/timer"><span className="tile-icon"><TimerIcon /></span>Timer attività<small>Avvia o cambia cliente</small></Link>
          <Link className="tile" to="/op/pause"><span className="tile-icon"><Coffee /></span>Pause<small>Pranzo e pause brevi</small></Link>
          <Link className="tile" to="/op/imprevisto" data-testid="tile-imprevisto"><span className="tile-icon"><AlertOctagon /></span>Imprevisto<small>Segnala un problema</small></Link>
          <Link className="tile" to="/rapportini/nuovo?tipo=rapido" data-testid="tile-rapportino"><span className="tile-icon"><FilePlus2 /></span>Rapportino rapido<small>Pochi campi, subito</small></Link>
          <Link className="tile" to="/rapportini/nuovo?tipo=completo"><span className="tile-icon"><FileText /></span>Rapportino completo<small>Materiali, foto, firma</small></Link>
          <Link className="tile" to="/op/riepilogo" data-testid="tile-riepilogo"><span className="tile-icon"><ClipboardCheck /></span>Riepilogo giornata<small>Controlla e correggi</small></Link>
          <Link className="tile" to="/op/riepiloghi" data-testid="tile-riepiloghi"><span className="tile-icon"><FileDown /></span>I miei riepiloghi<small>PDF giornaliero e mensile</small></Link>
        </div>
      </section>

      {chiusura && nonChiusa && <ChiusuraPrecedente onClose={() => setChiusura(false)} presenzaId={nonChiusa.presenza.id} proposta={nonChiusa.uscitaProposta} data={nonChiusa.presenza.data_lavoro} />}
    </div>
  );
}

function ChiusuraPrecedente({ presenzaId, proposta, data, onClose }: { presenzaId: string; proposta: string; data: string; onClose: () => void }) {
  const g = useGiornata();
  const { run } = useApp();
  const [ora, setOra] = useState(formatOra(proposta));
  const [motivo, setMotivo] = useState('Uscita non registrata: app chiusa o dispositivo spento');
  return (
    <Sheet
      title="Chiudi la giornata precedente"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn btn-primary" data-testid="conferma-chiusura" onClick={async () => {
          const [y, m, d] = data.split('-').map(Number);
          const [hh, mm] = ora.split(':').map(Number);
          const ok = await run(() => g.s.workday.registraUscita(presenzaId, new Date(y, m - 1, d, hh, mm).getTime(), { motivo }), 'Giornata chiusa');
          if (ok) onClose();
        }}>Registra uscita</button>
      </>}
    >
      <p className="muted">Proposta basata sull'ultimo segnale dell'app e sull'ultima attività registrata. Il timer eventualmente attivo verrà chiuso allo stesso orario e segnalato come chiusura automatica.</p>
      <div className="field"><label htmlFor="ora-uscita">Orario di uscita del {formatData(data)}</label><input id="ora-uscita" type="time" className="input" value={ora} onChange={(e) => setOra(e.target.value)} /></div>
      <div className="field"><label htmlFor="motivo-uscita">Motivo</label><input id="motivo-uscita" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
    </Sheet>
  );
}
