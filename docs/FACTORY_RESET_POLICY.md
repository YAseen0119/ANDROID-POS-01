# Factory Reset Policy & Two-Scope Authorization — Dqnamo POS

## 1. Security Requirements
Dqnamo POS implements an explicitly authorized **Two-Scope Factory Reset Workflow** (`executeCompanyFactoryReset` in `src/server/release-onboarding.service.ts` and `executeAuthorizedFactoryReset` in `src/context/POSContext.tsx`).

Before any reset executes, the UI displays:
- **What Will Be Deleted**
- **What Will Be Preserved**
- **Explicit Scope Distinction** (**Scope A: Local Device Reset** vs **Scope B: Company Factory Reset**)

No public API allows arbitrary unauthenticated users to reset a company.

---

## 2. Scope A — Local Device Reset (`LOCAL_DEVICE_RESET`)
Resets local application state on the current device only:
- Clears local cached products, sales, customers, movements, currencies, and exchange rates in `localStorage`.
- Clears local device session state.
- Does **not** delete server-side company records, branches, or user accounts.
- Records a `LOCAL_DEVICE_RESET_AUTHORIZED` audit event.
- Leaves the local workspace with **zero default business records** (`0` products, `0` currencies, `0` accounts).

---

## 3. Scope B — Company Factory Reset (`COMPANY_FACTORY_RESET`)
Operates exclusively on the selected company workspace after passing 5 mandatory security gates:
1. **Owner Authentication:** Verifies the active `COMPANY_OWNER` account for the selected company.
2. **Explicit Warning:** Displays the destructive impact summary and scope warning banner.
3. **Company Name Confirmation:** Requires typing the exact legal or display name of the company (`confirmCompanyName`). Mismatches are rejected with `400 COMPANY_NAME_CONFIRMATION_MISMATCH`.
4. **Password Re-Authentication:** Verifies the Owner's password via `verifyPasswordScrypt` (or Owner PIN). Invalid credentials are rejected with `401 INVALID_OWNER_CREDENTIALS`.
5. **Final Confirmation Action:**
   - Removes only the target company's records, branches, and employee accounts.
   - Immediately revokes all active sessions (`isRevoked = true`) belonging to the reset company.
   - Preserves all other tenant companies and the isolated Practice Mode sandbox (`comp-demo-practice`).
   - Records an immutable `COMPANY_FACTORY_RESET_EXECUTED` compliance audit log entry.
   - Returns the application to the clean First-Run Onboarding screen with **zero default business data**.
