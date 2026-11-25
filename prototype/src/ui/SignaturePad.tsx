import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Firma a mano su touch/penna/mouse. Restituisce un PNG come data URL. */
export function SignaturePad({ onConfirm, testId }: { onConfirm: (dataUrl: string) => void; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [vuota, setVuota] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div className="stack-sm">
      <canvas
        ref={ref}
        className="signature"
        data-testid={testId}
        aria-label="Area firma"
        onPointerDown={(e) => {
          drawing.current = true;
          ref.current!.setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setVuota(false);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setVuota(true); }}><Eraser size={16} /> Cancella</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={vuota} onClick={() => onConfirm(ref.current!.toDataURL('image/png'))} data-testid={testId ? `${testId}-ok` : undefined}>Conferma firma</button>
      </div>
    </div>
  );
}
