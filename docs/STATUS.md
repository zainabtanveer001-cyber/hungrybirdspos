# Project Status — Hungry Birds POS

- **Current Phase:** Phase 4 (QA) & Phase 5 (Security & Quality Audit) — `/qa-gate` **PASSED** (ready for Phase 6 Release / `/ship`)
- **Active Branch:** `qa/release-gate` (branched from `main` @ `b4aa1cf`)
- **Last Updated:** 2026-11-21

## 1. What Was Done
- **Cloned & Installed:** Cloned `zainabtanveer001-cyber/hungrybirdspos` into `C:\Users\Admin\.gemini\antigravity\scratch\hungrybirdspos` and installed dependencies for both root and `hungrybirds-pos-modern/` (`0` npm audit vulnerabilities in `hungrybirds-pos-modern`).
- **QA & Browser Verification (`docs/qa/TEST_PLAN.md`):**
  - Executed all 18 Must-story test cases (`TC-001`..`TC-018`) across unit suites and live browser walkthroughs at desktop (`1366×768`) and mobile (`390×844`) widths.
- **Bug Fixes (`docs/qa/BUGS.md` — 9 bugs found, all S1/S2/S3 fixed & verified):**
  - `BUG-001` [S2]: Fixed ICU/CLDR PKR decimal drift (`Rs 1,300.00` vs `Rs 1,300`) in `hungrybirds-pos-modern/src/lib/format.ts` and `tests/test-utils.js`; added `tests/format.test.ts`.
  - `BUG-002` [S2]: Fixed root `vitest.config.js` (`environment: "node"`) so `npm test` runs on Node 22.14 without `jsdom@30`/`undici@8` startup crashes; fixed stale `hungrybirdspos/` script paths in root `package.json` and `.eslintrc.js`; added `"test": "vitest run"` to `hungrybirds-pos-modern/package.json`.
  - `BUG-003` [S1]: Gated the destructive `Edit` (re-open sale) button in `SalesHistoryModal.tsx` behind `canVoid` (`OWNER` / `MANAGER`), locked `OwnerPinModal.tsx` when no PIN is configured and the caller is not `OWNER`, and added `OwnerPinSection` to `AdminSettingsModal.tsx` so the Owner can set/rotate the Owner PIN.
  - `BUG-004` [S2]: Fixed `CustomersModal.tsx` so customer name edits persist to IndexedDB (`db.customers.put`) on `Save`, and fixed the sort `Reset` button condition (`sortOrders !== null`).
  - `BUG-005` [S2]: Fixed `LoyaltyRewardsSection.tsx` so clicking `Edit` populates form state and inputs remain editable; removed duplicate `"Loyalty Rewards"` heading in `AdminSettingsModal.tsx`.
  - `BUG-006` [S2]: Fixed `buildShiftReport()` in `src/lib/shift.ts` to match recipes via `line.menuItemId || line.id` so items sold with modifiers count toward shift ingredient consumption and raw material cost.
  - `BUG-007` [S2]: Unified checkout pre-validation (`startCheckout` in `src/App.tsx`) across `Checkout & Print`, `F2`, and mobile sticky `Checkout` (validating waiter role, delivery phone, delivery `Rs 500` minimum, and stock before opening `PaymentModal`); improved mobile sticky bar scroll clearance (`pb-28`, `block: 'end'`) and singular/plural item count.
  - `BUG-008` [S2]: Fixed `getPnl()` in `src/lib/analytics.ts` (`parseLocalDateBoundary`) to parse `YYYY-MM-DD` date strings in local time instead of UTC midnight.
  - `BUG-009` [S3]: Fixed `saveMenuItem()` in `src/lib/menu.ts` so clearing an existing dish's `imageUrl` saves `""`, and updated `SalesHistoryModal.tsx` partial refund badge to display the refunded amount.
- **Security & Quality Audit (`docs/audit/AUDIT_REPORT.md`):**
  - `AUD-001` [High]: Added CSV formula-injection neutralization (`sanitizeCsvCell` in `src/lib/export.ts`) + unit tests in `tests/export.test.ts`.
  - `AUD-002` [High]: Fixed RBAC gating on sale re-open and Owner PIN setup/authorization (`BUG-003`).
  - `AUD-003` [Medium]: Updated `isAdmin()` in `firestore.rules` to recognize authenticated users with `role == 'OWNER'` in `/users/{uid}`.
  - `AUD-004` [Medium]: Added `X-Frame-Options = "DENY"`, `Permissions-Policy`, and `frame-ancestors 'none'` to `netlify.toml` and `vercel.json`; disabled production source maps (`sourcemap: false`) in `hungrybirds-pos-modern/vite.config.ts`.
