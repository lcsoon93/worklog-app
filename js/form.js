// Campi dinamici in base al tipo di lavoro
const campiPerTipo = {
  elettrico: `
    <label>Quadro elettrico <input type="text" id="quadro_elettrico"></label>
    <label>Sezione cavo <input type="text" id="sezione_cavo" placeholder="es. 2.5mm²"></label>
    <label>Modello interruttore <input type="text" id="modello_interruttore"></label>
    <div class="row">
      <label>Res. isolamento (MΩ) <input type="number" step="0.1" id="resistenza_isolamento"></label>
      <label>Res. terra (Ω) <input type="number" step="0.1" id="resistenza_terra"></label>
    </div>`,
  rete: `
    <label>Tipo cavo <input type="text" id="tipo_cavo_rete" placeholder="es. Cat6 UTP"></label>
    <label>Test link <input type="text" id="test_link" placeholder="es. PASS 100m"></label>
    <label>Porta patch panel <input type="text" id="patch_panel_porta"></label>`,
  automazione: `
    <label>Modello PLC <input type="text" id="modello_plc"></label>
    <label>Versione programma <input type="text" id="versione_programma"></label>
    <label>Punti I/O <input type="text" id="punti_io"></label>`,
  videosorveglianza: `
    <label>Modello telecamera <input type="text" id="modello_telecamera"></label>
    <label>IP telecamera <input type="text" id="ip_telecamera"></label>
    <label>Canale NVR <input type="text" id="canale_nvr"></label>
    <label>Giorni registrazione <input type="number" id="giorni_registrazione"></label>`
};

function inizializzaForm() {
  const tipoSelect = document.getElementById('tipo_lavoro');
  const campiDiv = document.getElementById('campi-specifici');
  const dataInput = document.getElementById('data_lavoro');

  // data di oggi di default
  dataInput.value = new Date().toISOString().split('T')[0];

  tipoSelect.addEventListener('change', () => {
    campiDiv.innerHTML = campiPerTipo[tipoSelect.value] || '';
  });

  // anteprima foto
  document.getElementById('foto').addEventListener('change', (e) => {
    const preview = document.getElementById('foto-preview');
    preview.innerHTML = '';
    Array.from(e.target.files).forEach(file => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    });
  });

  // GPS
  document.getElementById('btn-gps').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('GPS non disponibile');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window._gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        alert('Posizione acquisita: ' + pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5));
      },
      (err) => alert('Errore GPS: ' + err.message)
    );
  });

  // submit
  document.getElementById('work-form').addEventListener('submit', salvaLavoro);
}

async function comprimiImmagine(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function salvaLavoro(e) {
  e.preventDefault();
  const msg = document.getElementById('form-msg');
  msg.textContent = '';
  msg.classList.remove('ok');

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // carica foto
  const fotoFiles = document.getElementById('foto').files;
  const fotoUrls = [];
  for (const file of fotoFiles) {
    const blob = await comprimiImmagine(file);
    const nome = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: upErr } = await supabaseClient.storage
      .from('foto-lavori')
      .upload(nome, blob, { contentType: 'image/jpeg' });
    if (!upErr) fotoUrls.push(nome);
  }

  const record = {
    user_id: user.id,
    data_lavoro: document.getElementById('data_lavoro').value,
    ora_inizio: document.getElementById('ora_inizio').value || null,
    ora_fine: document.getElementById('ora_fine').value || null,
    cliente: document.getElementById('cliente').value.trim(),
    indirizzo: document.getElementById('indirizzo').value.trim() || null,
    latitudine: window._gps?.lat || null,
    longitudine: window._gps?.lng || null,
    tipo_lavoro: document.getElementById('tipo_lavoro').value,
    descrizione: document.getElementById('descrizione').value.trim() || null,
    materiali_usati: document.getElementById('materiali_usati').value.trim() || null,
    stato: document.getElementById('stato').value,
    foto_urls: fotoUrls.length ? fotoUrls : null,
    note_vocali: document.getElementById('note_vocali').value.trim() || null,
    // campi specifici (null se non presenti)
    quadro_elettrico: val('quadro_elettrico'),
    sezione_cavo: val('sezione_cavo'),
    modello_interruttore: val('modello_interruttore'),
    resistenza_isolamento: num('resistenza_isolamento'),
    resistenza_terra: num('resistenza_terra'),
    tipo_cavo_rete: val('tipo_cavo_rete'),
    test_link: val('test_link'),
    patch_panel_porta: val('patch_panel_porta'),
    modello_plc: val('modello_plc'),
    versione_programma: val('versione_programma'),
    punti_io: val('punti_io'),
    modello_telecamera: val('modello_telecamera'),
    ip_telecamera: val('ip_telecamera'),
    canale_nvr: val('canale_nvr'),
    giorni_registrazione: num('giorni_registrazione')
  };

  if (navigator.onLine) {
    const { error } = await supabaseClient.from('work_logs').insert(record);
    if (error) {
      msg.textContent = 'Errore: ' + error.message;
    } else {
      msg.classList.add('ok');
      msg.textContent = 'Lavoro salvato!';
      document.getElementById('work-form').reset();
      document.getElementById('campi-specifici').innerHTML = '';
      document.getElementById('foto-preview').innerHTML = '';
      window._gps = null;
      caricaLavori();
    }
  } else {
    await aggiungiAllaCoda(record);
    msg.classList.add('ok');
    msg.textContent = 'Offline: salvato in coda, verrà sincronizzato.';
    document.getElementById('work-form').reset();
    aggiornaStatoSync();
  }
}

function val(id) {
  const el = document.getElementById(id);
  return el && el.value.trim() ? el.value.trim() : null;
}
function num(id) {
  const el = document.getElementById(id);
  return el && el.value ? parseFloat(el.value) : null;
}