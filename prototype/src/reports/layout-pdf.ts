/**
 * Layout dei PDF (definizione pdfmake) a partire dal modello già calcolato.
 * Funzione pura: nessun accesso ai dati, nessun calcolo di ore (solo formattazione).
 * A4 verticale, intestazione e piè di pagina su ogni pagina, numerazione "Pagina x di y",
 * tabelle con intestazione ripetuta e righe non spezzate tra pagine.
 */
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ETICHETTE_CATEGORIA, type AttivitaDoc, type Avviso, type CategoriaAttivita, type Intestazione, type RiepilogoGiornalieroDoc, type RiepilogoMensileDoc, type TotaliOre } from './modello';
import { dataBreve, dataLunga, giornoBreve, istante, meseAnno, NON_REGISTRATO, ora, oraRelativa, oreMinuti } from './formato';

const C = {
  primario: '#0f766e',
  primarioChiaro: '#e3f3f1',
  testo: '#15202b',
  secondario: '#4a5866',
  bordo: '#c9d2da',
  zebra: '#f6f8fa',
  weekend: '#eef1f4',
  avviso: '#b45309',
  avvisoChiaro: '#fdf1e1',
  errore: '#b91c1c',
  erroreChiaro: '#fdeaea',
  ok: '#15803d',
  okChiaro: '#e5f5ea',
};

// ---------------------------------------------------------------------------------------
// Mattoni comuni
// ---------------------------------------------------------------------------------------

function base(int: Intestazione, contenuto: Content[], provvisorio: boolean): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 82, 40, 56],
    info: {
      title: `${int.titolo} – ${int.operaio.nome}`,
      author: int.azienda.ragioneSociale,
      subject: int.idDocumento,
      creator: 'Gestionale Interventi',
    },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: C.testo, lineHeight: 1.15 },
    styles: {
      titolo: { fontSize: 17, bold: true, color: C.testo },
      sottotitolo: { fontSize: 11, color: C.secondario },
      sezione: { fontSize: 12, bold: true, color: C.primario, margin: [0, 14, 0, 6] },
      sottosezione: { fontSize: 10, bold: true, color: C.testo, margin: [0, 8, 0, 4] },
      th: { bold: true, fontSize: 8, color: C.secondario },
      piccolo: { fontSize: 7.5, color: C.secondario },
      totale: { bold: true, fontSize: 10 },
    },
    watermark: provvisorio ? { text: 'PROVVISORIO', color: C.errore, opacity: 0.06, bold: true, angle: -40 } : undefined,
    header: () => intestazionePagina(int),
    footer: (pagina, totale) => ({
      margin: [40, 16, 40, 0],
      columns: [
        { text: `${int.azienda.ragioneSociale} · ${int.titolo} · ${int.idDocumento} · generato il ${istante(int.generatoIl)}`, style: 'piccolo', width: '*' },
        { text: `Pagina ${pagina} di ${totale}`, style: 'piccolo', alignment: 'right', width: 80 },
      ],
    }),
    // Evita titoli di sezione isolati in fondo alla pagina.
    pageBreakBefore: (nodo, successivi) => nodo.headlineLevel === 1 && successivi.length === 0,
    content: contenuto,
  };
}

