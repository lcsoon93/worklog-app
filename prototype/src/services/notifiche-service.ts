/**
 * Notifiche e promemoria (Fase 7).
 *
 * Le notifiche sono DERIVATE dai dati già presenti (interventi, assegnazioni, storico delle
 * modifiche, rapportini, cartellini, magazzino): nessuna tabella nuova, nessun dato duplicato.
 * Ogni notifica ha un identificativo stabile; lo stato "letta" è salvato sul dispositivo per
 * utente. Gli avvisi di sistema (Notification API) sono facoltativi e attivati dall'utente;
 * le push con app chiusa richiedono un server push, non disponibile (vedi docs/17).
 */
import { giacenza, movimentoValido } from '../domain/magazzino';
import { statoPresenza } from '../domain/stato-presenza';
import { addDays, atLocal, formatData, localDate } from '../domain/time';
import type { Profilo } from '../domain/types';
import type { ServiceContext } from './base';

export type TipoNotifica =
  | 'intervento_assegnato'
  | 'intervento_modificato'
  | 'intervento_imminente'
  | 'rapportino_da_completare'
  | 'cartellino_da_confermare'
  | 'cartellino_esito'
  | 'richiesta_gestita'
  | 'cartellino_da_approvare'
  | 'richiesta_aperta'
  | 'sotto_scorta'
  | 'ritorno_da_pianificare'
  | 'presenza_non_chiusa';

export interface Notifica {
  id: string;
  tipo: TipoNotifica;
  titolo: string;
  testo: string;
  quando: string;
  link: string;
  priorita: 'normale' | 'alta';
  letta: boolean;
}

interface StatoLettura {
  lette: string[];
  avvisate: string[];
}

const CAMPI_RILEVANTI = ['data_programmata', 'ora_inizio', 'stato', 'sede_id', 'titolo', 'descrizione', 'note', 'priorita'] as const;

