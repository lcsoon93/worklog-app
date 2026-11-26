# 17 – PWA, configurazione e preparazione al rilascio (Fasi 7–8)

> **Stato**: il prototipo è completo e verificato in modalità dimostrativa. **Non è pronto per la produzione.** Manca l'integrazione con il backend reale (§6): oggi i dati vivono solo sul dispositivo e su un server simulato nel browser.

## 1. Applicazione installabile (PWA)

| Elemento | Stato |
|---|---|
| Manifest | nome, nome breve, colori, `display: standalone`, orientamento libero, scorciatoie (Oggi, Notifiche) |
| Icone | PNG 192 e 512, *maskable* 512 per Android, `apple-touch-icon` 180 per iOS, SVG |
| Service Worker | Workbox (vite-plugin-pwa): tutte le risorse in cache, PDF e font compresi, quindi l'app si apre ed esporta anche offline; le cache vecchie vengono pulite |
| Schermata di avvio | mostrata subito dall'HTML, finché i dati del dispositivo sono pronti: niente pagina bianca |
| Aggiornamenti | la nuova versione si scarica in background e compare il banner "Aggiorna ora". Se ci sono operazioni non inviate, l'app chiede conferma e spiega che restano salvate. Ogni ora il tablet controlla se ci sono nuove versioni. **I dati (IndexedDB) non vengono toccati.** |
| Schermo intero | l'app installata si apre senza barre del browser; c'è anche il pulsante "Schermo intero" in *Notifiche → App sul dispositivo* |
| Archiviazione persistente | l'app chiede al browser di non liberare i dati locali (`navigator.storage.persist`) e ne mostra l'esito |

**Compatibilità** (dichiarata in base agli standard, non provata su dispositivi fisici):

| Dispositivo | Supporto |
|---|---|
| Chrome / Edge su Android, Windows, ChromeOS | installazione da browser o con il pulsante "Installa" |
| Safari su iPad e iPhone | installazione da *Condividi → Aggiungi alla schermata Home*; avvisi di sistema solo da iOS 16.4, con l'app installata |
| Firefox desktop | funziona senza installazione |

**Installazione su un tablet aziendale**:
1. Aprire l'indirizzo dell'app con Chrome (Android) o Safari (iPad).
2. Installare con il pulsante *Installa* (Android) oppure *Condividi → Aggiungi alla schermata Home* (iPad).
3. Aprire l'app dall'icona e accedere.
4. In *Menu → Notifiche* attivare gli avvisi.
5. Lasciare attivo il salvataggio dei dati del sito. Non usare la navigazione privata.

## 2. Offline e sincronizzazione (cosa funziona davvero)

**Disponibili offline**:
- timbrature, pause, attività e timer, correzioni;
- rapportini con foto e firme;
- imprevisti, richieste di correzione e conferma del cartellino (invio differito);
- magazzino e consumi;
- report, PDF, Excel e CSV, calcolati sui dati presenti sul dispositivo.

Tutto viene salvato subito in IndexedDB con una coda di invio. La sincronizzazione funziona così:
- L'indicatore è sempre visibile in alto: online o offline, quante operazioni sono in coda, conflitti, errori. Durante l'invio l'icona ruota. Su smartphone mostra solo icona e numero.
- L'invio parte da solo ogni 5 secondi, al ritorno della rete e quando l'app torna in primo piano. La pagina *Sincronizzazione* ha il pulsante "Sincronizza ora".
- Gli errori vengono ritentati con attesa crescente. Se un'operazione fallisce 3 volte compare un banner con "Riprova ora".
- In caso di conflitto un banner rosso porta alla scelta tra la versione del dispositivo e quella del server.
- Non ci sono duplicati né perdite: ogni operazione ha un id idempotente e riusa lo stesso payload nei ritentativi; i consumi di magazzino hanno una chiave univoca; i record diventano "sincronizzato" solo dopo la conferma del server.
- Un invio interrotto da una chiusura dell'app viene ripreso al riavvio, con lo stesso id: il server non lo applica due volte.
- La bozza del rapportino viene salvata anche quando l'app va in secondo piano.

**Limite attuale**: il "server" è simulato nel browser. Finché non c'è il backend reale (§6), i dati restano sul singolo dispositivo e non sono condivisi tra tablet.

