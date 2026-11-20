# Security and Quality Audit Report — Hungry Birds POS

- **Audit Date:** 2026-11-21
- **Auditor Role:** Independent Security & Quality Auditor (`security-and-quality-audit`)
- **Scope:** Full repository release candidate audit (`hungrybirds-pos-modern/` production React/TypeScript/Vite app, `firestore.rules`, `netlify.toml`, `vercel.json`, `export-data.html`, and root legacy files/test runner).
- **Entry Points Reviewed:**
  - Authentication & Session Management (`src/lib/auth.ts`, `src/components/LoginScreen.tsx`, `src/lib/staffAccounts.ts`)
  - Owner Authorization PIN & Role-Based Access Control (`src/lib/ownerPin.ts`, `src/components/OwnerPinModal.tsx`, `src/components/Sidebar.tsx`, `src/components/SalesHistoryModal.tsx`, `src/components/AdminSettingsModal.tsx`, `src/components/ExpensesModal.tsx`)
  - Cloud Sync & Firestore Security Rules (`src/lib/sync.ts`, `src/lib/syncMap.ts`, `src/lib/config.ts`, `firestore.rules`)
  - File Import / Export & Receipt Rendering (`src/lib/backup.ts`, `src/lib/export.ts`, `src/lib/receipt.ts`, `export-data.html`)
  - Hardware / Network Printer Transports (`src/lib/printer.ts`, `src/lib/escpos.ts`)
  - Hosting & Build Configurations (`netlify.toml`, `vercel.json`, `hungrybirds-pos-modern/vite.config.ts`)
- **Sensitive Assets:** Staff credentials and auth tokens (`hb.syncToken`, `loggedUser`), Owner authorization PIN hash (`ownerPinHash`), financial records (`sales`, `refunds`, `expenses`, `salaryPayments`, `advancePayments`), and customer PII (`name`, `phone`, `address`).

---

## 1. Executive Summary & Gate Verdict

| Severity | Found | Fixed & Verified | Open / Deferred |
|----------|-------|------------------|-----------------|
| **Critical** | 0 | 0 | 0 |
| **High** | 2 | 2 (`AUD-001`, `AUD-002`) | 0 |
| **Medium** | 3 | 2 (`AUD-003`, `AUD-004`), 1 documented architectural constraint (`AUD-005`) | 0 blocking |
| **Low** | 2 | 2 (`AUD-006`, `AUD-007`) | 0 |

**Release Gate Status:** **PASS** — Zero open Critical or High findings.

---

## 2. Detailed Findings

### `AUD-001` [HIGH] — CSV Formula Injection (Spreadsheet Injection) in Sales, Expenses, and Inventory Exports
- **Location:** `hungrybirds-pos-modern/src/lib/export.ts:11-15` (called by `SalesHistoryModal.tsx:121`, `ExpensesModal.tsx:68`, `InventoryModal.tsx:95`)
- **Evidence:**
  ```ts
  const cell = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  ```
  Untrusted strings (including website order item names/notes, customer names, and expense descriptions) were wrapped in double quotes without neutralizing leading spreadsheet formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`).
- **Impact:** If a customer or staff member submits a payload such as `=CMD|'/C calc'!A0` or `=IMPORTXML(...)` and the Owner opens `Sales_Export_*.csv` or `Expenses_Export_*.csv` in Excel or Google Sheets, the spreadsheet application can execute arbitrary formulas or exfiltrate cell data.
- **Fix & Verification:** Implemented and exported `sanitizeCsvCell(value)` in `src/lib/export.ts`, which prefixes any non-numeric string starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a leading single quote `'`. Verified by unit tests in `tests/export.test.ts` (`4 passed`). **Status: FIXED & VERIFIED.**

---

### `AUD-002` [HIGH] — Broken Access Control on Sale Re-open (`Edit`) and Unconfigured Owner PIN Modal
- **Location:** `hungrybirds-pos-modern/src/components/SalesHistoryModal.tsx:34,276-283` and `hungrybirds-pos-modern/src/components/OwnerPinModal.tsx:25-30,52,59-75`
- **Evidence:**
  1. In `SalesHistoryModal.tsx`, `canVoid` (`role === 'OWNER' || role === 'MANAGER'`) gated the `Refund` and `Void` buttons, but the `Edit` button (`onReopen(sale)`, which calls `reopenSale` to **delete** the sale from `db.sales` and Firestore `sales/{cloudId}` and load its items into the active cart) was rendered unconditionally for all roles (`CASHIER` and `WAITER`).
  2. When no Owner PIN was configured yet (`pinExists === false`), clicking `Edit` as `CASHIER` or `Refund` as `MANAGER` opened `OwnerPinModal` displaying `"No owner PIN is set yet. The Owner creates one now (4–8 digits)."` with an active `"Create owner PIN"` input, while `AdminSettingsModal` provided no UI for the `OWNER` to set or rotate the Owner PIN (and `withOwnerPin` skipped `OwnerPinModal` whenever `role === 'OWNER'`).
- **Impact:** Non-manager staff could access the sale re-open/deletion trigger, and managers were deadlocked from obtaining owner PIN authorization on fresh installs unless the Owner happened to unlock the `LiveStockPanel` widget first.
- **Fix & Verification:**
  1. Gated the `Edit` button in `SalesHistoryModal.tsx` behind `{canVoid && (...)}`.
  2. Locked `OwnerPinModal.tsx` when `pinExists === false && !isOwner` (hiding the creation input and disabling `Authorize` with clear instructions).
  3. Added `OwnerPinSection` to `AdminSettingsModal.tsx` (restricted to `OWNER`) so the Owner can create or rotate the salted SHA-256 Owner PIN directly in Admin Settings with audit logging (`OWNER_PIN_UPDATED`). **Status: FIXED & VERIFIED.**

