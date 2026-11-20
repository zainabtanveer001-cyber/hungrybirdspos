# QA Bug Reports — Hungry Birds POS

---

```
BUG-001 [S2 high]
Title: Non-deterministic PKR currency formatting (`Rs 1,300.00` vs `Rs 1,300`) across ICU/CLDR builds breaks receipt formatting and unit tests on Node 22.14
Steps to reproduce:
  1. Run `npx vitest run` in `hungrybirds-pos-modern` on Node v22.14.0 (ICU 76.1).
  2. Observe `tests/receipt.test.ts > receipt > lists items, charges and payments in print order` fail because `formatAmount(1300)` returns `"Rs 1,300.00"` instead of `"Rs 1,300"`.
Expected vs actual:
  Expected: Whole-rupee amounts format without `.00` across all Node/browser ICU versions (`Rs 1,300`), while fractional amounts show two decimals (`Rs 12.50`).
  Actual: `Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 })` left `minimumFractionDigits` unpinned, inheriting CLDR's PKR default (2 on Node 22.14, 0 on newer ICU).
Evidence: `AssertionError: expected [ 'Order #42', …(17) ] to include 'Zinger Burger x2  Rs 1,300'` (actual: `'Zinger Burger x2  Rs 1,300.00'`).
Environment: `b4aa1cf` / `qa/release-gate`, Node v22.14.0, Vitest v4.1.12.
Status: verified (fixed in `hungrybirds-pos-modern/src/lib/format.ts`, `tests/format.test.ts`, and `tests/test-utils.js`)
```

---

