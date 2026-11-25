#!/usr/bin/env python3
"""
Genera docs/05-dizionario-dati.md leggendo il catalogo di un PostgreSQL LOCALE su cui è stato
applicato database/schema.sql. Tipi, nullabilità, default, vincoli, indici e trigger vengono
dal database; le descrizioni dal dizionario DESCRIZIONI qui sotto.

Uso: python3 database/genera-dizionario.py "<parametri psql>"   es. "-h /percorso/socket -p 55432 -U postgres -d verifica"
"""
import json
import pathlib
import subprocess
import sys

PSQL = sys.argv[1] if len(sys.argv) > 1 else "-d verifica"
OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "05-dizionario-dati.md"

TABELLE = {
    "profili": "Utenti dell'azienda (amministratori e operai). In Fase 2 l'id coincide con auth.users.id.",
    "clienti": "Clienti dell'azienda.",
    "sedi_cliente": "Sedi operative dei clienti, luogo degli interventi.",
    "interventi": "Lavori programmati o richiesti presso un cliente/sede. Gli interventi di ritorno puntano al followup che li ha generati.",
    "intervento_operai": "Squadra assegnata a un intervento (più operai, un responsabile). Le rimozioni sono logiche.",
    "presenze": "Giornata lavorativa di un operaio: entrata, uscita, valori registrati in origine, ultimo segnale dell'app.",
    "pause_presenza": "Pause all'interno di una presenza.",
    "attivita_lavoro": "Intervalli di tempo della presenza attribuiti a cliente, intervento, attività interna o trasferimento. Le correzioni producono nuove righe collegate.",
    "imprevisti": "Problemi riscontrati durante il lavoro.",
    "allegati": "Metadati di foto, firme e documenti; il contenuto è su Supabase Storage.",
    "rapportini": "Documento del lavoro eseguito (autonomo, da intervento o da ritorno). Le bozze non arrivano al server.",
    "rapportino_operai": "Operai presenti sul lavoro documentato dal rapportino.",
    "rapportino_attivita": "Attività da cui derivano le ore del rapportino.",
    "rapportino_materiali": "Materiali utilizzati.",
    "rapportino_foto": "Foto del rapportino (collegamento ad allegati).",
    "rapportino_firme": "Firme di cliente e operaio (collegamento ad allegati).",
    "followup": "Ritorni e lavori da ultimare generati da un rapportino.",
    "imprevisto_allegati": "Foto allegate agli imprevisti.",
    "transizioni_cartellino": "Regole ammesse della macchina a stati del cartellino (configurazione).",
    "cartellini_mensili": "Testata del cartellino mensile di un operaio: stato corrente e versioni.",
    "cartellino_versioni": "Snapshot immutabile di una versione del cartellino (giorni e totali calcolati dal motore ore).",
    "approvazioni_cartellino": "Registro append-only di ogni transizione del cartellino.",
    "audit_log": "Registro tecnico append-only delle modifiche (prima/dopo).",
    "dispositivi": "Dispositivi che sincronizzano.",
    "sync_operazioni": "Registro di idempotenza: ogni op_id è applicato una sola volta e la risposta è memorizzata.",
    "contatori_documenti": "Contatori per le numerazioni definitive assegnate dal server.",
    "richieste_correzione": "Richieste di correzione inviate dal lavoratore e gestite dall'amministrazione (Fase 3). Non modificano dati.",
}

COMUNI = {
    "created_at": "Istante di creazione (server). Immutabile.",
    "created_by": "Utente che ha creato il record. Immutabile.",
    "updated_at": "Ultima modifica (trigger).",
    "updated_by": "Utente dell'ultima modifica.",
    "row_version": "Versione della riga per il controllo di concorrenza ottimistico; +1 a ogni UPDATE.",
    "device_id": "Dispositivo che ha originato la modifica.",
    "client_created_at": "Istante di creazione secondo il dispositivo (anche offline).",
    "deleted_at": "Eliminazione logica: se valorizzato il record è escluso.",
    "id": "Chiave primaria UUID v4 generata sul dispositivo.",
}

