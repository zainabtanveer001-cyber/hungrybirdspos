# QA Test Plan & Execution Report — Hungry Birds POS

- **Date:** 2026-11-21
- **Branch / Base Commit:** `qa/release-gate` (branched from `b4aa1cf`)
- **Environment:** Windows, Node.js `v22.14.0` (also verified on `v24.22.3`), Vite `8.3.4`, Vitest `4.1.12` (modern) & `5.0.5` (root), Built-in Webview Browser (`1366×768` desktop & `390×844` mobile).

## 1. Exit Criteria
1. All Must-story test cases (`US-1` through `US-12`) pass.
2. Zero open **S1 (Critical)** or **S2 (High)** bugs.
3. All **S3 (Medium)** and **S4 (Low)** bugs triaged with evidence and disposition.
4. Automated regression suites green on the release commit (`hungrybirds-pos-modern` + root `rest_pos`).
5. Critical user journeys verified in a real browser at both desktop (`1366×768`) and mobile (`390×844`) viewports.

---

## 2. Automated Test Suite Results

| Suite | Command | Result | Evidence |
|-------|---------|--------|----------|
| Modern POS Unit & Regression Suite | `cd hungrybirds-pos-modern && npm test` | **PASS** | `10 passed (10)` test files, `56 passed (56)` tests (`syncMap`, `cart`, `modifiers`, `refunds`, `payroll`, `backup`, `onlineOrders`, `receipt`, `format`, `export`) |
| Legacy / Root Security & Cart Suite | `npm test` | **PASS** | `4 passed (4)` test files, `60 passed (60)` tests (`security`, `permissions`, `cart`, `debounce`) |
| Modern TypeScript & Vite Production Build | `cd hungrybirds-pos-modern && npm run build` | **PASS** | `tsc -b && vite build` exited with code `0`; `dist/assets/index-*.js` and `dist/assets/index-*.css` emitted with no `.map` file exposed |
| Modern Linter (`oxlint`) | `cd hungrybirds-pos-modern && npm run lint` | **PASS** | `0 errors` across 74 files |

---

## 3. Test Cases Mapped to PRD User Stories

