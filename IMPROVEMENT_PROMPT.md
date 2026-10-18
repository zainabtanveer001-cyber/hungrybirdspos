# Hungry Birds Restaurant POS — Improvement & Security Hardening Prompt

You are an expert senior developer reviewing a vibe-coded Progressive Web App (PWA) for a restaurant POS system. This is a single-file Vue 3 + TypeScript + Vite build system that uses Firebase Authentication and Firestore for cloud sync, Dexie.js (IndexedDB wrapper) for offline-first local database, Web Bluetooth API for ESC/POS thermal printer connectivity, and TailwindCSS for styling.

## Project Overview

The project is a complete restaurant Point of Sale system built as a PWA with offline capabilities. It features:

- **Offline-first architecture**: Dexie.js IndexedDB wrapper stores all data locally
- **Cloud sync capability**: Firebase Firestore for real-time sync (echo-guarded)
- **Role-based access control**: OWNER, MANAGER, CASHIER, WAITER roles
- **Web Bluetooth**: ESC/POS thermal printer for receipts and KDS tickets
- **PWA features**: Service worker caching, manifest.json, installable
- **Analytics**: Sales analytics with SVG charts, P&L reports, inventory cost calculations
- **Delivery management**: Pending/Active/Completed delivery tracking
- **Customer CRM**: Loyalty points, order history
- **Expense management**: Approval workflow with owner-only access

## Critical Security Vulnerabilities (FIX IMMEDIATELY)

### 1. Plaintext Default Passwords
**File**: `db.js` and `app.js` — `initializeUsers()` function

Current code creates users with default passwords `"1234"` stored in plaintext:
```js
{ username: "owner", password: "1234", role: "OWNER" }
{ username: "manager", password: "1234", role: "MANAGER" }
{ username: "cashier", "password": "1234", role: "CASHIER" }
{ username: "waiter", "password": "1234", role: "WAITER" }
```

**Action Required**:
- NEVER hardcode default passwords in source code
- Force password change on first login
- Use bcrypt or SHA-256 hashing for all stored passwords
- Generate random temporary passwords and display them securely

### 2. Plaintext Owner PIN Storage
**File**: `app.js` — line ~1878

Current code stores the owner PIN as plaintext:
```js
await db.settings.put({ key: "ownerPin", value: "7774" })
```

**Action Required**:
- Hash the PIN using SHA-256 or bcrypt before storage
- The code already has `hashPin()` and `validateAuthorizationPin()` functions — USE THEM
- Store the hashed PIN, not the plaintext value

### 3. Exposed Firebase Configuration
**File**: `app.js` — line ~15-23

Firebase config is exposed in client code:
```js
const firebaseConfig = {
  apiKey: "AIzaSyAIibLNTusvBFOEcExpe db1tYQh_1rv2q7k",
  ...
};
```

**Action Required**:
- While Firebase API keys are not as sensitive as backend secrets, expose only what's necessary
- Use Firebase environment variables via Vite
- Implement proper Firebase Security Rules — these should be the primary security boundary
- Ensure Firestore Security Rules prevent unauthorized data access (see firestore.rules review below)

### 4. Missing Content Security Policy (CSP)
**File**: `index.html` and `netlify.toml`

No CSP header is configured.

**Action Required**:
- Add a CSP meta tag or header in `netlify.toml`:
```toml
[headers.values]
  Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://www.gstatic.com https://www.googleapis.com https://firebaseapp.com; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
```

### 5. Service Worker URL Filter Bug
**File**: `sw.js` — line 36

Operator precedence bug in Firebase traffic filter:
```js
if (url.hostname.includes("firebase") || url.hostname.includes("googleapis") || url.hostname.includes("gstatic.com") && url.pathname.includes("firebasejs")) {
```

**Action Required**:
- Fix operator precedence — the `&&` binds tighter than `||`:
```js
if (
  url.hostname.includes("firebase") ||
  url.hostname.includes("googleapis") ||
  (url.hostname.includes("gstatic.com") && url.pathname.includes("firebasejs"))
) {
  return;
}
```

### 6. Insecure DOM-Based XSS via InnerHTML
**File**: `app.js` and `db.js`

Code throughout injects untrusted data into `innerHTML` without sanitization:
```js
container.innerHTML = menu.map(item => `<div>${item.name}</div>`).join("");
```

**Action Required**:
- Sanitize all data before inserting into innerHTML using `escapeHtml()` (already defined in v4.0 app.js but not used in v3.6)
- Or use DOM APIs (`createElement`, `textContent`) for building elements
- Apply this pattern everywhere HTML is constructed from database/API data

## Architecture & Code Quality Issues

### 1. Monolithic Single-File Architecture
**Files**: `app.js` (~5681 lines), `db.js` (~798 lines), `index.html` (~1488 lines)

