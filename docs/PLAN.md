# Delivery & QA Gate Plan — Hungry Birds POS

## Current Milestone: Release Candidate QA & Security/Quality Audit (`/qa-gate`)

### Slices & Checkpoints
- [x] **Slice 1 — Repository & Build Baseline**
  - Clone repository, install root and `hungrybirds-pos-modern` dependencies, map architecture and deployment targets (`netlify.toml`, `vercel.json` -> `hungrybirds-pos-modern/dist`).
  - Acceptance: Production build (`npm run build` in `hungrybirds-pos-modern`) succeeds with zero TypeScript errors.
- [x] **Slice 2 — Deterministic Currency Formatting (`BUG-001`)**
  - Pin `minimumFractionDigits: 2`, `maximumFractionDigits: 2`, `trailingZeroDisplay: 'stripIfInteger'` in `hungrybirds-pos-modern/src/lib/format.ts` and add unit tests in `tests/format.test.ts`.
  - Acceptance: `tests/receipt.test.ts` and `tests/format.test.ts` pass across Node 22 and Node 24 ICU builds.
- [x] **Slice 3 — End-to-End Browser QA Walkthrough (Desktop & Mobile)**
  - Execute live browser QA across login, menu/category creation, cart math & discount clamping, delivery validation rules, cash checkout & change, hold/restore orders, partial refunds, RBAC (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`), mobile drawer & sticky checkout bar (`390x844`), and logout persistence.
  - Acceptance: All critical journeys recorded with evidence in `docs/qa/TEST_PLAN.md` and `docs/qa/BUGS.md`.
- [x] **Slice 4 — Bug & Audit Remediation (S1/S2 Bugs & Critical/High Findings)**
  - Fix all S1/S2 functional bugs and Critical/High security & quality findings discovered during code review and browser QA:
    - `BUG-002` (S2): Root `npm test` crashes on Node 22.14 due to unnecessary `jsdom@30`/`undici@8` environment in `vitest.config.js` and stale `hungrybirdspos/` script paths in root `package.json` & `.eslintrc.js`; add `"test": "vitest run"` to `hungrybirds-pos-modern/package.json`.
    - `BUG-003` (S1): `SalesHistoryModal.tsx` exposes the `Edit` (re-open sale into cart, deleting the sale record) button to `CASHIER` and `WAITER` roles without checking `canVoid`, and `OwnerPinModal.tsx` shows an active PIN creation form to non-owners when no PIN is configured.
    - `BUG-004` (S2): `CustomersModal.tsx` (`CustomerHistory`) "Save" button never writes the edited customer name to `db.customers` (in-memory state only, lost on close/back), and the "Reset" sort button is rendered only when `sortOrders === null`.
    - `BUG-005` (S2): `LoyaltyRewardsSection.tsx` binds input `value` props directly to `editing?.field` instead of form state when `editingId !== null`, freezing inputs during edit and failing validation on save.
    - `BUG-006` (S2): `shift.ts` (`buildShiftReport`) matches recipes using `r.menuItemId === line.id` instead of `line.menuItemId || line.id`, omitting ingredient consumption and cost for any sold item with modifiers.
    - `BUG-007` (S2): `App.tsx` unified `startCheckout()` validation for delivery phone, delivery minimum order (`Rs 500`), waiter block, and stock check before opening `PaymentModal`, plus mobile sticky bar scroll clearance and singular/plural text.
    - `BUG-008` (S2): `analytics.ts` (`getPnl`) local calendar date boundary parsing (`parseLocalDateBoundary`) without UTC day shift.
    - `BUG-009` (S3): `menu.ts` (`saveMenuItem`) allows clearing `imageUrl`, and `SalesHistoryModal.tsx` shows refunded rupee amount on partial refund badges.
    - `AUD-001`..`AUD-004`: CSV formula injection protection in `export.ts`, RBAC & Owner PIN management in `AdminSettingsModal.tsx`, `X-Frame-Options: DENY` and `Permissions-Policy` in `netlify.toml` / `vercel.json`, `firestore.rules` `isAdmin()` support for provisioned `OWNER` profiles, and `sourcemap: false` in `vite.config.ts`.
  - Acceptance: Unit & regression tests added for every fix; all suites (`npm test`, `npm run lint`, `npm run build`) green.
- [x] **Slice 5 — Gate Sign-off Documentation**
  - Finalize `docs/qa/TEST_PLAN.md`, `docs/qa/BUGS.md`, `docs/audit/AUDIT_REPORT.md`, and `docs/STATUS.md` with commit hashes, command outputs, and exit-criteria verdict.
- [x] **Slice 6 — Per-Dish Local Photo Upload & Client-Side Compression**
  - Add `scaleImageDimensions()` and `compressImageFile()` in `src/lib/menu.ts` (canvas downscaling to max `800×800` px and JPEG compression under `650 KB` for Firestore sync compatibility).
  - Add `"Upload Photo"` file picker, live compressed preview card with KB badge, and `"Remove photo"` action in `src/components/AdminSettingsModal.tsx` so uploaded dish photos replace the `"Menu"` placeholder box on dish cards in `MenuGrid.tsx`.
- [x] **Slice 7 — Live Shift Inventory Costing, P&L Reactivity & Shift-End Cost Locking**
  - Track net manual stock reductions during the active shift (`applyStockDelta`, `recordShiftStockDelta` in `src/lib/inventory.ts` and `InventoryModal.tsx`).
  - Re-price active-shift recipe usage (excluding refunded quantities) and manual stock reductions live at the latest inventory unit cost (`computeSaleLiveCost`, `computeShiftUsage` in `src/lib/shift.ts` and `getPnl` in `src/lib/analytics.ts`), and lock/snapshot costs (`Sale.lockedCost` and `closedShiftManualCosts`) when `closeShift()` is called.
  - Subscribe `LiveStockPanel.tsx`, `ShiftSummaryModal.tsx`, and `ProfitLossModal.tsx` via `useLive` so cost and P&L update in real time on the go.
  - Add unit tests in `tests/liveCostAndMenuImage.test.ts` (6 tests).
