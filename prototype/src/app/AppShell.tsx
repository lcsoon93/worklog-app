import {
  BarChart3, Bell, History, Building2, FileDown, CalendarDays, ClipboardCheck, ClipboardList, Cloud, CloudOff, FileText, Home, LogOut, MapPin, Menu, RefreshCw, Package, RotateCcw, Timer, TrendingUp, Users, Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CONFIG } from '../config/ambiente';
import { Avatar, ConfirmSheet, Sheet } from '../ui/components';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CampanellaNotifiche, OsservatoreNotifiche } from '../ui/Notifiche';
import { useApp, useData } from './AppContext';
import { aggiornaApp, usePwa } from './pwa';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

const NAV_OPERAIO: NavItem[] = [
  { to: '/op', label: 'Oggi', icon: <Home />, end: true },
  { to: '/op/timer', label: 'Timer', icon: <Timer /> },
  { to: '/agenda/giorno', label: 'Agenda', icon: <CalendarDays /> },
  { to: '/rapportini', label: 'Rapportini', icon: <FileText /> },
  { to: '/op/cartellino', label: 'Cartellino', icon: <ClipboardCheck /> },
  { to: '/op/riepiloghi', label: 'Riepiloghi', icon: <FileDown /> },
];
/** Fase 13: voci aggiuntive per l'amministratore operativo (es. Luca). */
const NAV_OPERATIVO: NavItem[] = [
  { to: '/agenda/settimana', label: 'Interventi', icon: <Wrench /> },
  { to: '/admin/ritorni', label: 'Ritorni', icon: <RotateCcw /> },
  { to: '/admin/clienti', label: 'Clienti', icon: <Building2 /> },
  { to: '/admin/sedi', label: 'Sedi', icon: <MapPin /> },
];
const NAV_ADMIN: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: <Home />, end: true },
  { to: '/agenda/settimana', label: 'Agenda', icon: <CalendarDays /> },
  { to: '/admin/presenze', label: 'Presenze', icon: <ClipboardList /> },
  { to: '/rapportini', label: 'Rapportini', icon: <FileText /> },
  { to: '/admin/ritorni', label: 'Ritorni', icon: <RotateCcw /> },
  { to: '/admin/storico', label: 'Storico', icon: <History /> },
  { to: '/admin/cartellini', label: 'Cartellini', icon: <ClipboardCheck /> },
  { to: '/admin/analisi', label: 'Analisi', icon: <TrendingUp /> },
  { to: '/admin/report', label: 'Report mese', icon: <BarChart3 /> },
  { to: '/admin/report-presenze', label: 'PDF presenze', icon: <FileDown /> },
  { to: '/admin/magazzino', label: 'Magazzino', icon: <Package /> },
  { to: '/admin/clienti', label: 'Clienti', icon: <Building2 /> },
  { to: '/admin/sedi', label: 'Sedi', icon: <MapPin /> },
  { to: '/admin/operai', label: 'Operai', icon: <Users /> },
];

export function SyncPill() {
  const s = useData();
  const online = s.online();
  const pendenti = s.sync.pendenti();
  const conflitti = pendenti.filter((o) => o.stato === 'conflitto').length;
  const errori = pendenti.filter((o) => o.stato === 'errore').length;
  const inInvio = s.sync.inCorso();
  if (!s.syncAttiva) {
    // Accesso reale senza sincronizzazione: niente "Tutto sincronizzato", i dati sono solo locali.
    const testoLocale = `Solo su questo dispositivo${pendenti.length ? ` · ${pendenti.length} da inviare` : ''}`;
    return (
      <NavLink to="/sync" className="sync-pill pending" data-testid="sync-pill" aria-label={`Sincronizzazione: ${testoLocale}`} title={testoLocale}>
        <CloudOff size={18} />
        <span className="sync-testo">{testoLocale}</span>
        {pendenti.length > 0 && <span className="sync-breve" aria-hidden>{pendenti.length}</span>}
      </NavLink>
    );
  }
  const cls = !online ? 'offline' : conflitti || errori ? 'offline' : pendenti.length ? 'pending' : 'ok';
  const testo = !online ? `Offline · ${pendenti.length} in coda` : conflitti ? `${conflitti} conflitti` : errori ? `${errori} da reinviare` : pendenti.length ? `${pendenti.length} in invio` : 'Tutto sincronizzato';
  const breve = !online ? `${pendenti.length}` : conflitti + errori ? `${conflitti + errori}!` : pendenti.length ? `${pendenti.length}` : '';
  return (
    <NavLink to="/sync" className={`sync-pill ${cls}`} data-testid="sync-pill" aria-label={`Sincronizzazione: ${testo}`} title={testo}>
      {!online ? <CloudOff size={18} /> : pendenti.length || inInvio ? <RefreshCw size={18} className={inInvio ? 'gira' : undefined} /> : <Cloud size={18} />}
      <span className="sync-testo">{testo}</span>
      {breve && <span className="sync-breve" aria-hidden>{breve}</span>}
    </NavLink>
  );
}