export class NotificheService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  private chiave(u: Profilo) {
    return `notifiche:${u.id}`;
  }

  private statoLettura(u: Profilo): StatoLettura {
    return this.db.meta<StatoLettura>(this.chiave(u)) ?? { lette: [], avvisate: [] };
  }

  /** Notifiche attuali dell'utente collegato, più recenti prima. */
  elenco(): Notifica[] {
    const u = this.ctx.utente();
    if (!u) return [];
    const grezze = u.ruolo === 'admin' ? this.perAmministratore() : this.perOperaio(u);
    const lette = new Set(this.statoLettura(u).lette);
    return grezze
      .map((n) => ({ ...n, letta: lette.has(n.id) }))
      .sort((a, b) => (a.priorita === b.priorita ? b.quando.localeCompare(a.quando) : a.priorita === 'alta' ? -1 : 1));
  }

  nonLette(): number {
    return this.elenco().filter((n) => !n.letta).length;
  }

  async segnaLette(ids: string[]): Promise<void> {
    const u = this.ctx.utente();
    if (!u || !ids.length) return;
    const st = this.statoLettura(u);
    const attuali = new Set(this.elenco().map((n) => n.id));
    // Si conservano solo gli id ancora attuali: lo stato non cresce senza limite.
    const lette = [...new Set([...st.lette.filter((x) => attuali.has(x)), ...ids])];
    await this.db.setMeta(this.chiave(u), { ...st, lette });
  }

  async segnaTutteLette(): Promise<void> {
    await this.segnaLette(this.elenco().filter((n) => !n.letta).map((n) => n.id));
  }

  /** Notifiche non lette per cui non è ancora stato mostrato un avviso di sistema; le marca come avvisate. */
  async daAvvisare(): Promise<Notifica[]> {
    const u = this.ctx.utente();
    if (!u) return [];
    const st = this.statoLettura(u);
    const gia = new Set(st.avvisate);
    const nuove = this.elenco().filter((n) => !n.letta && !gia.has(n.id));
    if (nuove.length) {
      const attuali = new Set(this.elenco().map((n) => n.id));
      await this.db.setMeta(this.chiave(u), { ...st, avvisate: [...st.avvisate.filter((x) => attuali.has(x)), ...nuove.map((n) => n.id)] });
    }
    return nuove;
  }

  /** Marca come già avvisate tutte le notifiche attuali (alla prima attivazione non si inonda l'utente). */
  async allineaAvvisi(): Promise<void> {
    const u = this.ctx.utente();
    if (!u) return;
    await this.db.setMeta(this.chiave(u), { ...this.statoLettura(u), avvisate: this.elenco().map((n) => n.id) });
  }

  // --- lavoratore ----------------------------------------------------------------------
  private perOperaio(u: Profilo): Array<Omit<Notifica, 'letta'>> {
    const out: Array<Omit<Notifica, 'letta'>> = [];
    const now = this.db.now();
    const oggi = localDate(now);
    const domani = addDays(oggi, 1);
    const limite = new Date(now - 14 * 86400_000).toISOString();
    const mie = this.db.where('intervento_operai', (x) => x.operaio_id === u.id);
    const mieIds = new Set(mie.map((x) => x.intervento_id));

    for (const a of mie) {
      const i = this.db.get('interventi', a.intervento_id);
      if (!i || i.stato === 'annullato' || i.stato === 'completato' || (i.data_programmata && i.data_programmata < oggi)) continue;
      if (a.created_at < limite) continue;
      out.push({ id: `assegnato:${a.id}`, tipo: 'intervento_assegnato', titolo: 'Nuovo intervento assegnato', testo: `${i.codice} – ${i.titolo}${i.data_programmata ? ` · ${formatData(i.data_programmata, { breve: true })}${i.ora_inizio ? ` ore ${i.ora_inizio}` : ''}` : ''}`, quando: a.created_at, link: `/interventi/${i.id}`, priorita: 'normale' });
    }
    for (const x of this.db.audit()) {
      if (x.entita !== 'interventi' || x.eseguita_at < limite || !mieIds.has(x.entita_id) || x.utente_id === u.id || !x.prima) continue;
      const prima = x.prima as Record<string, unknown>;
      const dopo = x.dopo as Record<string, unknown>;
      const cambi = CAMPI_RILEVANTI.filter((k) => prima[k] !== dopo?.[k]);
      if (!cambi.length) continue;
      const i = this.db.get('interventi', x.entita_id);
      if (!i || (i.data_programmata && i.data_programmata < oggi && i.stato !== 'annullato')) continue;
      const descr = i.stato === 'annullato' && prima.stato !== 'annullato' ? 'Intervento annullato' : cambi.includes('data_programmata') || cambi.includes('ora_inizio') ? `Riprogrammato: ${dopo.data_programmata ? formatData(String(dopo.data_programmata), { breve: true }) : 'da programmare'}${dopo.ora_inizio ? ` ore ${dopo.ora_inizio}` : ''}` : 'Dettagli aggiornati';
      out.push({ id: `modificato:${x.id}`, tipo: 'intervento_modificato', titolo: `Intervento modificato · ${i.codice}`, testo: `${descr} – ${i.titolo}`, quando: x.eseguita_at, link: `/interventi/${i.id}`, priorita: i.stato === 'annullato' || cambi.includes('data_programmata') ? 'alta' : 'normale' });
    }
    for (const id of mieIds) {
      const i = this.db.get('interventi', id);
      if (!i || i.stato !== 'programmato' || !i.data_programmata) continue;
      if (i.data_programmata === oggi && i.ora_inizio) {
        const inizio = atLocal(oggi, i.ora_inizio);
        if (inizio >= now && inizio - now <= 2 * 3600_000) out.push({ id: `imminente:${i.id}:${oggi}`, tipo: 'intervento_imminente', titolo: `Tra poco: ore ${i.ora_inizio}`, testo: `${i.codice} – ${i.titolo}`, quando: new Date(now).toISOString(), link: `/interventi/${i.id}`, priorita: 'alta' });
      } else if (i.data_programmata === domani) {
        out.push({ id: `domani:${i.id}:${domani}`, tipo: 'intervento_imminente', titolo: `Domani${i.ora_inizio ? ` ore ${i.ora_inizio}` : ''}`, testo: `${i.codice} – ${i.titolo}`, quando: new Date(atLocal(oggi, '00:00')).toISOString(), link: `/interventi/${i.id}`, priorita: 'normale' });
      }
    }
    for (const r of this.db.where('rapportini', (r) => r.stato === 'bozza' && r.redatto_da === u.id)) {
      out.push({ id: `bozza:${r.id}`, tipo: 'rapportino_da_completare', titolo: 'Rapportino da completare', testo: `${r.numero_provvisorio} del ${formatData(r.data_lavoro, { breve: true })}`, quando: r.updated_at, link: `/rapportini/${r.id}`, priorita: r.data_lavoro < oggi ? 'alta' : 'normale' });
    }
    for (const c of this.db.where('cartellini_mensili', (c) => c.operaio_id === u.id)) {
      if (c.stato === 'da_confermare_operaio') out.push({ id: `conferma:${c.id}:${c.versione_corrente}`, tipo: 'cartellino_da_confermare', titolo: 'Cartellino da confermare', testo: `${String(c.mese).padStart(2, '0')}/${c.anno} · versione ${c.versione_corrente}`, quando: c.updated_at, link: '/op/cartellino', priorita: 'alta' });
    }
    const mieiCart = new Map(this.db.where('cartellini_mensili', (c) => c.operaio_id === u.id).map((c) => [c.id, c]));
    const limite60 = new Date(now - 60 * 86400_000).toISOString();
    for (const a of this.db.where('approvazioni_cartellino', (a) => mieiCart.has(a.cartellino_id) && a.eseguita_at >= limite60 && ['approva', 'richiedi_correzione', 'rifiuta', 'riapri'].includes(a.azione))) {
      const c = mieiCart.get(a.cartellino_id)!;
      const titolo = a.azione === 'approva' ? 'Cartellino approvato' : a.azione === 'riapri' ? 'Cartellino riaperto' : 'Cartellino restituito per correzione';
      out.push({ id: `esito:${a.id}`, tipo: 'cartellino_esito', titolo, testo: `${String(c.mese).padStart(2, '0')}/${c.anno}${a.motivazione ? ` – ${a.motivazione}` : ''}`, quando: a.eseguita_at, link: '/op/cartellino', priorita: a.azione === 'approva' ? 'normale' : 'alta' });
    }
    for (const r of this.db.where('richieste_correzione', (r) => r.operaio_id === u.id && r.gestita_at !== null && r.gestita_at >= limite)) {
      out.push({ id: `richiesta:${r.id}:${r.stato}`, tipo: 'richiesta_gestita', titolo: `Richiesta di correzione ${r.stato === 'risolta' ? 'risolta' : r.stato === 'respinta' ? 'respinta' : 'presa in carico'}`, testo: `${formatData(r.data_lavoro, { breve: true })}${r.risposta ? ` – ${r.risposta}` : ''}`, quando: r.gestita_at!, link: '/op/riepilogo', priorita: 'normale' });
    }
    return out;
  }

  // --- amministrazione -------------------------------------------------------------------
  private perAmministratore(): Array<Omit<Notifica, 'letta'>> {
    const out: Array<Omit<Notifica, 'letta'>> = [];
    const now = this.db.now();
    const nome = (id: string | null) => { const p = id ? this.db.get('profili', id) : undefined; return p ? `${p.nome} ${p.cognome}` : '—'; };
    for (const c of this.db.where('cartellini_mensili', (c) => c.stato === 'in_attesa_approvazione')) {
      out.push({ id: `approvare:${c.id}:${c.versione_corrente}`, tipo: 'cartellino_da_approvare', titolo: 'Cartellino da approvare', testo: `${nome(c.operaio_id)} · ${String(c.mese).padStart(2, '0')}/${c.anno} v${c.versione_corrente}`, quando: c.updated_at, link: `/admin/cartellini/${c.id}`, priorita: 'normale' });
    }
    for (const r of this.db.where('richieste_correzione', (r) => r.stato === 'aperta')) {
      out.push({ id: `richiesta:${r.id}`, tipo: 'richiesta_aperta', titolo: 'Richiesta di correzione', testo: `${nome(r.operaio_id)} · ${formatData(r.data_lavoro, { breve: true })}: ${r.messaggio}`, quando: r.created_at, link: '/admin', priorita: 'normale' });
    }
    const movs = this.db.all('movimenti_magazzino');
    for (const m of this.db.where('materiali', (m) => m.attivo)) {
      const g = giacenza(movs, m.id);
      if (g >= m.scorta_minima) continue;
      const ultimo = movs.filter((x) => x.materiale_id === m.id && movimentoValido(x)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      out.push({ id: `scorta:${m.id}:${ultimo?.id ?? 'nessuno'}`, tipo: 'sotto_scorta', titolo: 'Materiale sotto scorta', testo: `${m.nome}: ${g} ${m.unita} (minimo ${m.scorta_minima})`, quando: ultimo?.created_at ?? m.updated_at, link: '/admin/magazzino', priorita: g <= 0 ? 'alta' : 'normale' });
    }
    for (const f of this.db.where('followup', (f) => f.stato === 'aperto')) {
      out.push({ id: `ritorno:${f.id}`, tipo: 'ritorno_da_pianificare', titolo: f.tipo === 'ritorno' ? 'Ritorno da pianificare' : 'Lavoro da ultimare', testo: `${this.db.get('clienti', f.cliente_id)?.ragione_sociale ?? '—'}: ${f.motivo}`, quando: f.created_at, link: '/admin/ritorni', priorita: f.priorita === 'alta' || f.priorita === 'urgente' ? 'alta' : 'normale' });
    }
    for (const p of this.db.where('presenze', (p) => p.uscita_at === null)) {
      if (statoPresenza(p, now) !== 'non_chiusa') continue;
      out.push({ id: `nonchiusa:${p.id}`, tipo: 'presenza_non_chiusa', titolo: 'Presenza non chiusa', testo: `${nome(p.operaio_id)} · ${formatData(p.data_lavoro, { breve: true })}: uscita non registrata`, quando: p.ultimo_segnale_at, link: `/admin/presenze?operaio=${p.operaio_id}&data=${p.data_lavoro}`, priorita: 'alta' });
    }
    return out;
  }
}
