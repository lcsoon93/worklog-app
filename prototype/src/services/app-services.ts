/**
 * Contenitore dei servizi applicativi. È l'unico punto da cui la UI accede ai dati:
 * nessun componente legge IndexedDB o chiama il backend direttamente.
 */
import { FORMATO_PIN, normalizzaUsername, usernameDi } from '../config/accesso';
import { aggiornaAzienda } from '../config/azienda';
import { LocalDb } from '../data/local-db';
import type { StorageAdapter } from '../data/storage';
import type { Profilo } from '../domain/types';
import { MockRemoteApi, SIMULAZIONE_DEFAULT, type Simulazione } from '../sync/mock-remote-api';
import type { RemoteApi } from '../sync/remote-api';
import { SupabaseRemoteApi } from '../sync/supabase-remote-api';
import { SyncEngine } from '../sync/sync-engine';
import type { ServiceContext } from './base';
import { AppError } from './errors';
import { AnalisiService } from './analisi-service';
import { AuthSupabase, chiaveOffline, creaCredenzialeOffline, profiloDaServer, verificaCredenzialeOffline, type CredenzialeOffline, type DatiAziendaRemoti, type SessioneRemota } from './auth-supabase';
import { MagazzinoService } from './magazzino-service';
import { NotificheService } from './notifiche-service';
import { PlanningService } from './planning-service';
import { StoricoService } from './storico-service';
import { ReportService } from './report-service';
import { RichiesteService } from './richieste-service';
import { RiepiloghiService } from './riepiloghi-service';
import { TimesheetService } from './timesheet-service';
import { WorkdayService } from './workday-service';

/** Password unica degli account dimostrativi. NON è un sistema di autenticazione. */
export const PASSWORD_DEMO = 'demo';
/** PIN unico degli account dimostrativi (accesso con nome utente e PIN). */
export const PIN_DEMO = '123456';

export class AppServices {
  readonly ctx: ServiceContext;
  /** Server simulato (demo e test). Con l'accesso reale resta inattivo. */
  readonly api: MockRemoteApi;
  /** Fase 15: backend effettivamente usato dalla sincronizzazione (simulato o Supabase). */
  readonly remoto: RemoteApi;
  readonly sync: SyncEngine;
  readonly workday: WorkdayService;
  readonly timesheet: TimesheetService;
  readonly report: ReportService;
  readonly storico: StoricoService;
  readonly planning: PlanningService;
  readonly riepiloghi: RiepiloghiService;
  readonly richieste: RichiesteService;
  readonly magazzino: MagazzinoService;
  readonly analisi: AnalisiService;
  readonly notifiche: NotificheService;
  /** Accesso reale (Supabase Auth); null = accesso simulato con gli account dimostrativi. */
  readonly auth: AuthSupabase | null;
  /** Invio e ricezione dei dati attivi (Fase 15: anche con l'accesso reale, tramite Supabase). */
  readonly syncAttiva: boolean;
  /** Stato della rete del browser (in test sempre true). */
  browserOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  constructor(
    readonly db: LocalDb,
    opts: { sleep?: (ms: number) => Promise<void>; supabase?: { url: string; chiave: string; fetch?: typeof fetch }; sincronizzazione?: boolean; remoto?: RemoteApi } = {},
  ) {
    this.ctx = { db, utente: () => this.utente() };
    this.auth = opts.supabase ? new AuthSupabase(opts.supabase.url, opts.supabase.chiave, opts.supabase.fetch) : null;
    this.syncAttiva = opts.sincronizzazione !== false;
    const azienda = db.meta<DatiAziendaRemoti>('azienda');
    if (azienda) aggiornaAzienda(azienda);
    this.api = new MockRemoteApi(db, () => this.simulazione(), opts.sleep);
    this.api.onConflittoConsumato = () => void this.impostaSimulazione({ conflittoProssimaOp: false });
    this.api.onRispostaPersaConsumata = () => void this.impostaSimulazione({ rispostaPersa: false });
    this.remoto = opts.remoto ?? (this.auth ? new SupabaseRemoteApi(db, this.auth) : this.api);
    // Con l'accesso reale si sincronizza solo con un utente collegato (serve la sua sessione).
    this.sync = new SyncEngine(db, this.remoto, () => this.syncAttiva && this.online() && (!this.auth || !!this.utente()), () => this.utente()?.id ?? null);
    this.workday = new WorkdayService(this.ctx);
    this.timesheet = new TimesheetService(this.ctx);
    this.magazzino = new MagazzinoService(this.ctx);
    this.analisi = new AnalisiService(this.ctx);
    this.notifiche = new NotificheService(this.ctx);
    this.report = new ReportService(this.ctx, this.magazzino);
    this.storico = new StoricoService(this.ctx, this.report);
    this.planning = new PlanningService(this.ctx);
    this.riepiloghi = new RiepiloghiService(this.ctx);
    this.richieste = new RichiesteService(this.ctx);
  }