## 3. Notifiche e promemoria

Il centro notifiche è in `#/notifiche`, con la campanella e il contatore delle non lette nella barra in alto.

| Per chi | Notifiche |
|---|---|
| Lavoratore | nuovo intervento assegnato; intervento modificato (riprogrammato, annullato, dettagli cambiati, secondo lo storico delle modifiche); promemoria degli interventi imminenti (entro 2 ore, oppure domani); rapportini in bozza; cartellino da confermare; cartellino approvato, restituito o riaperto; richiesta di correzione gestita |
| Amministratore | cartellini da approvare; richieste di correzione aperte; materiali sotto scorta; ritorni da pianificare; presenze non chiuse |

- Le notifiche sono **derivate dai dati esistenti**: non c'è nessuna tabella nuova e nessun dato duplicato. Lo stato "letta" è salvato per utente sul dispositivo.
- Gli **avvisi di sistema** si attivano dall'utente (*Notifiche → Attiva avvisi*, con il permesso del browser). Toccando un avviso si apre la pagina collegata. Alla prima attivazione non vengono riproposte le notifiche già esistenti.

**Limiti**:
- Le **push con app chiusa** non sono attive: servono un server push (Web Push con chiavi VAPID, per esempio una Edge Function di Supabase) e il backend reale. La configurazione è predisposta (`VITE_PUSH_VAPID_PUBLIC_KEY`).
- Senza server push, gli avvisi arrivano solo con l'app aperta o in secondo piano.
- I promemoria "imminenti" vengono calcolati quando l'app è in uso.

## 4. Configurazione per ambiente

| File | Uso |
|---|---|
| `prototype/.env.example` | elenco documentato di tutte le variabili |
| `prototype/.env.test` | build di test: `npm run build:test` (server simulato, dati di prova, striscia "AMBIENTE DI TEST") |
| `prototype/.env.produzione.example` | modello per la produzione: va copiato in `.env.production.local` (ignorato da git) sulla macchina che compila |

