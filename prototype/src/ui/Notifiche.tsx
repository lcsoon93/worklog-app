/**
 * Centro notifiche (Fase 7): elenco delle notifiche dell'utente, campanella con contatore,
 * avvisi di sistema facoltativi (Notification API) e opzioni dell'app installata.
 */
import { Bell, BellOff, BellRing, CheckCheck, Download, Maximize, Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { CONFIG } from '../config/ambiente';
import { alternaSchermoIntero, installaApp, isIos, schermoInteroSupportato, usePwa } from '../app/pwa';
import { useApp, useData } from '../app/AppContext';
import type { Notifica } from '../services/notifiche-service';
import { Alert, Badge, Card, Empty, PageHead } from './components';

const CHIAVE_AVVISI = 'avvisi_dispositivo';

export function avvisiSupportati(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function CampanellaNotifiche() {
  const s = useData();
  const n = s.notifiche.nonLette();
  return (
    <NavLink to="/notifiche" className="btn btn-ghost icon-btn campanella" aria-label={n ? `Notifiche: ${n} non lette` : 'Notifiche'} data-testid="campanella">
      {n ? <BellRing /> : <Bell />}
      {n > 0 && <span className="badge-conteggio" data-testid="notifiche-non-lette">{n > 99 ? '99+' : n}</span>}
    </NavLink>
  );
}

/** Mostra un avviso di sistema per le nuove notifiche, se l'utente lo ha attivato su questo dispositivo. */
export function OsservatoreNotifiche() {
  const s = useData();
  const rev = s.db.getRevision();
  const ultimo = useRef(0);
  useEffect(() => {
    if (!avvisiSupportati() || Notification.permission !== 'granted' || !s.db.meta<boolean>(CHIAVE_AVVISI)) return;
    if (Date.now() - ultimo.current < 5000) return; // non più di un controllo ogni 5 s
    ultimo.current = Date.now();
    void (async () => {
      const nuove = await s.notifiche.daAvvisare();
      if (!nuove.length) return;
      const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      for (const n of nuove.slice(0, 3)) {
        const opzioni = { body: n.testo, tag: n.id, icon: 'icon-192.png', badge: 'icon-192.png', data: { link: n.link } };
        if (reg) await reg.showNotification(n.titolo, opzioni).catch(() => undefined);
        else {
          const x = new Notification(n.titolo, opzioni);
          x.onclick = () => { window.focus(); window.location.hash = `#${n.link}`; };
        }
      }
      if (nuove.length > 3 && reg) await reg.showNotification(`Altre ${nuove.length - 3} notifiche`, { body: 'Apri l\'app per vederle', tag: 'altre', data: { link: '/notifiche' } }).catch(() => undefined);
    })();
  }, [rev, s]);
  return null;
}

export function PaginaNotifiche() {
  const s = useData();
  const { run, toast } = useApp();
  const navigate = useNavigate();
  const pwa = usePwa();
  const elenco = s.notifiche.elenco();
  const attivi = Boolean(s.db.meta<boolean>(CHIAVE_AVVISI)) && avvisiSupportati() && Notification.permission === 'granted';

  const attivaAvvisi = async () => {
    if (!avvisiSupportati()) return toast('Questo browser non supporta le notifiche.', 'error');
    const permesso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permesso !== 'granted') return toast('Permesso negato: le notifiche si possono riattivare dalle impostazioni del browser.', 'error');
    await run(async () => {
      await s.notifiche.allineaAvvisi();
      await s.db.setMeta(CHIAVE_AVVISI, true);
    }, 'Avvisi attivati su questo dispositivo');
  };

  const apri = async (n: Notifica) => {
    await s.notifiche.segnaLette([n.id]);
    navigate(n.link);
  };

  return (
    <div className="stack">
      <PageHead title="Notifiche" eyebrow="Promemoria e avvisi" actions={elenco.some((n) => !n.letta) && <button className="btn" onClick={() => run(() => s.notifiche.segnaTutteLette(), 'Tutte segnate come lette')} data-testid="notifiche-tutte-lette"><CheckCheck /> Segna tutte come lette</button>} />
      <Card testId="notifiche-elenco">
        {elenco.length === 0 ? <Empty icon={<Bell />}>Nessuna notifica: sei in pari.</Empty> : (
          <div className="list">
            {elenco.map((n) => (
              <button key={n.id} className={`list-row notifica ${n.letta ? 'letta' : ''}`} style={{ width: '100%', textAlign: 'left' }} onClick={() => void apri(n)} data-testid="notifica">
                <span className={`punto ${n.letta ? '' : n.priorita === 'alta' ? 'alta' : 'nuova'}`} aria-hidden />
                <div className="grow">
                  <div className="title">{n.titolo} {!n.letta && <span className="sr-only">(non letta)</span>}</div>
                  <div className="subtle">{n.testo}</div>
                </div>
                {n.priorita === 'alta' && !n.letta && <Badge tono="warn">Importante</Badge>}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="Avvisi su questo dispositivo" pad>
        <div className="stack-sm">
          {!avvisiSupportati() ? (
            <Alert tono="info">Questo browser non supporta le notifiche di sistema: le trovi comunque in questa pagina e nella campanella.</Alert>
          ) : attivi ? (
            <div className="row-between"><span><BellRing size={18} /> Avvisi attivi: riceverai un avviso quando compare una nuova notifica mentre l'app è aperta o in secondo piano.</span>
              <button className="btn" onClick={() => run(() => s.db.setMeta(CHIAVE_AVVISI, false), 'Avvisi disattivati')} data-testid="avvisi-disattiva"><BellOff /> Disattiva</button></div>
          ) : (
            <div className="row-between"><span>Ricevi un avviso di sistema per interventi assegnati o modificati, promemoria, cartellini e scorte.</span>
              <button className="btn btn-primary" onClick={() => void attivaAvvisi()} data-testid="avvisi-attiva"><Bell /> Attiva avvisi</button></div>
          )}
          <p className="subtle small" style={{ margin: 0 }}>
            {CONFIG.pushVapidPublicKey
              ? 'Le notifiche push con app chiusa saranno disponibili quando il server push sarà configurato.'
              : "Limite: senza un server push (non ancora configurato) gli avvisi arrivano solo mentre l'app è aperta o in secondo piano, non con l'app completamente chiusa. Su iPhone/iPad servono iOS 16.4+ e l'app installata nella schermata Home."}
          </p>
        </div>
      </Card>

      <Card title="App sul dispositivo" pad>
        <div className="stack-sm">
          {pwa.installata ? <div><Smartphone size={18} /> App installata su questo dispositivo.</div> : pwa.installabile ? (
            <div className="row-between"><span>Installa l'app per aprirla a schermo intero dalla schermata Home, anche senza rete.</span><button className="btn btn-primary" onClick={() => void installaApp()} data-testid="installa-app"><Download /> Installa</button></div>
          ) : isIos() ? (
            <div>Su iPhone e iPad: apri il menu <strong>Condividi</strong> di Safari e scegli <strong>Aggiungi alla schermata Home</strong>.</div>
          ) : (
            <div className="muted">Per installare: menu del browser → <strong>Installa app</strong> (o "Aggiungi a schermata Home"). Istruzioni complete in docs/17.</div>
          )}
          {schermoInteroSupportato() && <div className="row-between"><span>Schermo intero (nasconde le barre del browser).</span><button className="btn" onClick={() => void alternaSchermoIntero().catch(() => toast('Schermo intero non disponibile.', 'error'))}><Maximize /> Schermo intero</button></div>}
          <div className="subtle small">
            Versione {CONFIG.versioneApp} · ambiente {CONFIG.ambiente} · {pwa.prontaOffline ? 'pronta per l\'uso offline' : 'risorse offline in preparazione'} · archiviazione {pwa.archiviazionePersistente === true ? 'persistente' : pwa.archiviazionePersistente === false ? 'non persistente (il browser potrebbe liberare spazio: sincronizza spesso)' : 'in verifica'} · <Link to="/sync">stato sincronizzazione</Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
