# Fresh Installation Guide — Dqnamo POS

## 1. Overview
**Dqnamo POS** is engineered as a production-grade Point of Sale system that starts with **zero default business records** on a fresh installation or after an authorized company factory reset.

No sample products, fictional customers, pre-populated exchange rates, fake sales, or fabricated accounting balances are seeded into Production Mode.

---

## 2. Fresh Installation State
When the application is launched for the first time (or when `.data/platform-onboarding-state.json` contains no configured production companies):
- **Production Companies:** `0` (`requiresInitialSetup: true`).
- **Products & Categories:** `0` (`[]`).
- **Customers & Suppliers:** `0` (`[]`).
- **Employee Accounts:** `0` (until the Initial Company Owner account is created during setup).
- **Sales, Purchases & Inventory Movements:** `0` (`[]`).
- **Currencies & Exchange Rates:** `0` active company currencies unless explicitly selected or added by the owner.
- **Practice Mode Sandbox (`comp-demo-practice`):** Completely isolated in its own separate demo store (`practice-store-state.json` and `dqnamo_pos_practice_*` localStorage keys).

---

## 3. First-Run Company Setup Wizard
On first launch, the operator is presented with the **Company Onboarding & Workspace Hub** (`FirstRunOnboardingModal`):
1. **Option A — Practice Mode Sandbox:** Launches the isolated training environment (`workspaceMode === 'PRACTICE'`) with a persistent amber Practice Mode banner.
2. **Option B — Create New Production Company:** Launches the 5-step Production Company Setup Wizard:
   - **Step 1 — Company Information:** Company Legal Name (required), Display Name (EN/AR), Business Type, City/Country, Phone, Email, Tax Number, and Default Language (`ar` RTL or `en` LTR).
   - **Step 2 — Currency & Exchange Rate Policy:** Choose to start with **0 default currencies** (*Skip Currency Setup Now*) or specify the Accounting Base Currency (`SDG` or custom) and optional secondary currencies with explicit owner-configured exchange rates.
   - **Step 3 — Initial Main Branch:** Main Branch Name (EN/AR), Branch Code, City, Address, and Phone.
   - **Step 4 — Initial Company Owner Account:** Owner Full Name, Login Username (required, unique), Password (required, policy-validated), Confirm Password (must match), and Terminal PIN. Passwords are hashed using `crypto.scryptSync` + 16-byte random salt and never stored in plaintext.
   - **Step 5 — Confirmation & Launch:** Reviews all entered parameters and creates the Company, Main Branch, Owner Account (`COMPANY_OWNER` with all 46 capabilities), and immutable Audit Trail records (`COMPANY_CREATED`, `INITIAL_OWNER_CREATED`).

---

## 4. Security & Post-Setup Protection
- **Idempotency Protection:** Duplicate clicks, browser refreshes, or network retries with the same `idempotencyKey` return the existing company record without creating duplicates.
- **Post-Setup Endpoint Lockdown:** Once at least one production company is initialized, `POST /api/onboarding/companies` requires an authenticated `COMPANY_OWNER` or `ADMIN` session token (`403 FORBIDDEN_COMPANY_CREATION` for unauthenticated or unauthorized callers).
