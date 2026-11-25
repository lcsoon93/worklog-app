/**
 * Dati dell'azienda usati nei documenti. Configurabili: in Fase 2 verranno letti da una
 * tabella impostazioni su Supabase. Il logo è un SVG (testo) o null: nessun file esterno,
 * così la generazione funziona anche offline.
 */
export interface DatiAzienda {
  ragioneSociale: string;
  indirizzo: string;
  partitaIva: string;
  logoSvg: string | null;
}

export const AZIENDA: DatiAzienda = {
  ragioneSociale: 'Demo Impianti S.r.l.',
  indirizzo: 'Via dell\'Artigianato 10 · 40100 Bologna (BO)',
  partitaIva: '00000000000',
  logoSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f766e"/><path d="M318 120a92 92 0 0 0-86 124L126 350a34 34 0 1 0 48 48l106-106a92 92 0 0 0 124-86l-54 54-46-12-12-46z" fill="#ecfdf9"/></svg>',
};
