# Bentree OMS

> **Order Management System** — v3.3.0 Stable  
> Built with React 18, Firebase Firestore, and Tailwind CSS.

A full-featured, real-time order management system for Bentree — handling the complete lifecycle of online and store orders, inventory, barcode printing, exchanges, returns, and profit reporting.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Authentication & Roles](#authentication--roles)
- [Core Features](#core-features)
  - [New Order Form](#new-order-form)
  - [Order Lifecycle](#order-lifecycle)
  - [Exchange System](#exchange-system)
  - [Return System](#return-system)
  - [Inventory Management](#inventory-management)
  - [Barcode Print Studio](#barcode-print-studio)
  - [Barcode Scanner Integration](#barcode-scanner-integration)
  - [Store Sales](#store-sales)
  - [Reporting](#reporting)
- [Data Architecture](#data-architecture)
- [Inventory Stock Logic](#inventory-stock-logic)
- [URL Routing](#url-routing)
- [Environment & Deployment](#environment--deployment)

---

## Overview

Bentree OMS manages the full operational workflow of an apparel retail business:

- **Online orders** flow from Pending → Confirmed → Dispatched → Delivered, with branches for Hold, Exchange, and Return.
- **Store orders** are created at a physical counter and processed through an in-app checkout queue.
- **Inventory** is tracked atomically per product per size. Every status change that affects stock triggers an `increment()` update directly in Firestore.
- **Barcode labels** are generated per-unit per-size and printed to a thermal label printer from the browser.
- **Hardware barcode scanners** are supported natively — scan into the New Order form to auto-fill products, or scan anywhere in the app to open an order details popup.
- **Role-based access** restricts financial reports and delete operations to `master` users.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React 18 (Vite) |
| Styling | Tailwind CSS (CDN in production, PostCSS in dev) |
| Database | Firebase Firestore (real-time `onSnapshot` listeners) |
| Authentication | Firebase Auth — Google OAuth + Anonymous (credential) |
| Icons | Lucide React |
| Barcodes | `react-barcode` (preview) + `JsBarcode` (print iframe) |
| CSV export | Custom `downloadCSV` with BOM for Bangla (৳) support |
| Deployment | Static SPA — compatible with Vercel, Netlify, Firebase Hosting |

---

## Project Structure

```
bentree-oms/
├── index.html                  # Entry point, Tailwind CDN
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── src/
    ├── main.jsx                # React root
    ├── App.jsx                 # Root component: auth, listeners, routing, handlers
    ├── firebase.js             # Firebase init, exports { auth, db, appId }
    ├── utils.js                # Constants, getStatusColor, downloadCSV, updateInventoryStock
    ├── index.css               # Tailwind directives + custom scrollbar
    ├── hooks/
    │   └── useScanner.js       # Hardware barcode scanner hook (keydown buffering)
    └── components/
        ├── LoginPage.jsx       # Google + credential auth
        ├── Sidebar.jsx         # Role-filtered navigation, profile photo upload
        ├── SearchBar.jsx       # Reusable search input
        ├── NewOrderForm.jsx    # Online + Store order creation, scanner-aware
        ├── PrimaryOrders.jsx   # Pending orders, call log, checkout flow
        ├── ConfirmedOrders.jsx # Active orders, delivery modal, hold modal
        ├── DispatchTab.jsx     # Dispatch queue, SL counter, dispatch remark
        ├── HoldTab.jsx         # On-hold orders with remarks
        ├── ExchangeTab.jsx     # Exchange history table
        ├── ExchangeModal.jsx   # Full/partial exchange processing
        ├── CancelledOrders.jsx # Cancelled/returned with refund tracking
        ├── OrderDetailsPopup.jsx # Full order view, inline edit, return/exchange
        ├── InvoiceGenerator.jsx  # A5 printable invoice
        ├── InventoryTab.jsx    # Dashboard, CRUD, CSV import/export, barcode trigger
        ├── BarcodePrintView.jsx # Label preview + print studio
        ├── StockLocationTab.jsx # Shelf/bag/carton location management
        ├── StoreSales.jsx      # Store checkout queue + sales history
        ├── OnlineSalesTab.jsx  # Delivered online orders, per-product P&L
        ├── SalesReports.jsx    # Master report: revenue, COGS, return loss
        ├── MonthlyProfitTab.jsx # Monthly P&L with expense input
        └── OrdersPage.jsx      # Standalone reference page (alternative entry)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Firebase project with Firestore and Authentication enabled

### Installation

```bash
git clone <repo-url>
cd bentree-oms
npm install
```

### Firebase setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore Database** (production mode).
3. Enable **Authentication** — turn on Google provider and Anonymous provider.
4. Copy your config into `src/firebase.js`.
5. Update `appId` in `src/firebase.js` to match your Firebase App ID — this is used as the Firestore path prefix.

### Firestore data paths

All collections live under:

```
artifacts/{appId}/public/data/
  orders/         ← all order documents
  inventory/      ← all inventory documents
  locations/      ← shelf/bag/carton locations
  expenses/       ← monthly expense records
```

### Adding authorized users

Edit `src/utils.js`:

```js
// Google accounts (email → role)
export const GOOGLE_ACCOUNTS = {
  'you@gmail.com': 'master',
};

// Credential accounts (username → { pass, role, name })
export const CREDENTIAL_ACCOUNTS = {
  'myuser': { pass: 'mypass', role: 'employee', name: 'My Name' },
};
```

### Running locally

```bash
npm run dev
```

### Building for production

```bash
npm run build
```

---

## Authentication & Roles

The app supports two authentication paths:

| Method | How it works |
|---|---|
| Google OAuth | `signInWithPopup` — email must be in `GOOGLE_ACCOUNTS` whitelist |
| Username/Password | `signInAnonymously` + `updateProfile` to set display name |

### Roles

| Role | Access |
|---|---|
| `master` | All tabs including Sales Reports, Monthly Profit, and permanent delete |
| `employee` | Orders, Inventory, Store Sales, Online Sales |
| `qmt` | Orders only (New Order, Primary, Confirmed, Dispatch, Hold, Exchange, Cancel) |

Role is stored in `localStorage` as `bentree_role` and checked on every render via `userRole` state.

---

## Core Features

### New Order Form

Located at `/new-order`. Supports two order types toggled at the top:

**Online order fields:**
- Date, order source (Facebook / Instagram / Whatsapp / Website / Other), profile link
- Order receiver name, shift (1/2/3), checkout status
- Products: code, size, qty, price, per-item discount (fixed or %)
- Global discount (fixed or %), delivery charge, express delivery toggle
- Advance amount → auto-calculates due amount
- Recipient: name, phone (11-digit validated), address, city, zone, area
- Merchant Order ID (auto-incremented from existing orders)

**Store order fields:**
- Sales-by name, payment mode (Cash / Card / MFS), customer phone
- Products with same discount logic
- Total received amount → calculates due

**Duplicate detection** — warns if an active order already exists for the same phone + product code combination.

**Stock validation** — checks available stock per size in real time. Prevents submission if insufficient stock.

**On submit:**
1. Calls `updateInventoryStock` for each product to deduct stock.
2. Writes the order document to Firestore.
3. Redirects to Primary Orders (online) or Store Sales (store).

---

### Order Lifecycle

#### Online orders

```
New Order → Pending → Confirmed → Dispatched → Delivered
                 ↘ Cancelled           ↘ Returned
                 ↘ Hold → (Unhold) → Confirmed
                           ↘ Exchanged
```

**Status transitions and their stock impact:**

| Transition | Stock effect |
|---|---|
| Create order | Deduct all product quantities |
| Cancel active order | Restore all product quantities |
| Return active order | Restore all product quantities |
| Restore cancelled/returned to Pending | Deduct all product quantities again |
| Edit order (change products) | Restore old products, deduct new products |

All stock operations use Firestore `increment()` for atomicity — no read-modify-write race conditions.

#### Primary Orders tab

- Shows all `Pending` online orders.
- Call log with 3 attempt buttons + freeform note.
- Duplicate phone alert (animated warning triangle).
- Express Delivery badge (⚡ ED).
- Checkout flow: enter Merchant Order ID → click Confirm → order becomes `Confirmed`.

#### Confirmed Orders tab

- Shows Confirmed, Dispatched, Delivered, Returned, Exchanged orders.
- Date range filter (start + end date).
- Delivery modal: enter received amount + delivery charge → marks Delivered, moves advance to collected.
- Hold modal: requires a remark.
- Return, Exchange, Cancel, Delete buttons with role-based disable.
- Duplicate detection across active orders.
- Footer totals: order count + total revenue (ex. delivery).

#### Dispatch tab

- Shows Confirmed + Dispatched + Exchanged orders.
- Reverse serial number within each group (so newest = highest SL).
- Dispatch remark input (saved on blur).
- One-click "Confirm Dispatch" button.

---

### Exchange System

Accessible from the Confirmed Orders row (⇌ button) or the Exchange Orders tab.

**Full exchange (`ExchangeModal`):**
- Replace all products with new ones.
- Per-item discount + global discount on new items.
- New delivery cost.
- Calculates: new product value − old product value + new delivery = net due or refund.
- Appends to `exchangeHistory[]` array, preserving all past exchanges.

**Partial exchange:**
- Check the "Exchange" checkbox on individual product rows.
- Creates a new order document for the exchanged items (status: `Exchanged`, `isPartialExchange: true`).
- Updates the original order with the remaining items.
- Calculates proportional discount and delivery for the split.

**Exchange history tab** — shows one row per exchange event, with original/new product lists, financial adjustment, and "Return received" checkbox.

---

### Return System

Accessible from the Confirmed Orders row (↩ button) which opens `OrderDetailsPopup` in return mode.

**Full return:**
- Saves order with status `Returned`.
- Restores stock for all products.
- Records original delivery charge in `originalDeliveryCharge` for return-loss calculation in reports.

**Partial return (`OrderDetailsPopup`):**
- Check the "Return" checkbox on individual product rows.
- Click "Process Partial Return" → preview modal shows split.
- Creates a new order document for returned items (status: `Returned`, `isPartialReturn: true`, `dueAmount: 0`, `deliveryCharge: 0`, no discount).
- Updates original order with remaining items, retains original status.

**Cancelled & Returned tab:**
- Combined view of all `Cancelled` and `Returned` orders.
- "Return received" checkbox — turns row green when product physically received back.
- "Refunded" checkbox — marks money returned to customer.
- Refund amount visibility: only shown for orders with advance payment or prior delivery.
- Restore-to-Pending button.
- Permanent delete (master only).

---

### Inventory Management

#### Product types

| Type | Stock field | Size |
|---|---|---|
| Variable | `stock: { S: 10, M: 5, XL: 3 }` | XS / S / M / L / XL / 2XL / 3XL |
| Single | `totalStock: 20` | Free (no size) |

#### Inventory dashboard

- Category summary cards (14 categories).
- Total items + total asset value (qty × unit cost).
- Per-item table: stock breakdown, unit cost, total MRP value, sold qty, revenue, profit/loss.
- Profit/loss calculated by cross-referencing all delivered orders.

#### Add / edit product

Fields: date, product name, code (unique, uppercase), type, category, location, shelf row, stock per size, unit cost, MRP.

#### CSV import

- Parses exported CSV back into Firestore.
- Skips duplicates by product code.
- Handles quoted fields with internal commas.
- Supports `Variable` type with `stock breakdown` column format `M:95 | XL:116`.

#### CSV export

- Exports current filtered inventory with all stats.
- BOM prefix (`\uFEFF`) ensures Bangla characters render correctly in Excel.

---

### Barcode Print Studio

Triggered by clicking the printer icon on any inventory row. Opens at `/barcodePrintView`.

- Generates one label per unit per size (e.g. 5 units in size M = 5 labels).
- Label content: brand, product name, barcode (code-size format), code, size, MRP.
- Size presets: 38×25mm (default), 50×25mm, 50×30mm, 60×40mm, Custom.
- Preview at screen scale; prints at physical label size via an iframe.
- Print single label or all labels in queue.
- Grid preview of all labels in queue.

**Print mechanism:** Injects an `<iframe>` with a self-contained HTML document that loads JsBarcode from CDN, renders all labels, calls `window.print()`, and removes itself after the dialog closes.

---

### Barcode Scanner Integration

The `useScanner` hook listens to `keydown` events globally. It distinguishes scanner input from human typing using a 100ms gap threshold between keystrokes.

**Scan format:** `CODE-SIZE` (e.g. `BNT001-XL`) or plain `CODE`.

**In New Order Form:**
- Parses code and size from barcode value.
- Auto-fills the first empty product row or appends a new row.
- Checks stock availability before adding.

**Anywhere else in the app:**
- Looks up orders by `merchantOrderId`, `storeOrderId`, or `trackingId`.
- Opens `OrderDetailsPopup` for the matched order.

---

### Store Sales

**Checkout queue mode:**
- Large scan/type input, shows only Pending store orders matching the search.
- Enter order ID → Complete button appears → marks order Completed, records collected amount.
- Payment mode selector per order.

**Sales history mode:**
- Table of all non-cancelled/returned store orders.
- Per-product revenue and profit/loss.
- Filter by category, payment mode, date range.
- Export to CSV.

---

### Reporting

All report tabs are restricted to `master` role.

#### Monthly Profit tab

- Date range: month-to-month picker.
- Expense input form (12 categories: media, salary, rent, utility, VAT, COD charge, food, transport, accessories, payment gateway fees, maintenance, others).
- Expense auto-loads when start month changes.
- Saved to Firestore under `expenses/{year}-{month}`.
- Financial overview:
  - Online net sales (subtotal − discount − revenue adjustment, delivered orders only)
  - Store sales (grand total of completed store orders)
  - Return delivery loss (original delivery charge of returned orders with 0 current charge)
  - Total revenue = Online + Store − Return loss
  - COGS = unit cost × qty sold (from inventory cross-reference)
  - Operating expenses = sum of all expense fields in range
  - **Net profit = Revenue − COGS − Expenses**

#### Sales Reports tab

- Same revenue/COGS logic but displayed per product row.
- Platform filter (Facebook / Instagram / Whatsapp / Website / Store / Other).
- Summary cards: Net Online Sales, Store Sales, Delivery Income, Total Discount, Return Loss, Total Cash In.
- Sticky footer totals.

#### Online Sales tab

- Shows delivered online orders only.
- Per-product: receiver name, phone, checkout status, category, stock, cost, units sold, net revenue, profit/loss.
- Refund checkbox inline.
- Sticky footer with order count, total revenue, total profit.

---

## Data Architecture

### Order document fields

```js
{
  // Identity
  type: 'Online' | 'Store',
  merchantOrderId: '1042',      // Online
  storeOrderId: '2018',         // Store
  trackingId: 'PATHAO123',      // Set after dispatch
  
  // Customer
  recipientName, recipientPhone, recipientAddress,
  recipientCity, recipientZone, recipientArea,
  
  // Products
  products: [
    { code: 'BNT001', size: 'L', qty: 2, price: 1200,
      discountType: 'Fixed' | 'Percent', discountValue: 100 }
  ],
  
  // Financials
  subtotal,          // sum of (price × qty) after per-item discounts
  discountType, discountValue,   // global discount
  totalDiscount,     // computed global discount amount
  deliveryCharge,
  grandTotal,        // subtotal + delivery − global discount
  dueAmount,         // grandTotal − advance − collected
  advanceAmount,
  collectedAmount,
  revenueAdjustment, // shortfall/excess on delivery

  // Status
  status: 'Pending' | 'Confirmed' | 'Dispatched' | 'Delivered' |
          'Returned' | 'Cancelled' | 'Exchanged' | 'Hold',
  
  // Flags
  isExpress: false,
  isPartialReturn: false,
  isPartialExchange: false,
  isReturnReceived: false,
  isRefunded: false,
  
  // Exchange
  exchangeDetails: { originalProducts, newProducts, priceDeviation, exchangeDate },
  exchangeHistory: [...],  // array of exchange events
  originalOrderId: '1042', // for split orders
  
  // Tracking
  history: [{ status, timestamp, note, updatedBy }],
  createdAt, updatedAt,
  addedBy, addedByEmail, lastEditedBy,
  
  // Store-specific
  storePaymentMode: 'Cash' | 'Card' | 'MFS',
  salesByName,
}
```

### Inventory document fields

```js
{
  code: 'BNT001',              // uppercase, unique
  productName: 'Panjabi Blue',
  category: 'Panjabi',
  type: 'Variable' | 'Single',
  stock: { S: 10, M: 5, XL: 3 },  // Variable only
  totalStock: 20,                   // Single only
  unitCost: 800,
  mrp: 1500,
  locationId: 'loc_abc',
  shelfRow: 'Row 2',
  date, createdAt, addedBy, lastEditedBy,
}
```

---

## Inventory Stock Logic

All stock mutations go through `updateInventoryStock` in `utils.js`:

```js
updateInventoryStock(productCode, size, qtyChange, inventoryList)
```

- `qtyChange > 0` → restores stock (cancellation, return).
- `qtyChange < 0` → deducts stock (new order, exchange).
- Uses Firestore `increment(qtyChange)` — atomic, no stale reads.
- For Variable products: finds the exact case-sensitive key in `stock` to prevent duplicate field creation.
- Throws on failure so the calling function can halt and alert the user.

**Key flows:**

| Action | Call |
|---|---|
| Create order | `increment(-qty)` per product |
| Cancel active order | `increment(+qty)` per product |
| Edit order | restore old products `+qty`, deduct new products `−qty` |
| Exchange (full) | restore old `+qty`, deduct new `−qty` |
| Create return order | no stock change (already restored on cancel/return status) |

---

## URL Routing

The app uses the HTML5 History API — no React Router dependency.

- `window.history.pushState` updates the URL on tab change.
- `window.addEventListener('popstate')` handles browser back/forward.
- `window.location.pathname` is read on load to restore the active tab.
- Current tab is also persisted to `localStorage` as `bentree_tab`.

Tab IDs map directly to URL paths:

| URL | Tab |
|---|---|
| `/new-order` | New Order Form |
| `/primary` | Primary Orders |
| `/confirmed` | Confirmed Orders |
| `/dispatch` | Dispatch Info |
| `/hold` | Hold Orders |
| `/exchange` | Exchange Orders |
| `/cancelled` | Cancel & Return |
| `/inventory` | Inventory |
| `/stock-location` | Stock Location |
| `/online-sales` | Online Sales |
| `/store-sales` | Store Sales |
| `/reports` | Sales Reports |
| `/monthly-profit` | Monthly Profit |
| `/barcodePrintView` | Barcode Print Studio |

The Sidebar uses `<a href="/{tabId}">` with `e.preventDefault()` for normal clicks, and lets Ctrl+click / Cmd+click open a new tab natively.

---

## Environment & Deployment

### Firebase security rules (recommended)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/public/data/{collection}/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Vite SPA redirect (Vercel / Netlify)

For Vercel — add `vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

For Netlify — add `public/_redirects`:

```
/* /index.html 200
```

### Profile photos

Profile photos are stored in `localStorage` keyed by display name (`bentree_photo_{displayName}`). They are not uploaded to Firebase Storage. This means photos are device-local only.

---

## License

Private — Bentree internal use only.