DESCRIZIONI = {
    ("profili", "ruolo"): "admin | operaio.",
    ("profili", "attivo"): "Se falso l'utente non può accedere né timbrare.",
    ("profili", "colore"): "Colore in agenda.",
    ("profili", "ore_giornaliere_contratto"): "Ore contrattuali giornaliere (riferimento per report).",
    ("clienti", "partita_iva"): "11 cifre, univoca tra i clienti attivi; null se assente.",
    ("sedi_cliente", "note_accesso"): "Istruzioni di accesso mostrate agli operai (chiavi, orari, DPI).",
    ("interventi", "codice"): "Codice leggibile assegnato dal server (INT-AAAA-NNN).",
    ("interventi", "sede_id"): "Sede del cliente (FK composta con cliente_id).",
    ("interventi", "stato"): "da_programmare | programmato | in_corso | da_ultimare | completato | annullato.",
    ("interventi", "followup_origine_id"): "Per gli interventi di tipo ritorno: followup che li ha generati.",
    ("interventi", "durata_prevista_min"): "Durata prevista in minuti (pianificazione, non ore lavorate).",
    ("intervento_operai", "ruolo"): "responsabile (uno per intervento) | squadra.",
    ("presenze", "data_lavoro"): "Giorno lavorativo = giorno locale dell'entrata (anche se l'uscita è dopo mezzanotte).",
    ("presenze", "entrata_at"): "Entrata effettiva (eventualmente corretta).",
    ("presenze", "uscita_at"): "Uscita effettiva; null = giornata aperta.",
    ("presenze", "entrata_registrata_at"): "Entrata registrata in origine dal dispositivo. Immutabile.",
    ("presenze", "uscita_registrata_at"): "Uscita registrata in origine. Immutabile una volta valorizzata.",
    ("presenze", "ultimo_segnale_at"): "Ultimo istante in cui l'app era attiva: base per proporre l'uscita dopo una chiusura anomala.",
    ("presenze", "uscita_automatica"): "Uscita indicata a posteriori (non al momento).",
    ("pause_presenza", "tipo"): "pranzo | breve | altro.",
    ("pause_presenza", "attivita_sospesa_id"): "Attività interrotta dalla pausa, proposta alla ripresa.",
    ("attivita_lavoro", "tipo"): "lavoro_cliente | trasferimento | interna | da_definire.",
    ("attivita_lavoro", "codice_interno"): "Per tipo interna: magazzino | manutenzione_mezzi | formazione | ufficio | riunione.",
    ("attivita_lavoro", "fine_at"): "Null = timer in corso.",
    ("attivita_lavoro", "origine"): "timer | manuale | correzione | divisione.",
    ("attivita_lavoro", "sostituisce_id"): "Riga sostituita da questa correzione/divisione.",
    ("attivita_lavoro", "superata_da_id"): "Se valorizzato la riga è storica e non conta nel calcolo.",
    ("attivita_lavoro", "annullata"): "Attività annullata (con motivo); resta nello storico.",
    ("attivita_lavoro", "motivo_correzione"): "Obbligatorio per correzioni, inserimenti manuali e annullamenti.",
    ("attivita_lavoro", "chiusura_automatica"): "Timer chiuso dal sistema all'uscita.",
    ("imprevisti", "richiede_ritorno"): "Suggerisce l'esito 'serve un ritorno' nel rapportino.",
    ("imprevisti", "blocca_lavoro"): "Il problema impedisce di proseguire.",
    ("allegati", "entita"): "rapportino | imprevisto | intervento.",
    ("allegati", "storage_path"): "Percorso su Storage; valorizzato solo dopo upload confermato.",
    ("allegati", "sha256"): "Impronta del contenuto: verifica dell'integrità e deduplica degli upload.",
    ("rapportini", "numero"): "Numero definitivo R-AAAA-NNNN assegnato dal server.",
    ("rapportini", "numero_provvisorio"): "Numero generato sul dispositivo, unico per device_id.",
    ("rapportini", "intervento_id"): "Null = rapportino autonomo.",
    ("rapportini", "followup_id"): "Valorizzato per i rapportini di un ritorno.",
    ("rapportini", "esito"): "completato | da_ultimare | ritorno_necessario | non_eseguito.",
    ("rapportini", "note_interne"): "Obbligatorie (≥ 5 caratteri) se l'esito richiede un seguito.",
    ("rapportini", "stato"): "completato | firmato | annullato (le bozze restano sul dispositivo).",
    ("followup", "rapportino_origine_id"): "Rapportino che ha generato il seguito (sempre presente).",
    ("followup", "intervento_ritorno_id"): "Intervento pianificato per il ritorno.",
    ("followup", "rapportino_chiusura_id"): "Rapportino che ha chiuso il seguito.",
    ("followup", "stato"): "aperto | pianificato | chiuso | annullato.",
    ("cartellini_mensili", "stato"): "in_compilazione | da_confermare_operaio | confermato_operaio | in_attesa_approvazione | da_correggere | approvato | riaperto.",
    ("cartellini_mensili", "versione_corrente"): "Ultima versione generata (0 = nessuna).",
    ("cartellini_mensili", "versione_approvata"): "Versione approvata; resta valorizzata anche dopo una riapertura.",
    ("cartellino_versioni", "giorni"): "Array JSON dei giorni (entrata, uscita, pause, netta, attribuite, non attribuite, anomalie, correzioni).",
    ("cartellino_versioni", "totali"): "Totali del mese in millisecondi (somma dei giorni, nessun arrotondamento intermedio).",
    ("cartellino_versioni", "impronta"): "Impronta dello snapshot: rileva cambiamenti dei dati dopo la generazione.",
    ("cartellino_versioni", "motore_versione"): "Versione dell'algoritmo ore usato per il calcolo.",
    ("approvazioni_cartellino", "azione"): "genera | conferma | segnala_discrepanza | ricezione_server | approva | richiedi_correzione | rifiuta | rigenera | riapri.",
    ("approvazioni_cartellino", "ruolo_utente"): "admin | operaio | sistema.",
    ("sync_operazioni", "op_id"): "Chiave di idempotenza generata sul dispositivo.",
    ("sync_operazioni", "base_versione"): "row_version su cui il client ha basato la modifica.",
    ("sync_operazioni", "risposta"): "Risposta restituita: riusata identica per i ritentativi.",
}

