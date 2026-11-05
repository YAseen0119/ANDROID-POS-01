# Known Limitations & Post-Release Roadmap

**Application:** Dqnamo POS (`82cc08b7-ecc8-4968-b1b8-331b54b755ff`)  
**Release Phase:** Phase 11 — Initial Production Release

---

## 1. Documented Operational Boundaries

1. **Advisory-Only Intelligence & Replenishment Engine**:
   - By strict operational safety design, Smart Replenishment, Branch Transfer, and Price/Margin insights never execute automatic purchase orders, stock transfers, or price changes. Human review and explicit operator execution are always required.
2. **Offline / Hybrid State Synchronization**:
   - POS transactions, customer balances, stock movements, and platform onboarding states synchronize between browser storage (`localStorage`), `.data/store-state.json` / `.data/platform-onboarding-state.json`, and Cloud SQL PostgreSQL (`products`, `currencies`, `exchange_rates`, `companies`, `branches`, `users`, `intelligence_item_lifecycle`).
   - In multi-terminal LAN/cloud deployments, terminals poll `/api/store-sync` every 5 seconds to merge state idempotently.
3. **Practice Mode Sandbox Reset Scope**:
   - `POST /api/onboarding/practice/reset` is intentionally hard-locked to `companyId === 'comp-demo-practice'`. Production companies cannot be wiped or reset through any UI or API endpoint.
4. **External Email / SMS Gateway**:
   - Employee password resets and initial credential provisioning are performed directly by the Company Owner or System Administrator in **Settings → Users, Branches & Granular RBAC** without requiring paid external SMTP or SMS subscriptions.
