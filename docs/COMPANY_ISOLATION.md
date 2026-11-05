# Multi-Company & Multi-Branch Data Isolation

**Application:** Dqnamo POS  
**Module:** Server-Side Tenant & Branch Boundary Enforcement (`release-onboarding.service.ts` & `src/db/schema.ts`)

---

## 1. Tenant Isolation Model (`company_id`)

Every operational table in PostgreSQL (`src/db/schema.ts`) and every record in the server platform store carries an explicit `company_id` column/property:
- **Existing Production Data**: Preserved under `company_id = 'comp-default'`.
- **Practice Mode Sandbox**: Isolated under `company_id = 'comp-demo-practice'`.
- **Newly Created Companies**: Assigned a cryptographically unique tenant identifier (`comp-<timestamp>-<hex>`) upon completion of the Company Onboarding Wizard.

### Tables Carrying `company_id`
- `companies` (Primary tenant table)
- `branches` (`company_id`, indexed via `branches_company_idx`)
- `roles` (`company_id`, indexed via `roles_company_idx`)
- `users` (`company_id`, indexed via `users_company_idx`)
- `auth_sessions` (`company_id`, indexed via `auth_sessions_company_idx`)
- `currencies`, `exchange_rates`, `categories`, `products`, `product_barcodes`, `customers`, `Customer_Ledger`, `suppliers`, `Supplier_Ledger`, `purchase_orders`, `purchase_order_items`, `stock_movements`, `sales`, `sale_items`, `payments`, `expenses`, `audit_logs`, `store_settings`, `unmet_demand_logs`, `intelligence_item_lifecycle`

---

## 2. Server-Side Enforcement Rules

1. **Authoritative Actor Resolution (`resolveAuthenticatedActorFromRequest`)**:
   - The server resolves the requesting user from the verified `Bearer` / `x-session-token` hash in `auth_sessions` or the verified `x-user-id` in the server-side user store.
   - The actor's `companyId`, `systemRole`, `capabilities`, and `assignedBranchIds` are loaded exclusively from the server record — **never** from client-supplied role headers.
2. **Cross-Company Access Prevention (`assertActorCompanyMatch`)**:
   - If a request attempts to read, create, update, or deactivate records belonging to another `companyId` (e.g. Company A Owner querying `GET /api/users?companyId=<CompanyB>` or `PUT /api/companies/<CompanyB>`), the server immediately rejects the request with `HTTP 403` and `code: 'FORBIDDEN_CROSS_COMPANY_ACCESS'`.
3. **Branch Access Enforcement (`assertActorBranchAccess`)**:
   - Each employee is assigned a primary `branchId` and an `assignedBranchIds: string[]` list.
   - `COMPANY_OWNER` and `ADMIN` roles have company-wide branch visibility.
   - Branch-scoped employees (`CASHIER`, `INVENTORY_MANAGER`, etc.) are restricted to their `assignedBranchIds`. Attempting to access another branch returns `HTTP 403` (`FORBIDDEN_BRANCH_ACCESS`).
