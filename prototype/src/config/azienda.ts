/**
 * Dati dell'azienda usati nei documenti. Configurabili: in Fase 2 verranno letti da una
 * tabella impostazioni su Supabase. Il logo è un SVG (testo) o null: nessun file esterno,
 * così la generazione funziona anche offline.
 */
export interface DatiAzienda {
  ragioneSociale: string;
  indirizzo: string;
  partitaIva: string;
  /** Telefono, email e sito su una riga (facoltativo). */
  contatti: string;
  logoSvg: string | null;
}

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const da = (k: string, predefinito: string) => (env[k]?.trim() ? env[k]!.trim() : predefinito);

/**
 * Dati aziendali nei documenti: da variabili VITE_AZIENDA_* (vedi .env.example); in assenza,
 * i valori dimostrativi. Il logo resta un SVG incorporato (generazione PDF anche offline):
 * VITE_AZIENDA_LOGO_SVG accetta il testo SVG completo.
 */
export const AZIENDA: DatiAzienda = {
  ragioneSociale: da('VITE_AZIENDA_RAGIONE_SOCIALE', 'Demo Impianti S.r.l.'),
  indirizzo: da('VITE_AZIENDA_INDIRIZZO', 'Via dell\'Artigianato 10 · 40100 Bologna (BO)'),
  partitaIva: da('VITE_AZIENDA_PARTITA_IVA', '00000000000'),
  contatti: da('VITE_AZIENDA_CONTATTI', ''),
  logoSvg: env.VITE_AZIENDA_LOGO_SVG?.trim().startsWith('<svg') ? env.VITE_AZIENDA_LOGO_SVG.trim() : 
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f766e"/><path d="M318 120a92 92 0 0 0-86 124L126 350a34 34 0 1 0 48 48l106-106a92 92 0 0 0 124-86l-54 54-46-12-12-46z" fill="#ecfdf9"/></svg>',
};

/**
 * Dati aziendali ricevuti dal server dopo l'accesso reale (tabella impostazioni_azienda): hanno
 * la precedenza sulle variabili di build. Aggiorna l'oggetto condiviso usato dai PDF.
 */
export function aggiornaAzienda(d: { ragione_sociale: string; indirizzo: string; partita_iva: string | null; telefono: string; email: string; sito_web: string | null; logo_svg: string | null }) {
  AZIENDA.ragioneSociale = d.ragione_sociale;
  AZIENDA.indirizzo = d.indirizzo;
  AZIENDA.partitaIva = d.partita_iva ?? '';
  const contatti = [d.telefono && `Tel. ${d.telefono}`, d.email, d.sito_web].filter(Boolean).join(' · ');
  if (contatti) AZIENDA.contatti = contatti;
  if (d.logo_svg?.trim().startsWith('<svg')) AZIENDA.logoSvg = d.logo_svg;
}
