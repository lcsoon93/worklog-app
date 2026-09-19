const DB_NAME = 'worklog-offline';
const STORE = 'pending';

function apriDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function aggiungiAllaCoda(record) {
  const db = await apriDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function leggiCoda() {
  const db = await apriDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function svuotaCoda() {
  const db = await apriDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
  });
}

async function sincronizzaCoda() {
  if (!navigator.onLine) return;
  const items = await leggiCoda();
  if (!items.length) {
    aggiornaStatoSync();
    return;
  }
  for (const record of items) {
    const { error } = await supabaseClient.from('work_logs').insert(record);
    if (error) {
      console.error('Errore sync:', error);
      return;
    }
  }
  await svuotaCoda();
  aggiornaStatoSync();
  caricaLavori();
}

async function aggiornaStatoSync() {
  const badge = document.getElementById('sync-status');
  const items = await leggiCoda();
  if (!navigator.onLine) {
    badge.textContent = 'offline';
    badge.className = 'sync-badge offline';
  } else if (items.length > 0) {
    badge.textContent = items.length + ' in coda';
    badge.className = 'sync-badge pending';
  } else {
    badge.textContent = 'online';
    badge.className = 'sync-badge';
  }
}

window.addEventListener('online', sincronizzaCoda);
window.addEventListener('offline', aggiornaStatoSync);