QUERY = r"""
with t as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind = 'r'
)
select json_agg(json_build_object(
  'tabella', t.relname,
  'colonne', (select json_agg(json_build_object('nome', a.attname, 'tipo', format_type(a.atttypid, a.atttypmod),
                'null', not a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
              from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped),
  'vincoli', (select json_agg(json_build_object('nome', co.conname, 'tipo', co.contype, 'def', pg_get_constraintdef(co.oid)) order by co.contype, co.conname)
              from pg_constraint co where co.conrelid = t.oid),
  'indici', (select json_agg(json_build_object('nome', i.indexname, 'def', i.indexdef) order by i.indexname)
             from pg_indexes i where i.schemaname = 'app' and i.tablename = t.relname),
  'trigger', (select json_agg(json_build_object('nome', tg.tgname, 'funzione', p.proname) order by tg.tgname)
              from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid where tg.tgrelid = t.oid and not tg.tgisinternal)
) order by t.relname) from t;
"""


def main() -> None:
    out = subprocess.run(["psql", *PSQL.split(), "-At", "-c", QUERY], check=True, capture_output=True, text=True).stdout
    tabelle = json.loads(out)
    ordine = list(TABELLE)
    tabelle.sort(key=lambda t: ordine.index(t["tabella"]) if t["tabella"] in ordine else 999)
    tipi = {"p": "PK", "f": "FK", "u": "UNIQUE", "c": "CHECK", "x": "EXCLUDE"}
    righe = [
        "# 05 – Dizionario dati",
        "",
        "> **Generato** da `database/genera-dizionario.py` leggendo il catalogo di PostgreSQL 16 locale dopo l'applicazione di `database/schema.sql`. Non modificare a mano: aggiornare le migrazioni o le descrizioni nello script e rigenerare.",
        "",
        "Schema: `app`. Colonne tecniche comuni (presenti nelle tabelle sincronizzabili):",
        "",
        "| Colonna | Significato |",
        "|---|---|",
    ]
    righe += [f"| `{k}` | {v} |" for k, v in COMUNI.items()]
    righe += ["", "Indice: " + " · ".join(f"[{t['tabella']}](#{t['tabella'].replace('_', '_')})" for t in tabelle), ""]
    for t in tabelle:
        nome = t["tabella"]
        righe += [f"## {nome}", "", TABELLE.get(nome, ""), "", "| Campo | Tipo | Null | Default | Descrizione |", "|---|---|---|---|---|"]
        riferimenti = {}
        for v in t["vincoli"] or []:
            if v["tipo"] == "f":
                cols = v["def"].split("(", 1)[1].split(")", 1)[0].split(", ")
                dest = v["def"].split("REFERENCES ", 1)[1].split("(", 1)[0].replace("app.", "")
                for col in cols:
                    riferimenti.setdefault(col, dest)
        for c in t["colonne"]:
            desc = DESCRIZIONI.get((nome, c["nome"]), COMUNI.get(c["nome"], ""))
            if not desc and c["nome"] in riferimenti:
                desc = f"Riferimento a `{riferimenti[c['nome']]}`."
            desc = desc.replace("|", "\\|")
            default = (c["default"] or "").replace("|", "\\|")
            righe.append(f"| `{c['nome']}` | {c['tipo'].replace('|', '/')} | {'sì' if c['null'] else 'no'} | {('`' + default + '`') if default else ''} | {desc} |")
        if t["vincoli"]:
            righe += ["", "**Vincoli**", ""]
            for v in t["vincoli"]:
                righe.append(f"- {tipi.get(v['tipo'], v['tipo'])} `{v['nome']}`: `{v['def']}`")  # elenco, non tabella
        indici = [i for i in (t["indici"] or []) if not i["nome"].endswith("_pkey")]
        if indici:
            righe += ["", "**Indici**", ""]
            for i in indici:
                righe.append(f"- `{i['nome']}`: `{i['def'].split(' USING ', 1)[-1]}`")
        if t["trigger"]:
            righe += ["", "**Trigger**: " + ", ".join(f"`{g['nome']}` → `{g['funzione']}()`" for g in t["trigger"])]
        righe.append("")
    OUT.write_text("\n".join(righe), encoding="utf-8")
    print(f"Scritto {OUT} ({len(tabelle)} tabelle)")


if __name__ == "__main__":
    main()