function intestazionePagina(int: Intestazione): Content {
  const logo: Content[] = int.azienda.logoSvg ? [{ svg: int.azienda.logoSvg, width: 26, height: 26 }] : [];
  return {
    margin: [40, 26, 40, 0],
    stack: [
      {
        columnGap: 8,
        columns: [
          ...logo,
          {
            width: '*',
            stack: [
              { text: int.azienda.ragioneSociale, bold: true, fontSize: 11 },
              { text: `${int.azienda.indirizzo} · P.IVA ${int.azienda.partitaIva}`, style: 'piccolo' },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: int.titolo, bold: true, fontSize: 9, color: C.primario },
              { text: `${int.operaio.nome} · Doc. ${int.idDocumento}`, style: 'piccolo' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: C.primario }] },
    ],
  };
}

function sezione(testo: string, opzioni: { nuovaPagina?: boolean } = {}): Content {
  return { text: testo, style: 'sezione', headlineLevel: 1, pageBreak: opzioni.nuovaPagina ? 'before' : undefined };
}

function th(testo: string, allinea: 'left' | 'right' | 'center' = 'left'): TableCell {
  return { text: testo.toUpperCase(), style: 'th', alignment: allinea };
}

function num(testo: string, extra: Record<string, unknown> = {}): TableCell {
  return { text: testo, alignment: 'right', ...extra } as TableCell;
}

/** Tabella con intestazione ripetuta a ogni pagina e righe mai spezzate. */
function tabella(widths: Array<string | number>, intestazioni: TableCell[], righe: TableCell[][], opzioni: { piede?: TableCell[]; righeEvidenziate?: (i: number) => string | null; righeIntestazione?: TableCell[][] } = {}): ContentTable {
  const pre = opzioni.righeIntestazione ?? [];
  const body = [...pre, intestazioni, ...righe, ...(opzioni.piede ? [opzioni.piede] : [])];
  const nIntest = pre.length + 1;
  return {
    table: { widths, headerRows: nIntest, dontBreakRows: true, keepWithHeaderRows: 1, body },
    layout: {
      hLineWidth: (i: number, nodo: { table: { body: unknown[] } }) => (i === 0 || i === nIntest || i === nodo.table.body.length ? 0.8 : 0.3),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i === nIntest ? C.primario : C.bordo),
      paddingTop: () => 3.5,
      paddingBottom: () => 3.5,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      fillColor: (i: number) => {
        if (i < pre.length) return C.primarioChiaro;
        if (i === pre.length) return '#f1f5f7';
        if (opzioni.piede && i === body.length - 1) return C.primarioChiaro;
        const ev = opzioni.righeEvidenziate?.(i - nIntest);
        if (ev) return ev;
        return (i - nIntest) % 2 === 1 ? C.zebra : null;
      },
    },
  };
}

function avvisi(lista: Avviso[]): Content[] {
  return lista.map((a) => ({
    table: {
      widths: ['*'],
      body: [[{ text: [{ text: a.livello === 'errore' ? 'ATTENZIONE  ' : a.livello === 'avviso' ? 'AVVISO  ' : 'NOTA  ', bold: true }, a.testo], color: a.livello === 'errore' ? C.errore : a.livello === 'avviso' ? C.avviso : C.secondario }]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 2.5 : 0),
      vLineColor: () => (a.livello === 'errore' ? C.errore : a.livello === 'avviso' ? C.avviso : C.bordo),
      fillColor: () => (a.livello === 'errore' ? C.erroreChiaro : a.livello === 'avviso' ? C.avvisoChiaro : C.zebra),
      paddingTop: () => 5,
      paddingBottom: () => 5,
      paddingLeft: () => 8,
    },
    margin: [0, 0, 0, 5],
  }));
}

function schedaInfo(righe: Array<[string, string]>): Content {
  return {
    table: { widths: [110, '*'], body: righe.map(([k, v]) => [{ text: k, color: C.secondario }, { text: v, bold: true }]) },
    layout: 'noBorders',
    margin: [0, 8, 0, 8],
  };
}

