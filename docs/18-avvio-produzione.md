# 18 – Configurazione di produzione e avvio aziendale (Fase 9)

> Il documento prepara ogni passo e indica quali richiedono la tua autorizzazione (🔒). Il §0 riporta cosa è stato attivato, su tua autorizzazione. Dominio, hosting e pubblicazione non sono attivati.

## 0. Stato del progetto Supabase "worklog" (25/11/2026)

Piano **Free**, regione eu-west-1. Eseguito con l'autorizzazione del titolare:

| Passo | Esito |
|---|---|
| Pulizia | rimossi la tabella `work_logs` della vecchia app (vuota), la sua funzione e le sue policy. Resta il bucket vuoto `foto-lavori`: Supabase non lo lascia cancellare via SQL, si elimina da *Storage* oppure si riusa per le foto |
| Migrazioni | 0001–0012 applicate (0012: RPC `mio_profilo`, eseguibile solo da utenti autenticati, verificata: senza accesso viene rifiutata, con accesso restituisce solo il proprio profilo; le tabelle dello schema `app` non sono raggiungibili direttamente): 31 tabelle e 3 viste nello schema `app`; `btree_gist` nello schema `extensions` |
| Verifica | `verifica_regole.sql` eseguito sul progetto dentro una transazione annullata: tutte le regole rispettate, nessun dato di prova rimasto |
| Dati aziendali | `impostazioni_azienda`: Comp.Ha.S. Assistance S.R.L., P.IVA 03035421217, Corso Vittorio Emanuele 41 B, isolato D · 80059 Torre del Greco (NA), tel./fax 081 8828730 · 081 8829682, info@comphas.it, www.comphas.it (in `preferenze.sito_web`), logo (SVG con l'immagine incorporata). Nei PDF compaiono tramite le variabili `VITE_AZIENDA_*`, compresa `VITE_AZIENDA_CONTATTI` |
| Magazzino | MAG-01 "Magazzino centrale" |
| Account | `comphas` = Gianmario Falanga, amministratore; `luca` = Luca Pinto, tecnico (operaio). Accesso con **nome utente + PIN di 6 cifre**, provato su Supabase Auth: PIN corretto accettato, PIN errato rifiutato |
| Clienti e materiali | nessuna importazione: si inseriscono dall'app |

I PIN non sono scritti in nessun file del repository: in Supabase esiste solo il loro hash.

**Accesso reale nell'app (Fase 12)**: la versione compilata con `npm run build:pilota` (file `.env.pilota.local`, vedi `.env.pilota.example`) usa questi account. Verificato nel browser contro il progetto: PIN errato rifiutato, `luca` entra come tecnico, `comphas` come amministratore, accesso senza rete dopo il primo accesso. Dalla Fase 15 **la sincronizzazione è attiva**: rapporti, presenze, interventi, restituzioni e approvazioni passano dal server e arrivano sugli altri dispositivi secondo i permessi (docs/17 §5–6).

**Come funziona l'accesso** (decisione D-42): ogni account ha in Supabase Auth un'email tecnica non recapitabile, `<nome utente>@utenti.worklog.invalid`, e il PIN come password. L'app chiede solo nome utente e PIN.

**Da fare in dashboard** (non è modificabile da qui):
- *Authentication → Sign In / Providers*: disattivare **Allow new users to sign up**. Gli account si creano solo dall'amministrazione.
- Per cambiare un PIN: *Authentication → Users → (utente) → Reset password* non va bene, perché l'email non è recapitabile. Il PIN si cambia da SQL, oppure dall'app quando ci sarà la funzione dedicata.

**Sicurezza del PIN**: 6 cifre fanno 1 milione di combinazioni. Supabase limita i tentativi di accesso, ma un PIN resta più debole di una password: non riusarlo altrove e cambiarlo se viene comunicato ad altri.

## 1. Infrastruttura predisposta

| Componente | Preparato | Da fare |
|---|---|---|
| Separazione degli ambienti | `VITE_AMBIENTE` demo/test/produzione; file `.env.test` e `.env.produzione.example`; build separate (`build:test`, `build:produzione`); la produzione non si avvia senza backend reale | — |
| Hosting della PWA | build statica in `prototype/dist/` utilizzabile da qualsiasi hosting HTTPS; `public/_headers` con le regole di cache per Netlify e Cloudflare Pages (Service Worker mai in cache a lungo); `base: './'` funziona anche in una sottocartella | 🔒 scegliere l'hosting e collegarlo. GitHub Pages resta per la **demo** |
| Dominio e HTTPS | — | 🔒 registrare o indicare il dominio (es. `app.<azienda>.it`) e configurare il DNS (CNAME verso l'hosting). L'HTTPS è automatico su Pages, Netlify e Cloudflare. **Una PWA richiede HTTPS** |
| Supabase di produzione | progetto "worklog" attivo (piano Free), migrazioni 0001–0017 applicate, dati aziendali e account creati, accesso reale e sincronizzazione funzionanti | collaudo su due dispositivi; Storage per foto e firme (facoltativo) |
| Supabase di test | — | 🔒 un secondo progetto, separato, per il collaudo |
| Backup | procedura in docs/17 §7 | 🔒 scegliere la conservazione (7 giorni inclusi oppure PITR) |

## 2. Database e dati iniziali (`database/avvio-produzione/`)

| File | Scopo |
|---|---|
| `01_dati_iniziali.template.sql` | impostazioni aziendali (tabella `impostazioni_azienda`, migrazione 0010), primo amministratore (id dell'utente invitato in Supabase Auth), magazzino centrale |
| `02_import_anagrafiche.template.sql` | import da CSV di clienti, sedi, lavoratori e materiali |
| `*.csv.modello` | modelli dei CSV (separatore `;`, UTF-8), con righe di esempio fittizie |

**Nessuna sovrascrittura**: ogni inserimento avviene solo se il dato non esiste già (stessa P.IVA, sede, email o codice), e un'esecuzione ripetuta non duplica nulla. L'ho verificato su PostgreSQL locale usa e getta eseguendo ogni script due volte e controllando che una riga modificata dopo il primo inserimento non venga toccata dal secondo.

**Ordine di inizializzazione** 🔒:
1. applicare le migrazioni in ordine: `0001 … 0012` (fatto), poi `0013–0017` (fatto, 27/11/2026);
2. invitare gli utenti in Supabase Auth (§3);
3. eseguire `01_dati_iniziali`;
4. compilare i CSV ed eseguire `02_import_anagrafiche`;
5. controllare a campione in app.

## 3. Utenti e configurazione aziendale

- **Profilo e logo aziendale**: ragione sociale, indirizzo e P.IVA vanno nella tabella `impostazioni_azienda` e, finché il client non la legge, anche nelle variabili `VITE_AZIENDA_*` della build. Il logo va fornito in **SVG**, perché viene incorporato nei PDF che si generano anche offline.
- **Amministratori e lavoratori**: un elenco con nome, cognome, email, ruolo, qualifica e ore contrattuali (modello `lavoratori.csv.modello`).
- **Procedura di invito e attivazione**, da eseguire quando l'autenticazione reale sarà integrata:
  1. l'amministratore invita l'utente dalla dashboard di Supabase (*Authentication → Invite user*) o da una funzione dedicata;
  2. l'utente riceve l'email, imposta la password e il suo `auth.users.id` diventa l'`id` del profilo (script 01 o 02);
  3. al primo accesso sul tablet l'app scarica i dati.
  
  Per disattivare un utente si imposta `profili.attivo = false`, senza cancellarlo.
- **Configurazioni operative**: le soglie del motore ore e il preavviso dei promemoria sono in `impostazioni_azienda.preferenze`. I valori predefiniti sono quelli di D-16, che richiedono la tua approvazione.

**Nessun account reale è stato creato.**

## 4. PWA sui dispositivi aziendali

Manifest, icone e Service Worker sono completi e verificati nella build. La procedura di installazione sui tablet e la gestione degli aggiornamenti sono descritte in docs/17 §1 e §7.

## 5. Avvio controllato (procedura consigliata)

| Passo | Attività | Chi |
|---|---|---|
| 1 | Inizializzazione dell'ambiente: progetto Supabase, migrazioni, hosting, dominio, build di produzione | tecnico, 🔒 |
| 2 | Configurazione degli utenti: inviti e primo amministratore | amministrazione, 🔒 |
| 3 | Clienti, sedi e materiali da CSV, poi controllo in app e verifica delle giacenze iniziali con un carico di apertura | amministrazione |
| 4 | Verifica dei flussi con 1–2 lavoratori per una settimana: timbrature, attività, rapportino con foto e firma, consumo di materiale, sincronizzazione offline, cartellino del mese | tecnico + lavoratori pilota |
| 5 | Primo utilizzo di tutti i lavoratori: installazione accompagnata, attivazione delle notifiche, prova di una giornata completa | amministrazione |
| 6 | Chiusura del primo mese: conferma dei cartellini, approvazione, PDF; confronto con il sistema precedente | amministrazione |

## 6. Costi ricorrenti stimati

| Voce | Stima | Fonte |
|---|---|---|
| Supabase Pro (produzione) | 25 $/mese, con 10 $ di crediti di calcolo che coprono un progetto *Micro* | [supabase.com/pricing](https://supabase.com/pricing) |
| Supabase, progetto di test | con un secondo progetto Micro nella stessa organizzazione si arriva a circa 35 $/mese (esempio della FAQ: 3 progetti = 45 $/mese); in alternativa un progetto di test sul piano gratuito, in un'organizzazione separata | [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) |
| Supabase, quote incluse | 8 GB di disco, 250 GB di traffico, 100.000 utenti attivi al mese: ampiamente sufficienti per una PMI. Il limite di spesa è attivo per impostazione predefinita | [supabase.com/pricing](https://supabase.com/pricing) |
| Hosting della PWA | GitHub Pages, Netlify e Cloudflare Pages hanno piani gratuiti adeguati a un'app statica di queste dimensioni | **da verificare** sul sito del fornitore scelto |
| Dominio | circa 10–20 €/anno per un `.it` | **da verificare** con il registrar |
| PITR (ripristino puntuale) | componente aggiuntivo facoltativo | **da verificare** sul listino attuale |

I prezzi sono stati verificati sul sito di Supabase a novembre 2026 e possono cambiare: vanno ricontrollati prima dell'attivazione.

## 7. Problemi che impediscono l'avvio

1. **Backend reale**: autenticazione, sincronizzazione e permessi sono attivi (Fase 15). Restano l'archiviazione delle foto su Storage e la proiezione nelle tabelle normalizzate (docs/17 §6).
2. **Collaudo di sicurezza** (RLS, autorizzazioni) ancora da fare. È stato escluso da queste fasi, ma è necessario prima di inserire dati reali.
3. **Decisioni in attesa di approvazione**: D-15, D-16, D-23, D-29, D-31, D-32 (docs/11).
4. **Server push** non configurato: facoltativo, perché le notifiche funzionano comunque nell'app.

## 8. Passaggi che richiedono la tua autorizzazione 🔒

- Creazione dei progetti Supabase (test e produzione) e attivazione del piano a pagamento.
- Applicazione delle migrazioni su qualsiasi database remoto.
- Importazione dei dati aziendali reali (clienti, sedi, lavoratori, materiali).
- Creazione e invito degli account reali.
- Scelta e collegamento dell'hosting, del dominio e del DNS.
- Pubblicazione della build di produzione.
- Commit, push e merge di questo lavoro.