All logic is in global scope with `window.functionName` declarations.

**Action Required**:
- Split into ES modules:
  - `database.js` — Dexie initialization and schema
  - `auth.js` — authentication, role management, permissions
  - `cart.js` — cart state, calculations, rendering
  - `sales.js` — sale processing, receipts, refunds
  - `kitchen.js` — KDS, kitchen orders, status updates
  - `inventory.js` — stock verification, deduction, inventory management
  - `delivery.js` — delivery management
  - `customers.js` — CRM, loyalty points
  - `expenses.js` — expense management
  - `analytics.js` — sales analytics, charts, reports
  - `printer.js` — Bluetooth printer connection and printing
  - `cloudSync.js` — Firebase Firestore sync with echo guards
  - `security.js` — CSP, input validation, sanitization
  - `utils.js` — helper functions (escapeHtml, debounce, formatAmount, etc.)
  - `constants.js` — TABLE_STATUS, role definitions, etc.

### 2. Global State Management
**File**: `db.js` and `app.js`

Global variables for state:
```js
let cart = [];
let currentTable = null;
let currentUser = null;
let currentRole = null;
let bluetoothDevice = null;
// ... many more
```

**Action Required**:
- Implement a centralized state store (even a simple pub/sub pattern)
- Use a reactive state management pattern (could be a simplified store)
- Group related state into a single state object
- Consider using Vue 3's reactivity API even in a script-tag setup

### 3. Missing Input Validation
**File**: Throughout `app.js`

Inputs are used without validation:
- Menu prices not validated as numbers
- Quantity inputs can be negative
- Customer phone numbers not validated
- Search inputs injected directly into DOM

**Action Required**:
- Add input validation on all user inputs
- Validate numeric fields (prices, quantities, stock levels)
- Validate phone numbers with regex
- Sanitize all text inputs before storage/display
- Add max-length constraints

### 4. Inconsistent Error Handling
**File**: Throughout

Many `try/catch` blocks are missing or incomplete:
```js
// No error handling
const user = await db.users.where("username").equals(username).first();
if (!user) { alert("User not found."); return; }
```

**Action Required**:
- Add proper error handling for all async operations
- Create a centralized error handler
- Log errors to an error log (for debugging)
- Display user-friendly error messages
- Never expose internal error details to end users

### 5. Missing Tests
No test files exist.

**Action Required**:
- Set up Jest or Vitest for unit testing
- Write tests for:
  - Cart calculations (subtotal, discounts, totals)
  - Inventory deduction logic
  - Stock verification logic
  - PIN hashing/validation
  - Role-based permission checks
  - Input validation functions
  - Database operations (CRUD)

### 6. Missing Linting and Code Quality
**Action Required**:
- Add ESLint configuration (`.eslintrc.js`):
  - Use `eslint:recommended` and `plugin:prettier/recommended`
  - Enforce consistent code style
  - Catch unused variables, undefined variables
- Add Prettier for formatting consistency
- Add editorconfig for consistent editor settings

### 7. Duplicate Dexie Initialization
Both `db.js` and `app.js` initialize Dexie databases, and there are two separate copies in `hungrybirdspos/` subfolder.

**Action Required**:
- Ensure single database initialization
- Implement proper schema migration versioning (Dexie version() chain)
- Consolidate the two copies into one source of truth

## PWA & Service Worker Improvements

### 1. Cache Versioning
**File**: `sw.js`

Cache version is hardcoded: `CACHE_NAME = "hb-pos-cache-v7"`

**Action Required**:
- Version the cache based on app version
- Implement proper cache migration
- Add cache size limits

### 2. Missing Offline Fallback Pages
**File**: `sw.js`

No offline fallback for when the app shell fails to load.

**Action Required**:
- Add an offline fallback page in the service worker
- Cache critical assets more aggressively
- Implement stale-while-revalidate for non-critical resources

### 3. Manifest Completeness
**File**: `manifest.json`

**Action Required**:
- Ensure all icon sizes are provided (192x192, 512x512, etc.)
- Add `start_url` with proper path
- Add `scope` to restrict PWA to specific directory

## Database & Schema Issues

### 1. Schema Design
**File**: `db.js`

Dexie version(7) with no migration history. The v4.0 app.js mentions versioned schemas v14-v19.

**Action Required**:
- Implement proper Dexie migration versioning
- Add indexes for frequently queried fields
- Add data validation at the database layer
- Consider adding timestamps (createdAt, updatedAt) to all tables

### 2. Missing Referential Integrity
No foreign key constraints at the application level.

**Action Required**:
- Add validation when creating relationships (e.g., recipes referencing menu items/inventory)
- Implement cleanup logic when items are deleted (orphan cleanup)

