# Initial Release Architecture — Phase 11

**Application:** Dqnamo POS (`82cc08b7-ecc8-4968-b1b8-331b54b755ff`)  
**Release Phase:** Phase 11 — Initial Release, Company Onboarding, Practice Mode & User Access Management  
**Base Currency:** Sudanese Pound (`SDG`) with Multi-Currency & Historical Exchange-Rate Snapshot Integrity  
**Database Engine:** Google Cloud SQL for PostgreSQL 16 (27 Tables, 100% Additive & Backward-Compatible)

---

## 1. Executive Summary

Phase 11 prepares Dqnamo POS for its first multi-tenant-ready production release while strictly preserving all existing operational records (`comp-default`, 113 products, 84 exchange-rate history records, 20 intelligence lifecycle records, and existing sales/inventory state).

The architecture introduces six cohesive subsystems integrated directly into the existing Express + Vite React + Drizzle PostgreSQL stack:

1. **First-Run Onboarding & Workspace Switcher** (`FirstRunOnboardingModal.tsx`, `POST /api/onboarding/companies`, `GET /api/onboarding/status`):
   - **Option A — Practice Mode (`comp-demo-practice`)**: Isolated training sandbox preloaded with realistic multi-category Sudanese retail data.
   - **Option B — Create New Company**: Production 3-step wizard creating an isolated `CompanyProfile`, initial `Main Branch`, and initial `COMPANY_OWNER` account with `scrypt` password hashing and idempotency protection.
   - **Existing Company Safeguard**: If a production company (`comp-default`) is already configured, the application boots directly into the operational workspace without forcing a duplicate company creation wizard.
2. **Practice Mode Sandbox Isolation** (`PracticeModeBanner.tsx`, `.data/practice-store-state.json`, `dqnamo_pos_practice_*`):
   - Persistent top banner indicating active Practice Mode with one-click **Reset Demo Data** (`POST /api/onboarding/practice/reset`), **Create Real Company**, and **Exit Practice Mode** actions.
   - Server-side middleware (`isPracticeModeRequest`) routes all `/api/store-sync` and product/transaction mutations in Practice Mode exclusively to `.data/practice-store-state.json`, guaranteeing zero impact on production PostgreSQL or `.data/store-state.json`.
3. **13-Module Interactive Guided Product Tour & 8-Item Onboarding Checklist** (`training-tour.ts`, `TrainingTourOverlay.tsx`, `TrainingCenterSection.tsx`):
   - Covers all 13 required POS, Inventory, Purchasing, Accounting, Branch, Reports, Intelligence, Notifications, Users & Permissions, and Company Settings modules.
   - Persists progress per user and company (`dqnamo_pos_training_tour_v1_<companyId>_<userId>`) and dynamically adapts to user capabilities.
4. **Enterprise Employee Management & Security** (`UsersPermissionsSection.tsx`, `release-onboarding.service.ts`):
   - Password hashing via Node.js `crypto.scryptSync` (64-byte key + 16-byte random salt) and timing-safe verification (`crypto.timingSafeEqual`).
   - Session tokens hashed via `SHA-256` (`auth_sessions`).
   - Employee deactivation (`POST /api/users/:id/status` and `/api/users/:id/deactivate`) revokes active sessions and blocks login while preserving historical sales/audit attribution.
   - **Last Active Owner Protection**: Server-side guard prevents deactivating or demoting the last active `COMPANY_OWNER` of any company.
5. **Granular Role-Based Access Control (RBAC)** (`rbac-capabilities.ts`, `requireServerCapability`):
   - **9 System Roles** (`COMPANY_OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `INVENTORY_MANAGER`, `ACCOUNTANT`, `PURCHASING_MANAGER`, `REPORT_VIEWER`, `CUSTOM_ROLE`).
   - **46 Granular Capabilities** organized across **11 Functional Groups**, enforced both in UI navigation/controls and on backend Express routes.
6. **Multi-Company & Multi-Branch Data Isolation**:
   - Every operational table and state store carries `company_id` (default `'comp-default'`) and `branch_id`.
   - Server endpoints validate `assertActorCompanyMatch` and `assertActorBranchAccess` against the authenticated user record on the server, never trusting client-supplied role headers or cross-tenant IDs.

---

## 2. System Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        React 19 + Tailwind CSS Client                      │
│  ┌──────────────────────────┐  ┌───────────────────────┐  ┌──────────────┐ │
│  │ PracticeModeBanner       │  │ FirstRunOnboarding    │  │ TrainingTour │ │
│  │ (Reset / Exit / Setup)   │  │ Modal (Practice / New)│  │ Overlay (13) │ │
│  └────────────┬─────────────┘  └───────────┬───────────┘  └──────┬───────┘ │
│               └────────────────────────────┼─────────────────────┘         │
│                                            ▼                               │
│                     POSContext (WorkspaceMode + CompanyScope               │
│                       + 46-Capability RBAC + Tour + Checklist)             │
└────────────────────────────────────────────┬───────────────────────────────┘
                                             │ HTTP REST (/api/*)
                                             │ Headers: x-user-id, x-company-id,
                                             │ x-workspace-mode, x-session-token
                                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     Express Backend (server.ts + Routers)                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ releasePlatformRouter (/api/onboarding, /api/auth, /api/companies,   │  │
│  │                        /api/branches, /api/users, /api/audit-logs)   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ requireServerCapability Middleware & Actor Verification              │  │
│  │ (Resolves user from server store, blocks spoofed headers & cross-co) │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└───────────────┬────────────────────────────┬───────────────────────────────┘
                │                            │
     PRODUCTION │                            │ PRACTICE MODE
                ▼                            ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────────┐
│ Cloud SQL PostgreSQL 16      │  │ Isolated Practice Sandbox                │
│ (27 Tables, company_id       │  │ (.data/practice-store-state.json +       │
│  scoped, default comp-default│  │  dqnamo_pos_practice_* localStorage)     │
│  + .data/store-state.json)   │  │  Safe 1-Click Reset — Zero Prod Impact   │
└──────────────────────────────┘  └──────────────────────────────────────────┘
```
