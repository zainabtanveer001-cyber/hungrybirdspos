# UI/UX Design Specification — Hungry Birds POS

> **Phase:** 2 — UI/UX Design (Senior UI/UX Designer)  
> **Scope:** `hungrybirds-pos-modern/` (React 19 + Tailwind CSS v4 PWA)  
> **Standard:** WCAG 2.2 AA · Mobile-first (`320px` floor) · Offline-first POS

---

## 1. Personas & Top 3 User Tasks

Derived from [PRD.md](./PRD.md) (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`):

1. **Counter Order & Checkout (Cashier, Waiter, Manager, Owner)** — Find dishes by search (`/`) or category, configure modifiers, assign order type (`Dine In + Table`, `Takeaway`, `Delivery`) and customer/loyalty, then `Hold` (`F4`) or `Checkout & Print` (`F2`) with fast cash change calculation and receipt printing.
2. **Incoming Online Order & Kitchen Fulfillment (Cashier, Manager, Kitchen)** — Notice arriving website orders immediately without polling, inspect items, accept into cart (or reject with reason), and move kitchen tickets through `PREPARING` → `READY` → `SERVED` in KDS (`F8`).
3. **Live Shift Inventory, Costing & Closeout (Manager, Owner)** — Unlock Live Stock with Owner PIN, adjust stock or ingredient unit costs, monitor live shift COGS and P&L as sales happen, and close the shift to lock historical costs before setting next shift's Opening Cash.

The UI is judged first on speed, error prevention, and legibility across these three tasks under rush-hour counter lighting.

---

## 2. User Flows (Happy & Unhappy Paths)

### Flow A — Counter Order & Checkout
1. **Happy path:** Tap/click dish card (`MenuGrid`) → if modifiers exist, select required/optional choices in `ModifierModal` → dish card flashes `✓ Added` and shows `×N in cart`, cart row highlights, toast confirms (`Added <dish> to cart (×N)`) → choose `Dine In` (optional `T1`–`T12`), `Takeaway`, or `Delivery` → optional customer phone lookup auto-fills name & loyalty balance → click `Checkout & Print` (`F2`) → pick `Cash` / `Card` / `Online` in `PaymentModal` → enter/tap tender → `Complete Sale` → stock deducts, cart resets, receipt prints automatically.
2. **Unhappy paths:**
   - **Waiter attempts checkout:** `Checkout & Print` / `F2` / mobile `Checkout` shows clear notice (`"Waiters cannot take payments. Ask a cashier or manager."`) without opening payment modal; `Hold` remains available.
   - **Delivery missing phone or `< Rs 500`:** Blocked before opening `PaymentModal`, with actionable message naming the missing field or `Rs 500` minimum; inline `"Min Order: Rs 500"` badge stays visible in `CustomerPanel`.
   - **Insufficient recipe stock:** `verifyStock()` blocks checkout and names the short ingredient so staff can adjust order or restock.
   - **Cash tendered `< Total Due`:** `Complete Sale` stays disabled; label switches from `"Change"` to `"Still owed"` in red with exact shortfall.
   - **Double-click during save:** Submit button locks (`disabled` + `"Completing…"` progress text) until `recordSale()` resolves.
   - **Thermal printer unavailable:** Sale still completes and persists; toast notifies `"Printer unavailable — printing from the browser instead"` and opens escaped HTML print view.
   - **Offline / local-only:** Header `SyncBadge` shows `Local only` (muted cloud-off icon); all counter flows continue uninterrupted via IndexedDB.

### Flow B — Incoming Online Order & KDS
1. **Happy path:** Website order arrives → header `Online` button pulses violet with count pill, persistent dark-navy banner appears at top of workspace (`"N new online order(s) waiting to be accepted"` + `"View & Accept"`), sidebar badge pulses, mobile hamburger shows violet dot, and audio chime plays → staff opens `OnlineOrdersModal` → reviews items/address → clicks `Accept to cart` → cart loads order + customer + order type → cashier checks out → order advances automatically and appears in KDS (`F8`) → kitchen taps `Mark Ready` → `Bump / Served`.
2. **Unhappy paths:**
   - **Cart already has items when accepting online order:** Inline confirmation asks before overwriting the current cart.
   - **Rejecting an online order:** Opens an inline reason input inside the card/dialog (replacing browser `window.prompt()`) with explicit `"Confirm Reject"` and `"Cancel"`.
   - **Sync failure:** `SyncBadge` switches to high-contrast danger state (`"Sync issue"` + click-to-retry tooltip with error detail).
   - **Empty inbox / empty KDS:** Centered empty state explains how orders arrive and offers a direct `"Record website order"` action in Online Orders.
   - **Delayed kitchen ticket (`≥ 15m`):** Card shifts to red border + tint, paired with `Clock` icon and `"15m+"` urgent badge (never color alone).

### Flow C — Live Shift Stock, Costing & Closeout
1. **Happy path:** Owner/Manager clicks `Authenticate to View` on `LiveStockPanel` → enters 4–8 digit Owner PIN → sees live KPI strip (`Shift Sales`, `Live Cost`, `Live P&L`), ingredient list with `+1`/`-1` quick adjustments, and low-stock warning banner → opens `Shift Summary` or `Profit & Loss` (live-updated on the go) → clicks `Close Shift & Start New` → confirms in modal → shift costs lock into `Sale.lockedCost` → `OpeningCashModal` opens for the next shift.
2. **Unhappy paths:**
   - **Wrong Owner PIN:** Inline field error (`"Incorrect owner PIN."`); 5 failed attempts trigger a 5-minute lockout countdown.
   - **No Owner PIN configured yet:** If caller is `OWNER`, prompt allows creating a 4–8 digit PIN; if caller is `MANAGER`/other, input is hidden and copy instructs an Owner to configure a PIN in `Admin Settings`.
   - **Invalid negative unit cost or stock edit:** Rejected inline next to the input while keeping user input intact.

### Flow D — Sign-In & First-Time Bootstrap
1. **Happy path:** Staff enters username/email + password → cloud auth verifies role (`OWNER`/`MANAGER`/`CASHIER`/`WAITER`) → enters counter shell.
2. **Unhappy paths:** Wrong credentials / disabled account / missing POS role show inline `role="alert"` message without clearing username; unreachable network falls back cleanly to local seeded accounts (`OfflineError` only); first-time Owner can click `"First time? Create the owner account"` to open the bootstrap dialog.

---

## 3. Information Architecture

### Shell Structure
- **Top Header (`56px` sticky):** Brand mark + title, Role pill (`≥ sm`), high-priority triggers (`Online` with live pending badge, `KDS`), `SyncBadge`, User greeting (`≥ lg`), `Logout`.
- **Left Navigation Rail (`Sidebar`):** Persistent on desktop (`≥ 1024px`, `256px` expanded / `64px` collapsed with icon badges); slide-over drawer with scrim on mobile/tablet (`< 1024px`).
- **Main Counter Workspace:**
  - `≥ 1024px`: 3-column grid — `2fr` left (`MenuGrid` + 2-up `LiveStockPanel` & `Recent Sales`), `1fr` sticky right (`CartPanel`). Full-width Online Order alert banner spans all 3 columns at top when `pendingOnlineCount > 0`.
  - `< 1024px`: Single-column flow — Alert banner → `MenuGrid` → `CartPanel` (`#posCartMobileAnchor`) → `LiveStockPanel` & `Recent Sales` (2-up at `md`, stacked on mobile) + fixed `60px` dark-navy sticky bottom checkout bar when cart has items.
- **Layered Task Modals (`<Modal>`):** Secondary workflows open in focused dialogs (`max-w-md` for single-step prompts, `max-w-2xl` for operational tables/reports) so the cashier's in-progress cart is never lost.

### Navigation & Role Visibility Matrix

| Group | Nav Label (User Vocabulary) | Shortcut / Badge | `OWNER` | `MANAGER` | `CASHIER` | `WAITER` |
|-------|-----------------------------|------------------|---------|-----------|-----------|----------|
| **Orders** | Counter & menu | `/` search, `F2` pay, `F4` hold | Yes | Yes | Yes | Yes (no pay) |
| **Orders** | Kitchen display (KDS) | `F8` · active ticket badge | Yes | Yes | Yes | Yes |
| **Orders** | Online orders | Header + pulsing pending badge | Yes | Yes | Yes | Yes |
| **Orders** | Held orders | Held count badge | Yes | Yes | Yes | Yes |
| **Orders** | Deliveries | Active deliveries badge | Yes | Yes | Yes | Yes |
| **Orders** | Customers | — | Yes | Yes | Yes | Yes |
| **Insights** | Sales analytics | — | Yes | — | — | — |
| **Insights** | Profit & loss | Live active-shift COGS | Yes | — | — | — |
| **Operations** | Inventory | — | Yes | Yes | — | — |
| **Operations** | Suppliers | — | Yes | Yes | — | — |
| **Operations** | Expenses | Manager submits `PENDING` | Yes | Yes | — | — |
| **Operations** | Staff management | — | Yes | Yes | — | — |
| **Operations** | Opening cash | — | Yes | — | — | — |
| **Operations** | Shift summary | Close shift locks costs | Yes | Yes | — | — |
| **Operations** | Printer settings | — | Yes | Yes | Yes | Yes |
| **Operations** | Activity log | — | Yes | — | — | — |
| **Operations** | Admin settings | Menu, photos, PIN, loyalty, backup | Yes | — | — | — |

---

## 4. Visual Direction

> **One-sentence direction:** *A high-clarity cobalt-and-paper counter instrument: crisp white order sheets on cool slate-ice surfaces, midnight-navy urgency chrome for live orders and mobile checkout, and tabular PKR numerals built for zero-hesitation tapping.*

### Intentional Choices
- **Type pair:** `Plus Jakarta Sans` (500–700, `-0.01em` tracking) for display headings, section headers, and grand totals; `Inter` (400–700, `tabular-nums` on every price, quantity, order ID, and timer) for UI controls, tables, and dense operational rows.
- **Surface discipline:** Flat crisp cards (`1px` cool hairline borders) instead of heavy drop shadows or generic gradients. The only dark surface in light mode is `#000524` (Midnight Navy), strictly reserved for high-attention chrome: Login backdrop, Incoming Online Order alert banner, Mobile sticky checkout bar, Toasts, and Sidebar session footer.
- **Single brand accent + reserved urgency hue:** `#2941e0` (Cobalt) owns all primary actions, selected states, and prices. `#5b3ee0` / `#795afa` (Violet) is reserved exclusively for incoming online-order urgency so cashiers never confuse it with ordinary buttons.
- **Unify legacy modals:** Eliminate the split between newer cobalt cards and older Tailwind `indigo-600` / `blue-600` / `gray-100` / `font-black` / `text-[9px]` modals by routing every screen through the single token set below.

---

## 5. Design Tokens

### Color Tokens & Verified WCAG 2.2 AA Contrast

| Token | Hex | Usage | Verified Contrast |
|-------|-----|-------|-------------------|
| `--surface-canvas` | `#f8fafd` | App workspace background | Base |
| `--surface-card` | `#ffffff` | Cards, modals, sidebar, header, inputs | Base |
| `--surface-tint` | `#eff6ff` | Soft chips, table picker, KPI strip, subtle hover | Base |
| `--surface-navy` | `#000524` | Online alert banner, mobile checkout bar, toasts | Base |
| `--border-subtle` | `#e0edff` | Card & section dividers | Decorative container |
| `--border-hairline` | `#d4d4d8` | Header/sidebar structural rules | Structural divider |
| `--border-control` | `#788991` | Input borders, secondary button borders, close/remove icons | **3.63:1** on `#fff` (WCAG AA UI ≥ 3:1) |
| `--ink-primary` | `#000000` | Headings, dish titles, line totals, input text | **21.00:1** on `#fff` / **20.08:1** on `#f8fafd` |
| `--ink-strong` | `#273238` | Section titles, field labels, inactive tabs | **13.13:1** on `#fff` |
| `--ink-secondary` | `#526066` | Captions, unit prices, helper copy | **6.51:1** on `#fff` / **5.99:1** on `#eff6ff` |
| `--ink-muted` | `#616f75` | Placeholders, empty-state copy, timestamps (replaces `gray-400`) | **5.20:1** on `#fff` / **4.78:1** on `#eff6ff` |
| `--accent-primary` | `#2941e0` | Primary buttons, active filters, selected tables, prices | **7.18:1** white-on-cobalt / **6.59:1** on `#eff6ff` |
| `--accent-primary-hover` | `#1f35c4` | Primary button hover/pressed | **8.88:1** with `#fff` |
| `--accent-alert` | `#5b3ee0` | Online order urgent button & badge ink (upgraded from `#795afa` 4.51:1) | **6.54:1** with `#fff` |
| `--accent-alert-soft` | `#c5b9fa` | Secondary text/rings on `#000524` navy chrome | **11.17:1** on `#000524` |
| `--status-success` | `#047857` | Confirm / Complete Sale / Add-to-cart badge / positive P&L (replaces `emerald-500` 2.54:1) | **5.48:1** with `#fff` / **5.21:1** on `#ecfdf5` |
| `--status-success-bg` | `#ecfdf5` | Success highlight row & revenue tiles | Pairs with `#047857` |
| `--status-warning` | `#b45309` | KDS `Mark Ready`, pending expense, low stock text (replaces `amber-500` 2.15:1) | **5.02:1** with `#fff` |
| `--status-warning-ink` | `#92400e` | Text inside `#fffbeb` warning panels & occupied tables | **6.84:1** on `#fffbeb` |
| `--status-warning-bg` | `#fffbeb` | Occupied table, KDS preparing/warning, low stock strip | Pairs with `#92400e` |
| `--status-danger` | `#dc2626` | Void/delete, cart `-` stepper, shortfall, urgent KDS (replaces `red-500` 3.76:1) | **4.83:1** with `#fff` |
| `--status-danger-ink` | `#b91c1c` | Danger text inside `#fef2f2` tinted containers | **5.91:1** on `#fef2f2` |
| `--status-danger-bg` | `#fef2f2` | Urgent ticket tint, discount/shortfall alerts | Pairs with `#b91c1c` |

### Type, Spacing, Radii, Elevation, Breakpoints & Motion

```css
:root {
  /* Typography */
  --font-display: "Plus Jakarta Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --text-total: 1.5rem;      /* 24px / 1.2 — Grand Total, Payment Due */
  --text-title: 1.125rem;    /* 18px / 1.3 — Modal & Panel Titles */
  --text-section: 0.9375rem; /* 15px / 1.35 — Category & Card Headings */
  --text-body: 0.875rem;     /* 14px / 1.45 — Inputs, Dish Names, Buttons */
  --text-meta: 0.75rem;      /* 12px / 1.4 — Labels, Helper Text, Timestamps */
  --text-badge: 0.6875rem;   /* 11px / 1.1 — Minimum floor for status pills */

  /* Spacing (4px base grid) */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */

  /* Radii */
  --radius-control: 8px;   /* Buttons, table chips, header actions */
  --radius-input: 10px;    /* Text inputs, selects, segmented wraps, toasts */
  --radius-card: 16px;     /* Cards, dish tiles, modals */
  --radius-pill: 88px;     /* Status badges, count pills */

  /* Elevation */
  --shadow-card-hover: 0 4px 14px rgba(41, 65, 224, 0.10);
  --shadow-floating: 0 12px 28px rgba(0, 5, 36, 0.22);
  --shadow-modal: 0 24px 60px rgba(0, 5, 36, 0.45);

  /* Motion (all reduced to 0.01ms under prefers-reduced-motion: reduce) */
  --dur-fast: 150ms;     /* Button hover, chip toggle, focus ring */
  --dur-base: 200ms;     /* Sidebar collapse, drawer slide, modal fade */
  --dur-feedback: 420ms; /* cartPop confirmation pulse */
}
```

- **Breakpoints:** `320px` (minimum no-horizontal-scroll floor) · `375px` (standard mobile) · `768px` (`md` tablet, 3-col menu + 2-col stock/sales) · `1024px` (`lg` desktop persistent sidebar + sticky right cart) · `1280px` (`xl` 4-col menu grid).

---

## 6. Component Inventory

| Component | Variants | Sizes & Touch Bar | States |
|-----------|----------|-------------------|--------|
| **Button** | `primary` (`#2941e0`), `secondary` (`#fff` + `#788991` border), `confirm` (`#047857`), `danger` (`#dc2626`), `alert` (`#5b3ee0`), `ghost` | `sm` `36px` desktop (`40px` mobile), `md` `40px`, `lg` `44px` (`Checkout`, `Complete Sale`). Icon-only buttons `≥ 36px` desktop / `≥ 44px` mobile. | default, hover, active, `focus-visible:ring-2 ring-offset-1 ring-[#2941e0]`, disabled (`opacity-45 cursor-not-allowed`), busy (spinner + verb `"Saving…"`). |
| **Input / Select / Textarea** | `text`, `tel`, `number` (right-aligned `tabular-nums`), `password`, `date`, `search` (`/` shortcut hint) | Height `40px` desktop / `44px` mobile. Always paired with a visible `<label>` above (never placeholder-only). | default (`#788991` border), focus (`2px` `#2941e0`), error (`#dc2626` border + inline `role="alert"` fix hint), disabled. |
| **Quantity Stepper** | Cart line `-` / `qty` / `+` + Trash remove | Each tap target **`≥ 32×32px` desktop / `36×36px` mobile** (upgrade from current `22×22px`). `-` uses `#dc2626`, `+` uses `#047857`, remove icon uses `#526066` hover `#dc2626`. | default, hover, focus-visible, min-qty (`1` → removes item). |
| **Segmented Control & Filter Chips** | Order Type (`Dine In / Takeaway / Delivery`), Category filter pills, KDS `Active / Completed` | Height `40px`, `role="group"` + `aria-pressed` (not mismatched `role="tablist"`). Wrap/scroll cleanly without clipping at `320px`. | active (`#2941e0` fill + white text), inactive (`#fff` + `#273238`), hover (`#eff6ff`). |
| **Dish Card (`MenuGrid`)** | Photo card (`object-cover h-24`) or `"Menu"` placeholder box (per-dish, no global override) | 2-col (`320–767px`), 3-col (`768–1279px`), 4-col (`≥ 1280px`). | default, hover lift, `in-cart` (`#2941e0` border + `×N in cart` pill + `+1 more`), `just-added` (`#047857` border + `✓ Added` + `cartPop`), focus-visible. |
| **Status Badge / Live Cue** | Neutral count, Online urgent (pulsing dot + icon + count), KDS timer (`<8m` neutral, `8–14m` amber + `Clock`, `≥15m` red + `Clock`), Refund partial/full | Min `11px` semi-bold, `rounded-[88px]`, icon + text (never color alone). | static, pulsing (stopped under `prefers-reduced-motion`). |
| **Modal & Inline Confirm** | Standard (`max-w-md`), Wide (`max-w-2xl`), Inline confirmation panel (replaces `window.confirm` / `window.prompt`) | `max-h-[85vh]`, sticky header + footer, scrollable body. Must support `Esc` to close, `aria-labelledby`, focus trap, and focus return to trigger. | open, submitting/locked, error banner. |
| **Toast & Workspace Banner** | Floating toast (`#000524`, `role="status"` `aria-live="polite"`, `3s` auto-dismiss, lifted `bottom-20` on mobile when cart bar visible); Persistent Online Alert banner (`#000524` + `#5b3ee0` CTA). | Max 1 active toast (debounced/replaced cleanly). | visible, reduced-motion instant swap. |
| **Data Table / Dense List** | Sales History, Inventory, Suppliers, Customers, Staff, Activity Log | Stacked cards on `< 640px`, horizontal-scroll-safe table/list on `≥ 640px`, `tabular-nums` right-aligned money columns. | loading skeleton/text, empty state with CTA, filtered-empty with reset, populated. |

---

## 7. Screen Specifications (Layouts & All 6 States)

### 7.1 Sign-In & Owner Bootstrap (`LoginScreen`)
- **Layout:** Centered `max-w-md` white card (`p-6 sm:p-10`) over Midnight Navy radial backdrop. Brand logo, `"Point of Sale"` pill, `"Hungry Birds"` display title, Username + Password fields with visible labels, full-width `44px` `"Secure Login"` CTA, and `"First time? Create the owner account"` link. At `320–375px`, outer padding `16px` and `overflow-y-auto` so keyboard appearance never traps the submit button.
- **States:** `loading` (`"Signing in…"` disabled CTA) · `empty` (inputs blank, HTML5 + blur validation) · `error` (inline `role="alert"` red banner preserving username) · `partial` (username entered, awaiting password) · `success` (transitions directly to Counter) · `disabled` (submit disabled while `busy`).

### 7.2 POS Counter Workspace (`App` + `Sidebar` + `MenuGrid` + `CartPanel` + `CustomerPanel`)
- **Desktop (`1280px+`):** Persistent `256px` sidebar (collapsible to `64px`) + `2fr` menu/operations column (4-col dish grid; 2-col `LiveStockPanel` + `Recent Sales` below) + `1fr` sticky `CartPanel`.
- **Tablet (`768px`):** Sidebar collapses to slide-over drawer via header hamburger (`44px` tap target). Menu shows 3-col grid; `CartPanel` stacks cleanly below menu; `LiveStockPanel` + `Recent Sales` render 2-up; fixed bottom checkout bar appears when cart has items.
- **Mobile (`320–375px`):** Header keeps hamburger + logo icon + compact title (hide `"Hungry Birds"` text only if `< 360px` with active Online pill so `"Hung..."` never clips awkwardly), Online icon+count pill, `KDS` icon/label, `Sync` icon, and `Logout` icon/label without horizontal scroll. Menu is 2-col; `Order Type` segmented buttons use `grid-cols-3` equal widths so `Dine In / Takeaway / Delivery` never overflow `320px`; `CustomerPanel` uses visible labels and 1-col inputs on mobile; `#posCartMobileAnchor` keeps `scroll-mb-24` clearance above the `60px` bottom sticky bar.
- **States:**
  - `loading`: Dexie `useLive` initializes immediately from local IndexedDB; brief placeholder text if `categories`/`menu` undefined.
  - `empty`: No dishes → `"No dishes available. Add some in Admin Settings."`; Search miss → `"No items match \"…\""` + quick `"Clear search"` button; Empty cart → `"Cart is empty — tap any dish to start an order"`; Empty `Recent Sales` → `"No sales recorded yet."`.
  - `error`: Delivery/stock/waiter guard displays actionable toast (and highlights missing customer phone field on Delivery).
  - `partial`: Cart populated with modifiers/discount/table/customer, waiting for `Hold` or `Checkout & Print`.
  - `success`: Dish added (`✓ Added` + `×N in cart` + emerald cart row highlight + toast); Sale completed (cart cleared + `"Sale #ID completed — Rs X"`).
  - `disabled`: `Hold` and `Checkout & Print` disabled when cart is empty; `Checkout & Print` visually cues Waiter limitation (`"Waiters hold orders only"` or clear toast).

### 7.3 Take Payment (`PaymentModal`)
- **Layout:** Migrated onto shared `<Modal title="Take Payment">` (`max-w-md`) with `Esc` close. Top KPI summary card (`Total Due` in `24px` `tabular-nums` cobalt/emerald), 3-col method selector (`Cash`, `Card`, `Online`), and when `Cash` is selected: visible `"Cash Received (Rs)"` label + large `tabular-nums` input + **quick-tender chips** (`Exact`, `Rs 500`, `Rs 1,000`, `Rs 2,000`, `Rs 5,000`) + high-contrast `Change` / `Still owed` readout. Footer: `Cancel` (`secondary`) + `Complete Sale` (`confirm` `#047857`, `44px`).
- **States:** `loading` (`busy` guard `"Recording sale…"` preventing double-submit) · `empty` (cash cleared to `0` → shows `"Still owed"` in `#dc2626`) · `error` (inline error if sale fails, modal stays open preserving input) · `partial` (cash `< total`, CTA disabled) · `success` (closes modal, resets cart, triggers print + toast) · `disabled` (`short || busy`).

### 7.4 Online Orders Inbox (`OnlineOrdersModal`)
- **Layout:** `<Modal wide>` split into `New orders (N)` (violet-accented cards with `Accept to cart` `#047857` + `Reject` danger-outline), `In progress (N)` (amber-tinted cards with single next-step action: `Start preparing` / `Assign to rider` / `Mark delivered`), and collapsible `History`. Footer: `Record website order`, `Sync now`, `Show/Hide history` (wraps cleanly on `375px`).
- **States:** `loading` (`Sync now` spins icon + disables while syncing) · `empty` (`Inbox` icon + `"No active online orders"` + phone-order hint) · `error` (inline validation if submitting empty phone order) · `partial` (inline reject-reason form or new-order form open) · `success` (order moved to cart or status advanced + toast) · `disabled` (`Record order` disabled until ≥ 1 dish selected).

### 7.5 Kitchen Display System (`KitchenDisplayModal`)
- **Layout:** `<Modal wide>` with summary strip (`N active kitchen tickets` + `Active` / `Completed` segmented toggle) and responsive ticket grid (`1-col` mobile, `2-col` `≥ 768px`). Each ticket header shows `#ID`, order type badge, table badge, `"Running Tab"` badge (for held), server/time, and elapsed-time urgency pill (`<8m`, `8–14m`, `≥15m` red). Body lists large `qty×` count pills + item names + modifier/note lines. Footer: `Print KOT`, `Mark Ready` (`#b45309` / dark-on-gold), `Bump / Served` (`#047857`), or `Recall` on completed tab.
- **States:** `loading` (instant Dexie query) · `empty` (`"No active/completed kitchen tickets right now."`) · `error` (KOT printer error toast) · `partial` (`PREPARING` vs `READY` visual distinction with icon + label) · `success` (ticket moves to Completed + toast) · `disabled` (none needed; recall always available).

### 7.6 Live Stock, Shift Summary & Profit & Loss (`LiveStockPanel`, `ShiftSummaryModal`, `ProfitLossModal`)
- **Layout:**
  - `LiveStockPanel`: Locked card (`Lock` icon + `"Stock Protected"` + `"Authenticate to View"` CTA) until Owner PIN unlocks → reveals 3-tile live strip (`Shift Sales`, `Live Cost`, `Live P&L`), scrollable ingredient rows with `>= 40px` `+1` / `-1` buttons, and low-stock alert strip.
  - `ShiftSummaryModal` (`<Modal wide>`): Drawer cash ledger → highlighted `Total shift revenue` card → 3-col order-type breakdown → charges → scrollable `Inventory consumed this shift` (showing `recipe` vs `manual` qty & live unit cost) → staff discounts + live `Gross` & `Net shift profit` → footer `Close Shift & Start New` (`#dc2626`) with inline confirm step explaining cost lock.
  - `ProfitLossModal` (`<Modal wide>`): Date range (`From`, `To`, `Today`, `This month`) → 4 KPI cards (`Sales`, `Inventory cost (COGS)`, `Approved expenses`, `Net profit/loss`) stacked 1-col mobile, 2-col tablet, 4-col desktop + explanatory footnote.
- **States:** `loading` (`report === null` placeholder) · `empty` (`"No ingredient consumption recorded this shift"`, `"No raw inventory found"`) · `error` (PIN error / negative cost validation) · `partial` (active shift updating live vs locked historical shift) · `success` (shift closed → opens `OpeningCashModal`) · `disabled` (PIN submit disabled until entered or when non-owner with unset PIN).

### 7.7 Sales History, Refunds & Admin Settings (`SalesHistoryModal`, `RefundModal`, `AdminSettingsModal`)
- **Layout:** All use `<Modal wide>` with consistent `12px` labels, `40px` inputs, and WCAG-verified button colors.
  - `SalesHistoryModal`: Search bar + `Export CSV` + `OWNER`/`MANAGER`-only `Void`, `Refund`, `Edit (Re-open)` controls (Manager routes through `OwnerPinModal`); `CASHIER`/`WAITER` see `Print` and `Share` only.
  - `RefundModal`: Per-line refundable quantity inputs with live pro-rata rupee preview + required `Reason` textarea + `Refund Rs X` CTA.
  - `AdminSettingsModal`: Tabbed sections (`Menu & Recipes` with per-dish `"Upload Photo"` compressed JPEG preview & `"Remove photo"`, `Categories`, `Staff`, `Loyalty Rewards`, `Owner PIN`, `Cloud & Backup`).
- **States:** All 6 states covered; destructive actions (`Void`, `Delete dish`, `Restore backup`, `Close shift`) require explicit inline confirmation (no native `window.confirm()`).

---

## 8. Accessibility & Usability Bar (WCAG 2.2 AA)

1. **Contrast:** Text `≥ 4.5:1` (`≥ 3:1` for large text `≥ 18px bold / 24px regular` and UI control boundaries/icons). Never convey state by color alone (always pair with icon + text label).
2. **Keyboard & Focus:** Every button, input, chip, and modal action reachable via `Tab`; clear `2px` `#2941e0` `focus-visible` ring; modals trap focus, close on `Esc`, and return focus to the opener; counter shortcuts (`/`, `F2`, `F4`, `F8`) ignore keystrokes inside form fields.
3. **Semantic HTML & Forms:** Native `<button>`, `<label htmlFor>`, `<fieldset>/<legend>`, and `<dialog>` / `role="dialog" aria-modal="true" aria-labelledby`; validate on blur & submit; preserve input on error; prevent double-submit on async writes.
4. **Touch & Responsive Floor:** Minimum `24×24px` everywhere (`≥ 40–44px` on mobile primary/stepper controls); zero horizontal overflow at `320px`; respect `@media (prefers-reduced-motion: reduce)` including Tailwind `animate-pulse` and `animate-ping`.
5. **Plain Action-First Copy:** Specific labels (`"Accept to cart"`, `"Bump / Served"`, `"Close Shift & Start New"`, `"Upload Photo"`) and error messages stating *what happened* and *what to do next*.

---

## 9. Audit of Current UI vs. This Spec (Phase 3 Polish Backlog)

Audited directly against `hungrybirds-pos-modern/src/` and prior `1366×768` / `390×844` QA screenshots:

| Priority | Gap Found in Current Code | Files Affected | Spec Fix |
|----------|---------------------------|----------------|----------|
| **P1 (A11y / Contrast)** | Buttons & empty states fail WCAG AA 4.5:1: `bg-emerald-500` (`2.54:1`), `bg-emerald-600` (`3.77:1`), `bg-amber-500` (`2.15:1`), `bg-red-500` (`3.76:1`), `text-gray-400` (`2.54:1`), `text-[#b4c4cc]` trash icon (`1.79:1`). | `PaymentModal.tsx`, `ModifierModal.tsx`, `CartPanel.tsx`, `KitchenDisplayModal.tsx`, `OnlineOrdersModal.tsx`, `HeldOrdersModal.tsx`, `LiveStockPanel.tsx`, `App.tsx` | Switch to verified tokens (`#047857`, `#b45309`, `#dc2626`, `#616f75`, `#526066`/`#788991`). |
| **P1 (Touch Targets)** | Cart `-` / `+` buttons are `22×22px` (`p-1` + `14px` icon) and trash remove icon is `16×16px` — below WCAG 2.2 AA `24px` minimum and `44px` mobile target. | `CartPanel.tsx` | Upgrade stepper buttons to `min-w-8 min-h-8 sm:min-w-9 sm:min-h-9` (`32–36px`) and remove button to `min-w-9 min-h-9`. |
| **P1 (Modal A11y & Consistency)** | `Modal.tsx` lacks `Esc` key handler, `aria-labelledby`, and focus management; `PaymentModal.tsx` bypasses `<Modal>` and lacks double-submit guard; `OnlineOrdersModal` / `ShiftSummaryModal` use `window.prompt()` / `window.confirm()`. | `Modal.tsx`, `PaymentModal.tsx`, `OnlineOrdersModal.tsx`, `ShiftSummaryModal.tsx`, `App.tsx` | Enhance `<Modal>` with `Esc` + `aria-labelledby` + focus restoration; port `PaymentModal` onto `<Modal>` with `busy` guard + quick-tender chips; replace `window.prompt()`/`window.confirm()` with inline confirm UI. |
| **P2 (ARIA & Forms)** | `MenuGrid.tsx` uses `role="tablist"` with `aria-pressed` buttons; `CustomerPanel.tsx` & `OwnerSetupModal` lack visible `<label>` elements. | `MenuGrid.tsx`, `CustomerPanel.tsx`, `LoginScreen.tsx` | Change category strip to `role="group" aria-label="Menu categories"`; add visible `12px` labels to Customer & Owner Setup inputs. |
| **P2 (Mobile `320–375px` Polish)** | At `390px` with active Online pill, header brand truncates to `"Hung..."`; `CartPanel` Order Type bar risks tightness at `320px`; toast can overlap top of `CartPanel` when scrolled. | `App.tsx`, `CartPanel.tsx` | Hide text `"Hungry Birds"` below `sm` when `pendingOnlineCount > 0` (logo + `aria-label` remain); make Order Type `grid-cols-3` full-width on `< sm`. |
| **P2 (Design-System Unification)** | Legacy modals mix `indigo-600`, `blue-600`, `rounded-3xl`, `font-black`, and `text-[9px]`/`text-[10px]` micro-copy instead of the cobalt/paper tokens and `11px` badge floor. | `PaymentModal.tsx`, `CustomerPanel.tsx`, `OnlineOrdersModal.tsx`, `KitchenDisplayModal.tsx`, `ShiftSummaryModal.tsx`, `ProfitLossModal.tsx`, `OwnerPinModal.tsx`, `ModifierModal.tsx`, `HeldOrdersModal.tsx`, `RefundModal.tsx` | Consolidate CSS custom properties in `src/index.css` and standardize modal typography (`≥ 11px` badges, `≥ 12px` metadata) and cobalt/verified semantic tokens. |

---

## 10. Visual Verification Status

- **Prior live captures inspected:** `1366×768` (desktop) and `390×844` (mobile) from Slice 8 QA confirmed zero console errors, functional Online Order & Add-to-Cart cues, and identified the mobile `"Hung..."` truncation, tight cart steppers, and modal style drift documented in Section 9.
- **Pending spec-pass verification:** Fresh multi-width browser check at **`375px`, `768px`, and `1280px`** (plus `320px` overflow check) is **still pending** because Chrome remote debugging (`DevToolsActivePort`) was unavailable during this Phase 2 pass. Re-run once Chrome is open or immediately after implementing the Phase 3 polish slices.