## Cloud Sync & Firebase Issues

### 1. Echo Guard Implementation
**File**: `app.js` — lines ~2116-2291

The code has echo guards to prevent infinite loops in Firestore onSnapshot listeners.

**Action Required**:
- Ensure ALL cloud sync listeners have echo guards
- Standardize the echo guard pattern across all sync functions
- Add proper conflict resolution for offline-first sync
- Handle sync failures gracefully with retry logic

### 2. Firebase Security Rules
**File**: `firestore.rules`

**Action Required**:
- Review and strengthen all rules
- Ensure users can only read/write data they're authorized for
- Restrict sensitive operations (refunds, expense approvals) to appropriate roles
- Add validation rules for document structure

## Bluetooth Printer Issues

### 1. No Connection State Management
**File**: `app.js` — `connectPrinter()`

**Action Required**:
- Track connection state (connected, connecting, disconnected)
- Handle disconnection gracefully
- Reconnect automatically when the device reconnects
- Show connection status in the UI
- Add timeout handling for connection attempts

## Expense Management Issues

### 1. Approval Workflow Inconsistency
**File**: `app.js` — expenses section

The UI mentions "Manager Notice" with restriction to owner, but the approval workflow is incomplete.

**Action Required**:
- Complete the approval workflow: pending → approved/rejected
- Track who approved each expense
- Add approval timestamp
- Add notification for pending approvals

## Refund System Issues

### 1. Owner PIN Verification
**File**: `app.js` — refund functions

**Action Required**:
- Ensure owner PIN is verified using hashed comparison, NOT plaintext
- Log all refund attempts (success and failure)
- Add refund reason validation
- Prevent duplicate refunds on already-refunded orders

## Analytics & Reporting

### 1. Chart Implementation
**File**: `app.js` — lines 608-728

SVG line charts are implemented manually without a charting library.

**Action Required**:
- Consider using Chart.js or a similar library for better maintainability
- Add date range filtering for all analytics
- Add export functionality for all reports
- Add print preview for reports

## Netlify Configuration

**File**: `netlify.toml`

**Action Required**:
- Add more comprehensive security headers:
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Strict-Transport-Security: max-age=31536000; includeSubDomains
  - X-XSS-Protection: 1; mode=block
- Add redirect rules for SPA fallback
- Configure asset optimization

## Specific Code Improvements to Make

### 1. In `db.js` — User Initialization
Replace:
```js
await db.users.bulkAdd([
  { username: "owner", password: "1234", role: "OWNER" },
  { username: "manager", password: "1234", role: "MANAGER" },
  // ...
]);
```
With:
```js
// Do NOT create default users with known passwords
// Instead, require first-run setup with password creation
// Or generate random temporary passwords and force change on login
```

### 2. In `app.js` — PIN Storage
Replace:
```js
await db.settings.put({ key: "ownerPin", value: "7774" });
```
With:
```js
const hashedPin = await hashPin("7774"); // Use the existing hashPin function
await db.settings.put({ key: "ownerPinHash", value: hashedPin });
```

### 3. In `sw.js` — Fix Filter Logic
Fix the operator precedence issue on line 36.

### 4. In `app.js` — HTML Injection
Replace all instances of:
```js
container.innerHTML = data.map(item => `<div>${item.name}</div>`).join("");
```
With:
```js
container.innerHTML = data.map(item => `<div>${escapeHtml(item.name)}</div>`).join("");
```

### 5. In `index.html` — Add CSP Meta Tag
Add before the closing `</head>` tag:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://www.gstatic.com https://www.googleapis.com https://firebaseapp.com; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;">
```

## Summary of Priority

**P0 (Critical Security)**:
1. Remove default passwords
2. Hash all PINs before storage
3. Add CSP headers
4. Fix service worker URL filter bug
5. Sanitize all innerHTML usage against XSS

**P1 (Architecture)**:
6. Split monolithic files into modules
7. Implement centralized state management
8. Add input validation everywhere
9. Add comprehensive error handling
10. Fix duplicate Dexie initialization

**P2 (PWA & Offline)**:
11. Improve cache versioning and strategy
12. Add offline fallback pages
13. Complete manifest with all icons

**P3 (Testing & Quality)**:
14. Add ESLint and Prettier
15. Write unit tests
16. Add type checking (TypeScript even if basic)

**P4 (Features & Polish)**:
17. Add proper audit logging for all sensitive actions
18. Improve expense approval workflow
19. Add conflict resolution for offline sync
20. Improve printer connection state management

---

This prompt is designed to guide a developer (or AI coding tool) through systematically improving the Hungry Birds Restaurant POS application. Start with the P0 security fixes, as these are critical vulnerabilities that could compromise the entire system.