/** Avvisi globali: nuova versione, conflitti da risolvere, invii che continuano a fallire. */
function BannerGlobali() {
  const s = useData();
  const { kickSync } = useApp();
  const pwa = usePwa();
  const [conferma, setConferma] = useState(false);
  const pendenti = s.sync.pendenti();
  const conflitti = pendenti.filter((o) => o.stato === 'conflitto').length;
  const bloccate = pendenti.filter((o) => o.stato === 'errore' && o.tentativi >= 3).length;
  return (
    <>
      {pwa.aggiornamentoDisponibile && (
        <div className="banner info" role="status" data-testid="banner-aggiornamento">
          <span>È disponibile una nuova versione dell'app. I dati salvati sul dispositivo restano invariati.</span>
          <button className="btn btn-sm btn-primary" onClick={() => (pendenti.length ? setConferma(true) : void aggiornaApp())}>Aggiorna ora</button>
        </div>
      )}
      {conflitti > 0 && (
        <div className="banner danger" role="alert" data-testid="banner-conflitti">
          <span>{conflitti === 1 ? 'Un elemento è stato modificato' : `${conflitti} elementi sono stati modificati`} anche da un altro dispositivo: scegli quale versione tenere.</span>
          <Link className="btn btn-sm" to="/sync">Risolvi</Link>
        </div>
      )}
      {bloccate > 0 && !conflitti && (
        <div className="banner warn" role="alert" data-testid="banner-errori">
          <span>{bloccate} operazioni non riescono a essere inviate. Restano salvate sul dispositivo e vengono ritentate in automatico.</span>
          <button className="btn btn-sm" onClick={() => { void s.sync.ciclo({ forza: true }).finally(kickSync); }}>Riprova ora</button>
        </div>
      )}
      {conferma && (
        <ConfirmSheet title="Aggiornare l'app?" conferma="Aggiorna" message={`Ci sono ${pendenti.length} operazioni non ancora inviate al server: restano salvate sul dispositivo e verranno inviate dopo l'aggiornamento.`} onClose={() => setConferma(false)} onConfirm={() => aggiornaApp()} />
      )}
    </>
  );
}

export function AppShell() {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const u = s.utente();
  if (!u) return null;
  const nav = u.ruolo === 'admin' ? NAV_ADMIN : u.amministratore_operativo ? [...NAV_OPERAIO, ...NAV_OPERATIVO] : NAV_OPERAIO;
  // Sul telefono la barra in basso mostra le voci principali; le altre sono in "Menu".
  const principali = nav.slice(0, 4);
  const pendenti = s.sync.pendenti().length;
  // L'uscita non cancella nulla: le operazioni in coda restano sul dispositivo e partono al prossimo accesso.
  const logout = () => run(async () => { await s.logout(); navigate('/login'); }, pendenti ? `${pendenti} operazioni restano in coda su questo dispositivo` : undefined);
  const chiediLogout = () => void logout();
  const striscia = CONFIG.ambiente === 'demo'
    ? 'PROTOTIPO · dati dimostrativi salvati solo su questo dispositivo · server di sincronizzazione simulato, nessun backend di produzione'
    : CONFIG.ambiente === 'test'
      ? (s.auth ? 'VERSIONE PILOTA · accesso reale e sincronizzazione con il server aziendale attivi' : 'AMBIENTE DI TEST · dati di prova, non usare per dati reali')
      : null;
  return (
    <div className="shell">
      <a className="skip-link" href="#contenuto">Vai al contenuto</a>
      <OsservatoreNotifiche />
      <nav className="rail" aria-label="Navigazione principale">
        <div className="rail-logo"><Wrench size={28} /></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/notifiche"><Bell />Notifiche</NavLink>
        <NavLink to="/sync"><RefreshCw />Sync</NavLink>
        <a href="#" onClick={(e) => { e.preventDefault(); chiediLogout(); }} data-testid="logout"><LogOut />Esci</a>
      </nav>
      <div className="main">
        {striscia && <div className="demo-strip" data-testid="demo-strip">{striscia}</div>}
        <header className="topbar">
          <Avatar p={u} />
          <div className="grow">
            <div style={{ fontWeight: 700 }} className="ellipsis" data-testid="utente-corrente">{u.nome} {u.cognome}</div>
            <div className="subtle ellipsis">{u.ruolo === 'admin' ? 'Amministratore' : u.amministratore_operativo ? `${u.qualifica} · amministratore operativo` : u.qualifica}</div>
          </div>
          <SyncPill />
          <CampanellaNotifiche />
          <button className="btn btn-ghost icon-btn hide-mobile" onClick={chiediLogout} aria-label="Esci"><LogOut /></button>
        </header>
        <BannerGlobali />
        <main className="content" id="contenuto" tabIndex={-1}>
          <ErrorBoundary chiave={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navigazione">
        {principali.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <button type="button" className={menu ? 'active' : ''} onClick={() => setMenu(true)} aria-haspopup="dialog" data-testid="menu-altro"><Menu />Menu</button>
      </nav>
      {menu && (
        <Sheet title="Menu" onClose={() => setMenu(false)}>
          <div className="menu-griglia" data-testid="menu-griglia">
            {[...nav.slice(4), { to: '/notifiche', label: 'Notifiche', icon: <Bell /> }, { to: '/sync', label: 'Sincronizzazione', icon: <RefreshCw /> }].map((n) => (
              <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : undefined} className="tile" onClick={() => setMenu(false)}>
                <span className="tile-icon">{n.icon}</span>
                <span>{n.label}</span>
              </NavLink>
            ))}
            <button type="button" className="tile" onClick={() => { setMenu(false); chiediLogout(); }}><span className="tile-icon"><LogOut /></span><span>Esci</span></button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
