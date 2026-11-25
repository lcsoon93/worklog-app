import { LogIn, ShieldAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp, useData } from '../app/AppContext';
import { CONFIG } from '../config/ambiente';
import { PASSWORD_DEMO } from '../services/app-services';
import { Avatar } from '../ui/components';

export function Login() {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const u = s.utente();
  if (u) return <Navigate to={u.ruolo === 'admin' ? '/admin' : '/op'} replace />;

  const accedi = async (em: string, pw: string) => {
    const p = await run(() => s.login(em, pw));
    if (p) navigate(p.ruolo === 'admin' ? '/admin' : '/op');
  };
  const profili = s.db.all('profili').filter((p) => p.attivo).sort((a, b) => (a.ruolo === b.ruolo ? a.cognome.localeCompare(b.cognome) : a.ruolo === 'operaio' ? -1 : 1));

  return (
    <div className="login-wrap">
      <aside className="login-side">
        <div className="row"><Wrench size={32} /><strong style={{ fontSize: '1.2rem' }}>Gestionale Interventi</strong></div>
        <div className="stack">
          <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>Presenze, attività e rapportini in un'unica app da cantiere.</h1>
          <p style={{ opacity: 0.9, fontSize: '1.05rem', maxWidth: 520 }}>Prototipo Fase 1 pensato per tablet: timbratura, timer per cliente, pause, rapportini con foto e firma, cartellino mensile con doppia approvazione. Funziona anche senza rete.</p>
        </div>
        <div className="small" style={{ opacity: 0.8 }}>{CONFIG.ambiente === 'demo' ? 'Versione prototipo · nessun dato reale' : CONFIG.ambiente === 'test' ? 'Ambiente di test' : `Versione ${CONFIG.versioneApp}`}</div>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <div>
            <h1>Accedi</h1>
            <p className="muted">{CONFIG.datiDimostrativi ? 'Scegli un account dimostrativo con un tocco oppure inserisci le credenziali.' : 'Inserisci le credenziali ricevute dall\'amministrazione.'}</p>
          </div>
          {CONFIG.datiDimostrativi && <><div className="alert warn">
            <ShieldAlert className="alert-icon" size={22} />
            <div className="small">
              <strong>Accesso simulato.</strong> Non c'è un sistema di autenticazione: password unica degli account demo <code>{PASSWORD_DEMO}</code>. L'autenticazione reale (Supabase Auth) è prevista nella Fase 2.
            </div>
          </div>
          <div className="card list">
            {profili.map((p) => (
              <button key={p.id} className="list-row" onClick={() => void accedi(p.email, PASSWORD_DEMO)} data-testid={`login-${p.email}`}>
                <Avatar p={p} />
                <div className="grow">
                  <div className="title">{p.nome} {p.cognome}</div>
                  <div className="subtle">{p.ruolo === 'admin' ? 'Amministratore' : p.qualifica} · {p.email}</div>
                </div>
                <LogIn size={20} className="muted" />
              </button>
            ))}
          </div></>}
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void accedi(email, password); }}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-lg" type="submit">Accedi</button>
          </form>
        </div>
      </main>
    </div>
  );
}