---

### `AUD-003` [MEDIUM] — Firestore Security Rules (`isAdmin()`) Did Not Recognize Provisioned `OWNER` Staff Profiles
- **Location:** `firestore.rules:11-15,60-73`
- **Evidence:**
  ```
  function isAdmin() {
      return isSignedIn() && request.auth.token.email in ["owner@hungrybirds.com"];
  }
  ```
  While `bootstrapOwnerAccount` uses `owner@hungrybirds.com`, additional `OWNER` accounts provisioned via `StaffAccountsSection` (`createStaffAccount`) receive `<username>@hungrybirds-pos.local` auth emails with `role: 'OWNER'` in `/users/{uid}`. Under the previous rule, a provisioned `OWNER` passed `isStaff()` but failed `isAdmin()`, causing `/usernameDirectory` and `/users` staff-management writes to be rejected with HTTP 403.
- **Impact:** Provisioned co-owner accounts could not list, create, or disable staff accounts in `StaffAccountsSection`.
- **Fix & Verification:** Updated `isAdmin()` in `firestore.rules` to accept either the bootstrap email allowlist OR an authenticated user whose `/users/$(request.auth.uid)` profile has `role == 'OWNER'`. **Status: FIXED & VERIFIED.**

---

### `AUD-004` [MEDIUM] — Missing `X-Frame-Options`, `Permissions-Policy`, `frame-ancestors`, and Unconditional Production Source Maps
- **Location:** `netlify.toml:5-13`, `vercel.json:6-32`, `hungrybirds-pos-modern/vite.config.ts:11-15`
- **Evidence:**
  - `netlify.toml` and `vercel.json` omitted `X-Frame-Options`, `Permissions-Policy`, and `frame-ancestors` in CSP, and used an invalid bare filename token `worker-src 'self' sw.js`.
  - `vite.config.ts` set `sourcemap: true`, emitting a 2.14 MB `dist/assets/index-*.js.map` file into the production publish directory.
- **Impact:** Clickjacking exposure on older browsers not enforcing CSP `frame-ancestors`, unnecessary browser feature permissions, and full unminified TypeScript source exposure on public CDNs.
- **Fix & Verification:** Added `X-Frame-Options = "DENY"`, `Permissions-Policy = "camera=(), microphone=(), geolocation=()"`, and `worker-src 'self'; frame-ancestors 'none'` to `netlify.toml` and `vercel.json`. Set `sourcemap: false` in `hungrybirds-pos-modern/vite.config.ts` and verified `npm run build` no longer emits `.js.map` files in `dist/assets/`. **Status: FIXED & VERIFIED.**

---

### `AUD-005` [MEDIUM — Documented Architectural Constraint] — Offline-Fallback Default Local Accounts (`1234`) & Unsalted Local Password Hashes
- **Location:** `hungrybirds-pos-modern/src/lib/auth.ts:80-91,157-176`
- **Evidence:** `ensureDefaultUsers()` seeds 4 local IndexedDB accounts (`owner`, `manager`, `cashier`, `waiter`) with SHA-256 hashes of `'1234'` when `db.users.count() === 0`.
- **Impact & Mitigations Present:**
  - Whenever the device has network connectivity to Firebase, `signIn()` calls `cloudSignIn()` first and **never** falls back to local IndexedDB accounts on an authentication failure (`if (!(err instanceof OfflineError)) throw err;` on `auth.ts:167`).
  - Local accounts are only consulted when the cloud is unreachable (`OfflineError`), enabling a fresh till or offline demo to operate without internet access.
  - **Recommendation for future multi-tenant hardening:** Salt local password hashes the same way `ownerPin.ts` salts PINs (`${salt}:${sha256}`), and prompt the local `owner` account to rotate the offline fallback password on first offline login. **Status: DOCUMENTED (by-design offline fallback).**

---

### `AUD-006` [LOW] — Data Integrity & Functional Correctness Bugs in Shift Report, Customer CRM, Loyalty Rewards, Menu Image Clearing, and P&L Dates
- **Location:** `src/lib/shift.ts:108`, `src/components/CustomersModal.tsx:68,141`, `src/components/LoyaltyRewardsSection.tsx:110-147`, `src/lib/menu.ts:80`, `src/lib/analytics.ts:191-192`
- **Evidence & Impact:** Detailed in `docs/qa/BUGS.md` (`BUG-004` through `BUG-009`): modified items were excluded from shift ingredient costs; customer name edits in CRM were not saved to IndexedDB; editing a loyalty reward froze inputs; clearing a dish's `imageUrl` reverted to the old URL; `getPnl` parsed `YYYY-MM-DD` in UTC before calling local `.setHours()`.
- **Fix & Verification:** Fixed all five issues and verified with unit tests (`56/56` passing in `hungrybirds-pos-modern`). **Status: FIXED & VERIFIED.**

---

### `AUD-007` [LOW] — Dependency Audit & Legacy Root Coexistence
- **Location:** `package.json` (root) vs `hungrybirds-pos-modern/package.json`
- **Evidence:**
  - `cd hungrybirds-pos-modern && npm audit` reports **0 vulnerabilities** across 85 packages.
  - Root `package.json` (used only for legacy root unit tests and ESLint on legacy `app.js`/`db.js`/`sw.js`) depends on deprecated `eslint@8.57.1` / `glob@7.2.3`.
- **Fix & Verification:** Fixed root `vitest.config.js` (`environment: 'node'`), `package.json`, and `.eslintrc.js` so all 60 legacy tests and ESLint run cleanly on Node 22.14. **Status: FIXED & VERIFIED.**
