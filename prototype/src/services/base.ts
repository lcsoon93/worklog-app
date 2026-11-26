import type { LocalDb } from '../data/local-db';
import type { BaseRecord, Profilo } from '../domain/types';
import { meseDi } from '../domain/time';
import { meseModificabile } from '../domain/timesheet-workflow';
import { AppError } from './errors';

/** Contesto condiviso dai servizi: database locale e utente autenticato. */
export interface ServiceContext {
  db: LocalDb;
  utente: () => Profilo | null;
}

export function richiediUtente(ctx: ServiceContext): Profilo {
  const u = ctx.utente();
  if (!u) throw new AppError('NON_CONSENTITO', 'Sessione scaduta: accedi di nuovo.');
  return u;
}

/** Fase 13: amministratore aziendale oppure operaio con privilegi di amministratore operativo. */
export function haGestioneOperativa(u: Pick<Profilo, 'ruolo' | 'amministratore_operativo'> | null | undefined): boolean {
  return !!u && (u.ruolo === 'admin' || u.amministratore_operativo === true);
}

/** Clienti, sedi, interventi e ritorni: amministratore o amministratore operativo. */
export function richiediGestioneOperativa(ctx: ServiceContext): Profilo {
  const u = richiediUtente(ctx);
  if (!haGestioneOperativa(u)) throw new AppError('NON_CONSENTITO', "Operazione riservata all'amministrazione.");
  return u;
}

export function richiediAdmin(ctx: ServiceContext): Profilo {
  const u = richiediUtente(ctx);
  if (u.ruolo !== 'admin') throw new AppError('NON_CONSENTITO', "Operazione riservata all'amministratore.");
  return u;
}

/** Campi tecnici iniziali di un nuovo record (completati da UnitOfWork.save). */
export function nuovoBase(ctx: ServiceContext, id: string): BaseRecord {
  const now = ctx.db.nowIso();
  const u = ctx.utente();
  return {
    id,
    created_at: now,
    created_by: u?.id ?? null,
    updated_at: now,
    updated_by: u?.id ?? null,
    row_version: 0,
    sync_stato: 'in_attesa',
    device_id: ctx.db.deviceId,
    deleted_at: null,
  };
}

/** Impedisce modifiche a presenze/attività di un mese il cui cartellino è in verifica o approvato. */
export function verificaMeseModificabile(ctx: ServiceContext, operaioId: string, data: string): void {
  const { anno, mese } = meseDi(data);
  const c = ctx.db.all('cartellini_mensili').find((x) => x.operaio_id === operaioId && x.anno === anno && x.mese === mese);
  if (c && !meseModificabile(c.stato)) {
    throw new AppError(
      'MESE_BLOCCATO',
      'Il cartellino di questo mese è in verifica o approvato: per modificare serve segnalare una discrepanza o una riapertura.',
    );
  }
}
