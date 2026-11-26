import { Delete, LogIn, ShieldAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FORMATO_PIN, usernameDi } from '../config/accesso';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp, useData } from '../app/AppContext';
import { aggiornaApp, usePwa } from '../app/pwa';
import { CONFIG } from '../config/ambiente';
import { PIN_DEMO } from '../services/app-services';
import { Avatar } from '../ui/components';

export function Login() {
  const s = useData();
  const { run } = useApp();
  const navigate = useNavigate();
  const pwa = usePwa();
  // Nella schermata di accesso non c'è nulla da perdere: una nuova versione dell'app si applica
  // subito (i dati sul dispositivo restano). Dopo l'accesso resta il banner "Aggiorna ora".
  useEffect(() => { if (pwa.aggiornamentoDisponibile) void aggiornaApp(); }, [pwa.aggiornamentoDisponibile]);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const u = s.utente();
  if (u) return <Navigate to={u.ruolo === 'admin' ? '/admin' : '/op'} replace />;

  const accedi = async (id: string, codice: string) => {
    const p = await run(() => s.login(id, codice));
    if (p) navigate(p.ruolo === 'admin' ? '/admin' : '/op');
    else setPin('');
  };
  const invia = (codice = pin) => { if (username.trim() && FORMATO_PIN.test(codice)) void accedi(username, codice); };
  const cifra = (c: string) => {
    if (pin.length >= 6) return;
    const nuovo = pin + c;
    setPin(nuovo);
    if (nuovo.length === 6) invia(nuovo);
  };
  const profili = s.db.all('profili').filter((p) => p.attivo).sort((a, b) => (a.ruolo === b.ruolo ? a.cognome.localeCompare(b.cognome) : a.ruolo === 'operaio' ? -1 : 1));

  return (
    <div className="login-wrap">
      <aside className="login-side">
        <div className="row"><Wrench size={32} /><strong style={{ fontSize: '1.2rem' }}>Gestionale Interventi</strong></div>
        <div className="stack">
          <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>Presenze, attività e rapportini in un'unica app da cantiere.</h1>
          <p style={{ opacity: 0.9, fontSize: '1.05rem', maxWidth: 520 }}>{CONFIG.datiDimostrativi
            ? 'Prototipo pensato per tablet: timbratura, timer per cliente, pause, rapportini con foto e firma, cartellino mensile con doppia approvazione. Funziona anche senza rete.'
            : `${s.db.meta<{ ragione_sociale: string }>('azienda')?.ragione_sociale ?? (import.meta.env.VITE_AZIENDA_RAGIONE_SOCIALE || 'Gestionale interventi')} · timbratura, attività, rapportini e cartellino mensile. Dopo il primo accesso puoi entrare anche senza rete.`}</p>
        </div>
        <div className="small" style={{ opacity: 0.8 }}>{CONFIG.ambiente === 'demo' ? 'Versione prototipo · nessun dato reale' : CONFIG.ambiente === 'test' ? 'Ambiente di test' : `Versione ${CONFIG.versioneApp}`}</div>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <div>
            <h1>Accedi</h1>
            <p className="muted">{CONFIG.datiDimostrativi ? 'Scegli un account dimostrativo con un tocco oppure inserisci nome utente e PIN.' : 'Inserisci il nome utente e il PIN di 6 cifre.'}</p>
          </div>
          {CONFIG.datiDimostrativi && <><div className="alert warn">
            <ShieldAlert className="alert-icon" size={22} />
            <div className="small">
              <strong>Accesso simulato.</strong> Non c'è un sistema di autenticazione: nome utente = parte dell'email prima della @, PIN unico <code>{PIN_DEMO}</code>. L'autenticazione reale (Supabase Auth) è prevista nella Fase 2.
            </div>
          </div>
          <div className="card list">
            {profili.map((p) => (
              <button key={p.id} className="list-row" onClick={() => void accedi(p.email, PIN_DEMO)} data-testid={`login-${p.email}`}>
                <Avatar p={p} />
                <div className="grow">
                  <div className="title">{p.nome} {p.cognome}</div>
                  <div className="subtle">{p.ruolo === 'admin' ? 'Amministratore' : p.qualifica} · {usernameDi(p)}</div>
                </div>
                <LogIn size={20} className="muted" />
              </button>
            ))}
          </div></>}
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); invia(); }}>
            <div className="field">
              <label htmlFor="username">Nome utente</label>
              <input id="username" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={username} onChange={(e) => setUsername(e.target.value)} data-testid="login-username" />
            </div>
            <div className="field">
              <label htmlFor="pin">PIN</label>
              <input id="pin" className="input pin-input" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} pattern="\d{6}"
                value={pin} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setPin(v); if (v.length === 6 && pin.length < 6) invia(v); }}
                aria-describedby="pin-aiuto" data-testid="login-pin" />
              <div id="pin-aiuto" className="pin-punti" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < pin.length ? 'pieno' : ''} />)}</div>
            </div>
            <div className="tastierino" role="group" aria-label="Tastierino PIN">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => <button key={c} type="button" className="btn btn-lg" onClick={() => cifra(c)}>{c}</button>)}
              <button type="button" className="btn btn-lg" onClick={() => setPin('')}>C</button>
              <button type="button" className="btn btn-lg" onClick={() => cifra('0')}>0</button>
              <button type="button" className="btn btn-lg" aria-label="Cancella ultima cifra" onClick={() => setPin((v) => v.slice(0, -1))}><Delete /></button>
            </div>
            <button className="btn btn-primary btn-lg" type="submit" disabled={!username.trim() || !FORMATO_PIN.test(pin)}>Accedi</button>
          </form>
        </div>
      </main>
    </div>
  );
}
