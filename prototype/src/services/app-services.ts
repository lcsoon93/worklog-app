/**
 * Contenitore dei servizi applicativi. È l'unico punto da cui la UI accede ai dati:
 * nessun componente legge IndexedDB o chiama il backend direttamente.
 */
import { LocalDb } from '../data/local-db';
import type { StorageAdapter } from '../data/storage';
import type { Profilo } from '../domain/types';
import { MockRemoteApi, SIMULAZIONE_DEFAULT, type Simulazione } from '../sync/mock-remote-api';
import { SyncEngine } from '../sync/sync-engine';
import type { ServiceContext } from './base';
import { AppError } from './errors';
import { AnalisiService } from './analisi-service';
import { MagazzinoService } from './magazzino-service';
import { NotificheService } from './notifiche-service';
import { PlanningService } from './planning-service';
import { ReportService } from './report-service';
import { RichiesteService } from './richieste-service';
import { RiepiloghiService } from './riepiloghi-service';
import { TimesheetService } from './timesheet-service';
import { WorkdayService } from './workday-service';

/** Password unica degli account dimostrativi. NON è un sistema di autenticazione. */
export const PASSWORD_DEMO = 'demo';

export class AppServices {
  readonly ctx: ServiceContext;
  readonly api: MockRemoteApi;
  readonly sync: SyncEngine;
  readonly workday: WorkdayService;
  readonly timesheet: TimesheetService;
  readonly report: ReportService;
  readonly planning: PlanningService;
  readonly riepiloghi: RiepiloghiService;
  readonly richieste: RichiesteService;
  readonly magazzino: MagazzinoService;
  readonly analisi: AnalisiService;
  readonly notifiche: NotificheService;
  /** Stato della rete del browser (in test sempre true). */
  browserOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  constructor(
    readonly db: LocalDb,
    opts: { sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.ctx = { db, utente: () => this.utente() };
    this.api = new MockRemoteApi(db, () => this.simulazione(), opts.sleep);
    this.api.onConflittoConsumato = () => void this.impostaSimulazione({ conflittoProssimaOp: false });
    this.api.onRispostaPersaConsumata = () => void this.impostaSimulazione({ rispostaPersa: false });
    this.sync = new SyncEngine(db, this.api, () => this.online(), () => this.utente()?.id ?? null);
    this.workday = new WorkdayService(this.ctx);
    this.timesheet = new TimesheetService(this.ctx);
    this.magazzino = new MagazzinoService(this.ctx);
    this.analisi = new AnalisiService(this.ctx);
    this.notifiche = new NotificheService(this.ctx);
    this.report = new ReportService(this.ctx, this.magazzino);
    this.planning = new PlanningService(this.ctx);
    this.riepiloghi = new RiepiloghiService(this.ctx);
    this.richieste = new RichiesteService(this.ctx);
  }

  static async crea(storage: StorageAdapter, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<AppServices> {
    const db = new LocalDb(storage);
    await db.init();
    return new AppServices(db, opts);
  }

  // --- sessione (simulata) -----------------------------------------------------------
  utente(): Profilo | null {
    const id = this.db.meta<string>('sessione');
    return id ? this.db.get('profili', id) ?? null : null;
  }

  async login(email: string, password: string): Promise<Profilo> {
    const p = this.db.all('profili').find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!p || password !== PASSWORD_DEMO) throw new AppError('NON_CONSENTITO', 'Email o password non corretti.');
    if (!p.attivo) throw new AppError('NON_CONSENTITO', 'Utente disattivato.');
    await this.db.setMeta('sessione', p.id);
    return p;
  }

  async logout(): Promise<void> {
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
