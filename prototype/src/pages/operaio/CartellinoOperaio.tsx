import { CheckCircle2, MessageSquareWarning, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useData, useUtente } from '../../app/AppContext';
import { etichettaMese, localDate, meseDi, mesePrecedente } from '../../domain/time';
import { ETICHETTE_STATO } from '../../domain/timesheet-workflow';
import { Alert, CartellinoBadge, ConfirmSheet, PageHead, SyncBadge } from '../../ui/components';
import { GiorniCartellino, PassiCartellino, StoricoApprovazioni, TotaliCartellinoView } from '../../ui/CartellinoView';

export function CartellinoOperaio() {
  const s = useData();
  const u = useUtente();
  const { run, runOk } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const corrente = meseDi(localDate(s.db.now()));
  const prec = mesePrecedente(corrente.anno, corrente.mese);
  const def = s.timesheet.cartellino(u.id, prec.anno, prec.mese) ? prec : corrente;
  const anno = Number(params.get('anno') ?? def.anno);
  const mese = Number(params.get('mese') ?? def.mese);
  const [dialogo, setDialogo] = useState<'conferma' | 'discrepanza' | null>(null);

  const c = s.timesheet.cartellino(u.id, anno, mese);
  const versione = c ? s.timesheet.versione(c.id, c.versione_corrente) : undefined;
  const anteprima = s.timesheet.anteprima(u.id, anno, mese);
  const dati = versione ?? { giorni: anteprima.giorni, totali: anteprima.totali };
  const mesi = [mesePrecedente(prec.anno, prec.mese), prec, corrente];

  return (
    <div className="stack">
      <PageHead title={`Cartellino ${etichettaMese(anno, mese)}`} eyebrow="Il mio cartellino presenze" actions={
        <div className="segmented">
          {mesi.map((m) => (
            <button key={`${m.anno}-${m.mese}`} className={m.anno === anno && m.mese === mese ? 'on' : ''} onClick={() => setParams({ anno: String(m.anno), mese: String(m.mese) })}>{etichettaMese(m.anno, m.mese)}</button>
          ))}
        </div>
      }>
        <div className="row" style={{ marginTop: 8 }}>
          {c ? <CartellinoBadge stato={c.stato} /> : <span className="badge">In compilazione · non ancora generato</span>}
          {c && <span className="subtle">Versione {c.versione_corrente}{c.versione_approvata ? ` · approvata v${c.versione_approvata}` : ''}</span>}
          {c && <SyncBadge stato={c.sync_stato} />}
        </div>
      </PageHead>

      {c && <PassiCartellino stato={c.stato} />}

      {!c && <Alert tono="info" title="Anteprima dal vivo">Il cartellino verrà generato dall'amministrazione alla chiusura del mese. I totali qui sotto sono calcolati dai dati attuali e possono ancora cambiare.</Alert>}
      {c?.stato === 'da_confermare_operaio' && (
        <Alert tono="warn" title="Controlla e conferma il tuo cartellino" actions={<>
          <button className="btn btn-primary btn-lg" data-testid="cart-conferma" onClick={() => setDialogo('conferma')}><CheckCircle2 /> Confermo, è corretto</button>
          <button className="btn btn-lg" data-testid="cart-discrepanza" onClick={() => setDialogo('discrepanza')}><MessageSquareWarning /> Segnala una discrepanza</button>
        </>}>
          Verifica giorni, orari, pause e ore. Confermando, il cartellino passa all'amministrazione per l'approvazione. Se qualcosa non torna, segnala la discrepanza: il mese torna correggibile.
        </Alert>
      )}
      {c?.stato === 'confermato_operaio' && <Alert tono="info" title="Confermato sul dispositivo">La conferma verrà inviata all'amministrazione appena il dispositivo si sincronizza. Lo stato diventerà “In attesa di approvazione” solo dopo la ricezione da parte del server.</Alert>}
      {c?.stato === 'in_attesa_approvazione' && <Alert tono="info" title="In attesa di approvazione">L'amministrazione sta verificando il cartellino.</Alert>}
      {c?.stato === 'approvato' && <Alert tono="ok" title={`Approvato (versione ${c.versione_approvata})`}>Il cartellino è chiuso. Eventuali rettifiche richiedono una riapertura motivata da parte dell'amministrazione.</Alert>}
      {(c?.stato === 'da_correggere' || c?.stato === 'riaperto') && (
        <Alert tono="danger" title={c.stato === 'riaperto' ? 'Cartellino riaperto' : 'Correzioni richieste'} actions={<>
          <button className="btn" onClick={() => navigate('/op/riepilogo')}>Vai alle correzioni</button>
          <button className="btn btn-primary" data-testid="cart-rigenera" onClick={() => run(() => s.timesheet.rigenera(c.id, 'Correzioni completate dall\'operaio'), 'Nuova versione generata')}><RefreshCw /> Ho corretto: genera nuova versione</button>
        </>}>
          {c.ultima_motivazione ? <>Motivo: “{c.ultima_motivazione}”. </> : null}Correggi i giorni interessati dal riepilogo giornaliero (usa le frecce per cambiare giorno o tocca un giorno nella tabella), poi genera una nuova versione da confermare.
        </Alert>
      )}

      <TotaliCartellinoView t={dati.totali} />
      <GiorniCartellino giorni={dati.giorni} onGiorno={(d) => navigate(`/op/riepilogo?data=${d}`)} />
      {c && <StoricoApprovazioni storico={s.timesheet.storico(c.id)} />}

      {dialogo === 'conferma' && c && (
        <ConfirmSheet title="Confermi il cartellino?" conferma="Confermo" testId="dlg-conferma" message={`Confermi che le presenze di ${etichettaMese(anno, mese)} (versione ${c.versione_corrente}) sono corrette. Stato attuale: ${ETICHETTE_STATO[c.stato]}.`} onClose={() => setDialogo(null)}
          onConfirm={async () => { const ok = await runOk(() => s.timesheet.conferma(c.id), 'Cartellino confermato'); if (ok) setDialogo(null); }} />
      )}
      {dialogo === 'discrepanza' && c && (
        <ConfirmSheet title="Segnala una discrepanza" conferma="Invia segnalazione" tono="danger" motivazione="obbligatoria" testId="dlg-discrepanza" message="Descrivi cosa non è corretto (giorno e orario). Il mese tornerà modificabile per le correzioni." onClose={() => setDialogo(null)}
          onConfirm={async (m) => { const ok = await runOk(() => s.timesheet.segnalaDiscrepanza(c.id, m), 'Discrepanza segnalata'); if (ok) setDialogo(null); }} />
      )}
    </div>
  );
}