  static async crea(storage: StorageAdapter, opts: ConstructorParameters<typeof AppServices>[1] = {}): Promise<AppServices> {
    const db = new LocalDb(storage);
    await db.init();
    return new AppServices(db, opts);
  }

  // --- sessione (simulata) -----------------------------------------------------------
  utente(): Profilo | null {
    const id = this.db.meta<string>('sessione');
    return id ? this.db.get('profili', id) ?? null : null;
  }

  /**
   * Accesso. Con Supabase: nome utente + PIN verificati dal server (o, senza rete, dall'impronta
   * salvata su questo dispositivo dopo un accesso riuscito). Senza Supabase: accesso simulato
   * con gli account dimostrativi.
   */
  async login(identificativo: string, codice: string): Promise<Profilo> {
    if (this.auth) return this.loginReale(identificativo, codice);
    return this.loginSimulato(identificativo, codice);
  }

  private async loginReale(username: string, pin: string): Promise<Profilo> {
    const nome = normalizzaUsername(username);
    if (!nome || !FORMATO_PIN.test(pin)) throw new AppError('NON_CONSENTITO', 'Inserisci il nome utente e il PIN di 6 cifre.');
    const offline = this.db.meta<CredenzialeOffline>(chiaveOffline(nome));
    const entraOffline = async (motivo: string): Promise<Profilo> => {
      const p = offline ? this.db.get('profili', offline.profilo_id) : undefined;
      if (!offline || !p) throw new AppError('RETE', `${motivo} Il primo accesso su questo dispositivo richiede la connessione.`);
      if (!(await verificaCredenzialeOffline(offline, pin))) throw new AppError('NON_CONSENTITO', 'Nome utente o PIN non corretti.');
      if (!p.attivo) throw new AppError('NON_CONSENTITO', 'Utente disattivato.');
      await this.db.setMeta('sessione', p.id);
      return p;
    };
    if (!this.browserOnline()) return entraOffline('Sei offline.');
    let sessione: SessioneRemota;
    try {
      sessione = await this.auth!.accedi(nome, pin);
    } catch (e) {
      if (e instanceof AppError && e.codice === 'RETE') return entraOffline('Server non raggiungibile.');
      throw e;
    }
    const { profilo, azienda } = await this.auth!.mioProfilo(sessione);
    if (!profilo) {
      await this.auth!.esci(sessione);
      throw new AppError('NON_CONSENTITO', 'Account non abilitato all\'app o disattivato. Contatta l\'amministrazione.');
    }
    const p = profiloDaServer(profilo);
    await this.db.applyBatch([{ tipo: 'put', store: 'profili', value: p }]);
    await this.db.setMeta('sessione_remota', sessione);
    await this.db.setMeta(chiaveOffline(nome), await creaCredenzialeOffline(p.id, pin));
    if (azienda) {
      await this.db.setMeta('azienda', azienda);
      aggiornaAzienda(azienda);
    }
    await this.db.setMeta('sessione', p.id);
    return p;
  }

  /** Accesso simulato: `identificativo` è il nome utente (o l'email), `codice` il PIN dimostrativo. */
  private async loginSimulato(identificativo: string, codice: string): Promise<Profilo> {
    const id = normalizzaUsername(identificativo);
    const p = this.db.all('profili').find((x) => x.email.toLowerCase() === id || usernameDi(x) === id);
    if (!p || (codice !== PIN_DEMO && codice !== PASSWORD_DEMO)) throw new AppError('NON_CONSENTITO', 'Nome utente o PIN non corretti.');
    if (!p.attivo) throw new AppError('NON_CONSENTITO', 'Utente disattivato.');
    await this.db.setMeta('sessione', p.id);
    return p;
  }

  async logout(): Promise<void> {
    const remota = this.db.meta<SessioneRemota>('sessione_remota');
    if (this.auth && remota) {
      // Ultimo invio prima di chiudere la sessione: ciò che non parte resta in coda sul dispositivo.
      if (this.online()) await this.sync.ciclo({ forza: true }).catch(() => undefined);
      await this.db.setMeta('sessione_remota', null);
      await this.auth.esci(remota);
    }
    await this.db.setMeta('sessione', null);
  }

  // --- simulazione rete/server -------------------------------------------------------
  simulazione(): Simulazione {
    return { ...SIMULAZIONE_DEFAULT, ...(this.db.meta<Partial<Simulazione>>('simulazione') ?? {}) };
  }

  async impostaSimulazione(patch: Partial<Simulazione>): Promise<void> {
    await this.db.setMeta('simulazione', { ...this.simulazione(), ...patch });
  }

  online(): boolean {
    return this.browserOnline() && !this.simulazione().offline;
  }
}