- **Feature Slice 6 — Local Menu Image Upload & Compression:**
  - Added `scaleImageDimensions()` and `compressImageFile()` in `hungrybirds-pos-modern/src/lib/menu.ts` (resizes to max `800×800` px on `<canvas>` with white background fill for transparent PNGs and compresses to JPEG under `650 KB` for Firestore sync compatibility).
  - Updated `AdminSettingsModal.tsx` with an `"Upload Photo"` file picker, live compressed preview card showing KB size, and `"Remove photo"` action so uploaded dish photos replace the `"Menu"` placeholder box on dish cards in `MenuGrid.tsx`.
- **Feature Slice 7 — Live Shift Inventory Costing, P&L Reactivity & Shift-End Cost Locking:**
  - Added shift manual stock reduction tracking (`applyStockDelta`, `recordShiftStockDelta`, `clearShiftStockDeltas` in `src/lib/inventory.ts` and `InventoryModal.tsx`).
  - Added live recipe & manual stock cost calculation (`computeSaleLiveCost`, `computeShiftUsage` in `src/lib/shift.ts` and `getPnl` in `src/lib/analytics.ts`) that dynamically re-prices active-shift recipe usage (excluding refunded quantities) and manual stock reductions at the latest inventory unit cost, and locks/snapshots costs (`Sale.lockedCost` and `closedShiftManualCosts`) when `closeShift()` is called.
  - Updated `LiveStockPanel.tsx`, `ShiftSummaryModal.tsx`, and `ProfitLossModal.tsx` to subscribe via `useLive` so cost and P&L update in real time on the go.
  - Added unit tests in `hungrybirds-pos-modern/tests/liveCostAndMenuImage.test.ts` (7 tests).
- **Post-Feature `/qa-testing` Verification & Bug Fixes (`BUG-010`..`BUG-012`):**
  - `BUG-010` [S1]: Made `getShiftStart()` strictly read-only (never calls `db.settings.put()` inside Dexie `liveQuery`), initialized `shiftStartTime` in `initializeApp()`, and proportionally scaled `sale.lockedCost` when closed-shift sales are later refunded (`refunds.ts`). Verified in browser on clean `:5175` origin with **0 console errors**.
  - `BUG-011` [S2]: Added `scroll-mb-24 scroll-mt-4` on `#posCartMobileAnchor` (`App.tsx`) so mobile `390×844` `View Order` leaves `51.56px` clearance above the sticky bottom bar.
  - `BUG-012` [S3]: Replaced `useMemo` with `useEffect` in `OwnerPinSection` (`AdminSettingsModal.tsx`) and enforced non-negative cost validation on edit in `InventoryModal.tsx`.

## 2. Verification Results
- `cd hungrybirds-pos-modern && npm test` → **11 passed (11)** test files, **63 passed (63)** tests.
- `cd hungrybirds-pos-modern && npm run build` → **EXIT 0** (`dist/assets/index-*.js` and `dist/assets/index-*.css` built in 4.03s, no `.map` file exposed).
- `cd hungrybirds-pos-modern && npm run lint` → **EXIT 0** (`0 errors`, `20` warnings).
- `npm test` (root) → **4 passed (4)** test files, **60 passed (60)** tests.
- `npm run lint` (root) → **EXIT 0** (`0 errors`).
- **Live Browser QA (`http://localhost:5174/` & fresh `http://localhost:5175/`):** All 24 test cases (`TC-001`..`TC-024`) **PASS**, **0** open S1/S2 bugs, **0** browser console errors.

## 3. Known Gaps & Deferred Items
- **Offline fallback default credentials (`AUD-005`):** Fresh offline installs seed `owner`, `manager`, `cashier`, and `waiter` with password `1234` (SHA-256) in local IndexedDB for offline fallback when Firebase is unreachable. Cloud authentication always takes precedence when online.
- **Cosmetic / S4 items deferred:** Minor text truncation on narrow pills at intermediate breakpoints and single-chunk bundle size warning (`~606 kB` minified / `172 kB` gzip).

## 4. How to Run
```powershell
# Production app (hungrybirds-pos-modern)
cd C:\Users\Admin\.gemini\antigravity\scratch\hungrybirdspos\hungrybirds-pos-modern
npm test          # Run 56 Vitest unit & regression tests
npm run lint      # Run Oxlint
npm run build     # Type-check (tsc -b) and build production bundle to dist/
npm run dev       # Start local Vite dev server on http://localhost:5173

# Legacy root suite
cd C:\Users\Admin\.gemini\antigravity\scratch\hungrybirdspos
npm test          # Run 60 root Vitest unit tests
npm run lint      # Run ESLint on legacy root files
```

## 5. Next Steps / Blockers
- **Blockers:** None.
- **Next:** Commit code and docs on `qa/release-gate` (or merge to `main`) and proceed to Phase 6 Release (`/ship`) when ready to deploy.