| Variabile | Significato |
|---|---|
| `VITE_AMBIENTE` | `demo` (predefinito, usato da GitHub Pages) · `test` (con `VITE_BACKEND=supabase`: collaudo dell'accesso reale, `npm run build:pilota` con `.env.pilota.local`) · `produzione`. In produzione nessun dato dimostrativo, nessun account demo e i dati locali non vengono mai cancellati |
| `VITE_BACKEND` | `simulato` · `supabase` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | progetto Supabase. La chiave *anon* è pubblica per natura; la chiave *service_role* **non va mai** in variabili `VITE_*` |
| `VITE_PUSH_VAPID_PUBLIC_KEY` | chiave **pubblica** VAPID per le push |
| `VITE_AZIENDA_RAGIONE_SOCIALE`, `_INDIRIZZO`, `_PARTITA_IVA`, `_LOGO_SVG` | dati aziendali stampati sui documenti |
| `VITE_VERSIONE_APP` | versione mostrata nell'app |

**Protezione**: con `VITE_AMBIENTE=produzione` l'app **non si avvia** se manca il backend reale o la sua configurazione. Mostra una pagina che spiega cosa manca e non tocca nessun dato. Oggi la build di produzione è quindi bloccata di proposito.

## 5. Database e migrazioni

Le migrazioni sono in `database/migrations/`, verificate su PostgreSQL 16 locale. Le migrazioni 0001–0012 sono state **applicate al progetto Supabase "worklog"** il 25/11/2026, con autorizzazione (docs/18 §0):

| Migrazione | Contenuto |
|---|---|
| 0001–0007 | anagrafiche, interventi, presenze e attività, rapportini, cartellini, audit, sincronizzazione, regole |
| 0008 | richieste di correzione |
| 0009 | magazzino, materiali e movimenti |
| 0010 | impostazioni aziendali |
| 0011 | nome utente dei profili (accesso con nome utente e PIN) |
| 0012 | RPC `public.mio_profilo()`: profilo dell'utente autenticato e dati aziendali (accesso reale) |

**Da preparare prima della produzione** (non ancora scritte, servono le decisioni del §6):
- 0013 (scritta, Fase 12): campi del rapporto autonomo (`richiesta`, `indirizzo_intervento`, verifica dell'amministratore); da applicare insieme alle successive (0013–0015 si applicano prima della sincronizzazione; finché la 0014 non è applicata, l'amministratore operativo si indica con `VITE_AMMINISTRATORI_OPERATIVI`);
- 0014 (scritta, Fase 13): `profili.amministratore_operativo` e flusso dei rapporti (`fase_invio`, restituzione, revisione);
- 0015 (scritta, Fase 14): `stati_amministrativi` ed `esportazioni` (storico amministrativo, registro dei PDF);
- 0016: collegamento `profili.id → auth.users.id`, funzioni di ruolo e **policy RLS** su tutte le tabelle;
- 0017: RPC `sync_apply`, che replica le regole del server simulato (idempotenza per `op_id`, `row_version`, numerazione dei rapportini, ricezione della conferma del cartellino, duplicati dei consumi tramite `movimenti_chiave_uk`);
- 0018: bucket di Storage privati per foto e firme, con le relative policy.

Le procedure di inizializzazione e import dei dati aziendali sono in `database/avvio-produzione/` (vedi docs/18).

## 6. Integrazioni ancora da realizzare (bloccanti per la produzione)

1. **Autenticazione reale**: ✅ implementata (Fase 12). Con `VITE_BACKEND=supabase` l'app accede con nome utente e PIN su Supabase Auth, scarica profilo e dati aziendali (`mio_profilo`) e, dopo il primo accesso, consente l'accesso senza rete con un'impronta PBKDF2 del PIN salvata sul dispositivo. Manca la creazione degli account dall'app (serve una funzione lato server: la chiave di servizio non può stare nell'app); per ora si creano dall'amministrazione su Supabase.
2. **`SupabaseRemoteApi`**: implementazione del contratto `RemoteApi` (`src/sync/remote-api.ts`) sull'RPC `sync_apply`, più lo scaricamento dei dati del server (oggi c'è solo l'invio).
3. **Policy RLS** e ruoli, da scrivere e poi verificare con un collaudo dedicato. Le verifiche di sicurezza sono escluse da queste fasi.
4. **Archiviazione dei file** (foto e firme) su Storage, al posto dei data URL in IndexedDB.
5. **Server push** (facoltativo): Edge Function con chiavi VAPID.
6. **Lettura delle impostazioni aziendali** dal database invece che dalle variabili di build.

## 7. Backup, ripristino e aggiornamenti

- **Backup del database** (produzione):
  - backup giornalieri automatici di Supabase, conservati 7 giorni sul piano Pro (PITR facoltativo, a pagamento);
  - in più, un dump settimanale esterno: `pg_dump --format=custom --no-owner --schema=app "$DATABASE_URL" > backup_$(date +%F).dump`, conservato fuori da Supabase e cifrato.
- **Ripristino**: su un progetto di prova eseguire `pg_restore --no-owner --dbname "$DATABASE_URL_PROVA" backup_AAAA-MM-GG.dump`, verificare e solo dopo, con autorizzazione, ripristinare in produzione. Provare il ripristino una volta al trimestre.
- **Dati sui dispositivi**: le operazioni non ancora inviate esistono solo sul tablet. Prima di reinstallare, resettare o sostituire un tablet, controllare che la pagina *Sincronizzazione* mostri "Tutto sincronizzato".
- **Aggiornamenti dell'app**:
  1. compilare (`npm run build:produzione`) e pubblicare la cartella `dist/`;
  2. alla riapertura i tablet mostrano "Aggiorna ora", e i dati locali restano.
  
  Per le modifiche al database: applicare le migrazioni prima, in modo compatibile con la versione precedente, e pubblicare l'app dopo.

## 8. Procedura di rilascio consigliata

1. Completare le integrazioni del §6 e le migrazioni 0013–0018. Collaudarle su un progetto Supabase **di test**, compreso un collaudo di sicurezza dedicato, che non rientra in queste fasi.
2. Compilare `npm run build:test` e far provare il flusso completo a 1–2 lavoratori per una settimana.
3. Con autorizzazione: creare il progetto di produzione, applicare le migrazioni, inizializzare i dati (docs/18).
4. Compilare `npm run build:produzione` con `.env.production.local` e pubblicare sull'hosting scelto.
5. Installare l'app sui tablet, primo accesso accompagnato, poi monitorare la sincronizzazione per i primi giorni.
