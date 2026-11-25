/**
 * Genera PDF di esempio dai dati demo (stesso codice dell'app) in una cartella indicata.
 * Uso: npx vite-node scripts/genera-esempi-pdf.ts <cartella-di-uscita>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDemo } from '../src/data/demo-seed';
import { LocalDb } from '../src/data/local-db';
import { MemoryStorage } from '../src/data/storage';
import { atLocal } from '../src/domain/time';
import { generaPdfGiornaliero, generaPdfMensile, nomeFilePdf } from '../src/reports/pdf-report-service';
import { AppServices } from '../src/services/app-services';

async function main() {
  const out = process.argv[2] ?? 'esempi-pdf';
  mkdirSync(out, { recursive: true });
  const db = new LocalDb(new MemoryStorage());
  await db.init();
  const now = atLocal('2026-11-24', '17:30');
  db.clock = () => now;
  await seedDemo(db, now);
  const s = new AppServices(db, { sleep: async () => {} });
  await s.login('laura.bianchi@demo.local', 'demo');
  const operaio = (nome: string) => db.all('profili').find((p) => p.nome === nome)!;
  const giorno = db.where('presenze', (p) => p.operaio_id === operaio('Marco').id && p.data_lavoro.startsWith('2026-11-')).sort((a, b) => b.data_lavoro.localeCompare(a.data_lavoro))[0].data_lavoro;
  const documenti = [
    s.riepiloghi.giornaliero(operaio('Marco').id, giorno),
    s.riepiloghi.mensile(operaio('Marco').id, 2026, 10),
    s.riepiloghi.mensile(operaio('Andrea').id, 2026, 10),
  ];
  for (const m of documenti) {
    const bytes = m.tipo === 'giornaliero' ? await generaPdfGiornaliero(m) : await generaPdfMensile(m);
    writeFileSync(join(out, nomeFilePdf(m)), bytes);
    console.log(nomeFilePdf(m), bytes.length, 'byte');
  }
}

void main();
