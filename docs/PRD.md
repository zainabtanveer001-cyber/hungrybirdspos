# Product Requirements Document (PRD) — Hungry Birds POS

## 1. Product Overview
**Hungry Birds POS** (`hungrybirds-pos-modern`) is an offline-first Progressive Web App (PWA) Point-of-Sale system for restaurant counter, table (dine-in), takeaway, and delivery operations. It uses IndexedDB (via Dexie.js v24 schema) for local persistence, optional Firebase Authentication + Firestore REST sync for multi-device and website order integration, and Web Bluetooth / WebUSB / WebSerial / LAN ESC/POS thermal receipt printing with browser-print fallback.

## 2. User Roles & Permissions
| Role | Level | Permitted Actions |
|------|-------|-------------------|
| `OWNER` | 4 | Full access: POS, KDS, Sales history (void/refund/edit without PIN prompt), Analytics, P&L, Inventory, Suppliers, Expenses (auto-approved + approve/reject/edit/delete), Staff & Payroll, Opening Cash, Shift Summary, Activity Log, Printer Settings, Admin Settings (Cloud Setup, Backup/Restore, Categories, Menu & Recipes, Staff Accounts, Loyalty Rewards). |
| `MANAGER` | 3 | Counter & Menu, KDS, Online Orders, Held Orders, Deliveries, Customers, Inventory, Suppliers, Expenses (submit as `PENDING`), Staff Management, Shift Summary, Printer Settings. Void/Refund/Edit completed sales requires Owner PIN authorization. |
| `CASHIER` | 2 | Counter & Menu, KDS, Online Orders, Held Orders, Deliveries, Customers, Printer Settings, Checkout & Print payments, view/print/share Sales History. Cannot void/refund/edit sales or access Operations/Insights modals. |
| `WAITER` | 1 | Counter & Menu, KDS, Online Orders, Held Orders (take orders, assign tables, hold orders), Deliveries, Customers, Printer Settings. Cannot take payments (`Checkout & Print` and `F2` are blocked). |

## 3. User Stories & Acceptance Criteria (Must-Have)

