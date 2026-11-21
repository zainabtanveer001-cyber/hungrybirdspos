# Project Status — Hungry Birds POS

- **Current Phase:** Phase 3 (Build — UI/UX & WCAG 2.2 AA alignment Slices 9–11 complete; ready for live multi-width visual verification, push, or `/ship`)
- **Active Branch:** `main` (local ahead of `origin/main` with Phase 2 docs + Slices 9–11)
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
- **Feature Slice 8 — Incoming Online Order & Add-to-Cart Visual Cues:**
  - **Incoming online orders:** Added a dedicated header `Online` button (`App.tsx`) with live pulsing beacon + count pill when `pendingOnlineCount > 0`, a persistent top-of-workspace alert banner (`"N new online order(s) waiting to be accepted"` + `"View & Accept"`), a pulsing dot on the mobile navigation hamburger button, and collapsed-sidebar badge support (`Sidebar.tsx`) with accessible `aria-label`; upgraded `useOrderAlert.ts` to expose `{ pendingCount, recentArrival }`.
  - **Add-to-cart feedback:** Added `countCartByMenuId()` & `cartItemCount()` (`src/lib/cart.ts` + unit test in `tests/cart.test.ts`), dish-card `×N in cart` pill badge, active border, `"✓ Added"` flash & `animate-cart-pop` (`MenuGrid.tsx`, `index.css`), `Current Order` live item count badge & newly-added row emerald highlight (`CartPanel.tsx`), debounced toast confirmation (`Added <name> to cart (×N)`) lifted clear above the mobile sticky bottom bar, and mobile sticky bar flash on add.
- **Phase 2 — UI/UX Design Spec (`docs/DESIGN.md`):**
  - Authored `docs/DESIGN.md` covering the top 3 POS user tasks, happy & unhappy user flows, information architecture & role matrix, one-sentence visual direction, WCAG 2.2 AA contrast-verified design tokens, component inventory, mobile/tablet/desktop screen specs with all 6 UI states, and a concrete P1/P2 gap audit against the current `hungrybirds-pos-modern` UI.
- **Phase 3 — UI/UX & WCAG 2.2 AA Alignment (Slices 9–11):**
  - **Slice 9 (`2b81133`):** Added verified WCAG 2.2 AA CSS tokens & global `:focus-visible` outline (`src/index.css`); upgraded `Modal.tsx` with `Esc` close, `aria-labelledby`, focus trap & focus return, and scrim close; eliminated mobile `"Hung..."` header truncation when Online orders are pending (`App.tsx`); fixed `MenuGrid.tsx` `role="group"` + clear-search button; upgraded `CartPanel.tsx` quantity steppers & remove buttons to `36×36px` with `#dc2626`/`#047857` contrast and equal 3-column mobile order-type toggle; added visible `12px` `<label>` elements across `CustomerPanel.tsx` and `LoginScreen.tsx`.
  - **Slice 10 (`1389e33`):** Added `src/lib/payment.ts` (`computeQuickTenderAmounts`, `computeCashBalance`) + `tests/payment.test.ts` (3 tests); migrated `PaymentModal.tsx` onto shared `<Modal>` with quick-tender PKR chips, double-submit `busy` guard, and WCAG AA `#047857` / `#2941e0` / `#dc2626` tokens.
  - **Slice 11 (`4c7c27f`):** Unified `KitchenDisplayModal.tsx`, `OnlineOrdersModal.tsx`, `ShiftSummaryModal.tsx`, `LiveStockPanel.tsx`, `ModifierModal.tsx`, `OwnerPinModal.tsx`, `HeldOrdersModal.tsx`, `ProfitLossModal.tsx`, `RefundModal.tsx`, and `SalesHistoryModal.tsx` onto the cobalt-and-paper token system (`≥ 11–12px` copy, `≥ 36px` touch targets, WCAG AA button contrast) and replaced native `window.prompt()` / `window.confirm()` dialogs with inline confirmation UI.

## 2. Verification Results
- `cd hungrybirds-pos-modern && npm test` → **12 passed (12)** test files, **67 passed (67)** tests.
- `cd hungrybirds-pos-modern && npm run build` → **EXIT 0** (`tsc -b && vite build` in `1.37s`, no `.map` file exposed).
- `cd hungrybirds-pos-modern && npm run lint` → **EXIT 0** (`0 errors`, `19 warnings` — down from `21`).
- `npm test` (root) → **4 passed (4)** test files, **60 passed (60)** tests.
- `npm run lint` (root) → **EXIT 0** (`0 errors`).
- **Live Browser QA:** Prior Slice 8 pass (`1366×768` & `390×844`) had **0** console errors; post-Slice 11 multi-width check (`375px` / `768px` / `1280px`) is pending Chrome remote debugging.

## 3. Known Gaps & Deferred Items
- **Pending post-polish visual verification (`docs/DESIGN.md` §10):** Live multi-width Chrome verification of Slices 9–11 at `375px`, `768px`, and `1280px` (plus `320px` overflow check) is pending Chrome remote debugging (`DevToolsActivePort`).
- **Offline fallback default credentials (`AUD-005`):** Fresh offline installs seed `owner`, `manager`, `cashier`, and `waiter` with password `1234` (SHA-256) in local IndexedDB for offline fallback when Firebase is unreachable. Cloud authentication always takes precedence when online.
- **Cosmetic / S4 items deferred:** Single-chunk bundle size warning (`~635 kB` minified / `178 kB` gzip).

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
- **Blockers:** Chrome remote debugging (`DevToolsActivePort`) was unavailable for fresh `375px` / `768px` / `1280px` visual verification.
- **Next:** Run live multi-width browser QA (`375px` / `768px` / `1280px`) once Chrome remote debugging is active, push to `zainabtanveer001-cyber/hungrybirdspos` when requested, or run `/ship` (Phase 6 Release).