function tabellaTotali(t: TotaliOre, extra: Array<[string, string, boolean]> = []): Content {
  const righe: Array<[string, string, boolean]> = [
    ...extra,
    ['Presenza lorda', oreMinuti(t.lordaMs), false],
    ['Pause', oreMinuti(t.pauseMs), false],
    ['Ore nette lavorate', oreMinuti(t.nettaMs), true],
    ['Ore attribuite ai clienti', oreMinuti(t.clientiMs), false],
    ['Ore interne', oreMinuti(t.interneMs), false],
    ['Ore di trasferimento', oreMinuti(t.trasferimentiMs), false],
    ['Totale ore attribuite', oreMinuti(t.attribuiteMs), true],
    [`Ore non attribuite${t.daClassificareMs ? ` (di cui ${oreMinuti(t.daClassificareMs)} da classificare)` : ''}`, oreMinuti(t.nonAttribuiteMs), true],
  ];
  return {
    table: {
      widths: ['*', 90],
      body: righe.map(([k, v, forte]) => [
        { text: k, bold: forte, fontSize: forte ? 10 : 9 },
        { text: v, alignment: 'right', bold: forte, fontSize: forte ? 11 : 9.5, color: forte ? C.primario : C.testo },
      ]),
    },
    layout: {
      hLineWidth: (i: number, n: { table: { body: unknown[] } }) => (i === 0 || i === n.table.body.length ? 0.8 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => C.bordo,
      fillColor: (i: number) => (righe[i]?.[2] ? C.primarioChiaro : null),
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    },
  };
}

function righeAttivita(lista: AttivitaDoc[], giorno: string): TableCell[][] {
  return lista.map((a) => [
    { text: oraRelativa(a.inizio, giorno) },
    { text: oraRelativa(a.fine, giorno) },
    num(oreMinuti(a.durataMs), { bold: true }),
    { text: a.cliente || NON_REGISTRATO },
    { text: a.sede || NON_REGISTRATO },
    { text: a.intervento || NON_REGISTRATO },
    { stack: [{ text: [a.tipo, a.descrizione ? ` – ${a.descrizione}` : ''].join('') }, ...a.note.map((n) => ({ text: n, style: 'piccolo' }))] },
  ]);
}

function tabellaRichieste(lista: RiepilogoGiornalieroDoc['richiesteCorrezione'], conGiorno: boolean): ContentTable {
  return tabella(
    conGiorno ? [48, 70, '*', 60, 120] : [70, '*', 60, 140],
    [...(conGiorno ? [th('Giorno')] : []), th('Inviata il'), th('Richiesta'), th('Stato'), th('Risposta')],
    lista.map((r) => [
      ...(conGiorno ? [{ text: dataBreve(r.data) } as TableCell] : []),
      { text: istante(r.inviataIl) },
      { text: r.messaggio },
      { text: r.stato, bold: true, color: r.aperta ? C.avviso : C.testo },
      { text: r.gestitaIl ? `${r.risposta || NON_REGISTRATO} (${r.gestitaDa}, ${istante(r.gestitaIl)})` : NON_REGISTRATO },
    ]),
  );
}

const LEGENDA = '— = dato non registrato. Le durate sono in ore:minuti (HH:mm) e provengono dal motore di calcolo centrale: le pause e il tempo comune di attività sovrapposte non sono conteggiati due volte.';

// ---------------------------------------------------------------------------------------
// PDF giornaliero
// ---------------------------------------------------------------------------------------

const STATO_GIORNATA: Record<RiepilogoGiornalieroDoc['statoGiornata'], string> = {
  chiusa: 'Chiusa',
  in_corso: 'In corso (dati provvisori)',
  non_chiusa: 'Non chiusa – uscita mancante (dati incompleti)',
  assente: 'Nessuna presenza registrata',
};

export function layoutGiornaliero(d: RiepilogoGiornalieroDoc): TDocumentDefinitions {
  const avvisiTesta: Avviso[] = [];
  if (d.datiNonSincronizzati) avvisiTesta.push({ livello: 'avviso', testo: `Documento generato da dati non ancora sincronizzati con il server (${d.datiNonSincronizzati} elementi in attesa di conferma).` });
  if (d.statoGiornata === 'in_corso' && d.calcolatoFinoA) avvisiTesta.push({ livello: 'info', testo: `Giornata in corso: totali provvisori calcolati fino alle ${ora(d.calcolatoFinoA)}.` });
  if (d.statoGiornata === 'non_chiusa') avvisiTesta.push({ livello: 'errore', testo: 'Uscita non registrata: i totali della giornata non sono calcolabili e non vengono stimati.' });

  const contenuto: Content[] = [
    { text: d.intestazione.titolo, style: 'titolo' },
    { text: dataLunga(d.data), style: 'sottotitolo', margin: [0, 2, 0, 0] },
    schedaInfo([
      ['Operaio', `${d.intestazione.operaio.nome}${d.intestazione.operaio.qualifica ? ` – ${d.intestazione.operaio.qualifica}` : ''}`],
      ['Data', dataBreve(d.data)],
      ['Stato giornata', STATO_GIORNATA[d.statoGiornata]],
      ['Cartellino del mese', d.cartellinoMese.approvato ? `${d.cartellinoMese.etichetta}` : `${d.cartellinoMese.etichetta} (non approvato)`],
      ['Sincronizzazione', d.datiNonSincronizzati ? `${d.datiNonSincronizzati} elementi non ancora sincronizzati` : 'Tutti i dati risultano sincronizzati'],
      ['Identificativo', d.intestazione.idDocumento],
    ]),
    ...avvisi(avvisiTesta),

    { unbreakable: true, stack: [sezione('Presenze'), tabella(
      ['*', '*', '*', '*', '*'],
      [th('Entrata'), th('Uscita'), th('Presenza lorda', 'right'), th('Pause', 'right'), th('Ore nette', 'right')],
      d.presenze.map((p) => [
        { stack: [{ text: ora(p.entrata), bold: true }, ...(p.entrataOriginale ? [{ text: `registrata ${ora(p.entrataOriginale)}`, style: 'piccolo' }] : [])] },
        { stack: [{ text: p.uscita !== null ? oraRelativa(p.uscita, d.data) : p.stato === 'in_corso' ? 'in corso' : 'non registrata', bold: true, color: p.uscita === null && p.stato === 'non_chiusa' ? C.errore : C.testo }, ...(p.uscitaOriginale ? [{ text: `registrata ${ora(p.uscitaOriginale)}`, style: 'piccolo' }] : [])] },
        num(oreMinuti(p.lordaMs)),
        num(oreMinuti(p.pauseMs)),
        num(oreMinuti(p.nettaMs), { bold: true }),
      ]),
    )] },
  ];

  const pause = d.presenze.flatMap((p) => p.pause);
  if (pause.length) {
    contenuto.push({ unbreakable: pause.length <= 20, stack: [{ text: 'Pause', style: 'sottosezione' },
      tabella(
        ['*', '*', '*', '*'],
        [th('Tipo'), th('Inizio'), th('Fine'), th('Durata', 'right')],
        pause.map((x) => [{ text: x.tipo }, { text: ora(x.inizio) }, { text: x.fine !== null ? ora(x.fine) : 'non chiusa' }, num(oreMinuti(x.durataMs))]),
        { piede: [{ text: 'Totale pause conteggiate', bold: true, colSpan: 3 }, {}, {}, num(oreMinuti(d.totali?.pauseMs ?? null), { bold: true })] },
      )] });
  } else {
    contenuto.push({ text: 'Pause', style: 'sottosezione' }, { text: 'Nessuna pausa registrata.', color: C.secondario });
  }

  contenuto.push(sezione('Dettaglio attività'));
  const categorie: CategoriaAttivita[] = ['cliente', 'interna', 'trasferimento', 'non_attribuita'];
  let qualcosa = false;
  for (const cat of categorie) {
    const lista = d.attivita.filter((a) => a.categoria === cat);
    const scoperti = cat === 'non_attribuita' ? d.intervalliScoperti : [];
    if (!lista.length && !scoperti.length) continue;
    qualcosa = true;
    const righe = righeAttivita(lista, d.data);
    for (const s of scoperti) {
      righe.push([{ text: ora(s.inizio) }, { text: ora(s.fine) }, num(oreMinuti(s.fine - s.inizio), { bold: true }), { text: NON_REGISTRATO }, { text: NON_REGISTRATO }, { text: NON_REGISTRATO }, { text: 'Tempo di presenza senza attività registrata', italics: true }]);
    }
    contenuto.push({
      // Tabelle brevi non si spezzano; quelle lunghe ripetono l'intestazione su ogni pagina.
      unbreakable: righe.length <= 12,
      stack: [
        { text: ETICHETTE_CATEGORIA[cat], style: 'sottosezione' },
        tabella([34, 34, 36, 78, 70, 76, '*'], [th('Inizio'), th('Fine'), th('Durata', 'right'), th('Cliente'), th('Sede'), th('Intervento'), th('Tipologia e descrizione')], righe),
      ],
    });
  }
  if (!qualcosa) contenuto.push({ text: 'Nessuna attività registrata.', color: C.secondario });

  if (d.totali) {
    contenuto.push({ unbreakable: true, stack: [sezione('Totali della giornata'), { columns: [{ width: 300, stack: [tabellaTotali(d.totali)] }, { width: '*', text: '' }] }] });
  } else {
    contenuto.push(sezione('Totali della giornata'), ...avvisi([{ livello: 'errore', testo: 'Totali non calcolabili: manca l\'uscita di almeno una presenza. Nessun valore è stato stimato o sostituito con zero.' }]));
  }

  contenuto.push(sezione('Rapportini della giornata'));
  if (d.rapportini.length) {
    contenuto.push(
      tabella(
        [58, 90, 90, '*', 62],
        [th('Rapportino'), th('Cliente'), th('Intervento'), th('Descrizione'), th('Esito')],
        d.rapportini.map((r) => [{ stack: [{ text: r.numero, bold: true }, ...(r.definitivo ? [] : [{ text: 'numero provvisorio', style: 'piccolo' }])] }, { text: r.cliente }, { text: r.intervento }, { text: r.descrizione }, { text: r.esito }]),
      ),
    );
  } else {
    contenuto.push({ text: 'Nessun rapportino registrato in questa giornata.', color: C.secondario });
  }
  if (d.bozzeEscluse) contenuto.push({ text: `${d.bozzeEscluse} bozze di rapportino non completate non sono incluse.`, style: 'piccolo', margin: [0, 4, 0, 0] });

  contenuto.push(sezione('Anomalie, correzioni e note'));
  if (!d.anomalie.length && !d.correzioni.length && !d.note.length) contenuto.push({ text: 'Nessuna anomalia, correzione o nota.', color: C.secondario });
  contenuto.push(...avvisi(d.anomalie));
  if (d.correzioni.length) {
    contenuto.push(tabella([70, '*', 150], [th('Registrata il'), th('Correzione'), th('Motivo')], d.correzioni.map((c) => [{ text: istante(c.quando) }, { text: c.descrizione }, { text: c.motivo }])));
  }
  if (d.richiesteCorrezione.length) {
    contenuto.push({ text: 'Richieste di correzione', style: 'sottosezione' }, tabellaRichieste(d.richiesteCorrezione, false));
  }
  for (const n of d.note) contenuto.push({ text: `Nota: ${n}`, margin: [0, 4, 0, 0] });

  contenuto.push({
    unbreakable: true,
    stack: [
      sezione('Chiusura del documento'),
      schedaInfo([
        ['Generato il', istante(d.intestazione.generatoIl)],
        ['Generato da', d.intestazione.generatoDa],
        ['Stato della giornata', STATO_GIORNATA[d.statoGiornata]],
        ['Stato dei dati', d.datiNonSincronizzati ? `${d.datiNonSincronizzati} elementi non ancora sincronizzati` : 'Tutti i dati risultano sincronizzati'],
      ]),
      {
        columns: [
          { width: '*', stack: [{ text: 'Firma dell\'operaio', style: 'piccolo' }, { canvas: [{ type: 'line', x1: 0, y1: 34, x2: 220, y2: 34, lineWidth: 0.6, lineColor: C.secondario }] }] },
          { width: '*', text: 'Riepilogo informativo della giornata. Non sostituisce il cartellino mensile, che ha valore solo dopo la conferma dell\'operaio e l\'approvazione dell\'amministrazione registrate nel sistema.', style: 'piccolo' },
        ],
        columnGap: 24,
        margin: [0, 10, 0, 0],
      },
      { text: LEGENDA, style: 'piccolo', margin: [0, 14, 0, 0] },
    ],
  });

  return base(d.intestazione, contenuto, d.statoGiornata !== 'chiusa');
}

// ---------------------------------------------------------------------------------------
// PDF mensile
// ---------------------------------------------------------------------------------------

export function layoutMensile(d: RiepilogoMensileDoc): TDocumentDefinitions {
  const t = d.totali;
  const cart = d.cartellino;
  // Funzione (non oggetto condiviso): pdfmake modifica i nodi durante l'impaginazione,
  // quindi lo stesso riquadro usato due volte deve essere creato due volte.
  const boxStato = (): Content => ({
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: cart.approvato && !d.provvisorio ? 'CARTELLINO APPROVATO' : 'DOCUMENTO PROVVISORIO – NON APPROVATO', bold: true, fontSize: 12, color: cart.approvato && !d.provvisorio ? C.ok : C.errore },
          { text: `Stato del cartellino: ${cart.etichetta}${cart.versioneCorrente ? ` · versione ${cart.versioneCorrente}` : ' · non ancora generato'}`, margin: [0, 3, 0, 0] },
          cart.approvato
            ? { text: `Approvato il ${cart.approvatoIl ? istante(cart.approvatoIl) : NON_REGISTRATO} da ${cart.approvatoDa ?? NON_REGISTRATO} (versione ${cart.versioneApprovata})`, margin: [0, 2, 0, 0] }
            : { text: 'L\'esportazione del PDF non equivale all\'approvazione: il documento ha valore solo dopo la conferma dell\'operaio e l\'approvazione dell\'amministrazione registrate nel sistema.', style: 'piccolo', margin: [0, 2, 0, 0] },
        ],
      }]],
    },
    layout: {
      hLineWidth: () => 1.2,
      vLineWidth: () => 1.2,
      hLineColor: () => (cart.approvato && !d.provvisorio ? C.ok : C.errore),
      vLineColor: () => (cart.approvato && !d.provvisorio ? C.ok : C.errore),
      fillColor: () => (cart.approvato && !d.provvisorio ? C.okChiaro : C.erroreChiaro),
      paddingTop: () => 8,
      paddingBottom: () => 8,
      paddingLeft: () => 10,
    },
    margin: [0, 4, 0, 10],
  });

  const avvisiTesta = [...d.anomalie];
  if (d.datiNonSincronizzati) avvisiTesta.unshift({ livello: 'avviso', testo: `Documento generato da dati non ancora sincronizzati con il server (${d.datiNonSincronizzati} elementi in attesa di conferma).` });

  const contenuto: Content[] = [
    { text: d.intestazione.titolo, style: 'titolo' },
    { text: meseAnno(d.anno, d.mese), style: 'sottotitolo', margin: [0, 2, 0, 0] },
    schedaInfo([
      ['Operaio', `${d.intestazione.operaio.nome}${d.intestazione.operaio.qualifica ? ` – ${d.intestazione.operaio.qualifica}` : ''}`],
      ['Periodo', `${meseAnno(d.anno, d.mese)} (01/${String(d.mese).padStart(2, '0')}/${d.anno} – ${dataBreve(d.giorni[d.giorni.length - 1].data)})`],
      ['Generato il', `${istante(d.intestazione.generatoIl)} da ${d.intestazione.generatoDa}`],
      ['Identificativo', d.intestazione.idDocumento],
    ]),
    boxStato(),
    ...avvisi(avvisiTesta),
    sezione('Riepilogo complessivo del mese'),
    {
      columns: [
        {
          width: 210,
          table: {
            widths: ['*', 50],
            body: [
              [{ text: 'Giorni lavorati', bold: true }, num(String(t.giorniLavorati), { bold: true, fontSize: 11, color: C.primario })],
              [{ text: 'Giorni senza presenza' }, num(String(t.giorniSenzaPresenza))],
              [{ text: 'di cui feriali (lun–ven)', color: C.secondario, margin: [10, 0, 0, 0] }, num(String(t.giorniFerialiSenzaPresenza))],
              [{ text: 'Giornate con uscita mancante', color: t.giorniIncompleti ? C.errore : C.testo }, num(String(t.giorniIncompleti), { color: t.giorniIncompleti ? C.errore : C.testo })],
              [{ text: 'Clienti serviti' }, num(String(d.perCliente.length))],
              [{ text: 'Correzioni registrate' }, num(String(d.correzioni.length))],
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { width: '*', stack: [tabellaTotali(t)] },
      ],
      columnGap: 20,
    },
    { text: d.quadratura ? 'Quadratura verificata: ore clienti + interne + trasferimenti = ore attribuite; attribuite + non attribuite = ore nette; nette + pause = presenza lorda.' : 'ATTENZIONE: quadratura dei totali non verificata.', style: 'piccolo', margin: [0, 8, 0, 0], color: d.quadratura ? C.secondario : C.errore },
    { text: 'Le ore di presenza (nette) indicano il tempo al lavoro; le ore attribuite indicano quanta parte di quel tempo è stata assegnata a clienti, attività interne o trasferimenti. Le giornate con uscita mancante sono escluse dai totali.', style: 'piccolo', margin: [0, 4, 0, 0] },

    sezione('Tabella giornaliera', { nuovaPagina: true }),
    tabella(
      [64, 46, 52, 44, 54, 60, '*'],
      [th('Data'), th('Entrata'), th('Uscita'), th('Pause', 'right'), th('Ore nette', 'right'), th('Ore attribuite', 'right'), th('Stato')],
      d.giorni.map((g) => [
        { text: `${giornoBreve(g.data)}/${g.data.slice(5, 7)}`, bold: g.lavorato },
        { text: ora(g.entrata) },
        { text: g.uscita !== null ? oraRelativa(g.uscita, g.data) : g.lavorato ? (g.incompleto ? 'mancante' : 'in corso') : NON_REGISTRATO, color: g.incompleto ? C.errore : undefined },
        num(oreMinuti(g.pauseMs)),
        num(oreMinuti(g.nettaMs), { bold: true }),
        num(oreMinuti(g.attribuiteMs)),
        { stack: [{ text: g.stato, color: g.incompleto ? C.errore : g.stato === 'Da verificare' ? C.avviso : undefined }, ...(g.anomalie.length ? [{ text: g.anomalie.join(' · '), style: 'piccolo' }] : []), ...(g.correzioni ? [{ text: `${g.correzioni} correzioni`, style: 'piccolo' }] : [])] },
      ]),
      {
        piede: [{ text: `Totale (${t.giorniLavorati} giorni lavorati)`, bold: true, colSpan: 3 }, {}, {}, num(oreMinuti(t.pauseMs), { bold: true }), num(oreMinuti(t.nettaMs), { bold: true }), num(oreMinuti(t.attribuiteMs), { bold: true }), { text: '' }],
        righeEvidenziate: (i) => (d.giorni[i] && !d.giorni[i].lavorato && d.giorni[i].weekend ? C.weekend : null),
      },
    ),
    { text: LEGENDA, style: 'piccolo', margin: [0, 6, 0, 0] },

    sezione('Dettaglio attività per giorno', { nuovaPagina: true }),
  ];

  if (!d.attivitaPerGiorno.length) contenuto.push({ text: 'Nessuna attività registrata nel mese.', color: C.secondario });
  for (const g of d.attivitaPerGiorno) {
    const righe: TableCell[][] = g.attivita.map((a) => [
      { text: `${oraRelativa(a.inizio, g.data)}–${oraRelativa(a.fine, g.data)}` },
      { stack: [{ text: a.cliente || ETICHETTE_CATEGORIA[a.categoria] }, { text: a.tipo, style: 'piccolo' }] },
      { text: a.intervento || NON_REGISTRATO },
      { stack: [{ text: a.descrizione || NON_REGISTRATO }, ...a.note.map((n) => ({ text: n, style: 'piccolo' }))] },
      num(oreMinuti(a.durataMs), { bold: true }),
    ]);
    if (!righe.length) righe.push([{ text: 'Nessuna attività registrata', colSpan: 5, color: C.secondario }, {}, {}, {}, {}]);
    contenuto.push({
      ...tabella([62, 110, 110, '*', 44], [th('Orario'), th('Cliente / attività'), th('Intervento'), th('Descrizione'), th('Durata', 'right')], righe, {
        righeIntestazione: [[{ text: dataLunga(g.data), bold: true, colSpan: 5, color: C.primario }, {}, {}, {}, {}]],
      }),
      margin: [0, 0, 0, 8],
    });
  }

  contenuto.push(
    sezione('Riepilogo per cliente', { nuovaPagina: true }),
    d.perCliente.length
      ? tabella(
          ['*', 60, 60, 60, 60, 50],
          [th('Cliente'), th('Giornate', 'right'), th('Lavoro', 'right'), th('Trasferimenti', 'right'), th('Totale', 'right'), th('Interventi', 'right')],
          d.perCliente.map((c) => [{ text: c.cliente, bold: true }, num(String(c.giornate)), num(oreMinuti(c.lavoroMs)), num(oreMinuti(c.trasferimentoMs)), num(oreMinuti(c.totaleMs), { bold: true }), num(String(c.interventi))]),
          { piede: [{ text: 'Totale clienti', bold: true }, num(''), num(oreMinuti(d.perCliente.reduce((n, c) => n + c.lavoroMs, 0)), { bold: true }), num(oreMinuti(d.perCliente.reduce((n, c) => n + c.trasferimentoMs, 0)), { bold: true }), num(oreMinuti(d.perCliente.reduce((n, c) => n + c.totaleMs, 0)), { bold: true }), num('')] },
        )
      : { text: 'Nessuna ora attribuita a clienti nel mese.', color: C.secondario },
    { text: 'Attività interne', style: 'sottosezione' },
    d.perInterna.length
      ? tabella(['*', 70, 80], [th('Attività'), th('Giornate', 'right'), th('Ore', 'right')], d.perInterna.map((x) => [{ text: x.attivita }, num(String(x.giornate)), num(oreMinuti(x.ms), { bold: true })]), {
          piede: [{ text: 'Totale ore interne', bold: true }, num(''), num(oreMinuti(t.interneMs), { bold: true })],
        })
      : { text: 'Nessuna attività interna nel mese.', color: C.secondario },
    { text: 'Richieste di correzione del mese', style: 'sottosezione' },
    d.richiesteCorrezione.length ? tabellaRichieste(d.richiesteCorrezione, true) : { text: 'Nessuna richiesta di correzione nel mese.', color: C.secondario },
    { text: 'Correzioni del mese', style: 'sottosezione' },
    d.correzioni.length
      ? tabella([52, 70, '*', 140], [th('Giorno'), th('Registrata il'), th('Correzione'), th('Motivo')], d.correzioni.map((c) => [{ text: dataBreve(c.data) }, { text: istante(c.quando) }, { text: c.descrizione }, { text: c.motivo }]))
      : { text: 'Nessuna correzione registrata nel mese.', color: C.secondario },
  );

  contenuto.push({
    unbreakable: true,
    stack: [
      sezione('Stato del cartellino e approvazione'),
      boxStato(),
      cart.storico.length
        ? tabella([84, 110, 100, 30, '*'], [th('Quando'), th('Operazione'), th('Utente'), th('Vers.', 'right'), th('Motivazione')], cart.storico.map((s) => [{ text: istante(s.quando) }, { text: s.azione }, { text: s.utente }, num(String(s.versione)), { text: s.motivazione || NON_REGISTRATO }]))
        : { text: 'Il cartellino del mese non è ancora stato generato: nessuna conferma né approvazione registrata.', color: C.secondario },
      {
        columns: [
          { width: '*', stack: [{ text: 'Firma dell\'operaio', style: 'piccolo' }, { canvas: [{ type: 'line', x1: 0, y1: 30, x2: 220, y2: 30, lineWidth: 0.6, lineColor: C.secondario }] }] },
          { width: '*', stack: [{ text: 'Firma dell\'amministrazione', style: 'piccolo' }, { canvas: [{ type: 'line', x1: 0, y1: 30, x2: 220, y2: 30, lineWidth: 0.6, lineColor: C.secondario }] }] },
        ],
        columnGap: 24,
        margin: [0, 16, 0, 0],
      },
    ],
  });

  return base(d.intestazione, contenuto, d.provvisorio);
}