### US-1: Authentication & Offline Fallback
- **Must:** Support cloud sign-in (username or email via Firebase Auth + Firestore `usernameDirectory` and `users/{uid}`) when online, and fall back to local IndexedDB accounts (`owner`, `manager`, `cashier`, `waiter`) **only** when the cloud is unreachable (`OfflineError`).
- **Must:** Reject wrong passwords, disabled accounts, and accounts without a valid POS role (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`).
- **Must:** Persist active session in `sessionStorage` and clear session + sync token on Logout.

### US-2: Menu, Categories, Modifiers & Recipes
- **Must:** Allow Owner to create/delete food categories and create/edit/delete menu items with price, category, optional image URL, and recipe ingredient deductions.
- **Must:** Support dish search (`/` shortcut) and category filtering on the counter screen.
- **Must:** Support modifier groups (required/optional, single/multi-select) and merge identical modifier combinations into a single cart line while keeping different combinations separate.

### US-3: Cart, Order Types, Table Assignment & Pricing Math
- **Must:** Support `DINE_IN` (with table assignment `T1`–`T12` and occupied-table indicators from held orders), `TAKEAWAY`, and `DELIVERY`.
- **Must:** Calculate subtotal, percentage discount (`0`–`100%`), delivery charge (applied only when `orderType === 'DELIVERY'`), packing charge, other charge, percentage tax, and loyalty point redemption (capped at `subtotal - discountAmount`).
- **Must:** Format all PKR amounts deterministically across runtimes (`Rs 1,300` for whole rupees, `Rs 12.50` for fractional amounts).

### US-4: Checkout, Delivery Rules, Stock Verification & Deduction
- **Must:** Block `DELIVERY` checkout if customer phone is missing or if `subtotal - discountAmount < Rs 500`.
- **Must:** Verify recipe ingredient stock before completing a sale and block checkout with a clear message if any ingredient is insufficient.
- **Must:** On sale completion, atomically record the sale, deduct recipe stock, create a `PENDING` delivery record for delivery orders, and upsert the customer CRM + loyalty points.

### US-5: Held Orders & Kitchen Display System (KDS)
- **Must:** Allow holding the current cart (`F4` or Hold button) with table assignment and restoring or discarding held orders.
- **Must:** Display active (`PREPARING`, `READY`) and completed (`SERVED`) kitchen tickets in KDS (`F8`) from both held orders and recent sales, with elapsed time urgency indicators and thermal KOT printing.

### US-6: Sales History, Refunds, Voids & Re-open (Owner PIN Gate)
- **Must:** List completed sales with search and CSV export.
- **Must:** Restrict sale void, partial/full refund, and re-open (`Edit`) to `OWNER` and `MANAGER` (with Owner PIN verification required for `MANAGER`, and 5-attempt / 5-minute lockout on wrong PINs).
- **Must:** Compute refunds pro-rata after order-level discounts, clamp quantities to remaining refundable items, restore recipe stock on refund/void/reopen, and record an audit log entry.

### US-7: Online Orders Inbox
- **Must:** Poll/sync website orders and allow recording phone/website orders locally.
- **Must:** Support order lifecycle transitions (`PENDING` → `ACCEPTED` → `PREPARING` → `OUT_FOR_DELIVERY` → `COMPLETED`, or `REJECTED` with reason) and load accepted orders into the POS cart.

### US-8: Inventory, Suppliers & Expenses
- **Must:** Track raw ingredients, low-stock threshold alerts, and Owner-PIN-protected Live Stock quick adjustments.
- **Must:** Track suppliers, stock-in receipts (updating inventory stock and unit cost), supplier payments, and running balance (`approved expenses + stockIn - payments`).
- **Must:** Enforce expense approval workflow: Owner expenses auto-approve; Manager expenses enter `PENDING` until Owner approves or rejects.

### US-9: Customer CRM & Loyalty Program
- **Must:** Validate customer phone numbers (5–15 digits), track order count, total spent, and loyalty points (1 point per Rs 100 spent), and allow editing customer names in CRM.
- **Must:** Allow Owner to create, edit, enable/disable, and delete loyalty rewards in Admin Settings.

### US-10: Staff Management, Attendance, Leaves & Payroll
- **Must:** Manage employee records, daily attendance (`PRESENT`, `ABSENT`, `LATE`, `HALF_DAY`), leave requests/approvals, salary advances, and monthly payroll calculation (`baseSalary - pendingAdvances`) with atomic advance settlement.

### US-11: Shift Summary, Opening Cash, Analytics & P&L
- **Must:** Track shift start time, opening cash, cash collected, change given, expected drawer cash, discounts by staff, and ingredient cost consumed during the shift.
- **Must:** Provide Sales Analytics (today/week/month buckets, top items, top customers) and date-range Profit & Loss (`Sales - Approved Expenses`).

### US-12: Receipt Printing, Backup/Restore & Mobile Responsive UI
- **Must:** Generate ESC/POS thermal receipts (with centered monochrome logo stamp, kitchen ticket option, 58mm/80mm width) across Bluetooth, USB, Serial, and LAN printers, falling back cleanly to escaped HTML browser printing.
- **Must:** Export and import validated JSON backups (supporting both legacy and modern formats) without exposing or corrupting user credentials.
- **Must:** Provide a responsive mobile layout (`390px` width) with accessible navigation drawer, visible Logout button, and sticky bottom checkout bar.

## 4. Top 3 Risks & Assumptions
1. **Browser runtime / ICU drift:** `Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' })` defaults to 2 fraction digits on Node 22 / older ICU and 0 on newer ICU, breaking receipt tests and UI consistency unless `minimumFractionDigits`/`trailingZeroDisplay` are pinned.
2. **Client-side RBAC & local IndexedDB trust model:** Because the POS is an offline-capable client-side PWA, role checks in the UI must be backed by Firestore Security Rules (`firestore.rules`) for all cloud writes and Owner PIN hashing + lockout for sensitive local actions.
3. **Node 22.14 vs `jsdom@30` compatibility in legacy root test runner:** Root `vitest.config.js` configured `environment: 'jsdom'`, which loads `undici@8` requiring Node `>=22.19.0`, whereas the root unit tests are pure Node tests that do not use DOM APIs.
