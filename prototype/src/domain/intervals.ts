/**
 * Algebra degli intervalli temporali.
 *
 * Tutti gli intervalli sono semi-aperti [start, end) espressi in millisecondi epoch (UTC).
 * Lavorare su istanti assoluti rende irrilevante il cambio di data (turni oltre mezzanotte)
 * e i cambi di ora legale: la durata è sempre end - start.
 */
export interface Interval {
  start: number;
  end: number;
}

export function duration(i: Interval): number {
  return Math.max(0, i.end - i.start);
}

/** Ordina, scarta gli intervalli vuoti/invertiti e unisce quelli sovrapposti o adiacenti. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of valid) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function total(intervals: readonly Interval[]): number {
  return normalize(intervals).reduce((acc, i) => acc + duration(i), 0);
}

/** Intersezione tra due insiemi di intervalli. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const na = normalize(a);
  const nb = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    const start = Math.max(na[i].start, nb[j].start);
    const end = Math.min(na[i].end, nb[j].end);
    if (end > start) out.push({ start, end });
    if (na[i].end < nb[j].end) i++;
    else j++;
  }
  return out;
}

/** Differenza insiemistica a \ b. */
export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const nb = normalize(b);
  const out: Interval[] = [];
  for (const seg of normalize(a)) {
    let cursor = seg.start;
    for (const cut of nb) {
      if (cut.end <= cursor) continue;
      if (cut.start >= seg.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= seg.end) break;
    }
    if (cursor < seg.end) out.push({ start: cursor, end: seg.end });
  }
  return out;
}

/** true se i due intervalli hanno una parte in comune di durata > 0. */
export function overlaps(a: Interval, b: Interval): boolean {
  return Math.min(a.end, b.end) > Math.max(a.start, b.start);
}
