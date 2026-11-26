/**
 * Magazzino, materiali e costi (Fase 5). Specifica in docs/15-magazzino-materiali-costi.md.
 *
 * - Anagrafica materiali e magazzini: modifiche normali (sincronizzate con controllo di versione).
 * - Movimenti: registro in SOLA AGGIUNTA. Carichi, scarichi, rettifiche, trasferimenti e consumi
 *   creano sempre nuovi movimenti; nessun movimento viene modificato o cancellato.
 * - Consumi da rapportino: generati al completamento del rapportino (stessa transazione locale),
 *   uno per riga, con chiave univoca `consumo:<rapportino>:<riga>`; la quantità già scaricata
 *   viene sempre ricalcolata dai movimenti, quindi ripetere l'operazione non scarica due volte.
 */
import type { UnitOfWork } from '../data/local-db';
import { uuid } from '../domain/ids';
import {
  calcolaGiacenze,
  giacenza,
  isConsumo,
  movimentoValido,
  q3,
  riepilogaConsumi,
  type RiepilogoConsumi,
} from '../domain/magazzino';
import { localDate } from '../domain/time';
import type { Magazzino, MaterialeRapportino, Materiale, MovimentoMagazzino, MovimentoTipo, Rapportino } from '../domain/types';
import { nuovoBase, richiediAdmin, richiediUtente, type ServiceContext } from './base';
import { AppError, nonTrovato } from './errors';

export const ETICHETTE_MOVIMENTO: Record<MovimentoTipo, string> = {
  carico: 'Carico',
  scarico: 'Scarico',
  rettifica: 'Rettifica inventario',
  trasferimento: 'Trasferimento',
  consumo: 'Consumo da rapportino',
  correzione_consumo: 'Correzione consumo',
};

export const UNITA_MISURA = ['pz', 'm', 'kg', 'l', 'conf', 'h'];

export type DatiMateriale = Pick<
  Materiale,
  'codice' | 'nome' | 'descrizione' | 'categoria' | 'unita' | 'prezzo_acquisto' | 'prezzo_vendita' | 'fornitore' | 'scorta_minima' | 'attivo'
>;

interface DatiMovimento {
  materiale_id: string;
  magazzino_id: string;
  quantita: number;
  motivo?: string;
  documento?: string;
}

export interface Disponibilita {
  rigaId: string;
  materiale: Materiale;
  magazzinoId: string;
  richiesta: number;
  disponibile: number;
}

export interface ConsumoRiga {
  /** Quantità netta scaricata (consumo ± correzioni). */
  quantita: number;
  costo: number;
  movimenti: MovimentoMagazzino[];
}

export class MagazzinoService {
  constructor(private readonly ctx: ServiceContext) {}

  private get db() {
    return this.ctx.db;
  }

