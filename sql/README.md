# SQL scripts (Abdullah sandbox)

| File | Database | Purpose |
|------|----------|---------|
| `01_olist_oltp_abd_schema.sql` | `olist_oltp_abd` | OLTP tables — replica of shared `olist_oltp` |
| `02_olist_olap_abd_schema.sql` | `olist_olap_abd` | Empty star — replica of shared `olist_olap` (SERIAL SKs) |

Create DBs + apply DDL + load OLTP data:

```bash
export PGPASSWORD=...   # tgsteam password
./scripts/create_abd_databases.sh
```

Reset only the OLAP rows before rerunning the KNIME workflows:

```bash
./scripts/reset_olap_abd.sh
```

Legacy shared-targeting DDL/scripts: `archive/sql_pre_abd/`, `archive/scripts_pre_abd/`.
