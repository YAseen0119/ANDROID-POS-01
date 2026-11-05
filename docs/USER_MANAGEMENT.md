# Employee & User Account Management Guide

**Application:** Dqnamo POS  
**UI Component:** `src/components/settings/UsersPermissionsSection.tsx`  
**Backend Service:** `src/server/release-onboarding.service.ts`

---

## 1. Supported Employee Management Operations

Authorized administrators (`COMPANY_OWNER`, `ADMIN`, or users granted `users.view`, `users.create`, `users.edit`, `users.deactivate`, `roles.manage`, `permissions.manage`) can manage their company's workforce from **Settings → Users, Branches & Granular RBAC**:

1. **Create Employee Account (`POST /api/users`)**:
   - Full Name (English & Arabic)
   - Login Username / Email & Phone Number
   - System Role selection (`COMPANY_OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `INVENTORY_MANAGER`, `ACCOUNTANT`, `PURCHASING_MANAGER`, `REPORT_VIEWER`, `CUSTOM_ROLE`)
   - Primary Branch (`branchId`) and Multi-Branch Assignment (`assignedBranchIds`)
   - Password (`scrypt` hashed) and Quick POS Terminal PIN
   - Assigned POS Terminal Name (English & Arabic)
2. **Edit Employee Profile, Role & Branches (`PUT /api/users/:id`)**:
   - Update employee role, branch assignments, terminal name, or individual capability overrides.
   - Role escalation guard prevents non-Owner/non-Admin users from assigning `COMPANY_OWNER` or `ADMIN` roles (`403 FORBIDDEN_ROLE_ESCALATION`).
3. **Granular 46-Capability Matrix Override**:
   - Expand any employee card (`[data-testid="expand-capabilities-btn-<userId>"]`) to inspect or toggle individual capabilities across all 11 functional groups.
4. **Password & PIN Reset (`POST /api/users/:id/reset-password`)**:
   - Administrators can securely reset an employee's password (enforcing strength validation and `scrypt` hashing) or terminal PIN without exposing existing password hashes.
5. **Account Deactivation & Reactivation (`POST /api/users/:id/status` & `POST /api/users/:id/deactivate`)**:
   - **Deactivation over Deletion**: Employees with historical transactions or audit records are never hard-deleted. Deactivating an account sets `isActive = false`, records `deactivatedAt` and `deactivatedBy`, immediately revokes all active sessions for that user, and blocks future logins (`403 ACCOUNT_DEACTIVATED`).
   - Historical invoices, stock movements, and audit logs retain the employee's name and ID for complete financial traceability.

---

## 2. Last Active Company Owner Protection

- Every production company must retain at least one active `COMPANY_OWNER`.
- If an actor attempts to deactivate or demote a `COMPANY_OWNER` when no other active `COMPANY_OWNER` exists in that company, the server blocks the operation with `HTTP 400` and error code `LAST_OWNER_PROTECTION`.
- The UI also disables the Deactivate button on the sole active owner badge to prevent accidental lockout.