  // --- letture -----------------------------------------------------------------------
  materiali(filtro: { testo?: string; categoria?: string; soloAttivi?: boolean } = {}): Materiale[] {
    const t = filtro.testo?.trim().toLowerCase();
    return this.db
      .where(
        'materiali',
        (m) =>
          (!filtro.soloAttivi || m.attivo) &&
          (!filtro.categoria || m.categoria === filtro.categoria) &&
          (!t || `${m.codice} ${m.nome} ${m.descrizione} ${m.fornitore}`.toLowerCase().includes(t)),
      )
      .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));
  }

  categorie(): string[] {
    return [...new Set(this.db.all('materiali').map((m) => m.categoria).filter(Boolean))].sort();
  }

  magazzini(soloAttivi = false): Magazzino[] {
    return this.db.where('magazzini', (m) => !soloAttivi || m.attivo).sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === 'sede' ? -1 : 1));
  }

  /** Magazzino proposto per i consumi di un operaio: il suo furgone, altrimenti la sede. */
  magazzinoPredefinito(operaioId: string | null): Magazzino | undefined {
    const attivi = this.magazzini(true);
    return attivi.find((m) => m.responsabile_id && m.responsabile_id === operaioId) ?? attivi.find((m) => m.tipo === 'sede') ?? attivi[0];
  }

  movimenti(filtro: { materialeId?: string; magazzinoId?: string; tipo?: MovimentoTipo; da?: string; a?: string; rapportinoId?: string; interventoId?: string } = {}): MovimentoMagazzino[] {
    return this.db
      .where(
        'movimenti_magazzino',
        (m) =>
          (!filtro.materialeId || m.materiale_id === filtro.materialeId) &&
          (!filtro.magazzinoId || m.magazzino_id === filtro.magazzinoId) &&
          (!filtro.tipo || m.tipo === filtro.tipo) &&
          (!filtro.da || m.data_riferimento >= filtro.da) &&
          (!filtro.a || m.data_riferimento <= filtro.a) &&
          (!filtro.rapportinoId || m.rapportino_id === filtro.rapportinoId) &&
          (!filtro.interventoId || m.intervento_id === filtro.interventoId),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }

  giacenza(materialeId: string, magazzinoId?: string | null): number {
    return giacenza(this.db.all('movimenti_magazzino'), materialeId, magazzinoId);
  }

  giacenze(filtro: { testo?: string; categoria?: string; soloAttivi?: boolean } = {}) {
    return calcolaGiacenze(this.materiali(filtro), this.db.all('movimenti_magazzino'));
  }

  sottoScorta() {
    return this.giacenze({ soloAttivi: true }).filter((g) => g.sottoScorta);
  }

  // --- anagrafica --------------------------------------------------------------------
  async salvaMateriale(dati: DatiMateriale, id?: string, motivo = ''): Promise<Materiale> {
    const admin = richiediAdmin(this.ctx);
    const codice = dati.codice.trim().toUpperCase();
    const nome = dati.nome.trim();
    if (!codice) throw new AppError('VALIDAZIONE', 'Indica il codice del materiale.');
    if (!nome) throw new AppError('VALIDAZIONE', 'Indica il nome del materiale.');
    if (!dati.unita.trim()) throw new AppError('VALIDAZIONE', "Indica l'unità di misura.");
    if (!(dati.prezzo_acquisto >= 0)) throw new AppError('VALIDAZIONE', 'Il prezzo di acquisto non può essere negativo.');
    if (dati.prezzo_vendita != null && !(dati.prezzo_vendita >= 0)) throw new AppError('VALIDAZIONE', 'Il prezzo di vendita non può essere negativo.');
    if (!(dati.scorta_minima >= 0)) throw new AppError('VALIDAZIONE', 'La scorta minima non può essere negativa.');
    if (this.db.all('materiali').some((m) => m.id !== id && m.codice.toUpperCase() === codice)) {
      throw new AppError('VALIDAZIONE', `Il codice ${codice} è già usato da un altro materiale.`);
    }
    const prima = id ? this.db.get('materiali', id) : undefined;
    if (id && !prima) throw nonTrovato('Materiale');
    if (prima && prima.unita !== dati.unita && this.db.where('movimenti_magazzino', (m) => m.materiale_id === id).length > 0) {
      throw new AppError('VALIDAZIONE', "L'unità di misura non si può cambiare dopo i primi movimenti: crea un nuovo articolo.");
    }
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save(
      'materiali',
      {
        ...(prima ?? nuovoBase(this.ctx, uuid())),
        ...dati,
        codice,
        nome,
        descrizione: dati.descrizione.trim(),
        categoria: dati.categoria.trim(),
        fornitore: dati.fornitore.trim(),
        prezzo_acquisto: Math.round(dati.prezzo_acquisto * 10000) / 10000,
        prezzo_vendita: dati.prezzo_vendita == null ? null : Math.round(dati.prezzo_vendita * 10000) / 10000,
      },
      {
        motivo:
          motivo ||
          (prima && prima.prezzo_acquisto !== dati.prezzo_acquisto
            ? `Prezzo di acquisto ${prima.prezzo_acquisto} → ${dati.prezzo_acquisto} (vale per i movimenti futuri)`
            : ''),
      },
    );
    await uow.commit();
    return saved;
  }

  async salvaMagazzino(dati: Pick<Magazzino, 'codice' | 'nome' | 'tipo' | 'responsabile_id' | 'attivo'>, id?: string): Promise<Magazzino> {
    const admin = richiediAdmin(this.ctx);
    const codice = dati.codice.trim().toUpperCase();
    if (!codice || !dati.nome.trim()) throw new AppError('VALIDAZIONE', 'Indica codice e nome del magazzino.');
    if (this.db.all('magazzini').some((m) => m.id !== id && m.codice.toUpperCase() === codice)) throw new AppError('VALIDAZIONE', `Il codice ${codice} è già usato.`);
    const prima = id ? this.db.get('magazzini', id) : undefined;
    if (id && !prima) throw nonTrovato('Magazzino');
    const uow = this.db.unitOfWork(admin.id);
    const saved = uow.save('magazzini', { ...(prima ?? nuovoBase(this.ctx, uuid())), ...dati, codice, nome: dati.nome.trim() });
    await uow.commit();
    return saved;
  }

  // --- movimenti manuali (amministrazione) ------------------------------------------
  private materialeEMagazzino(materialeId: string, magazzinoId: string) {
    const mat = this.db.get('materiali', materialeId);
    if (!mat) throw nonTrovato('Materiale');
    const mag = this.db.get('magazzini', magazzinoId);
    if (!mag) throw nonTrovato('Magazzino');
    return { mat, mag };
  }

  private nuovoMovimento(mat: Materiale, magazzinoId: string, tipo: MovimentoTipo, quantita: number, extra: Partial<MovimentoMagazzino> = {}): MovimentoMagazzino {
    if (!Number.isFinite(quantita) || q3(quantita) === 0) throw new AppError('VALIDAZIONE', 'La quantità deve essere diversa da zero.');
    return {
      ...nuovoBase(this.ctx, uuid()),
      materiale_id: mat.id,
      magazzino_id: magazzinoId,
      tipo,
      quantita: q3(quantita),
      costo_unitario: mat.prezzo_acquisto,
      prezzo_vendita_unitario: null,
      data_riferimento: localDate(this.db.now()),
      motivo: '',
      documento: '',
      rapportino_id: null,
      riga_rapportino_id: null,
      intervento_id: null,
      cliente_id: null,
      operaio_id: null,
      corregge_id: null,
      trasferimento_id: null,
      chiave_univoca: null,
      duplicato_di: null,
      giacenza_insufficiente: false,
      ...extra,
    };
  }

  private quantitaPositiva(q: number) {
    if (!Number.isFinite(q) || q <= 0) throw new AppError('VALIDAZIONE', 'Indica una quantità maggiore di zero.');
  }

  async registraCarico(d: DatiMovimento & { costo_unitario?: number; aggiornaPrezzo?: boolean }): Promise<MovimentoMagazzino> {
    const admin = richiediAdmin(this.ctx);
    const { mat } = this.materialeEMagazzino(d.materiale_id, d.magazzino_id);
    this.quantitaPositiva(d.quantita);
    const costo = d.costo_unitario ?? mat.prezzo_acquisto;
    if (!(costo >= 0)) throw new AppError('VALIDAZIONE', 'Il costo unitario non può essere negativo.');
    const uow = this.db.unitOfWork(admin.id);
    const m = uow.save('movimenti_magazzino', this.nuovoMovimento(mat, d.magazzino_id, 'carico', d.quantita, { costo_unitario: costo, documento: d.documento?.trim() ?? '', motivo: d.motivo?.trim() ?? '' }));
    if (d.aggiornaPrezzo && costo !== mat.prezzo_acquisto) {
      uow.save('materiali', { ...mat, prezzo_acquisto: costo }, { motivo: `Prezzo di acquisto aggiornato dal carico ${d.documento ?? ''} (${mat.prezzo_acquisto} → ${costo}); i costi storici non cambiano` });
    }
    await uow.commit();
    return m;
  }

  async registraScarico(d: DatiMovimento): Promise<MovimentoMagazzino> {
    const admin = richiediAdmin(this.ctx);
    const { mat } = this.materialeEMagazzino(d.materiale_id, d.magazzino_id);
    this.quantitaPositiva(d.quantita);
    if (!d.motivo || d.motivo.trim().length < 5) throw new AppError('VALIDAZIONE', 'Indica il motivo dello scarico (es. reso al fornitore, materiale danneggiato).');
    const disp = this.giacenza(mat.id, d.magazzino_id);
    if (d.quantita > disp) throw new AppError('VALIDAZIONE', `Giacenza insufficiente: disponibili ${disp} ${mat.unita}. Se il conteggio è diverso usa una rettifica.`);
    const uow = this.db.unitOfWork(admin.id);
    const m = uow.save('movimenti_magazzino', this.nuovoMovimento(mat, d.magazzino_id, 'scarico', -d.quantita, { motivo: d.motivo.trim(), documento: d.documento?.trim() ?? '' }));
    await uow.commit();
    return m;
  }

  /** Rettifica inventariale: si indica la quantità contata, il movimento registra la differenza. */
  async rettifica(d: { materiale_id: string; magazzino_id: string; giacenzaContata: number; motivo: string }): Promise<MovimentoMagazzino> {
    const admin = richiediAdmin(this.ctx);
    const { mat } = this.materialeEMagazzino(d.materiale_id, d.magazzino_id);
    if (!Number.isFinite(d.giacenzaContata) || d.giacenzaContata < 0) throw new AppError('VALIDAZIONE', 'La quantità contata non può essere negativa.');
    if (d.motivo.trim().length < 5) throw new AppError('VALIDAZIONE', 'La rettifica richiede una motivazione (es. inventario del…, materiale danneggiato).');
    const delta = q3(d.giacenzaContata - this.giacenza(mat.id, d.magazzino_id));
    if (delta === 0) throw new AppError('VALIDAZIONE', 'La quantità contata coincide con la giacenza: nessuna rettifica necessaria.');
    const uow = this.db.unitOfWork(admin.id);
    const m = uow.save('movimenti_magazzino', this.nuovoMovimento(mat, d.magazzino_id, 'rettifica', delta, { motivo: d.motivo.trim() }), { motivo: d.motivo.trim() });
    await uow.commit();
    return m;
  }

  async trasferisci(d: { materiale_id: string; da_magazzino_id: string; a_magazzino_id: string; quantita: number; motivo?: string }): Promise<MovimentoMagazzino[]> {
    const admin = richiediAdmin(this.ctx);
    const { mat } = this.materialeEMagazzino(d.materiale_id, d.da_magazzino_id);
    this.materialeEMagazzino(d.materiale_id, d.a_magazzino_id);
    if (d.da_magazzino_id === d.a_magazzino_id) throw new AppError('VALIDAZIONE', 'Scegli due magazzini diversi.');
    this.quantitaPositiva(d.quantita);
    const disp = this.giacenza(mat.id, d.da_magazzino_id);
    if (d.quantita > disp) throw new AppError('VALIDAZIONE', `Giacenza insufficiente nel magazzino di partenza: disponibili ${disp} ${mat.unita}.`);
    const trasferimento_id = uuid();
    const motivo = d.motivo?.trim() ?? '';
    const uow = this.db.unitOfWork(admin.id);
    const out = [
      uow.save('movimenti_magazzino', this.nuovoMovimento(mat, d.da_magazzino_id, 'trasferimento', -d.quantita, { trasferimento_id, motivo })),
      uow.save('movimenti_magazzino', this.nuovoMovimento(mat, d.a_magazzino_id, 'trasferimento', d.quantita, { trasferimento_id, motivo })),
    ];
    await uow.commit();
    return out;
  }

  // --- materiali dei rapportini --------------------------------------------------------
  /** Righe con articolo di anagrafica la cui quantità supera la giacenza del magazzino scelto. */
  verificaDisponibilita(r: Pick<Rapportino, 'id' | 'materiali' | 'redatto_da'>): Disponibilita[] {
    const out: Disponibilita[] = [];
    const usato = new Map<string, number>();
    for (const riga of r.materiali) {
      if (!riga.materiale_id || !(riga.quantita > 0)) continue;
      const mat = this.db.get('materiali', riga.materiale_id);
      const magId = riga.magazzino_id ?? this.magazzinoPredefinito(r.redatto_da)?.id;
      if (!mat || !magId) continue;
      const k = `${mat.id}:${magId}`;
      const giaScaricato = this.consumoRiga(r.id, riga.id).quantita;
      const richiesta = q3((usato.get(k) ?? 0) + riga.quantita - giaScaricato);
      usato.set(k, richiesta);
      const disponibile = this.giacenza(mat.id, magId);
      if (richiesta > disponibile) out.push({ rigaId: riga.id, materiale: mat, magazzinoId: magId, richiesta, disponibile });
    }
    return out;
  }

  consumoRiga(rapportinoId: string, rigaId: string): ConsumoRiga {
    const movimenti = this.db
      .where('movimenti_magazzino', (m) => m.rapportino_id === rapportinoId && m.riga_rapportino_id === rigaId && isConsumo(m))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const validi = movimenti.filter(movimentoValido);
    return {
      quantita: q3(-validi.reduce((a, m) => a + m.quantita, 0)),
      costo: Math.round(-validi.reduce((a, m) => a + m.quantita * m.costo_unitario, 0) * 100) / 100,
      movimenti,
    };
  }

  /**
   * Aggiunge alla unit of work gli scarichi dovuti per le righe del rapportino. Idempotente:
   * scarica solo la differenza fra la quantità indicata e quanto già scaricato per la riga.
   */
  pianificaConsumi(uow: UnitOfWork, r: Rapportino): MovimentoMagazzino[] {
    const creati: MovimentoMagazzino[] = [];
    const usato = new Map<string, number>();
    // Fase 13: righe tolte durante una correzione tracciata → quantità 0 (lo scarico viene stornato).
    const presenti = new Set(r.materiali.map((m) => m.id));
    const tolte = new Map<string, MaterialeRapportino>();
    for (const m of this.db.where('movimenti_magazzino', (x) => x.rapportino_id === r.id && !!x.riga_rapportino_id && !presenti.has(x.riga_rapportino_id) && isConsumo(x))) {
      if (!tolte.has(m.riga_rapportino_id!)) tolte.set(m.riga_rapportino_id!, { id: m.riga_rapportino_id!, descrizione: '', quantita: 0, unita: '', materiale_id: m.materiale_id, magazzino_id: m.magazzino_id });
    }
    for (const riga of [...r.materiali, ...tolte.values()]) {
      if (!riga.materiale_id) continue;
      if (!(riga.quantita > 0) && this.consumoRiga(r.id, riga.id).quantita === 0) continue;
      const mat = this.db.get('materiali', riga.materiale_id);
      if (!mat) throw new AppError('VALIDAZIONE', `Materiale non trovato in anagrafica: ${riga.descrizione}.`);
      const magId = riga.magazzino_id ?? this.magazzinoPredefinito(r.redatto_da)?.id;
      if (!magId) throw new AppError('VALIDAZIONE', 'Nessun magazzino disponibile per lo scarico.');
      const prec = this.consumoRiga(r.id, riga.id);
      const delta = q3(riga.quantita - prec.quantita);
      if (delta === 0) continue;
      const k = `${mat.id}:${magId}`;
      const disponibile = q3(this.giacenza(mat.id, magId) - (usato.get(k) ?? 0));
      usato.set(k, (usato.get(k) ?? 0) + delta);
      const originale = prec.movimenti.find((m) => m.tipo === 'consumo' && movimentoValido(m));
      const m = this.nuovoMovimento(mat, magId, originale ? 'correzione_consumo' : 'consumo', -delta, {
        costo_unitario: originale?.costo_unitario ?? mat.prezzo_acquisto,
        prezzo_vendita_unitario: originale ? originale.prezzo_vendita_unitario : mat.prezzo_vendita,
        data_riferimento: r.data_lavoro,
        motivo: `Rapportino ${r.numero ?? r.numero_provvisorio}`,
        rapportino_id: r.id,
        riga_rapportino_id: riga.id,
        intervento_id: r.intervento_id,
        cliente_id: r.cliente_id,
        operaio_id: r.redatto_da,
        corregge_id: originale?.id ?? null,
        chiave_univoca: originale ? null : `consumo:${r.id}:${riga.id}`,
        giacenza_insufficiente: delta > 0 && delta > disponibile,
      });
      creati.push(uow.save('movimenti_magazzino', m));
    }
    return creati;
  }

  /**
   * Corregge la quantità consumata su una riga di un rapportino già completato. Il rapportino
   * (documento firmato) non cambia; il movimento originale resta: si aggiunge una correzione
   * collegata, valorizzata allo STESSO costo unitario del consumo originale.
   */
  async correggiConsumo(rapportinoId: string, rigaId: string, nuovaQuantita: number, motivo: string): Promise<MovimentoMagazzino> {
    const u = richiediUtente(this.ctx);
    const r = this.db.get('rapportini', rapportinoId);
    if (!r) throw nonTrovato('Rapportino');
    if (u.ruolo !== 'admin' && r.redatto_da !== u.id) throw new AppError('NON_CONSENTITO', "Il consumo può essere corretto dall'amministrazione o da chi ha redatto il rapportino.");
    if (r.stato === 'bozza' || r.stato === 'annullato') throw new AppError('STATO_NON_VALIDO', 'Nella bozza basta modificare la quantità: lo scarico avviene al completamento.');
    const riga = r.materiali.find((x) => x.id === rigaId);
    if (!riga?.materiale_id) throw new AppError('VALIDAZIONE', 'La riga non è collegata a un articolo di magazzino.');
    if (!Number.isFinite(nuovaQuantita) || nuovaQuantita < 0) throw new AppError('VALIDAZIONE', 'La quantità non può essere negativa.');
    if (motivo.trim().length < 5) throw new AppError('VALIDAZIONE', 'Indica il motivo della correzione.');
    const prec = this.consumoRiga(r.id, riga.id);
    const originale = prec.movimenti.find((m) => m.tipo === 'consumo' && movimentoValido(m));
    if (!originale) throw new AppError('STATO_NON_VALIDO', 'Il consumo originale non è ancora registrato o è stato scartato.');
    const delta = q3(nuovaQuantita - prec.quantita);
    if (delta === 0) throw new AppError('VALIDAZIONE', 'La quantità è uguale a quella già registrata.');
    const mat = this.db.get('materiali', riga.materiale_id)!;
    const disponibile = this.giacenza(mat.id, originale.magazzino_id);
    const uow = this.db.unitOfWork(u.id);
    const m = uow.save(
      'movimenti_magazzino',
      this.nuovoMovimento(mat, originale.magazzino_id, 'correzione_consumo', -delta, {
        costo_unitario: originale.costo_unitario,
        prezzo_vendita_unitario: originale.prezzo_vendita_unitario,
        data_riferimento: originale.data_riferimento,
        motivo: motivo.trim(),
        rapportino_id: r.id,
        riga_rapportino_id: riga.id,
        intervento_id: originale.intervento_id,
        cliente_id: originale.cliente_id,
        operaio_id: originale.operaio_id,
        corregge_id: originale.id,
        giacenza_insufficiente: delta > disponibile,
      }),
      { audit: 'correzione', motivo: motivo.trim() },
    );
    await uow.commit();
    return m;
  }

  // --- costi -------------------------------------------------------------------------
  /** Consumi e costi del periodo [da, a] (date di competenza, estremi inclusi). */
  riepilogoCosti(filtro: { da?: string; a?: string; clienteId?: string; interventoId?: string } = {}): RiepilogoConsumi {
    const movs = this.db.where(
      'movimenti_magazzino',
      (m) =>
        isConsumo(m) &&
        (!filtro.da || m.data_riferimento >= filtro.da) &&
        (!filtro.a || m.data_riferimento <= filtro.a) &&
        (!filtro.clienteId || m.cliente_id === filtro.clienteId) &&
        (!filtro.interventoId || m.intervento_id === filtro.interventoId),
    );
    return riepilogaConsumi(movs, (id) => (id ? this.db.get('interventi', id)?.tipo ?? 'altro' : 'senza_intervento'));
  }
}