| Case ID | Story | Precondition | Steps | Expected | Result (Pass/Fail & Evidence) |
|---------|-------|--------------|-------|----------|-------------------------------|
| `TC-001` | `US-1` | Cloud unreachable (offline harness on `:5174`) | Enter username `owner`, password `wrong`, click `Secure Login` | Rejects login with inline alert `"Incorrect password."`; form remains interactive | **PASS** — Verified in browser (`step_12_shot_1.png`) |
| `TC-002` | `US-1` | Cloud unreachable (offline harness on `:5174`) | Enter username `owner`, password `1234`, click `Secure Login` | Signs in via local IndexedDB fallback as `OWNER`; header shows `Local only` sync badge and `Welcome, owner` | **PASS** — Verified in browser (`step_12_shot_1.png`) |
| `TC-003` | `US-1` | Signed in as `owner` | Click `Logout`, then reload the page | Clears `sessionStorage` and returns to `LoginScreen`; reload stays logged out | **PASS** — Verified in browser (Step 11) |
| `TC-004` | `US-2` | Signed in as `OWNER`, empty menu | Open `Admin settings`, create `QA Burger` (`Rs 650`, `Burgers`) and `QA Cola` (`Rs 150`, `Drinks`) | Dishes appear immediately in POS Menu Grid (`All Items 2`, `Burgers 1`, `Drinks 1`) | **PASS** — Verified in browser (`step_16_shot_1.png`) |
| `TC-005` | `US-2` | Menu item with modifier groups | Select modifiers and add to cart; test identical vs distinct modifier combinations | Required group enforced; identical selections merge qty; distinct selections create separate lines | **PASS** — Verified via `tests/modifiers.test.ts` (5/5 pass) |
| `TC-006` | `US-3` | `QA Burger` (650) and `QA Cola` (150) on menu | Add 2× `QA Burger` + 1× `QA Cola`; enter discount `150`, then `10` | Subtotal `Rs 1,450`; discount `150` clamps to `100%` (`Rs 0`); discount `10%` saves `Rs 145` → Total Due `Rs 1,305` | **PASS** — Verified in browser (`step_18_shot_1.png`) and `tests/cart.test.ts` |
| `TC-007` | `US-3` | Node 22.14 & browser ICU builds | Format whole rupees (`1300`) and fractional rupees (`12.5`) via `formatAmount` and `receiptLines` | Whole rupees print as `Rs 1,300` (no `.00` drift); fractional prints `Rs 12.50` | **PASS** — Fixed `BUG-001`; verified in `tests/format.test.ts` & `tests/receipt.test.ts` |
| `TC-008` | `US-4` | Cart has items; order type switched to `DELIVERY` | Attempt checkout (`Checkout & Print` or `F2`) with no customer phone, then with phone `03001234567` and total `Rs 150` (`< Rs 500`) | Both button and `F2` block checkout immediately with toast `"Delivery orders need a customer phone number."` / `"Minimum order total for delivery is Rs 500."` | **PASS** — Fixed `BUG-007` (`startCheckout` in `App.tsx`) |
| `TC-009` | `US-4` | Cart has 2× `QA Burger` (`Rs 1,300`), `DINE_IN` | Click `Checkout & Print`, choose `Cash`, enter `1500`, click `Complete Sale` | Shows `Change: Rs 200`; records Sale `#1`; shows toast `"Sale #1 completed — Rs 1,300"`; appears in `Recent Sales` | **PASS** — Verified in browser (`step_38_shot_1.png`) |
| `TC-010` | `US-5` | Cart has 1× `QA Cola` (`Rs 150`) | Click `Hold` (`F4`), open `Held orders`, click `Restore to Cart` → `Yes, restore` | Holds order `#1` with sidebar badge `1`; restores items/charges to cart and clears held order | **PASS** — Verified in browser (Step 7) |
| `TC-011` | `US-6` | Completed Sale `#1` (2× `QA Burger`, `Rs 1,300`), signed in as `OWNER` | Open `Sales History`, click `Refund`, set qty `1` for `QA Burger`, reason `"QA partial refund"`, submit | Refunds `Rs 650` without prompting Owner for PIN; updates badge to `Part refunded (Rs 650)` | **PASS** — Verified in browser (`step_53_shot_1.png`) & `tests/refunds.test.ts` |
| `TC-012` | `US-6` | Signed in as `WAITER`, `CASHIER`, and `MANAGER` | Attempt checkout as `WAITER`; open `Sales History` as `CASHIER` and `MANAGER` | `WAITER` blocked from payment; `CASHIER` sees only `Print`/`Share` (no `Edit`/`Refund`/`Void`); `MANAGER` prompted for Owner PIN and blocked from creating PIN if unset | **PASS** — Fixed `BUG-003` / `AUD-002` in `SalesHistoryModal.tsx` & `OwnerPinModal.tsx` |
| `TC-013` | `US-7` | Online order in `PENDING` state | Advance order through `ACCEPTED` → `PREPARING` → `OUT_FOR_DELIVERY` → `COMPLETED` (and test takeaway shortcut) | Status transitions and Firestore REST patch masks match schema | **PASS** — Verified via `tests/onlineOrders.test.ts` & `tests/syncMap.test.ts` |
| `TC-014` | `US-8`, `US-11` | Completed sale containing item with modifiers and recipe ingredients | Run `buildShiftReport()` | Matches recipe via `line.menuItemId || line.id` and includes consumed ingredient quantity and cost | **PASS** — Fixed `BUG-006` in `shift.ts` & `tests/export.test.ts` |
| `TC-015` | `US-9` | Customer in CRM (`CustomersModal`) & Loyalty Rewards in `AdminSettingsModal` | Edit customer name and click `Save`; edit existing loyalty reward in Admin Settings | Customer name persists to `db.customers`; loyalty reward inputs populate and save cleanly; sort `Reset` only appears when sorted | **PASS** — Fixed `BUG-004` & `BUG-005` |
| `TC-016` | `US-10` | Active staff member with salary advances | Compute `payrollRows` for current month and after salary payment | Deducts pending advances for the period; settled advances are preserved on paid record | **PASS** — Verified via `tests/payroll.test.ts` (3/3 pass) |
| `TC-017` | `US-11`, `AUD-001` | Sales/Expenses CSV export & P&L date boundaries | Export CSV containing formula-prefixed text (`=CMD...`); parse `YYYY-MM-DD` P&L boundaries | Formula cells prefixed with `'`; `YYYY-MM-DD` parsed at local `00:00:00` and `23:59:59.999` without UTC shift | **PASS** — Fixed `AUD-001` & `BUG-008`; verified in `tests/export.test.ts` |
| `TC-018` | `US-12` | Mobile viewport `390×844`, signed in as `OWNER` | Check header `Logout`, open/close navigation drawer, add item, check sticky bottom bar and `View Order` scroll | Header `Logout` visible; drawer opens/closes; sticky bar shows `1 item · DINE IN` and scrolls cart buttons clear of the bar; ESC/POS & HTML receipts escape XSS | **PASS** — Verified in browser (`step_82_shot_1_mobile_drawer_open.png`, `step_87_shot_1_mobile_sticky_bar_top.png`) & `tests/receipt.test.ts` |
