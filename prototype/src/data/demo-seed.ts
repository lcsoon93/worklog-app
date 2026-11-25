/**
 * DATI DIMOSTRATIVI. Persone, aziende e indirizzi sono di fantasia.
 *
 * Il dataset è generato in modo deterministico rispetto alla data corrente:
 * - mese precedente completo (cartellini in stati diversi per provare il flusso di approvazione);
 * - mese corrente fino a ieri;
 * - oggi: Marco Rossi NON ha ancora timbrato (per simulare la giornata), Luca Ferri e
 *   Andrea Conti sono già al lavoro, Paolo Greco non ha ancora iniziato.
 * I record seminati risultano già sincronizzati (versione 1) anche sul server simulato.
 */
import { costruisciSnapshotMese } from '../domain/day-records';
import { impronta } from '../domain/ids';
import { addDays, atLocal, daysInMonth, isWeekend, localDate, meseDi, mesePrecedente, toIso } from '../domain/time';
import type {
  ApprovazioneCartellino,
  AttivitaLavoro,
  AzioneCartellino,
  BaseRecord,
  CartellinoMensile,
  CartellinoStato,
  CartellinoVersione,
  Cliente,
  CodiceAttivitaInterna,
  EntityName,
  Followup,
  Imprevisto,
  Intervento,
  InterventoOperaio,
  Magazzino,
  Materiale,
  MovimentoMagazzino,
  PausaPresenza,
  Presenza,
  Profilo,
  Rapportino,
  SedeCliente,
} from '../domain/types';
import type { LocalDb } from './local-db';
import type { BatchOp } from './storage';

