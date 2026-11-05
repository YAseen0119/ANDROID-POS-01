# Company Onboarding & Initial Owner Setup Guide

**Application:** Dqnamo POS  
**Module:** First-Run Onboarding & Production Company Creation (`FirstRunOnboardingModal.tsx` & `release-onboarding.service.ts`)

---

## 1. Onboarding Entry Behavior

1. **Existing Configured Company (`comp-default`):**
   - Because the existing installation already contains configured operational records under `comp-default` (`113` products, `84` exchange rates, `1` store settings row), the application preserves all existing records and boots directly into the active company without forcing an intrusive setup wizard.
   - Administrators and operators can open the **Workspace & Company Onboarding Modal** at any time via:
     - The top header **Workspace / Onboarding** button (`[data-testid="header-workspace-onboarding-btn"]`).
     - **Settings → Training & Onboarding Center** (`[data-testid="training-open-onboarding-wizard-btn"]`).
2. **Fresh Unconfigured Installation (`requiresInitialSetup === true`):**
   - When no production company has `setupCompleted = true`, the **First-Run Onboarding Wizard** (`[data-testid="first-run-onboarding-modal"]`) opens automatically and presents two clear entry options:
     - **Option A — Practice Mode (`وضع التدريب التجريبي`)**: Instant entry into an isolated training environment with preloaded demo data.
     - **Option B — Create New Company (`إنشاء شركة جديدة`)**: Guided 3-step production company and initial owner setup.

---

## 2. Production Company Creation Wizard (3 Steps)

### Step 1: Company Identity & Regional Settings
- **Company Legal Name** (`legalName`, required, min 2 characters)
- **Display / Trading Name** (`displayName` & `displayNameAr`)
- **Business Category** (`Supermarket & Grocery`, `Pharmacy & Medical`, `Electronics & Wholesale`, `Fashion & Retail`, `General Trading`)
- **Country & City** (defaults to `Sudan` / `Khartoum`)
- **Address, Phone, Email & Tax/Registration Number (`taxNumber`)**
- **Default Language** (`ar` RTL or `en` LTR) and **Timezone** (`Africa/Khartoum`)

### Step 2: Currency Policy & Main Branch Setup
- **Base Accounting Currency**: Defaults to **`SDG` (Sudanese Pound — الجنيه السوداني)**, preserving full compatibility with historical exchange-rate snapshots.
- **Currency Display Format**: `symbol_amount`, `code_amount`, or `amount_symbol`.
- **Exchange Rate Update Policy**: `owner_only`, `admin_only`, or `admin_or_manager`.
- **Main Branch Configuration**:
  - Branch Name (e.g., `الفرع الرئيسي - الخرطوم` / `Khartoum Main Branch`)
  - Branch Code (e.g., `BR-MAIN-01`)
  - Branch City, Address & Phone

### Step 3: Initial Owner (`COMPANY_OWNER`) Account
- **Owner Full Name** (English / Arabic)
- **Login Username or Email** (unique across company)
- **Password & Confirmation**:
  - Validated on both client and server (`validatePasswordStrength`): minimum 8 characters, must contain at least one letter and one number.
  - Hashed on the server using `crypto.scryptSync` with a 16-byte cryptographic salt (`hashPasswordScrypt`).
- **Quick POS Terminal PIN** (4–6 digits)

---

## 3. Idempotency & Duplicate Submission Protection

- Every submission includes an `idempotencyKey`.
- If the request is retried or submitted twice within the onboarding window with the same `idempotencyKey` (or identical `legalName` + `ownerUsername`), `createCompanyAndInitialOwner()` returns the existing company, main branch, and owner with `idempotentReplay: true` (`HTTP 200`) instead of creating duplicate company records.
- Upon completion, the user can immediately launch the **13-Step Interactive Guided Tour** or proceed directly to the **8-Item Onboarding Checklist**.
