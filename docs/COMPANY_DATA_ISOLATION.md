# Multi-Company & Practice Mode Data Isolation — Dqnamo POS

## 1. Multi-Tenant Company Scope Isolation
Every production company created in Dqnamo POS receives a unique `companyId` (`comp-<timestamp>-<hash>`) and operates within an isolated data boundary:
- **Client-Side Storage Namespace:** All operational collections in `localStorage` are scoped by `getCompanyStorageKey(baseKey, companyId)` (`<baseKey>__<companyId>`), ensuring products, invoices, customers, stock movements, currencies, exchange rates, and employee accounts never leak across companies.
- **Server-Side Isolation:** Platform records (`companies`, `branches`, `users`, `sessions`, `auditLogs`) and analytics queries filter by `companyId` and `workspaceMode`.

---

## 2. Practice Mode Sandbox Separation (`comp-demo-practice`)
Practice Mode (`workspaceMode === 'PRACTICE'`) is 100% isolated from Production Mode:
- **Persistent Visual Indicator:** A high-visibility amber banner (`PracticeModeBanner`) is pinned at the top of the screen whenever Practice Mode is active, displaying quick actions to **Reset Demo Data** or **Exit Practice Mode**.
- **Separate Storage Engine:**
  - Server-side demo data is stored in `.data/practice-store-state.json` under `companyId: 'comp-demo-practice'`.
  - Client-side demo data uses dedicated `dqnamo_pos_practice_*` keys (`PRACTICE_STORAGE_KEYS`).
- **Production Snapshot Protection:** Entering Practice Mode captures a memory snapshot of the active production state and restores it cleanly upon exiting.
- **Isolated Demo Reset:** Calling `POST /api/onboarding/practice/reset` or `resetPracticeModeData()` rejects any `companyId !== 'comp-demo-practice'` (`403 FORBIDDEN_PRODUCTION_RESET`) and only resets the synthetic training records.
