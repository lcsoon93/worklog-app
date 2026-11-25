/**
 * SERVER SIMULATO – solo per il prototipo. NON è un backend.
 *
 * Riproduce le regole che il backend reale dovrà rispettare:
 * - idempotenza per op_id (una richiesta ripetuta restituisce la stessa risposta, senza riapplicarla);
 * - controllo di concorrenza ottimistico tramite versione;
 * - regole lato server (numero definitivo rapportino, ricezione della conferma del cartellino).
 * Lo stato è salvato nello store IndexedDB `mock_server`, separato dai dati del dispositivo.
 */
import { uuid } from '../domain/ids';
import type { LocalDb } from '../data/local-db';
import {
  ErroreRete,
  ErroreServer,
  type RecordExtra,
  type RemoteApi,
  type RichiestaSync,
  type RispostaSync,
} from './remote-api';

export interface Simulazione {
  offline: boolean;
  erroreServer: boolean;
  /** Il server applica l'operazione ma la risposta si perde (timeout): verifica l'idempotenza. */
  rispostaPersa: boolean;
  /** Alla prossima operazione un "altro dispositivo" modifica lo stesso record. */
  conflittoProssimaOp: boolean;
  latenzaMs: number;
}

export const SIMULAZIONE_DEFAULT: Simulazione = {
  offline: false,
  erroreServer: false,
  rispostaPersa: false,
  conflittoProssimaOp: false,
  latenzaMs: 250,
};

interface StatoServer {
  id: 'stato';
  processate: Record<string, RispostaSync>;
  versioni: Record<string, number>;
  dati: Record<string, Record<string, unknown>>;
  contatori: Record<string, number>;
  /** Numero di richieste effettivamente applicate (non ripetute): usato per verificare l'idempotenza. */
  applicazioni: number;
}

const vuoto = (): StatoServer => ({ id: 'stato', processate: {}, versioni: {}, dati: {}, contatori: {}, applicazioni: 0 });

export class MockRemoteApi implements RemoteApi {
  constructor(
    private readonly db: LocalDb,
    private readonly sim: () => Simulazione,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  stato(): StatoServer {
    return (this.db.raw('mock_server').find((r) => r.id === 'stato') as StatoServer | undefined) ?? vuoto();
  }

  private async salva(s: StatoServer) {
    await this.db.applyBatch([{ tipo: 'put', store: 'mock_server', value: s }]);
  }

  async applica(req: RichiestaSync): Promise<RispostaSync> {
    const sim = this.sim();
    if (sim.latenzaMs > 0) await this.sleep(sim.latenzaMs);
    if (sim.offline) throw new ErroreRete();
    if (sim.erroreServer) throw new ErroreServer(500, 'Errore interno del server (simulato)');

    const s = structuredClone(this.stato());
    const precedente = s.processate[req.op_id];
    if (precedente) return precedente; // idempotenza

    const key = `${req.entita}:${req.entita_id}`;
    let versioneServer = s.versioni[key] ?? 0;

    if (sim.conflittoProssimaOp) {
      versioneServer += 1;
      s.versioni[key] = versioneServer;
      s.dati[key] = {
        ...(s.dati[key] ?? req.payload),
        note: 'Modificato da un altro dispositivo (simulazione)',
        updated_at: new Date(this.db.now()).toISOString(),
      };
      await this.salva(s);
      this.onConflittoConsumato?.();
    }

    if (req.base_versione !== versioneServer) {
      return {
        esito: 'conflitto',
        op_id: req.op_id,
        versione_server: versioneServer,
        dati_server: s.dati[key] ?? {},
      };
    }

    const now = new Date(this.db.now()).toISOString();
    const patch: Record<string, unknown> = {};
    const extra: RecordExtra[] = [];

    // --- regole lato server -------------------------------------------------------
    if (req.entita === 'rapportini' && req.payload.stato !== 'bozza' && !req.payload.numero) {
      const anno = String(req.payload.data_lavoro ?? now).slice(0, 4);
      const n = (s.contatori[`rapportini-${anno}`] ?? 0) + 1;
      s.contatori[`rapportini-${anno}`] = n;
      patch.numero = `R-${anno}-${String(n).padStart(4, '0')}`;
    }
    if (req.entita === 'cartellini_mensili' && req.payload.stato === 'confermato_operaio') {
      patch.stato = 'in_attesa_approvazione';
      const recordApprovazione = {
        id: uuid(),
        cartellino_id: req.entita_id,
        versione: req.payload.versione_corrente,
        azione: 'ricezione_server',
        stato_precedente: 'confermato_operaio',
        stato_nuovo: 'in_attesa_approvazione',
        utente_id: null,
        ruolo_utente: 'sistema',
        motivazione: '',
        eseguita_at: now,
        created_at: now,
        created_by: null,
        updated_at: now,
        updated_by: null,
        row_version: 1,
        sync_stato: 'sincronizzato',
        device_id: 'server',
        deleted_at: null,
      };
      s.versioni[`approvazioni_cartellino:${recordApprovazione.id}`] = 1;
      s.dati[`approvazioni_cartellino:${recordApprovazione.id}`] = recordApprovazione;
      extra.push({ entita: 'approvazioni_cartellino', record: recordApprovazione });
    }

    const nuovaVersione = versioneServer + 1;
    s.versioni[key] = nuovaVersione;
    s.dati[key] = { ...req.payload, ...patch, row_version: nuovaVersione };
    s.applicazioni += 1;
    const risposta: RispostaSync = { esito: 'ok', op_id: req.op_id, row_version: nuovaVersione, patch, extra, ricevuta_at: now };
    s.processate[req.op_id] = risposta;
    await this.salva(s);

    if (sim.rispostaPersa) {
      this.onRispostaPersaConsumata?.();
      throw new ErroreRete('Timeout: risposta del server non ricevuta (simulato)');
    }
    return risposta;
  }

  /** Callback usate dal controller di simulazione per disattivare i flag "una tantum". */
  onConflittoConsumato?: () => void;
  onRispostaPersaConsumata?: () => void;
}
