/**
 * Firma a schermo intero, sempre in orizzontale.
 *
 * Su iPhone il browser non permette di bloccare la rotazione: se il telefono è in verticale
 * l'area di firma viene ruotata di 90° (si firma tenendo il telefono di lato) e le coordinate
 * del dito vengono convertite. Dove il browser lo consente (es. Android a schermo intero) si
 * prova anche a bloccare l'orientamento.
 * Lo sfondo è sempre bianco e l'inchiostro scuro, anche con il tema scuro del telefono: la firma
 * resta leggibile nel PDF e sullo schermo.
 */
import { Eraser, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Punto = { x: number; y: number };

function dimensioniSchermo() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { w, h, verticale: h > w };
}

export function FirmaSchermoIntero({ titolo, nome, onNome, onConferma, onChiudi }: {
  titolo: string;
  /** Nome di chi firma (facoltativo): se presente viene chiesto nella stessa schermata. */
  nome?: string;
  onNome?: (v: string) => void;
  onConferma: (dataUrl: string) => void;
  onChiudi: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tratti = useRef<Punto[][]>([]);
  const inCorso = useRef<Punto[] | null>(null);
  const [schermo, setSchermo] = useState(dimensioniSchermo);
  const [vuota, setVuota] = useState(true);

  // Area di firma in coordinate "orizzontali": larghezza = lato lungo dello schermo.
  const larghezza = schermo.verticale ? schermo.h : schermo.w;
  const altezza = schermo.verticale ? schermo.w : schermo.h;

  useEffect(() => {
    const aggiorna = () => setSchermo(dimensioniSchermo());
    window.addEventListener('resize', aggiorna);
    window.addEventListener('orientationchange', aggiorna);
    const prima = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
    so?.lock?.('landscape').catch(() => undefined);
    return () => {
      window.removeEventListener('resize', aggiorna);
      window.removeEventListener('orientationchange', aggiorna);
      document.body.style.overflow = prima;
      try {
        so?.unlock?.();
      } catch {
        /* non supportato */
      }
    };
  }, []);

  const ridisegna = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const s = c.width / c.clientWidth;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    // I tratti sono salvati in proporzione all'area: sopravvivono a una rotazione del telefono.
    for (const t of tratti.current) {
      ctx.beginPath();
      t.forEach((p, i) => (i ? ctx.lineTo(p.x * c.clientWidth, p.y * c.clientHeight) : ctx.moveTo(p.x * c.clientWidth, p.y * c.clientHeight)));
      if (t.length === 1) ctx.lineTo(t[0].x * c.clientWidth + 0.1, t[0].y * c.clientHeight);
      ctx.stroke();
    }
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * ratio);
    c.height = Math.round(c.clientHeight * ratio);
    ridisegna();
  }, [larghezza, altezza, ridisegna]);

  /** Punto del dito nelle coordinate (proporzionali) dell'area di firma, anche se ruotata. */
  const punto = (e: React.PointerEvent): Punto => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    if (schermo.verticale) {
      // Area ruotata di 90° in senso orario: x locale scende lungo lo schermo, y locale va verso sinistra.
      return { x: (e.clientY - r.top) / c.clientWidth, y: (r.right - e.clientX) / c.clientHeight };
    }
    return { x: (e.clientX - r.left) / c.clientWidth, y: (e.clientY - r.top) / c.clientHeight };
  };

  const disegnaSegmento = (a: Punto, b: Punto) => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(a.x * c.clientWidth, a.y * c.clientHeight);
    ctx.lineTo(b.x * c.clientWidth, b.y * c.clientHeight);
    ctx.stroke();
  };

  const esporta = () => {
    // PNG ritagliato al lato lungo 1200 px (leggero da salvare e sincronizzare).
    const c = canvas.current!;
    const scala = Math.min(1, 1200 / c.width);
    const out = document.createElement('canvas');
    out.width = Math.round(c.width * scala);
    out.height = Math.round(c.height * scala);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };

  const stileArea: React.CSSProperties = schermo.verticale
    ? { position: 'fixed', top: 0, left: schermo.w, width: schermo.h, height: schermo.w, transform: 'rotate(90deg)', transformOrigin: 'top left' }
    : { position: 'fixed', top: 0, left: 0, width: schermo.w, height: schermo.h };

  return createPortal(
    <div className="firma-schermo" role="dialog" aria-modal="true" aria-label={titolo} data-testid="firma-schermo">
      <div className="firma-area" style={stileArea}>
        <div className="firma-barra">
          <button type="button" className="btn btn-ghost icon-btn" onClick={onChiudi} aria-label="Annulla"><X /></button>
          <strong className="grow ellipsis">{titolo}</strong>
          {onNome && <input className="input firma-nome" placeholder="Nome di chi firma" value={nome ?? ''} onChange={(e) => onNome(e.target.value)} data-testid="firma-schermo-nome" aria-label="Nome di chi firma" />}
          <button type="button" className="btn" onClick={() => { tratti.current = []; setVuota(true); ridisegna(); }} data-testid="firma-cancella"><Eraser size={18} /> Cancella</button>
          <button type="button" className="btn btn-primary" disabled={vuota} onClick={() => onConferma(esporta())} data-testid="firma-conferma">Conferma</button>
        </div>
        <div className="firma-foglio">
          <canvas
            ref={canvas}
            className="firma-canvas"
            data-testid="firma-canvas"
            aria-label="Area firma"
            onPointerDown={(e) => {
              e.preventDefault();
              canvas.current!.setPointerCapture(e.pointerId);
              const p = punto(e);
              inCorso.current = [p];
              tratti.current.push(inCorso.current);
              disegnaSegmento(p, { x: p.x + 0.0005, y: p.y });
            }}
            onPointerMove={(e) => {
              const t = inCorso.current;
              if (!t) return;
              const p = punto(e);
              disegnaSegmento(t[t.length - 1], p);
              t.push(p);
              if (vuota) setVuota(false);
            }}
            onPointerUp={() => { inCorso.current = null; }}
            onPointerCancel={() => { inCorso.current = null; }}
          />
          <div className="firma-linea" aria-hidden><span>Firma qui</span></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
