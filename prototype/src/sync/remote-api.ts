/**
 * Contratto del backend remoto. Il prototipo usa MockRemoteApi; in Fase 2 verrà fornita
 * un'implementazione SupabaseRemoteApi (RPC `sync_apply` lato PostgreSQL) con lo stesso contratto.
 */
import type { EntityName } from '../domain/types';

export interface RichiestaSync {
  op_id: string;
  device_id: string;
  utente_id: string | null;
  entita: EntityName;
  entita_id: string;
  base_versione: number;
  payload: Record<string, unknown>;
}

export interface RecordExtra {
  entita: EntityName;
  record: Record<string, unknown> & { id: string };
}

export type RispostaSync =
  | {
      esito: 'ok';
      op_id: string;
      row_version: number;
      /** Campi impostati dal server (es. numero definitivo del rapportino, stato del cartellino). */
      patch: Record<string, unknown>;
      /** Record generati dal server come effetto collaterale (es. registro approvazioni). */
      extra: RecordExtra[];
      ricevuta_at: string;
    }
  | {
      esito: 'conflitto';
      op_id: string;
      versione_server: number;
      dati_server: Record<string, unknown>;
    };

export class ErroreRete extends Error {
  constructor(msg = 'Connessione assente') {
    super(msg);
    this.name = 'ErroreRete';
  }
}

export class ErroreServer extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = 'ErroreServer';
  }
}

/** Fase 15: record ricevuto dal server (modifiche fatte da altri dispositivi o utenti). */
export interface RecordRemoto {
  entita: EntityName;
  dati: Record<string, unknown> & { id: string };
  row_version: number;
  seq: number;
}

export interface PaginaRemota {
  record: RecordRemoto[];
  ultimo: number;
  altri: boolean;
}

export interface RemoteApi {
  applica(req: RichiestaSync): Promise<RispostaSync>;
  /** Modifiche visibili all'utente successive al cursore (assente nel server simulato). */
  ricevi?(dopo: number): Promise<PaginaRemota>;
}
