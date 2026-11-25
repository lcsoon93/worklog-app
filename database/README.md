# database/

Schema PostgreSQL del gestionale (target: PostgreSQL 15+ / Supabase). **Le migrazioni sono solo preparate: non sono mai state applicate a database remoti.**

| File | Contenuto |
|---|---|
| `migrations/0001…0007_*.sql` | Migrazioni in ordine (fonte unica) |
| `schema.sql` | Concatenazione generata: `./build-schema.sh` |
| `er-diagram.mmd` | Diagramma ER (Mermaid) |
| `tests/verifica_regole.sql` | 28 verifiche di vincoli e trigger (casi validi e non validi) |
| `genera-dizionario.py` | Genera `docs/05-dizionario-dati.md` dal catalogo del database |

## Verifica su un PostgreSQL locale usa-e-getta

Richiede PostgreSQL 15+ installato in locale (provato con 16.15).

```bash
# 1. cluster temporaneo (fuori dal repository)
D=/var/lib/postgresql/fase1-verifica           # oppure una cartella qualsiasi dell'utente postgres
su postgres -c "mkdir -p $D && /usr/lib/postgresql/16/bin/initdb -D $D/data -A trust -E UTF8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55432 -k $D' -l $D/log start"

# 2. schema + verifiche
./build-schema.sh
psql -h $D -p 55432 -U postgres -c "create database verifica"
psql -h $D -p 55432 -U postgres -d verifica -v ON_ERROR_STOP=1 -f schema.sql
psql -h $D -p 55432 -U postgres -d verifica -f tests/verifica_regole.sql   # termina con "VERIFICA COMPLETATA"

# 3. dizionario dati (opzionale)
python3 genera-dizionario.py "-h $D -p 55432 -U postgres -d verifica"

# 4. arresto
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data stop"
```

Il cluster di verifica è locale e temporaneo; non contiene dati reali.
