# Initial Production Release Checklist — Phase 11

**Application:** Dqnamo POS (`82cc08b7-ecc8-4968-b1b8-331b54b755ff`)  
**Release Status:** **READY FOR INITIAL PRODUCTION RELEASE**

---

## 1. Database & Operational Safety Verification

- [x] **Zero Destructive Migrations**: All Phase 11 schema updates (`companies`, `auth_sessions`, and `company_id` / RBAC / branch columns) were applied additively via `cloudsql.UpdateSchema`.
- [x] **100% Preservation of Existing Operational Data**:
  - `products`: `113` rows intact (`company_id = 'comp-default'`).
  - `exchange_rates`: `84` rows intact (`company_id = 'comp-default'`).
  - `store_settings`: `1` row intact (`company_id = 'comp-default'`).
  - `intelligence_item_lifecycle`: `20` rows intact (`company_id = 'comp-default'`).
- [x] **Read-Only Analytics**: All analytics and intelligence queries remain strictly read-only (`SELECT`-only).
- [x] **No Auto-Execution of Recommendations**: Replenishment, transfer, and pricing insights remain strictly advisory.

---

## 2. Onboarding, Practice Mode & Isolation Verification

- [x] **Existing Company Safeguard**: Existing configured company (`comp-default`) boots directly without forcing duplicate company creation.
- [x] **First-Run Onboarding Modal**: Accessible on first-run or on-demand from Header & Settings, offering **Option A (Practice Mode)** and **Option B (Create New Company)**.
- [x] **Practice Mode Sandbox (`comp-demo-practice`)**:
  - Persistent `PracticeModeBanner` visible across all tabs.
  - Complete isolation in `.data/practice-store-state.json` and `dqnamo_pos_practice_*` storage keys.
  - One-click **Reset Demo Data** resets only `comp-demo-practice` (`403 FORBIDDEN_PRODUCTION_RESET` if attempted on production).
- [x] **Production Company Creation (`POST /api/onboarding/companies`)**:
  - Validates company identity, currency (`SDG` default), main branch, and owner password strength.
  - Enforces `idempotencyKey` replay protection.

---

## 3. Authentication, User Management & Granular RBAC Verification

- [x] **Cryptographic Password Hashing**: Passwords hashed with `crypto.scryptSync` (64-byte key + 16-byte random salt) and verified with `crypto.timingSafeEqual`.
- [x] **Session Token Security**: Session tokens hashed with `SHA-256`.
- [x] **9 System Roles & 46 Granular Capabilities**: Defined in `src/lib/rbac-capabilities.ts` and enforced in both UI and backend routes (`requireServerCapability`).
- [x] **Last Active Owner Protection**: Server blocks deactivating or demoting the last active `COMPANY_OWNER` (`400 LAST_OWNER_PROTECTION`).
- [x] **Employee Deactivation**: Deactivated accounts (`isActive = false`) have their sessions revoked and cannot log in (`403 ACCOUNT_DEACTIVATED`), while historical transactions remain intact.
