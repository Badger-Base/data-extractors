# UW-Madison Data Extractors

Extracts and loads UW–Madison academic data for [BadgerBase](https://badgerbase.app) from MadGrades, the Course Search & Enroll system, and Rate My Professor.

The pipeline is TypeScript and targets **PostgreSQL**. It lives in [`pg/`](pg/). The MySQL pipeline that used to sit at the repo root was removed once the Postgres migration completed — see `docs/current-mysql-schema.md` if you need the historical schema.

## 📁 Project Structure

```
data-extractors/
├── pg/                      # The ETL pipeline
│   ├── src/
│   │   ├── extractors/      # courses.ts, madgrades.ts, rmp.ts
│   │   ├── utils/           # sql-writer.ts, get-waf-token.ts
│   │   ├── seed.ts          # full pipeline against a fresh database
│   │   ├── run-dumps.ts     # load generated SQL into Postgres
│   │   ├── db-init.ts       # apply schema/001_init.sql
│   │   ├── notify.ts        # email subscribers when a seat opens
│   │   └── flush-cache.ts   # invalidate the API's Redis cache
│   ├── schema/              # 001_init.sql, 002_search_trgm.sql
│   ├── scripts/             # instructor fuzzy-matching experiments
│   ├── tests/               # unit tests for the transforms
│   └── data/sql/            # generated SQL, gitignored
├── src/utils/               # WAF token tooling (see below)
├── data/                    # legacy CSV/SQL fixtures
├── docs/                    # schema and API reference
└── .github/workflows/
```

## 🔧 Data Sources

- **MadGrades API** — historical grade distributions, cumulative and recent GPAs, median grade
- **Course Search & Enroll** — course catalog, sections, instructors, meetings, live enrollment status
- **Rate My Professor** — instructor ratings, difficulty, would-take-again

## 🚀 Getting Started

Everything runs from `pg/`:

```bash
cd pg
npm ci
cp .env.example .env    # set DATABASE_URL and MADGRADES_API_TOKEN
```

### Commands

| Command | What it does |
|---|---|
| `npm run db:init` | Apply the schema to an empty database |
| `npm run seed` | Run the full pipeline against a fresh database |
| `npm run extract:courses` | Course Search & Enroll → `data/sql/courses.sql` |
| `npm run extract:madgrades` | MadGrades → `data/sql/madgrades.sql` |
| `npm run extract:rmp` | Rate My Professor → `data/sql/rmp.sql` |
| `npm run load` | Load all generated SQL into Postgres |
| `npx tsx src/run-dumps.ts courses.sql` | Load one dump |
| `npm run notify` | Email subscribers whose watched sections opened |
| `npm run flush-cache` | Invalidate the API's Redis cache |
| `npm test` | Unit tests for the transforms |

`npm test` at the repo root delegates to `pg`.

## ⏱ Scheduled Workflows

| Workflow | Schedule | Purpose |
|---|---|---|
| `pg-hourly-course-update.yml` | Hourly, 7 AM–10 PM CST | Refresh enrollment status, notify subscribers, flush cache |
| `pg-semester-data-refresh.yml` | Manual / seasonal | Full refresh of courses, grades and RMP data |
| `update-waf-token.yml` | Scheduled | Refresh the Course Search & Enroll WAF token |
| `test.yml` | Push / PR to `new-main` | Run the `pg` test suite |
| `keep-alive.yml` | Scheduled | Keep the repo active so scheduled workflows don't get disabled |

## 🔐 WAF Token Tooling

Course Search & Enroll sits behind a WAF. Two helpers at the repo root keep a valid token in GitHub Actions secrets, driven by `update-waf-token.yml`:

```bash
npm run waf:token            # fetch a token via headless Chrome
npm run waf:update-secret    # fetch one and write it to the repo secret
npm run test:waf             # exercise the challenge flow
```

These still live in `src/utils/` rather than `pg/`. `pg/src/utils/get-waf-token.ts` is the pipeline's own copy; consolidating the two is tracked as follow-up work.

See `docs/WAF_TOKEN_SETUP.md` for setup.

## 📚 Documentation

- `docs/DATA_SCHEMA.md` — data model
- `docs/API_DOCUMENTATION.md` — upstream API notes
- `docs/WAF_TOKEN_SETUP.md` — WAF token setup
- `docs/current-mysql-schema.md` — historical MySQL schema, kept for reference
