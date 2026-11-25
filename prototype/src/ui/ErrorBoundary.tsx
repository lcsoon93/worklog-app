/**
 * Impedisce che un errore imprevisto in una schermata lasci la pagina bianca (Fase 7):
 * mostra un messaggio comprensibile, rassicura sui dati salvati e permette di ripartire.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; chiave?: string }
interface Stato { errore: Error | null }

export class ErrorBoundary extends Component<Props, Stato> {
  state: Stato = { errore: null };

  static getDerivedStateFromError(errore: Error): Stato {
    return { errore };
  }

  componentDidCatch(errore: Error, info: ErrorInfo) {
    console.error('Errore nella schermata', errore, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Cambiando pagina si riprova a mostrare il contenuto.
    if (prev.chiave !== this.props.chiave && this.state.errore) this.setState({ errore: null });
  }

  render() {
    if (!this.state.errore) return this.props.children;
    return (
      <div className="card" role="alert" data-testid="errore-schermata">
        <div className="card-body stack-sm">
          <h2>Questa schermata non è riuscita a caricarsi</h2>
          <p className="muted">I dati già salvati sul dispositivo non sono stati persi e le operazioni in coda verranno inviate normalmente. Puoi riprovare o tornare alla pagina iniziale.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => this.setState({ errore: null })}>Riprova</button>
            <a className="btn" href="#/">Pagina iniziale</a>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>Ricarica l'app</button>
          </div>
          <details className="subtle small"><summary>Dettaglio tecnico</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.errore.message}</pre></details>
        </div>
      </div>
    );
  }
}
