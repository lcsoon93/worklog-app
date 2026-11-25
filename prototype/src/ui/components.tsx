import { AlertTriangle, CheckCircle2, ChevronLeft, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Interval } from '../domain/intervals';
import { ETICHETTE_STATO } from '../domain/timesheet-workflow';
import { formatOra } from '../domain/time';
import type { CartellinoStato, InterventoStato, Profilo, SyncStato } from '../domain/types';

export function PageHead({ title, eyebrow, back, actions, children }: { title: ReactNode; eyebrow?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link className="back-link" to={back.to}>
            <ChevronLeft size={18} /> {back.label}
          </Link>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, foot, pad = false, className = '', testId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; foot?: ReactNode; pad?: boolean; className?: string; testId?: string }) {
  return (
    <section className={`card ${className}`} data-testid={testId}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
}

export type Tono = 'ok' | 'warn' | 'danger' | 'info' | 'primary' | 'pause' | 'neutral';
export function Badge({ tono = 'neutral', children, testId }: { tono?: Tono; children: ReactNode; testId?: string }) {
  return (
    <span className={`badge ${tono === 'neutral' ? '' : tono}`} data-testid={testId}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tono, testId }: { label: string; value: ReactNode; sub?: ReactNode; tono?: 'ok' | 'warn' | 'danger'; testId?: string }) {
  return (
    <div className={`stat ${tono ?? ''}`} data-testid={testId}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Alert({ tono = 'info', title, children, actions }: { tono?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const Icon = tono === 'danger' ? XCircle : tono === 'warn' ? AlertTriangle : tono === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`alert ${tono}`} role={tono === 'danger' ? 'alert' : undefined}>
      <Icon className="alert-icon" size={22} />
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {children && <div className="small">{children}</div>}
        {actions && <div className="row">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Sheet({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Chiudi">
            <X />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Conferma con motivazione (obbligatoria o facoltativa). */
export function ConfirmSheet({ title, message, conferma, tono = 'primary', motivazione, onConfirm, onClose, testId }: {
  title: string; message?: ReactNode; conferma: string; tono?: 'primary' | 'danger'; motivazione?: 'obbligatoria' | 'facoltativa';
  onConfirm: (motivo: string) => Promise<unknown> | void; onClose: () => void; testId?: string;
}) {
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = busy || (motivazione === 'obbligatoria' && !motivo.trim());
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annulla</button>
          <button
            className={`btn ${tono === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            disabled={disabled}
            data-testid={testId ? `${testId}-ok` : undefined}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(motivo);
              } finally {
                setBusy(false);
              }
            }}
          >
            {conferma}
          </button>
        </>
      }
    >
      {message && <div className="muted">{message}</div>}
      {motivazione && (
        <div className="field">
          <label htmlFor="motivo">Motivazione {motivazione === 'obbligatoria' ? '(obbligatoria)' : '(facoltativa)'}</label>
          <textarea id="motivo" className="textarea" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid={testId ? `${testId}-motivo` : undefined} />
        </div>
      )}
    </Sheet>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="segmented" role="tablist" data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ p, size = 40 }: { p: Pick<Profilo, 'nome' | 'cognome' | 'colore'>; size?: number }) {
  return (
    <span className="avatar" style={{ background: p.colore, width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {p.nome[0]}
      {p.cognome[0]}
    </span>
  );
}

// ---------- badge di stato ----------
export const SYNC_LABEL: Record<SyncStato, string> = {
  locale: 'Solo sul dispositivo',
  in_attesa: 'In attesa di invio',
  in_sincronizzazione: 'In sincronizzazione',
  sincronizzato: 'Sincronizzato',
  errore: 'Errore di invio',
  conflitto: 'Conflitto da risolvere',
};
const SYNC_TONO: Record<SyncStato, Tono> = { locale: 'neutral', in_attesa: 'warn', in_sincronizzazione: 'info', sincronizzato: 'ok', errore: 'danger', conflitto: 'danger' };
export function SyncBadge({ stato }: { stato: SyncStato }) {
  return <Badge tono={SYNC_TONO[stato]} testId="sync-badge">{SYNC_LABEL[stato]}</Badge>;
}

const CART_TONO: Record<CartellinoStato, Tono> = {
  in_compilazione: 'neutral', da_confermare_operaio: 'warn', confermato_operaio: 'info', in_attesa_approvazione: 'info', da_correggere: 'danger', approvato: 'ok', riaperto: 'pause',
};
export function CartellinoBadge({ stato }: { stato: CartellinoStato }) {
  return <Badge tono={CART_TONO[stato]} testId="cartellino-stato">{ETICHETTE_STATO[stato]}</Badge>;
}

export const INTERVENTO_LABEL: Record<InterventoStato, string> = {
  da_programmare: 'Da programmare', programmato: 'Programmato', in_corso: 'In corso', da_ultimare: 'Da ultimare', completato: 'Completato', annullato: 'Annullato',
};
const INT_TONO: Record<InterventoStato, Tono> = { da_programmare: 'warn', programmato: 'info', in_corso: 'primary', da_ultimare: 'danger', completato: 'ok', annullato: 'neutral' };
export function InterventoBadge({ stato }: { stato: InterventoStato }) {
  return <Badge tono={INT_TONO[stato]}>{INTERVENTO_LABEL[stato]}</Badge>;
}

// ---------- timeline giornata ----------
export interface TimelineSeg {
  intervallo: Interval;
  classe: string;
  titolo: string;
}
export function DayTimeline({ finestra, segmenti }: { finestra: Interval; segmenti: TimelineSeg[] }) {
  const start = finestra.start;
  const span = Math.max(1, finestra.end - finestra.start);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`;
  const ticks = 5;
  return (
    <div>
      <div className="timeline" aria-label="Linea del tempo della giornata">
        {segmenti.map((s, i) => (
          <div key={i} className={`seg ${s.classe}`} title={s.titolo} style={{ left: pct(s.intervallo.start), width: `calc(${pct(s.intervallo.end)} - ${pct(s.intervallo.start)})` }} />
        ))}
      </div>
      <div className="timeline-scale">
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span key={i}>{formatOra(start + (span * i) / ticks)}</span>
        ))}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="bg-lavoro_cliente" /> Lavoro cliente</span>
      <span><i className="bg-trasferimento" /> Trasferimento</span>
      <span><i className="bg-interna" /> Interna</span>
      <span><i className="bg-da_definire" /> Da classificare</span>
      <span><i className="bg-pausa" /> Pausa</span>
    </div>
  );
}
