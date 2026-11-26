import { CloudOff, RefreshCw, RotateCcw, Server, Wifi } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useData } from '../../app/AppContext';
import { CONFIG } from '../../config/ambiente';
import { seedDemo } from '../../data/demo-seed';
import type { OutboxOp } from '../../data/local-db';
import type { SyncStato } from '../../domain/types';
import { Alert, Badge, Card, ConfirmSheet, Empty, PageHead, Stat, SYNC_LABEL, SyncBadge } from '../../ui/components';

const ENTITA: Record<string, string> = {
  presenze: 'Presenza', pause_presenza: 'Pausa', attivita_lavoro: 'Attività', rapportini: 'Rapportino', allegati: 'Allegato', imprevisti: 'Imprevisto',
  interventi: 'Intervento', intervento_operai: 'Assegnazione', followup: 'Ritorno', cartellini_mensili: 'Cartellino', cartellino_versioni: 'Versione cartellino',
  approvazioni_cartellino: 'Approvazione', clienti: 'Cliente', sedi_cliente: 'Sede', profili: 'Utente',
  richieste_correzione: 'Richiesta di correzione', materiali: 'Materiale', magazzini: 'Magazzino', movimenti_magazzino: 'Movimento di magazzino',
};

export function SyncPage() {
  const s = useData();
  const { run, runOk, toast } = useApp();
  const navigate = useNavigate();
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const sim = s.simulazione();
  const ops = s.db.outbox().slice().reverse();
  const conteggi = ops.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.stato]: (acc[o.stato] ?? 0) + 1 }), {});
  const locali = (['rapportini', 'allegati'] as const).reduce((n, e) => n + s.db.where(e, (r) => r.sync_stato === 'locale').length, 0);
  const server = s.api.stato();
  const reale = !!s.auth;

  const toggle = (k: 'offline' | 'erroreServer' | 'rispostaPersa' | 'conflittoProssimaOp') => run(() => s.impostaSimulazione({ [k]: !sim[k] }));
  const sincronizza = async () => {
    setBusy(true);
    try {
      const e = await s.sync.ciclo({ forza: true });
      if (!s.online()) toast('Dispositivo offline: le operazioni restano in coda.', 'error');
      else toast(`Inviate ${e.inviate}: ${e.riuscite} confermate dal server, ${e.errori} errori, ${e.conflitti} conflitti${e.ricevuti ? ` · ricevute ${e.ricevuti} modifiche` : ''}.`, e.errori || e.conflitti ? 'error' : 'ok');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHead title="Stato sincronizzazione" eyebrow={`Dispositivo ${s.db.deviceId}`} actions={<button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void sincronizza()} data-testid="sync-ora"><RefreshCw /> Sincronizza ora</button>} />

      {reale && s.sync.erroreRicezione && <Alert tono="warn" title="Ricezione delle modifiche non riuscita">{s.sync.erroreRicezione}</Alert>}
      {reale && <Alert tono="info" title="Sincronizzazione con il server aziendale">Le operazioni in coda vengono inviate al server e le modifiche fatte su altri dispositivi (rapporti, restituzioni, approvazioni, interventi) arrivano in automatico ogni 30 secondi circa, o subito con “Sincronizza ora”. Senza rete tutto resta salvato sul dispositivo e parte al ritorno della connessione.</Alert>}
      {CONFIG.backend === 'simulato' && <Alert tono="info" title="Server simulato">
        Il prototipo non è collegato a nessun backend. Le operazioni vengono inviate a un <strong>server simulato</strong> nel browser che applica le stesse regole previste per Supabase (idempotenza, versioni, conflitti). Un record risulta “Sincronizzato” solo dopo la risposta positiva di questo server.
      </Alert>}

      <div className="grid-4">
        <Stat label="Connessione" value={s.online() ? 'Online' : 'Offline'} tono={s.online() ? 'ok' : 'danger'} sub={sim.offline ? 'offline simulato' : s.browserOnline() ? 'rete del browser attiva' : 'rete del browser assente'} testId="sync-connessione" />
        <Stat label="In coda" value={(conteggi.in_attesa ?? 0) + (conteggi.in_sincronizzazione ?? 0)} sub={`${locali} elementi solo locali (bozze)`} testId="sync-in-coda" />
        <Stat label="Errori / conflitti" value={`${conteggi.errore ?? 0} / ${conteggi.conflitto ?? 0}`} tono={(conteggi.errore ?? 0) + (conteggi.conflitto ?? 0) ? 'danger' : undefined} />
        <Stat label="Confermate dal server" value={conteggi.sincronizzato ?? 0} sub={reale ? 'Server aziendale (Supabase)' : `Server: ${server.applicazioni} applicate, ${Object.keys(server.processate).length} op. registrate`} tono="ok" />
      </div>

      {CONFIG.backend === 'simulato' && <Card title="Simulazione rete e server" pad>
        <div className="row">
          <button className={`chip ${sim.offline ? 'on' : ''}`} onClick={() => void toggle('offline')} data-testid="sim-offline"><CloudOff size={16} /> Dispositivo offline</button>
          <button className={`chip ${sim.erroreServer ? 'on' : ''}`} onClick={() => void toggle('erroreServer')} data-testid="sim-errore"><Server size={16} /> Errore del server (500)</button>
          <button className={`chip ${sim.rispostaPersa ? 'on' : ''}`} onClick={() => void toggle('rispostaPersa')}><Wifi size={16} /> Risposta persa (una volta)</button>
          <button className={`chip ${sim.conflittoProssimaOp ? 'on' : ''}`} onClick={() => void toggle('conflittoProssimaOp')} data-testid="sim-conflitto">Modifica da altro dispositivo (una volta)</button>
        </div>
        <p className="subtle" style={{ marginBottom: 0 }}>Le prove sono illustrate in docs/08 e docs/10. “Risposta persa” verifica che un nuovo tentativo non duplichi i dati.</p>
      </Card>}

      <Card title={`Coda operazioni (${ops.length})`} actions={<button className="btn btn-sm btn-ghost" onClick={() => run(() => s.sync.pulisciSincronizzate(), 'Operazioni confermate rimosse dalla coda')}>Pulisci confermate</button>}>
        {ops.length === 0 ? <Empty>Nessuna operazione registrata su questo dispositivo.</Empty> : (
          <div className="table-wrap">
            <table className="table" data-testid="tabella-coda">
              <thead><tr><th>#</th><th>Elemento</th><th>Creata</th><th className="num">Tentativi</th><th>Stato</th><th>Dettaglio</th><th /></tr></thead>
              <tbody>{ops.slice(0, 80).map((o) => <RigaOp key={o.id} o={o} />)}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Legenda stati" pad>
        <div className="row">{(Object.keys(SYNC_LABEL) as SyncStato[]).map((k) => <SyncBadge key={k} stato={k} />)}</div>
      </Card>

      {CONFIG.datiDimostrativi && <Card title="Dati dimostrativi" pad>
        <div className="row-between">
          <span className="muted">Cancella tutti i dati locali e rigenera il dataset dimostrativo (utile per ripetere la simulazione).</span>
          <button className="btn btn-danger" onClick={() => setReset(true)} data-testid="reset-demo"><RotateCcw /> Ripristina dati demo</button>
        </div>
      </Card>}
      {reset && (
        <ConfirmSheet title="Ripristinare i dati demo?" tono="danger" conferma="Cancella e rigenera" message="Tutti i dati salvati su questo dispositivo (timbrature, rapportini, coda di sincronizzazione) verranno cancellati e sostituiti dal dataset dimostrativo." onClose={() => setReset(false)}
          onConfirm={async () => {
            const ok = await runOk(async () => { await s.db.reset(); await s.db.init(); await seedDemo(s.db); }, 'Dati demo ripristinati');
            if (ok) { setReset(false); navigate('/login'); }
          }} />
      )}
    </div>
  );
}

function RigaOp({ o }: { o: OutboxOp }) {
  const s = useData();
  const { run } = useApp();
  return (
    <tr data-testid="riga-op">
      <td className="tabular subtle">{o.seq}</td>
      <td><strong>{ENTITA[o.entita] ?? o.entita}</strong><div className="subtle mono" style={{ fontSize: '0.72rem' }}>op {o.id.slice(0, 8)} · rec {o.entita_id.slice(0, 8)}</div></td>
      <td className="tabular">{new Date(o.created_at).toLocaleTimeString('it-IT')}</td>
      <td className="num">{o.tentativi}</td>
      <td><SyncBadge stato={o.stato} /></td>
      <td className="small" style={{ maxWidth: 280 }}>
        {o.ultimo_errore && <div style={{ color: 'var(--danger)' }}>{o.ultimo_errore}</div>}
        {o.stato === 'errore' && o.prossimo_tentativo_at && <div className="subtle">Nuovo tentativo dopo le {new Date(o.prossimo_tentativo_at).toLocaleTimeString('it-IT')}</div>}
        {o.conflitto && <div>Versione server {o.conflitto.versione_server}, base locale {o.base_versione}</div>}
      </td>
      <td>
        {o.stato === 'conflitto' && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => run(() => s.sync.risolviMantieniLocale(o.id), 'Verrà inviata la versione del dispositivo')} data-testid="conflitto-locale">Mantieni mia versione</button>
            <button className="btn btn-sm" onClick={() => run(() => s.sync.risolviAccettaServer(o.id), 'Applicata la versione del server')}>Usa versione server</button>
          </div>
        )}
        {o.stato === 'errore' && <Badge tono="warn">ritenta in automatico</Badge>}
      </td>
    </tr>
  );
}