export const VERSIONE_SEED = 6;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID deterministici per il seed (formato v4 valido). */
function seedIdFactory(rnd: () => number) {
  return () => {
    const h = Array.from({ length: 32 }, () => Math.floor(rnd() * 16).toString(16));
    h[12] = '4';
    h[16] = ['8', '9', 'a', 'b'][Math.floor(rnd() * 4)];
    const s = h.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
}

export const ACCOUNT_DEMO = {
  admin: 'laura.bianchi@demo.local',
  operaio: 'marco.rossi@demo.local',
};

export async function seedDemo(db: LocalDb, nowMs: number = db.now()): Promise<void> {
  const rnd = mulberry32(20261124);
  const newId = seedIdFactory(rnd);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const nowIso = toIso(nowMs);
  const out: Record<string, Array<BaseRecord>> = {};
  const add = <T extends BaseRecord>(entita: EntityName, r: Omit<T, keyof BaseRecord> & Partial<BaseRecord>, createdAt = nowIso): T => {
    // Un id esplicito non consuma il generatore principale: i dati delle fasi precedenti restano identici.
    const full = {
      id: (r as Partial<BaseRecord>).id ?? newId(),
      created_at: createdAt,
      created_by: null,
      updated_at: createdAt,
      updated_by: null,
      row_version: 1,
      sync_stato: 'sincronizzato',
      device_id: 'seed',
      deleted_at: null,
      ...r,
    } as T;
    (out[entita] ??= []).push(full);
    return full;
  };

  // --- persone ---------------------------------------------------------------------
  const prof = (nome: string, cognome: string, ruolo: Profilo['ruolo'], colore: string, qualifica: string) =>
    add<Profilo>('profili', {
      nome,
      cognome,
      email: `${nome}.${cognome}@demo.local`.toLowerCase(),
      telefono: `+39 333 ${Math.floor(1000000 + rnd() * 8999999)}`,
      ruolo,
      attivo: true,
      colore,
      qualifica,
      ore_giornaliere_contratto: 8,
    });
  const admin = prof('Laura', 'Bianchi', 'admin', '#7c3aed', 'Responsabile amministrativa');
  const marco = prof('Marco', 'Rossi', 'operaio', '#0f766e', 'Tecnico termoidraulico');
  const luca = prof('Luca', 'Ferri', 'operaio', '#b45309', 'Elettricista');
  const andrea = prof('Andrea', 'Conti', 'operaio', '#1d4ed8', 'Tecnico frigorista');
  const paolo = prof('Paolo', 'Greco', 'operaio', '#be123c', 'Apprendista');
  const operai = [marco, luca, andrea, paolo];

  // --- magazzino (Fase 5): generatore separato, non altera la sequenza dei dati precedenti ---
  const rndMag = mulberry32(20261125);
  const idMag = seedIdFactory(rndMag);
  type VoceCatalogo = [codice: string, nome: string, categoria: string, unita: string, acquisto: number, vendita: number | null, fornitore: string, scorta: number, caricoIniziale: number, prezzoPrecedente?: number];
  const CATALOGO: VoceCatalogo[] = [
    ['IDR-001', 'Guarnizioni assortite', 'Idraulica', 'pz', 0.85, 2.5, 'Idrotermica Emiliana', 30, 300],
    ['IDR-002', 'Raccordo 3/4"', 'Idraulica', 'pz', 3.4, 7.9, 'Idrotermica Emiliana', 20, 260],
    ['IDR-003', 'Valvola a sfera 1/2"', 'Idraulica', 'pz', 6.2, 14, 'Idrotermica Emiliana', 10, 25],
    ['CON-001', 'Nastro in PTFE', 'Consumabili', 'pz', 0.9, 2, 'Ferramenta Reno', 20, 60],
    ['CON-002', 'Silicone sigillante', 'Consumabili', 'pz', 4.5, null, 'Ferramenta Reno', 6, 12],
    ['FRG-001', 'Filtro deidratatore', 'Refrigerazione', 'pz', 21, 39, 'Frigoservice Bologna', 10, 220, 18.5],
    ['FRG-002', 'Gas refrigerante R32', 'Refrigerazione', 'kg', 28, 55, 'Frigoservice Bologna', 5, 2],
    ['FRG-003', 'Tubo rame 1/4"', 'Refrigerazione', 'm', 4.1, 8.5, 'Frigoservice Bologna', 25, 100],
    ['ELE-001', 'Fusibile 16A', 'Elettrico', 'pz', 0.6, 1.8, 'Elettroforniture Felsinea', 40, 200],
    ['ELE-002', 'Interruttore magnetotermico 16A', 'Elettrico', 'pz', 11.5, 24, 'Elettroforniture Felsinea', 5, 3],
    ['ELE-003', 'Cavo FG16 3x2,5', 'Elettrico', 'm', 1.35, 3.2, 'Elettroforniture Felsinea', 50, 200],
  ];
  const catalogo = new Map<string, { mat: Materiale; voce: VoceCatalogo }>();
  for (const v of CATALOGO) {
    const mat = add<Materiale>('materiali', {
      id: idMag(),
      codice: v[0], nome: v[1], descrizione: '', categoria: v[2], unita: v[3],
      prezzo_acquisto: v[4], prezzo_vendita: v[5], fornitore: v[6], scorta_minima: v[7], attivo: true,
    });
    catalogo.set(v[1], { mat, voce: v });
  }
  const magazzino = (codice: string, nome: string, tipo: Magazzino['tipo'], resp: Profilo | null) =>
    add<Magazzino>('magazzini', { id: idMag(), codice, nome, tipo, responsabile_id: resp?.id ?? null, attivo: true });
  const centrale = magazzino('MAG-01', 'Magazzino centrale', 'sede', null);
  const furgoni = [magazzino('FUR-01', 'Furgone Marco Rossi', 'automezzo', marco), magazzino('FUR-02', 'Furgone Andrea Conti', 'automezzo', andrea)];
  const magazzinoDi = (op: Profilo) => furgoni.find((f) => f.responsabile_id === op.id) ?? centrale;

  // --- clienti e sedi ----------------------------------------------------------------
  const cli = (ragione: string, piva: string, referente: string) =>
    add<Cliente>('clienti', {
      ragione_sociale: ragione,
      partita_iva: piva,
      email: `info@${ragione.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.example`,
      telefono: `051 ${Math.floor(100000 + rnd() * 899999)}`,
      referente,
      note: '',
      attivo: true,
    });
  const sede = (c: Cliente, nome: string, indirizzo: string, citta: string, cap: string, note = '') =>
    add<SedeCliente>('sedi_cliente', {
      cliente_id: c.id,
      nome,
      indirizzo,
      cap,
      citta,
      provincia: 'BO',
      referente: c.referente,
      telefono: c.telefono,
      note_accesso: note,
      attiva: true,
    });
  const condominio = cli('Condominio Via Roma 12', '90011223344', 'Amministratore Sig. Gatti');
  const fresco = cli('FrescoPiù Supermercati S.r.l.', '01234567890', 'Dott.ssa Neri');
  const hotel = cli('Hotel Belvedere S.p.A.', '02345678901', 'Ing. Fabbri');
  const studio = cli('Studio Medico Riva', '03456789012', 'Dott. Riva');
  const officine = cli('Officine Martelli S.n.c.', '04567890123', 'Sig. Martelli');
  const sCond = sede(condominio, 'Stabile Via Roma 12', 'Via Roma 12', 'Bologna', '40121', 'Chiavi centrale termica dal portiere (8-12).');
  const sFr1 = sede(fresco, 'Punto vendita Casalecchio', 'Via Porrettana 210', 'Casalecchio di Reno', '40033', 'Ingresso fornitori sul retro.');
  const sFr2 = sede(fresco, 'Punto vendita San Lazzaro', 'Via Emilia 45', 'San Lazzaro di Savena', '40068');
  const sHot = sede(hotel, 'Hotel Belvedere', 'Viale Panoramica 3', 'Bologna', '40136', 'Parcheggio interno, chiedere in reception.');
  const sStu = sede(studio, 'Ambulatorio', 'Via Saragozza 88', 'Bologna', '40135', 'Interventi solo dopo le 14:00.');
  const sOf1 = sede(officine, 'Stabilimento', 'Via del Lavoro 7', 'Zola Predosa', '40069', 'DPI obbligatori in reparto.');
  const sOf2 = sede(officine, 'Magazzino', 'Via del Lavoro 9', 'Zola Predosa', '40069');
  const coppie: Array<[Cliente, SedeCliente]> = [
    [condominio, sCond], [fresco, sFr1], [fresco, sFr2], [hotel, sHot], [studio, sStu], [officine, sOf1], [officine, sOf2],
  ];
  const titoli: Record<string, string[]> = {
    [condominio.id]: ['Manutenzione caldaia centralizzata', 'Sostituzione valvola di zona', 'Controllo fumi annuale'],
    [fresco.id]: ['Verifica impianto frigorifero banchi', 'Sostituzione ventola cella', 'Ricarica gas banco surgelati'],
    [hotel.id]: ['Installazione split camere 2° piano', 'Riparazione quadro elettrico cucina', 'Manutenzione UTA'],
    [studio.id]: ['Verifica impianto elettrico ambulatorio', 'Sostituzione plafoniere LED'],
    [officine.id]: ['Manutenzione compressore', 'Riparazione linea aria compressa', 'Verifica messa a terra'],
  };

  // --- interventi, presenze, attività e rapportini storici -------------------------
  const oggi = localDate(nowMs);
  const { anno: annoCorr, mese: meseCorr } = meseDi(oggi);
  const prec = mesePrecedente(annoCorr, meseCorr);
  const giorniStorici = [...daysInMonth(prec.anno, prec.mese), ...daysInMonth(annoCorr, meseCorr)].filter(
    (d) => d < oggi && !isWeekend(d),
  );

  let seqInt = 100;
  let seqRap = 0;
  const nuovoIntervento = (c: Cliente, s: SedeCliente, data: string, ora: string, durata: number, stato: Intervento['stato'], squadra: Profilo[], extra: Partial<Intervento> = {}) => {
    seqInt++;
    const i = add<Intervento>('interventi', {
      codice: `INT-${data.slice(0, 4)}-${seqInt}`,
      cliente_id: c.id,
      sede_id: s.id,
      titolo: pick(titoli[c.id]),
      descrizione: 'Intervento programmato dal piano di manutenzione.',
      tipo: pick(['manutenzione', 'riparazione', 'installazione'] as const),
      priorita: pick(['normale', 'normale', 'alta', 'bassa'] as const),
      stato,
      data_programmata: data,
      ora_inizio: ora,
      durata_prevista_min: durata,
      followup_origine_id: null,
      note: '',
      ...extra,
    });
    squadra.forEach((op, idx) =>
      add<InterventoOperaio>('intervento_operai', { intervento_id: i.id, operaio_id: op.id, ruolo: idx === 0 ? 'responsabile' : 'squadra' }),
    );
    return i;
  };

  const att = (p: Presenza, tipo: AttivitaLavoro['tipo'], inizio: number, fine: number | null, extra: Partial<AttivitaLavoro> = {}) =>
    add<AttivitaLavoro>(
      'attivita_lavoro',
      {
        presenza_id: p.id,
        operaio_id: p.operaio_id,
        tipo,
        cliente_id: null,
        sede_id: null,
        intervento_id: null,
        codice_interno: null,
        descrizione: '',
        inizio_at: toIso(inizio),
        fine_at: fine === null ? null : toIso(fine),
        origine: 'timer',
        sostituisce_id: null,
        superata_da_id: null,
        annullata: false,
        motivo_correzione: '',
        chiusura_automatica: false,
        ...extra,
      },
      toIso(inizio),
    );

  const pres = (op: Profilo, data: string, entrata: number, uscita: number | null) =>
    add<Presenza>(
      'presenze',
      {
        operaio_id: op.id,
        data_lavoro: data,
        entrata_at: toIso(entrata),
        uscita_at: uscita === null ? null : toIso(uscita),
        entrata_registrata_at: toIso(entrata),
        uscita_registrata_at: uscita === null ? null : toIso(uscita),
        ultimo_segnale_at: toIso(uscita ?? nowMs),
        uscita_automatica: false,
        note: '',
      },
      toIso(entrata),
    );

  const pausa = (p: Presenza, inizio: number, fine: number | null, tipo: PausaPresenza['tipo'] = 'pranzo') =>
    add<PausaPresenza>('pause_presenza', { presenza_id: p.id, operaio_id: p.operaio_id, tipo, inizio_at: toIso(inizio), fine_at: fine === null ? null : toIso(fine), attivita_sospesa_id: null }, toIso(inizio));

  const rapportino = (data: string, i: Intervento, autore: Profilo, attivita: AttivitaLavoro[], esito: Rapportino['esito'], note = '') => {
    seqRap++;
    return add<Rapportino>(
      'rapportini',
      {
        numero_provvisorio: `B-SEED-${String(seqRap).padStart(3, '0')}`,
        numero: `R-${data.slice(0, 4)}-${String(seqRap).padStart(4, '0')}`,
        tipo: rnd() > 0.5 ? 'completo' : 'rapido',
        stato: 'completato',
        data_lavoro: data,
        cliente_id: i.cliente_id,
        sede_id: i.sede_id,
        intervento_id: i.id,
        followup_id: i.followup_origine_id,
        redatto_da: autore.id,
        operai_ids: [autore.id],
        attivita_ids: attivita.map((a) => a.id),
        descrizione_lavoro: `${i.titolo}: eseguiti controlli e interventi previsti, impianto verificato funzionante.`,
        esito,
        note_interne: note,
        materiali: esito === 'completato' ? [((id: string, descrizione: string, quantita: number) => ({ id, descrizione, quantita, unita: 'pz', materiale_id: catalogo.get(descrizione)!.mat.id, magazzino_id: magazzinoDi(autore).id }))(newId(), pick(['Guarnizioni assortite', 'Filtro deidratatore', 'Fusibile 16A', 'Raccordo 3/4"']), 1 + Math.floor(rnd() * 4))] : [],
        foto_ids: [],
        firma_cliente_id: null,
        firma_cliente_nome: '',
        firma_operaio_id: null,
        imprevisti_ids: [],
      },
      toIso(atLocal(data, '17:00')),
    );
  };

  const interni: CodiceAttivitaInterna[] = ['magazzino', 'manutenzione_mezzi', 'ufficio', 'formazione'];
  let followupAperto: Followup | null = null;
  let ritorniCreati = 0;
  const motiviRitorno = ['Manca il pezzo di ricambio: ordinato, tornare per montarlo.', 'Perdita sul raccordo del collettore: serve un secondo intervento con pezzo nuovo.'];
  let rapportinoConRitorno: Rapportino | null = null;

  for (const data of giorniStorici) {
    for (const op of operai) {
      if (rnd() < 0.06) continue; // giorno di assenza (ferie/permesso)
      const [c1, s1] = pick(coppie);
      let [c2, s2] = pick(coppie);
      if (c2.id === c1.id) [c2, s2] = coppie[(coppie.findIndex(([c]) => c.id === c1.id) + 2) % coppie.length];
      const i1 = nuovoIntervento(c1, s1, data, '08:00', 240, 'completato', [op]);
      const i2 = nuovoIntervento(c2, s2, data, '13:45', 90, 'completato', [op]);

      const jitter = () => Math.floor(rnd() * 11) - 5;
      const t = (hhmm: string, j = 0) => atLocal(data, hhmm) + j * 60_000;
      const entrata = t('07:30', jitter());
      const uscita = t('16:45', jitter() + (rnd() < 0.15 ? 45 : 0));
      const p = pres(op, data, entrata, uscita);
      const finePausa = t('13:15', jitter());
      pausa(p, t('12:30'), finePausa);
      const fineGiro = uscita - Math.floor(rnd() * 8) * 60_000;

      const tr1 = att(p, 'trasferimento', entrata, t('08:00'), { cliente_id: c1.id, sede_id: s1.id, intervento_id: i1.id });
      const l1 = att(p, 'lavoro_cliente', t('08:00'), t('12:30'), { cliente_id: c1.id, sede_id: s1.id, intervento_id: i1.id });
      const tr2 = att(p, 'trasferimento', finePausa, t('13:45'), { cliente_id: c2.id, sede_id: s2.id, intervento_id: i2.id });
      const l2 = att(p, 'lavoro_cliente', t('13:45'), t('15:20'), { cliente_id: c2.id, sede_id: s2.id, intervento_id: i2.id });
      const caso = rnd();
      if (caso < 0.08) {
        // Timer dimenticato: chiuso automaticamente all'uscita.
        att(p, 'interna', t('15:20'), uscita, { codice_interno: 'magazzino', chiusura_automatica: true });
      } else if (caso < 0.16) {
        // Pomeriggio senza attività registrate: ore non attribuite.
      } else if (caso < 0.22) {
        // Correzione: il cliente era sbagliato, l'originale resta nello storico.
        const sbagliata = att(p, 'interna', t('15:20'), fineGiro, { codice_interno: 'ufficio' });
        const corretta = att(p, 'lavoro_cliente', t('15:20'), fineGiro, {
          cliente_id: c2.id, sede_id: s2.id, intervento_id: i2.id, origine: 'correzione', sostituisce_id: sbagliata.id, motivo_correzione: 'Ero ancora dal cliente, non in ufficio',
        });
        sbagliata.superata_da_id = corretta.id;
      } else {
        att(p, 'interna', t('15:20'), fineGiro, { codice_interno: pick(interni) });
      }

      const esitoRnd = rnd();
      const esito: Rapportino['esito'] = esitoRnd < 0.06 && ritorniCreati < 2 ? 'ritorno_necessario' : 'completato';
      const r1 = rapportino(data, i1, op, [tr1, l1], esito, esito === 'ritorno_necessario' ? motiviRitorno[ritorniCreati % 2] : '');
      rapportino(data, i2, op, [tr2, l2], 'completato');
      if (esito === 'ritorno_necessario') {
        i1.stato = 'da_ultimare';
        const f = add<Followup>('followup', {
          tipo: 'ritorno',
          stato: 'aperto',
          rapportino_origine_id: r1.id,
          intervento_origine_id: i1.id,
          cliente_id: c1.id,
          sede_id: s1.id,
          motivo: r1.note_interne,
          priorita: 'alta',
          data_suggerita: null,
          intervento_ritorno_id: null,
          rapportino_chiusura_id: null,
        });
        followupAperto = f;
        ritorniCreati++;
        rapportinoConRitorno = r1;
      }
    }
  }

  // Un ritorno già pianificato per domani (catena completa: rapportino → followup → intervento).
  let domani = addDays(oggi, 1);
  while (isWeekend(domani)) domani = addDays(domani, 1);
  if (followupAperto && rapportinoConRitorno) {
    const fu = followupAperto;
    const origine = (out.interventi as Intervento[]).find((i) => i.id === fu.intervento_origine_id)!;
    const ritorno = nuovoIntervento(
      condominio.id === fu.cliente_id ? condominio : (out.clienti as Cliente[]).find((c) => c.id === fu.cliente_id)!,
      (out.sedi_cliente as SedeCliente[]).find((s) => s.id === fu.sede_id)!,
      domani,
      '09:00',
      90,
      'programmato',
      [marco],
      { tipo: 'ritorno', titolo: `Ritorno: ${origine.titolo}`, descrizione: fu.motivo, followup_origine_id: fu.id, priorita: 'alta' },
    );
    fu.stato = 'pianificato';
    fu.intervento_ritorno_id = ritorno.id;
    fu.data_suggerita = domani;
  }
  // Un secondo ritorno ancora da pianificare, da un rapportino recente.
  const ultimi = (out.rapportini as Rapportino[]).filter((r) => r.esito === 'completato').slice(-6);
  if (ultimi.length) {
    const r = ultimi[0];
    r.esito = 'da_ultimare';
    r.note_interne = 'Completare il cablaggio del secondo quadro: manca mezza giornata.';
    const i = (out.interventi as Intervento[]).find((x) => x.id === r.intervento_id)!;
    i.stato = 'da_ultimare';
    add<Followup>('followup', {
      tipo: 'da_ultimare',
      stato: 'aperto',
      rapportino_origine_id: r.id,
      intervento_origine_id: i.id,
      cliente_id: r.cliente_id,
      sede_id: r.sede_id,
      motivo: r.note_interne,
      priorita: 'normale',
      data_suggerita: null,
      intervento_ritorno_id: null,
      rapportino_chiusura_id: null,
    });
  }

  // --- oggi e prossimi giorni ------------------------------------------------------
  if (!isWeekend(oggi)) {
    nuovoIntervento(condominio, sCond, oggi, '08:00', 180, 'programmato', [marco]);
    nuovoIntervento(fresco, sFr1, oggi, '11:30', 120, 'programmato', [marco, paolo]);
    const iLuca = nuovoIntervento(hotel, sHot, oggi, '08:00', 360, 'in_corso', [luca]);
    const iAndrea = nuovoIntervento(officine, sOf1, oggi, '07:45', 240, 'in_corso', [andrea]);
    nuovoIntervento(studio, sStu, oggi, '14:30', 90, 'programmato', [paolo]);

    const hNow = new Date(nowMs).getHours();
    if (hNow >= 8 && hNow < 19) {
      const lp = pres(luca, oggi, atLocal(oggi, '07:32'), null);
      att(lp, 'trasferimento', atLocal(oggi, '07:32'), atLocal(oggi, '07:58'), { cliente_id: hotel.id, sede_id: sHot.id, intervento_id: iLuca.id });
      att(lp, 'lavoro_cliente', atLocal(oggi, '07:58'), null, { cliente_id: hotel.id, sede_id: sHot.id, intervento_id: iLuca.id });
      const ap = pres(andrea, oggi, atLocal(oggi, '07:25'), null);
      att(ap, 'lavoro_cliente', atLocal(oggi, '07:45'), null, { cliente_id: officine.id, sede_id: sOf1.id, intervento_id: iAndrea.id });
      add<Imprevisto>('imprevisti', {
        operaio_id: andrea.id,
        presenza_id: ap.id,
        intervento_id: iAndrea.id,
        cliente_id: officine.id,
        rapportino_id: null,
        tipo: 'materiale_mancante',
        gravita: 'media',
        descrizione: 'Il kit guarnizioni consegnato non è compatibile con il modello del compressore.',
        avvenuto_at: toIso(atLocal(oggi, '08:40')),
        blocca_lavoro: false,
        richiede_ritorno: false,
        allegati_ids: [],
      }, toIso(atLocal(oggi, '08:40')));
    }
  }
  for (let k = 1; k <= 12; k++) {
    const d = addDays(oggi, k);
    if (isWeekend(d)) continue;
    operai.forEach((op, idx) => {
      if ((k + idx) % 3 === 0) return;
      const [c, s] = coppie[(k * 3 + idx) % coppie.length];
      nuovoIntervento(c, s, d, idx % 2 ? '13:30' : '08:00', idx % 2 ? 150 : 240, 'programmato', idx === 3 ? [op, operai[0]] : [op]);
    });
  }
  const daProg = coppie[4];
  nuovoIntervento(daProg[0], daProg[1], oggi, '', 60, 'da_programmare', [], { data_programmata: null, ora_inizio: null, titolo: 'Sopralluogo per preventivo nuove prese', tipo: 'sopralluogo' });

  // --- cartellini del mese precedente ----------------------------------------------
  const presenze = out.presenze as Presenza[];
  const pause = out.pause_presenza as PausaPresenza[];
  const attivita = out.attivita_lavoro as AttivitaLavoro[];
  const fineMesePrec = atLocal(`${prec.anno}-${String(prec.mese).padStart(2, '0')}-01`, '08:00') + 32 * 86400_000;
  const flussi: Array<[Profilo, Array<[AzioneCartellino, CartellinoStato, CartellinoStato, Profilo | null, string]>]> = [
    [marco, [['genera', 'in_compilazione', 'da_confermare_operaio', admin, '']]],
    [luca, [
      ['genera', 'in_compilazione', 'da_confermare_operaio', admin, ''],
      ['conferma', 'da_confermare_operaio', 'confermato_operaio', luca, ''],
      ['ricezione_server', 'confermato_operaio', 'in_attesa_approvazione', null, ''],
    ]],
    [andrea, [
      ['genera', 'in_compilazione', 'da_confermare_operaio', admin, ''],
      ['conferma', 'da_confermare_operaio', 'confermato_operaio', andrea, ''],
      ['ricezione_server', 'confermato_operaio', 'in_attesa_approvazione', null, ''],
      ['approva', 'in_attesa_approvazione', 'approvato', admin, ''],
    ]],
    [paolo, [
      ['genera', 'in_compilazione', 'da_confermare_operaio', admin, ''],
      ['conferma', 'da_confermare_operaio', 'confermato_operaio', paolo, ''],
      ['ricezione_server', 'confermato_operaio', 'in_attesa_approvazione', null, ''],
      ['richiedi_correzione', 'in_attesa_approvazione', 'da_correggere', admin, 'Verificare le ore non attribuite nei pomeriggi: classificare le attività mancanti.'],
    ]],
  ];
  for (const [op, passi] of flussi) {
    const snap = costruisciSnapshotMese(op.id, prec.anno, prec.mese, presenze, pause, attivita, fineMesePrec);
    const ultimo = passi[passi.length - 1];
    const c = add<CartellinoMensile>('cartellini_mensili', {
      operaio_id: op.id,
      anno: prec.anno,
      mese: prec.mese,
      stato: ultimo[2],
      versione_corrente: 1,
      versione_approvata: ultimo[0] === 'approva' ? 1 : null,
      ultima_motivazione: ultimo[4],
    });
    add<CartellinoVersione>('cartellino_versioni', {
      cartellino_id: c.id,
      versione: 1,
      giorni: snap.giorni,
      totali: snap.totali,
      impronta: snap.impronta,
      motivo: 'Chiusura del mese',
    });
    passi.forEach(([azione, da, a, chi, motivo], k) => {
      const quando = toIso(atLocal(oggi, '07:00') - (passi.length - k) * 86400_000 * 2);
      add<ApprovazioneCartellino>('approvazioni_cartellino', {
        cartellino_id: c.id,
        versione: 1,
        azione,
        stato_precedente: da,
        stato_nuovo: a,
        utente_id: chi?.id ?? null,
        ruolo_utente: chi ? chi.ruolo : 'sistema',
        motivazione: motivo,
        eseguita_at: quando,
      }, quando);
    });
  }

  // --- movimenti di magazzino (Fase 5) --------------------------------------------------
  const chiavi: Record<string, string> = {};
  {
    const giac = new Map<string, number>();
    const primoPrec = `${prec.anno}-${String(prec.mese).padStart(2, '0')}-01`;
    const cambioPrezzo = addDays(oggi, -3);
    const mov = (mat: Materiale, mag: Magazzino, tipo: MovimentoMagazzino['tipo'], quantita: number, quando: number, extra: Partial<MovimentoMagazzino> = {}) => {
      const k = `${mat.id}:${mag.id}`;
      giac.set(k, (giac.get(k) ?? 0) + quantita);
      const data = localDate(quando);
      const voce = [...catalogo.values()].find((c) => c.mat.id === mat.id)!.voce;
      return add<MovimentoMagazzino>('movimenti_magazzino', {
        id: idMag(), materiale_id: mat.id, magazzino_id: mag.id, tipo, quantita,
        costo_unitario: voce[9] !== undefined && data < cambioPrezzo ? voce[9] : mat.prezzo_acquisto,
        prezzo_vendita_unitario: null, data_riferimento: data, motivo: '', documento: '',
        rapportino_id: null, riga_rapportino_id: null, intervento_id: null, cliente_id: null, operaio_id: null,
        corregge_id: null, trasferimento_id: null, chiave_univoca: null, duplicato_di: null, giacenza_insufficiente: false,
        created_by: admin.id, updated_by: admin.id,
        ...extra,
      }, toIso(quando));
    };
    const t0 = atLocal(primoPrec, '07:30');
    for (const { mat, voce } of catalogo.values()) {
      mov(mat, centrale, 'carico', voce[8], t0, { documento: `DDT ${voce[6].split(' ')[0]} 1/${primoPrec.slice(5, 7)}`, motivo: 'Carico iniziale' });
    }
    for (const nome of ['Guarnizioni assortite', 'Filtro deidratatore', 'Fusibile 16A', 'Raccordo 3/4"']) {
      const mat = catalogo.get(nome)!.mat;
      for (const f of furgoni) {
        const tid = idMag();
        mov(mat, centrale, 'trasferimento', -40, t0 + 3600_000, { trasferimento_id: tid, motivo: 'Dotazione furgone' });
        mov(mat, f, 'trasferimento', 40, t0 + 3600_000, { trasferimento_id: tid, motivo: 'Dotazione furgone' });
      }
    }
    const rapps = ((out.rapportini ?? []) as Rapportino[]).slice().sort((a, b) => a.data_lavoro.localeCompare(b.data_lavoro));
    for (const r of rapps) {
      for (const riga of r.materiali) {
        const mat = [...catalogo.values()].find((c) => c.mat.id === riga.materiale_id)?.mat;
        if (!mat) continue;
        let mag = [centrale, ...furgoni].find((m) => m.id === riga.magazzino_id) ?? centrale;
        if ((giac.get(`${mat.id}:${mag.id}`) ?? 0) < riga.quantita) {
          mag = centrale; // furgone vuoto: il materiale è stato preso in sede
          riga.magazzino_id = centrale.id;
        }
        const i = (out.interventi as Intervento[]).find((x) => x.id === r.intervento_id);
        const m = mov(mat, mag, 'consumo', -riga.quantita, atLocal(r.data_lavoro, '17:00'), {
          prezzo_vendita_unitario: mat.prezzo_vendita, motivo: `Rapportino ${r.numero}`,
          rapportino_id: r.id, riga_rapportino_id: riga.id, intervento_id: i?.id ?? null, cliente_id: r.cliente_id,
          operaio_id: r.redatto_da, chiave_univoca: `consumo:${r.id}:${riga.id}`, created_by: r.redatto_da, updated_by: r.redatto_da,
        });
        chiavi[m.chiave_univoca!] = m.id;
      }
    }
    const fineMese = atLocal(addDays(primoPrec, 27), '16:00');
    const ptfe = catalogo.get('Nastro in PTFE')!.mat;
    mov(ptfe, centrale, 'rettifica', -3, fineMese, { motivo: 'Inventario di fine mese: 3 rotoli danneggiati' });
    const filtro = catalogo.get('Filtro deidratatore')!.mat;
    mov(filtro, centrale, 'carico', 10, atLocal(cambioPrezzo, '09:00'), { documento: 'DDT Frigoservice 412', motivo: 'Riordino (nuovo listino)' });
    const valvola = catalogo.get('Valvola a sfera 1/2"')!.mat;
    mov(valvola, centrale, 'scarico', -2, atLocal(addDays(oggi, -2), '10:00'), { motivo: 'Reso al fornitore: filettatura difettosa', documento: 'Reso 77' });
  }

  // --- scrittura atomica ------------------------------------------------------------
  const ops: BatchOp[] = [];
  const versioni: Record<string, number> = {};
  for (const [entita, rows] of Object.entries(out)) {
    for (const r of rows) {
      ops.push({ tipo: 'put', store: entita, value: r });
      versioni[`${entita}:${r.id}`] = 1;
    }
  }
  ops.push({
    tipo: 'put',
    store: 'mock_server',
    value: { id: 'stato', processate: {}, versioni, dati: {}, contatori: { [`rapportini-${annoCorr}`]: seqRap, [`rapportini-${prec.anno}`]: seqRap }, applicazioni: 0, chiavi } as unknown as { id: string },
  });
  ops.push({ tipo: 'put', store: 'meta', value: { id: 'seq_interventi', value: seqInt } as { id: string } });
  ops.push({ tipo: 'put', store: 'meta', value: { id: 'seed', value: { versione: VERSIONE_SEED, generato_il: nowIso, impronta: impronta(Object.keys(versioni).length) } } as { id: string } });
  await db.applyBatch(ops);
}
