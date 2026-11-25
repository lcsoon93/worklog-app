import {
  BarChart3, Building2, FileDown, CalendarDays, ClipboardCheck, ClipboardList, Cloud, CloudOff, FileText, Home, LogOut, MapPin, RefreshCw, RotateCcw, Timer, Users, Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Avatar } from '../ui/components';
import { useApp, useData } from './AppContext';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

const NAV_OPERAIO: NavItem[] = [
  { to: '/op', label: 'Oggi', icon: <Home />, end: true },
  { to: '/op/timer', label: 'Timer', icon: <Timer /> },
  { to: '/agenda/giorno', label: 'Agenda', icon: <CalendarDays /> },
  { to: '/rapportini', label: 'Rapportini', icon: <FileText /> },
  { to: '/op/cartellino', label: 'Cartellino', icon: <ClipboardCheck /> },
  { to: '/op/riepiloghi', label: 'Riepiloghi', icon: <FileDown /> },
];
const NAV_ADMIN: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: <Home />, end: true },
  { to: '/agenda/settimana', label: 'Agenda', icon: <CalendarDays /> },
  { to: '/admin/presenze', label: 'Presenze', icon: <ClipboardList /> },
  { to: '/rapportini', label: 'Rapportini', icon: <FileText /> },
  { to: '/admin/ritorni', label: 'Ritorni', icon: <RotateCcw /> },
  { to: '/admin/cartellini', label: 'Cartellini', icon: <ClipboardCheck /> },
  { to: '/admin/report', label: 'Report', icon: <BarChart3 /> },
  { to: '/admin/report-presenze', label: 'PDF presenze', icon: <FileDown /> },
  { to: '/admin/clienti', label: 'Clienti', icon: <Building2 /> },
  { to: '/admin/sedi', label: 'Sedi', icon: <MapPin /> },
  { to: '/admin/operai', label: 'Operai', icon: <Users /> },
];

export function SyncPill() {
  const s = useData();
  const online = s.online();
  const pendenti = s.sync.pendenti();
  const problemi = pendenti.filter((o) => o.stato === 'errore' || o.stato === 'conflitto').length;
  const cls = !online ? 'offline' : problemi ? 'offline' : pendenti.length ? 'pending' : 'ok';
  return (
    <NavLink to="/sync" className={`sync-pill ${cls}`} data-testid="sync-pill">
      {!online ? <CloudOff size={18} /> : pendenti.length ? <RefreshCw size={18} /> : <Cloud size={18} />}
      {!online ? `Offline · ${pendenti.length} in coda` : problemi ? `${problemi} da verificare` : pendenti.length ? `${pendenti.length} in invio` : 'Tutto sincronizzato'}
    </NavLink>
  );
}

export function AppShell() {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const u = s.utente();
  if (!u) return null;
  const nav = u.ruolo === 'admin' ? NAV_ADMIN : NAV_OPERAIO;
  const logout = () => run(async () => { await s.logout(); navigate('/login'); });
  return (
    <div className="shell">
      <nav className="rail" aria-label="Navigazione principale">
        <div className="rail-logo"><Wrench size={28} /></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/sync"><RefreshCw />Sync</NavLink>
        <a href="#" onClick={(e) => { e.preventDefault(); void logout(); }} data-testid="logout"><LogOut />Esci</a>
      </nav>
      <div className="main">
        <div className="demo-strip" data-testid="demo-strip">
          PROTOTIPO · dati dimostrativi salvati solo su questo dispositivo · server di sincronizzazione simulato, nessun backend di produzione
        </div>
        <header className="topbar">
          <Avatar p={u} />
          <div className="grow">
            <div style={{ fontWeight: 700 }} className="ellipsis" data-testid="utente-corrente">{u.nome} {u.cognome}</div>
            <div className="subtle">{u.ruolo === 'admin' ? 'Amministratore' : u.qualifica}</div>
          </div>
          <SyncPill />
          <button className="btn btn-ghost icon-btn" onClick={() => void logout()} aria-label="Esci"><LogOut /></button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navigazione">
        {nav.slice(0, 6).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