```
BUG-002 [S2 high]
Title: Root test suite (`npm test`) crashes at startup on Node 22.14 (`undici` `createZstdDecompress.bind` TypeError via `jsdom@30`), root `lint`/`format` scripts reference non-existent `hungrybirdspos/` subfolder, and `hungrybirds-pos-modern/package.json` lacks a `"test"` script
Steps to reproduce:
  1. Run `npm test` at repository root on Node v22.14.0.
  2. Observe 4 worker startup errors (`TypeError: Cannot read properties of undefined (reading 'bind')` at `node_modules/undici/lib/interceptor/decompress.js:78:30`).
  3. Run `npm run lint` at repository root and observe ESLint fail because `hungrybirdspos/app.js` does not exist.
Expected vs actual:
  Expected: `npm test` and `npm run lint` run and pass at both the repository root and `hungrybirds-pos-modern`.
  Actual: `vitest.config.js` requested `environment: "jsdom"`, loading `jsdom@30.1.3` -> `undici@8.12.2` (which requires Node >=22.19.0) even though `tests/*.test.js` do not use any DOM APIs; root `package.json` and `.eslintrc.js` pointed to a legacy `hungrybirdspos/` subdirectory.
Evidence: `Error: [vitest-pool]: Failed to start forks worker for test files .../tests/debounce.test.js`.
Environment: `b4aa1cf` / `qa/release-gate`, Node v22.14.0, Vitest v5.0.5.
Status: verified (fixed in `vitest.config.js`, `package.json`, `.eslintrc.js`, and `hungrybirds-pos-modern/package.json`)
```

---

```
BUG-003 [S1 critical]
Title: `SalesHistoryModal` exposes the destructive `Edit` (re-open sale, deleting the sale record) button to `CASHIER` and `WAITER` roles, and `OwnerPinModal` displays an active "Create owner PIN" form to non-owners when no PIN is configured
Steps to reproduce:
  1. Sign in as `cashier` (`CASHIER`) or `waiter` (`WAITER`) on `http://localhost:5174/`.
  2. Click `Manage` next to `Recent Sales` to open `Sales History`.
  3. Observe that `Edit` appears on every completed sale row even though `Refund` and `Void` are hidden (`canVoid` is `false`).
  4. Click `Edit` when no Owner PIN has been set yet: `"Owner Authorization"` opens reading `"No owner PIN is set yet. The Owner creates one now (4–8 digits)."` with an active `"Create owner PIN"` input and enabled `"Authorize"` button, while `AdminSettingsModal` has no UI for the `OWNER` to configure the Owner PIN.
Expected vs actual:
  Expected: Only `OWNER` and `MANAGER` (`canVoid`) see `Edit` in `SalesHistoryModal`; when no Owner PIN is set and a non-owner triggers `OwnerPinModal`, the input and `Authorize` button are disabled with instructions for the Owner to configure the PIN in `AdminSettingsModal`.
  Actual: `Edit` was rendered unconditionally for all roles, and `OwnerPinModal` rendered the PIN-creation form to non-owners.
Evidence: Browser QA Step 9 (`cashier` and `manager` role walkthrough on `:5174`); `SalesHistoryModal.tsx:276-283`, `OwnerPinModal.tsx:52,59-75`.
Environment: `b4aa1cf` / `qa/release-gate`, Webview Browser `1366x768`.
Status: verified (fixed in `SalesHistoryModal.tsx`, `OwnerPinModal.tsx`, and `AdminSettingsModal.tsx`)
```

---

```
BUG-004 [S2 high]
Title: Customer CRM (`CustomersModal.tsx`) "Save" button on customer name edit is a no-op that never writes to IndexedDB (`db.customers`), and the "Reset" sort button renders only when `sortOrders === null`
Steps to reproduce:
  1. Open `Customers` from the sidebar, select a customer, edit their name in the input field, and click `Save`.
  2. Click `Back to customer list` or reopen the modal.
  3. Observe the customer name reverted because `Save` only called `setSelected(c)` in React state and never updated `db.customers`.
  4. In the customer list, observe `Reset` appears next to `Sort by orders` when no sort is active (`sortOrders === null`) and disappears as soon as a sort (`asc`/`desc`) is selected.
Expected vs actual:
  Expected: Clicking `Save` persists the updated customer name to `db.customers`, and `Reset` appears when `sortOrders !== null`.
  Actual: `onUpdate` only updated local component state, and line 68 checked `sortOrders === null`.
Evidence: `hungrybirds-pos-modern/src/components/CustomersModal.tsx:29,68,139-145`.
Environment: `b4aa1cf` / `qa/release-gate`.
Status: verified (fixed in `hungrybirds-pos-modern/src/components/CustomersModal.tsx`)
```

---

```
BUG-005 [S2 high]
Title: Loyalty Rewards editor (`LoyaltyRewardsSection.tsx`) freezes form inputs when editing an existing reward and fails validation on save
Steps to reproduce:
  1. Open `Admin settings` as `OWNER` and create a Loyalty Reward.
  2. Click `Edit` on the created reward.
  3. Attempt to type a new name, points value, or discount value in the form inputs and click `Update reward`.
Expected vs actual:
  Expected: Clicking `Edit` populates the form state with the reward's current values, allows editing all fields, and saves changes on `Update reward`.
  Actual: `Edit` only called `setEditingId(r.id)` without populating `name`, `description`, `pointsRequired`, `discountType`, or `discountValue` state, while the inputs' `value` props switched to `editing?.name` (from the live Dexie query) and `onChange` wrote to `name`, making the inputs uneditable and causing `save()` to fail with `"Enter a reward name."`. Also rendered a duplicate `"Loyalty Rewards"` heading in `AdminSettingsModal.tsx`.
Evidence: `hungrybirds-pos-modern/src/components/LoyaltyRewardsSection.tsx:21-29,110-147,194` and `AdminSettingsModal.tsx:310`.
Environment: `b4aa1cf` / `qa/release-gate`.
Status: verified (fixed in `LoyaltyRewardsSection.tsx` and `AdminSettingsModal.tsx`)
```

---

```
BUG-006 [S2 high]
Title: Shift report (`buildShiftReport` in `shift.ts`) omits ingredient usage and raw material cost for any sold item with modifiers
Steps to reproduce:
  1. Sell a menu item that hasrecipe ingredients and selected modifiers (so `composeModifiedItem` sets `line.id = "${item.id}::${key}"` and `line.menuItemId = item.id`).
  2. Open `Shift summary` (`buildShiftReport()`).
Expected vs actual:
  Expected: `buildShiftReport()` matches recipes using `line.menuItemId || line.id` (matching `sales.ts` and `refunds.ts`) and includes the consumed ingredients and raw material cost.
  Actual: `shift.ts:108` filtered recipes with `r.menuItemId === line.id`, missing all modified items and overstating `grossProfit`.
Evidence: `hungrybirds-pos-modern/src/lib/shift.ts:108`; regression test in `tests/export.test.ts`.
Environment: `b4aa1cf` / `qa/release-gate`.
Status: verified (fixed in `hungrybirds-pos-modern/src/lib/shift.ts` and `tests/export.test.ts`)
```

---

```
BUG-007 [S2 high]
Title: Delivery checkout validation (`no phone` / `minimum order Rs 500`) is not enforced when opening `PaymentModal`, and mobile sticky bottom bar occludes `CartPanel` action buttons after tapping `View Order`
Steps to reproduce:
  1. Switch order type to `Delivery` with a single `Rs 150` item (`< Rs 500`) or no phone number, and press `F2` or click `Checkout & Print`.
  2. On mobile viewport (`390×844`), add an item (`1 items` shown in sticky bar) and tap `View Order`.
Expected vs actual:
  Expected: Clicking `Checkout & Print`, pressing `F2`, or tapping mobile `Checkout` validates waiter permission, delivery phone, delivery minimum (`Rs 500`), and stock *before* opening `PaymentModal`; tapping `View Order` on mobile scrolls the cart's `Hold` and `Checkout & Print` buttons above the sticky bar and displays singular `"1 item"`.
  Actual: `F2` and `onCheckout` opened `PaymentModal` without running delivery/stock checks first; on `390×844` mobile, `scrollIntoView` aligned the top of `#posCartMobileAnchor`, leaving the fixed bottom bar over `Hold` and `Checkout & Print` (`step_82.png`).
Evidence: Browser QA Step 5 and Step 10 (`step_82.png`, `step_87_shot_1_mobile_sticky_bar_top.png`).
Environment: `b4aa1cf` / `qa/release-gate`, Webview Browser `1366x768` & `390x844`.
Status: verified (fixed in `hungrybirds-pos-modern/src/App.tsx`)
```

---

```
BUG-008 [S2 high]
Title: Profit & Loss date range filter (`getPnl` in `analytics.ts`) parses `YYYY-MM-DD` strings as UTC midnight before calling `.setHours(...)`, shifting date boundaries by one day in negative UTC timezones
Steps to reproduce:
  1. Call `getPnl('2026-11-21', '2026-11-21')` in a negative UTC offset timezone (or inspect `new Date('2026-11-21').setHours(0, 0, 0, 0)`).
Expected vs actual:
  Expected: `startDate` and `endDate` (`YYYY-MM-DD`) are parsed as local calendar date boundaries (`00:00:00.000` to `23:59:59.999` local time).
  Actual: `new Date('YYYY-MM-DD')` is parsed by the JS engine as UTC midnight, so `.setHours(0, 0, 0, 0)` in any `UTC-` timezone sets the boundary to `00:00` of the previous calendar day.
Evidence: `hungrybirds-pos-modern/src/lib/analytics.ts:191-192`; unit test in `tests/export.test.ts`.
Environment: `b4aa1cf` / `qa/release-gate`.
Status: verified (fixed in `hungrybirds-pos-modern/src/lib/analytics.ts` and `tests/export.test.ts`)
```

---

```
BUG-009 [S3 medium]
Title: Clearing an existing menu item's `imageUrl` in `AdminSettingsModal` (`saveMenuItem` in `menu.ts`) silently reverts to the previous image URL, and partially refunded sales in `SalesHistoryModal` do not display the refunded amount on the badge
Steps to reproduce:
  1. Edit a menu item that has an `imageUrl`, clear the `Image URL` field to `""`, and click `Save Changes`.
  2. Partially refund an order in `Sales History` and observe the badge reads `"Part refunded"` without the refunded rupee amount (unlike `"Refunded Rs 1,300"` for full refunds).
Expected vs actual:
  Expected: Clearing `imageUrl` saves `""`; partial refund badge shows `"Part refunded (Rs 650)"`.
  Actual: `draft.imageUrl || existing?.imageUrl || ''` fell back to `existing?.imageUrl` when `draft.imageUrl` was `""`; partial refund badge omitted `sale.refundedAmount`.
Evidence: `hungrybirds-pos-modern/src/lib/menu.ts:80` and `SalesHistoryModal.tsx:217`.
Environment: `b4aa1cf` / `qa/release-gate`.
Status: verified (fixed in `menu.ts` and `SalesHistoryModal.tsx`)
```
