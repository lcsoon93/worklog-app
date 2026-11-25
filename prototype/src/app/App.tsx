import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Ruolo } from '../domain/types';
import { AdminHome } from '../pages/admin/AdminHome';
import { Assegnazione } from '../pages/admin/Assegnazione';
import { CartelliniAdmin, CartellinoVerifica } from '../pages/admin/Cartellini';
import { ClienteScheda, Clienti } from '../pages/admin/Clienti';
import { InterventoForm } from '../pages/admin/InterventoForm';
import { Operai } from '../pages/admin/Operai';
import { PresenzeAdmin } from '../pages/admin/PresenzeAdmin';
import { ReportMensile } from '../pages/admin/ReportMensile';
import { ReportPresenze } from '../pages/admin/ReportPresenze';
import { Ritorni } from '../pages/admin/Ritorni';
import { Sedi } from '../pages/admin/Sedi';
import { Login } from '../pages/Login';
import { CartellinoOperaio } from '../pages/operaio/CartellinoOperaio';
import { FineGiornata } from '../pages/operaio/FineGiornata';
import { Imprevisto } from '../pages/operaio/Imprevisto';
import { MieiRiepiloghi } from '../pages/operaio/MieiRiepiloghi';
import { OperaioHome } from '../pages/operaio/OperaioHome';
import { Pause } from '../pages/operaio/Pause';
import { Presenza } from '../pages/operaio/Presenza';
import { TimerPage } from '../pages/operaio/TimerPage';
import { Agenda } from '../pages/shared/Agenda';
import { InterventoScheda } from '../pages/shared/InterventoScheda';
import { RapportinoEditor } from '../pages/shared/RapportinoEditor';
import { Rapportini } from '../pages/shared/Rapportini';
import { SyncPage } from '../pages/shared/SyncPage';
import { useData } from './AppContext';
import { AppShell } from './AppShell';

function Guard({ ruolo, children }: { ruolo?: Ruolo; children: ReactNode }) {
  const s = useData();
  const u = s.utente();
  if (!u) return <Navigate to="/login" replace />;
  if (ruolo && u.ruolo !== ruolo) return <Navigate to={u.ruolo === 'admin' ? '/admin' : '/op'} replace />;
  return <>{children}</>;
}

function Home() {
  const s = useData();
  const u = s.utente();
  return <Navigate to={!u ? '/login' : u.ruolo === 'admin' ? '/admin' : '/op'} replace />;
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route element={<Guard><AppShell /></Guard>}>
          {/* operaio */}
          <Route path="/op" element={<Guard ruolo="operaio"><OperaioHome /></Guard>} />
          <Route path="/op/presenza" element={<Guard ruolo="operaio"><Presenza /></Guard>} />
          <Route path="/op/timer" element={<Guard ruolo="operaio"><TimerPage /></Guard>} />
          <Route path="/op/pause" element={<Guard ruolo="operaio"><Pause /></Guard>} />
          <Route path="/op/riepilogo" element={<Guard ruolo="operaio"><FineGiornata /></Guard>} />
          <Route path="/op/imprevisto" element={<Guard ruolo="operaio"><Imprevisto /></Guard>} />
          <Route path="/op/cartellino" element={<Guard ruolo="operaio"><CartellinoOperaio /></Guard>} />
          <Route path="/op/riepiloghi" element={<Guard ruolo="operaio"><MieiRiepiloghi /></Guard>} />
          {/* condivise */}
          <Route path="/agenda/:vista" element={<Agenda />} />
          <Route path="/rapportini" element={<Rapportini />} />
          <Route path="/rapportini/nuovo" element={<RapportinoEditor />} />
          <Route path="/rapportini/:id" element={<RapportinoEditor />} />
          <Route path="/interventi/:id" element={<InterventoScheda />} />
          <Route path="/sync" element={<SyncPage />} />
          {/* amministratore */}
          <Route path="/admin" element={<Guard ruolo="admin"><AdminHome /></Guard>} />
          <Route path="/admin/operai" element={<Guard ruolo="admin"><Operai /></Guard>} />
          <Route path="/admin/clienti" element={<Guard ruolo="admin"><Clienti /></Guard>} />
          <Route path="/admin/clienti/:id" element={<Guard ruolo="admin"><ClienteScheda /></Guard>} />
          <Route path="/admin/sedi" element={<Guard ruolo="admin"><Sedi /></Guard>} />
          <Route path="/admin/interventi/nuovo" element={<Guard ruolo="admin"><InterventoForm /></Guard>} />
          <Route path="/admin/interventi/:id/modifica" element={<Guard ruolo="admin"><InterventoForm /></Guard>} />
          <Route path="/admin/interventi/:id/assegna" element={<Guard ruolo="admin"><Assegnazione /></Guard>} />
          <Route path="/admin/presenze" element={<Guard ruolo="admin"><PresenzeAdmin /></Guard>} />
          <Route path="/admin/ritorni" element={<Guard ruolo="admin"><Ritorni /></Guard>} />
          <Route path="/admin/cartellini" element={<Guard ruolo="admin"><CartelliniAdmin /></Guard>} />
          <Route path="/admin/cartellini/:id" element={<Guard ruolo="admin"><CartellinoVerifica /></Guard>} />
          <Route path="/admin/report" element={<Guard ruolo="admin"><ReportMensile /></Guard>} />
          <Route path="/admin/report-presenze" element={<Guard ruolo="admin"><ReportPresenze /></Guard>} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  );
}
