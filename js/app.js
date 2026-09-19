async function caricaLavori() {
  const lista = document.getElementById('lista-lavori');
  lista.innerHTML = '<div class="empty">Caricamento...</div>';

  const filterStato = document.getElementById('filter-stato').value;
  const filterData = document.getElementById('filter-data').value;

  let query = supabaseClient
    .from('work_logs')
    .select('*')
    .order('data_lavoro', { ascending: false })
    .limit(100);

  if (filterStato) query = query.eq('stato', filterStato);
  if (filterData) query = query.eq('data_lavoro', filterData);

  const { data, error } = await query;

  if (error) {
    lista.innerHTML = '<div class="empty">Errore: ' + error.message + '</div>';
    return;
  }
  if (!data.length) {
    lista.innerHTML = '<div class="empty">Nessun lavoro trovato.</div>';
    return;
  }

  lista.innerHTML = '';
  data.forEach(lavoro => {
    lista.appendChild(creaCard(lavoro));
  });

  aggiornaStatoSync();
}

function creaCard(lavoro) {
  const card = document.createElement('div');
  card.className = 'card';

  const orario = (lavoro.ora_inizio && lavoro.ora_fine)
    ? `${lavoro.ora_inizio.slice(0,5)} - ${lavoro.ora_fine.slice(0,5)}`
    : '';

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(lavoro.cliente)}</div>
        <div class="card-date">${lavoro.data_lavoro} ${orario}</div>
      </div>
      <span class="badge ${lavoro.stato}">${lavoro.stato.replace('_',' ')}</span>
    </div>
    <div class="card-body">
      <p><strong>Tipo:</strong> ${lavoro.tipo_lavoro}</p>
      ${lavoro.indirizzo ? `<p><strong>Indirizzo:</strong> ${escapeHtml(lavoro.indirizzo)}</p>` : ''}
      ${lavoro.descrizione ? `<p>${escapeHtml(lavoro.descrizione)}</p>` : ''}
    </div>
    <div class="card-actions">
      <button data-action="dettagli" data-id="${lavoro.id}">Dettagli</button>
      <button data-action="elimina" data-id="${lavoro.id}" class="danger">Elimina</button>
    </div>
  `;

  card.querySelector('[data-action="dettagli"]').addEventListener('click', () => mostraDettagli(lavoro));
  card.querySelector('[data-action="elimina"]').addEventListener('click', () => eliminaLavoro(lavoro.id));

  return card;
}

async function mostraDettagli(lavoro) {
  // costruisci un testo riassuntivo (semplice alert multi-line)
  const righe = [];
  righe.push(`Cliente: ${lavoro.cliente}`);
  righe.push(`Data: ${lavoro.data_lavoro}`);
  if (lavoro.ora_inizio) righe.push(`Orario: ${lavoro.ora_inizio} - ${lavoro.ora_fine || '?'}`);
  if (lavoro.indirizzo) righe.push(`Indirizzo: ${lavoro.indirizzo}`);
  righe.push(`Tipo: ${lavoro.tipo_lavoro}`);
  righe.push(`Stato: ${lavoro.stato}`);

  // campi specifici
  const specifici = {
    quadro_elettrico: 'Quadro',
    sezione_cavo: 'Sezione cavo',
    modello_interruttore: 'Interruttore',
    resistenza_isolamento: 'Res. isolamento',
    resistenza_terra: 'Res. terra',
    tipo_cavo_rete: 'Tipo cavo rete',
    test_link: 'Test link',
    patch_panel_porta: 'Patch panel',
    modello_plc: 'PLC',
    versione_programma: 'Versione prog.',
    punti_io: 'Punti I/O',
    modello_telecamera: 'Telecamera',
    ip_telecamera: 'IP telecamera',
    canale_nvr: 'Canale NVR',
    giorni_registrazione: 'Giorni reg.'
  };
  Object.entries(specifici).forEach(([k, label]) => {
    if (lavoro[k] != null && lavoro[k] !== '') righe.push(`${label}: ${lavoro[k]}`);
  });

  if (lavoro.materiali_usati) righe.push(`Materiali: ${lavoro.materiali_usati}`);
  if (lavoro.note_vocali) righe.push(`Note: ${lavoro.note_vocali}`);

  alert(righe.join('\n'));

  // apri foto in nuova scheda
  if (lavoro.foto_urls && lavoro.foto_urls.length) {
    for (const path of lavoro.foto_urls) {
      const { data } = await supabaseClient.storage.from('foto-lavori').createSignedUrl(path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    }
  }
}

async function eliminaLavoro(id) {
  if (!confirm('Eliminare questo lavoro?')) return;
  const { error } = await supabaseClient.from('work_logs').delete().eq('id', id);
  if (error) return alert('Errore: ' + error.message);
  caricaLavori();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// TABS
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'lista') caricaLavori();
  });
});

// FILTRI
document.getElementById('filter-stato').addEventListener('change', caricaLavori);
document.getElementById('filter-data').addEventListener('change', caricaLavori);
document.getElementById('btn-refresh').addEventListener('click', caricaLavori);

// sync iniziale
aggiornaStatoSync();
sincronizzaCoda();