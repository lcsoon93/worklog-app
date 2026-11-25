import { Camera } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { uuid } from '../../domain/ids';
import type { Imprevisto as ImprevistoT, ImprevistoTipo } from '../../domain/types';
import { Card, PageHead, Segmented } from '../../ui/components';
import { IMPREVISTO_TIPO } from '../../ui/labels';
import { leggiFile } from '../../ui/files';
import { useGiornata } from './useGiornata';

export function Imprevisto() {
  const { s, u, oggi, aperta, attivitaInCorso } = useGiornata();
  const { run } = useApp();
  const navigate = useNavigate();
  const interventi = s.planning.interventiOperaio(u.id, oggi);
  const [tipo, setTipo] = useState<ImprevistoTipo | null>(null);
  const [gravita, setGravita] = useState<ImprevistoT['gravita']>('media');
  const [descrizione, setDescrizione] = useState('');
  // Default: l'intervento del timer in corso; se il timer è su un cliente senza intervento, nessuno.
  const [interventoId, setInterventoId] = useState<string>(attivitaInCorso ? attivitaInCorso.intervento_id ?? '' : interventi[0]?.id ?? '');
  const [blocca, setBlocca] = useState(false);
  const [ritorno, setRitorno] = useState(false);
  const [foto, setFoto] = useState<string[]>([]);
  const [tmpId] = useState(uuid());

  const salva = async (poiRapportino: boolean) => {
    const imp = await run(() => s.report.registraImprevisto({
      presenza_id: aperta?.id ?? null,
      intervento_id: interventoId || null,
      cliente_id: interventoId ? null : attivitaInCorso?.cliente_id ?? null,
      tipo: tipo!,
      gravita,
      descrizione,
      blocca_lavoro: blocca,
      richiede_ritorno: ritorno,
      allegati_ids: foto,
    }), 'Imprevisto registrato');
    if (!imp) return;
    if (poiRapportino && imp.cliente_id) navigate(`/rapportini/nuovo?tipo=rapido${imp.intervento_id ? `&intervento=${imp.intervento_id}` : `&cliente=${imp.cliente_id}`}`);
    else navigate('/op');
  };

  return (
    <div className="stack">
      <PageHead title="Registra imprevisto" eyebrow="Segnalazione" back={{ to: '/op', label: 'Oggi' }} />
      <Card title="Cosa è successo?" pad>
        <div className="choices">
          {(Object.keys(IMPREVISTO_TIPO) as ImprevistoTipo[]).map((k) => (
            <button key={k} className={`choice ${tipo === k ? 'on' : ''}`} onClick={() => setTipo(k)} data-testid={`imprevisto-${k}`}>{IMPREVISTO_TIPO[k]}</button>
          ))}
        </div>
      </Card>
      <Card title="Dettagli" pad>
        <div className="stack">
          <div className="field">
            <label htmlFor="imp-desc">Descrizione</label>
            <textarea id="imp-desc" className="textarea" value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Descrivi brevemente il problema" data-testid="imprevisto-descrizione" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="imp-int">Intervento</label>
              <select id="imp-int" className="select" value={interventoId} onChange={(e) => setInterventoId(e.target.value)}>
                <option value="">— Nessuno —</option>
                {interventi.map((i) => <option key={i.id} value={i.id}>{i.ora_inizio} · {s.db.get('clienti', i.cliente_id)?.ragione_sociale}</option>)}
              </select>
            </div>
            <div className="field"><span className="label">Gravità</span>
              <Segmented value={gravita} onChange={setGravita} options={[{ value: 'bassa', label: 'Bassa' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }]} />
            </div>
          </div>
          <div className="row">
            <button className={`chip ${blocca ? 'on' : ''}`} onClick={() => setBlocca(!blocca)}>Blocca il lavoro</button>
            <button className={`chip ${ritorno ? 'on' : ''}`} onClick={() => setRitorno(!ritorno)} data-testid="imprevisto-ritorno">Serve un ritorno</button>
          </div>
          <div className="field">
            <span className="label">Foto</span>
            <div className="row">
              <label className="btn"><Camera /> Scatta o allega<input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const url = await leggiFile(f);
                const a = await run(() => s.report.aggiungiAllegato('foto', 'imprevisto', tmpId, f.name, f.type, url));
                if (a) setFoto((x) => [...x, a.id]);
              }} /></label>
              <div className="thumbs">{foto.map((id) => <img key={id} src={s.db.get('allegati', id)?.data_url} alt="Foto imprevisto" />)}</div>
            </div>
          </div>
        </div>
      </Card>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-lg" disabled={!tipo} onClick={() => void salva(true)} data-testid="imprevisto-salva-rapportino">Salva e crea rapportino</button>
        <button className="btn btn-primary btn-lg" disabled={!tipo} onClick={() => void salva(false)} data-testid="imprevisto-salva">Salva imprevisto</button>
      </div>
    </div>
  );
}
