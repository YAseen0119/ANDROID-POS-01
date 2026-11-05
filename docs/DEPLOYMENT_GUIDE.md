# Deployment & Operations Guide — Dqnamo POS

**Application:** Dqnamo POS (`82cc08b7-ecc8-4968-b1b8-331b54b755ff`)  
**Runtime:** Node.js 22+ / Express (`server.ts`) + React 19 / Vite 6 + Google Cloud SQL for PostgreSQL 16

---

## 1. Environment Configuration (`.env.example`)

Configure the following environment variables in production (never commit secrets to version control):

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Runtime mode (`development` or `production`) | `production` |
| `DB_HOST` / `PGHOST` | PostgreSQL instance host or socket path | `127.0.0.1` |
| `DB_PORT` / `PGPORT` | PostgreSQL port | `5432` |
| `DB_USER` / `PGUSER` | PostgreSQL database user | `postgres` |
| `DB_PASS` / `PGPASSWORD` | PostgreSQL database password | *(Secret Manager)* |
| `DB_NAME` / `PGDATABASE` | PostgreSQL database name | `postgres` |

---

## 2. Build, Verification & Startup Commands

```bash
# 1. Install dependencies
npm install

# 2. Run TypeScript & Lint verification
npm run lint

# 3. Run full automated unit, security, analytics & Phase 11 release test suites
npx tsx --test \
  src/analytics/phase11-release.test.ts \
  src/lib/training-tour.test.ts \
  src/analytics/phase95-lifecycle.test.ts \
  src/analytics/phase10-intelligence.test.ts \
  src/analytics/unmet-demand.validation.test.ts \
  src/analytics/analytics.test.ts \
  src/analytics/acceptance-audit.test.ts \
  src/lib/pos-calculations.test.ts \
  src/lib/inventory-rules.test.ts \
  src/lib/exchange-rate-storage.test.ts \
  src/lib/barcode-scanner-engine.test.ts \
  src/lib/number-utils.test.ts

# 4. Build production frontend bundle (dist/)
npm run build

# 5. Start full-stack production server on port 3000
npm start
```

---

## 3. Database Backup & Rollback Procedure

1. **Pre-Release Snapshot**:
   - Before applying any schema updates in production, take an on-demand Cloud SQL backup snapshot and export `.data/store-state.json` and `.data/platform-onboarding-state.json`.
2. **Additive Schema Evolution**:
   - All Phase 11 schema changes (`companies`, `auth_sessions`, and `company_id` columns defaulting to `'comp-default'`) are strictly additive.
3. **Rollback Procedure**:
   - Because no existing columns or tables were dropped or renamed, rolling back application code to Phase 10/9.5 requires zero destructive database changes.
