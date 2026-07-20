# Bentree OMS

> **Order Management System** — v3.3.0 Stable  
> React 18 · Firebase Firestore · Firebase Cloud Functions · Tailwind CSS

A full-featured, real-time order management system for Bentree — handling the complete lifecycle of online (WooCommerce) and in-store orders, live inventory, barcode printing, exchanges, returns, and profit reporting.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Folder Structure](#folder-structure)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Clone & Install](#clone--install)
  - [Firebase Setup](#firebase-setup)
  - [WooCommerce Integration](#woocommerce-integration)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Adding Authorized Users](#adding-authorized-users)
- [Database / Firestore Setup](#database--firestore-setup)
- [OMS Features](#oms-features)
  - [New Order Form](#new-order-form)
  - [Primary Orders](#primary-orders)
  - [Confirmed Orders](#confirmed-orders)
  - [Dispatch Tab](#dispatch-tab)
  - [Hold Orders](#hold-orders)
  - [Exchange System](#exchange-system)
  - [Return System](#return-system)
  - [Cancelled & Returned](#cancelled--returned)
  - [Inventory Management](#inventory-management)
  - [Stock Locations](#stock-locations)
  - [Store Sales](#store-sales)
  - [Online Sales](#online-sales)
  - [Sales Reports](#sales-reports)
  - [Sales & Inventory Report](#sales--inventory-report)
  - [Monthly Profit](#monthly-profit)
  - [Barcode Print Studio](#barcode-print-studio)
  - [Barcode Scanner Integration](#barcode-scanner-integration)
- [Authentication & User Roles](#authentication--user-roles)
- [Cloud Functions](#cloud-functions)
- [URL Routing](#url-routing)
- [Available Scripts](#available-scripts)
- [Build & Deployment](#build--deployment)
- [Performance Optimizations](#performance-optimizations)
- [Troubleshooting](#troubleshooting)
- [Dependencies](#dependencies)
- [License](#license)

---

## Overview

Bentree OMS manages the full operational workflow of an apparel retail business across two sales channels:

- **Online orders** (WooCommerce website) flow through: Pending → Confirmed → Dispatched → Delivered, with branches for Hold, Exchange, and Return.
- **Store orders** (physical counter) are created in the OMS and processed through an in-app checkout queue.
- **Inventory** is tracked atomically per product per size using Firestore `increment()` — every status transition automatically adjusts stock without race conditions.
- **WooCommerce sync** runs bidirectionally via Firebase Cloud Functions: website orders sync into the OMS via webhook, and OMS changes sync back to WooCommerce via callable functions.
- **Barcode labels** are generated per-unit per-size and printed directly from the browser to a thermal label printer.
- **Hardware barcode scanners** integrate natively — scan into the New Order form to fill product rows, or scan from anywhere to open the matched order's detail popup.
- **Role-based access** restricts financial reports and permanent delete operations to `master` users.

---

## Features

| Category | Capability |
|---|---|
| Order Management | Create, edit, delete online and store orders |
| Status Lifecycle | Pending → Confirmed → Dispatched → Delivered → Return / Exchange |
| Exchanges | Full exchange or partial exchange with proportional financial split |
| Returns | Full return or partial return with sibling document creation |
| Inventory | Per-size stock tracking, CSV import/export, movement log |
| Barcode | Label design, preview, queue, print to thermal printer |
| Scanner | Global keyboard scanner hook; routes scans contextually |
| Store Sales | Checkout queue mode + sales history with payment filtering |
| WooCommerce | Inbound webhook, outbound order create/update/sync, stock sync |
| Reports | Sales report, online sales P&L, sales & inventory report, monthly profit |
| Expenses | 12-category monthly expense input with P&L calculation |
| Locations | Shelf / bag / carton location management |
| Invoices | A5 printable invoice per order |
| Export | CSV export on every list (orders, inventory, dispatch, sales) |
| Auth | Google OAuth + credential (username/password) sign-in |
| Roles | Master, Employee, QMT — tab-level and action-level restrictions |

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React 18 (Vite 8) |
| Styling | Tailwind CSS (loaded via CDN script in `index.html`) |
| Font | Inter (Google Fonts) |
| Icons | Lucide React |
| Database | Firebase Firestore (real-time `onSnapshot`) |
| Authentication | Firebase Auth — Google OAuth + Anonymous with `updateProfile` |
| Cloud Functions | Firebase Functions v7, Node.js 24 (2nd Gen) |
| WooCommerce API | WooCommerce REST API v3 via `axios` (in Cloud Functions) |
| Barcodes (preview) | `react-barcode` |
| Barcodes (print) | JsBarcode 3.11.6 (CDN, loaded inside print iframe) |
| CSV export | Custom `downloadCSV` utility with UTF-8 BOM |
| Hosting | Firebase Hosting (SPA rewrite to `index.html`) |
| Build tool | Vite 8 with manual chunk splitting |

---

## System Architecture

```
Browser (React SPA)
│
├── Firebase Auth          ← Google OAuth + Anonymous sign-in
├── Firestore onSnapshot   ← 5 real-time listeners (orders, inventory,
│                              locations, expenses, inventoryAdjustments)
└── Firebase Functions SDK ← httpsCallable (wooCreateOrder, wooSyncOrder,
                                wooUpdateOrder, wooAdjustStock)

Firebase Cloud Functions (Node.js 24)
│
├── woocommerceWebhook     ← HTTP trigger — receives WooCommerce events
│                              (order.created / order.updated / order.deleted)
├── wooCreateOrder         ← onCall — creates WooCommerce order from OMS
├── wooSyncOrder           ← onCall — updates WooCommerce order from OMS edit
├── wooUpdateOrder         ← onCall — changes WooCommerce order status
└── wooAdjustStock         ← onCall — syncs product stock to WooCommerce

WooCommerce (bentreebd.com)
└── REST API v3  ← /orders, /products, /products/{id}/variations
```

**Bounce-back loop prevention:**  
Before any OMS write propagates to WooCommerce, an `_omsEditedAt` server timestamp is stamped on the Firestore document. When the resulting webhook fires, the Cloud Function checks this timestamp and skips the event if it is within 90 seconds — preventing OMS edits from triggering a cycle.

**Stock atomicity:**  
All stock mutations use `FieldValue.increment()` — never read-modify-write. Concurrent order creation by multiple users cannot cause negative stock corruption.

---

## Folder Structure

```
bentree-oms/
├── index.html                    # App entry point, Tailwind CDN, Inter font
├── vite.config.js                # Vite build config with manual chunks
├── package.json                  # Frontend dependencies
├── firebase.json                 # Hosting + Functions deploy config
├── .firebaserc                   # Firebase project alias (bentree-oms)
├── public/
│   └── bentree_logo.webp         # Brand logo (used in invoice)
├── functions/                    # Firebase Cloud Functions (Node.js 24)
│   ├── index.js                  # All 5 exported Cloud Functions
│   ├── package.json              # Functions dependencies (axios, firebase-admin)
│   ├── .eslintrc.js              # Google style ESLint (gates deploy via predeploy hook)
│   └── .env                      # WooCommerce credentials (gitignored)
└── src/
    ├── main.jsx                  # React root (StrictMode)
    ├── App.jsx                   # Root: auth state, Firestore listeners, write handlers, routing
    ├── firebase.js               # Firebase init → exports { auth, db, functions, appId }
    ├── utils.js                  # Shared constants, helpers, stock logic
    ├── index.css                 # Tailwind directives + custom scrollbar styles
    ├── hooks/
    │   └── useScanner.js         # Hardware barcode scanner hook
    ├── WooAPI/
    │   ├── CreateOrder.jsx       # httpsCallable wrapper for wooCreateOrder
    │   └── wooStock.js           # httpsCallable wrappers for wooSyncOrder / wooUpdateOrder / wooAdjustStock
    └── components/
        ├── LoginPage.jsx
        ├── Sidebar.jsx
        ├── SearchBar.jsx
        ├── NewOrderForm.jsx
        ├── PrimaryOrders.jsx
        ├── ConfirmedOrders.jsx
        ├── DispatchTab.jsx
        ├── HoldTab.jsx
        ├── ExchangeTab.jsx
        ├── ExchangeModal.jsx
        ├── CancelledOrders.jsx
        ├── OrderDetailsPopup.jsx
        ├── InvoiceGenerator.jsx
        ├── InventoryTab.jsx
        ├── BarcodePrintView.jsx
        ├── StockLocationTab.jsx
        ├── StoreSales.jsx
        ├── OnlineSalesTab.jsx
        ├── SalesReports.jsx
        ├── SalesInventoryReport.jsx
        └── MonthlyProfitTab.jsx
```

---

## Installation

### Prerequisites

- Node.js 18+ (frontend) / Node.js 24 (Cloud Functions — enforced in `functions/package.json`)
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project with **Firestore** and **Authentication** enabled
- A WooCommerce store with REST API credentials (for the bidirectional sync)

### Clone & Install

```bash
git clone <repo-url>
cd bentree-oms

# Install frontend dependencies
npm install

# Install Cloud Functions dependencies
cd functions && npm install && cd ..
```

### Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore Database** (Production mode).
3. Enable **Authentication** — turn on **Google** provider and **Anonymous** provider.
4. Open `src/firebase.js` and replace the `firebaseConfig` object with your project's config (found in Project Settings → Your apps → Firebase SDK snippet).
5. The `appId` exported from `src/firebase.js` is set to `firebaseConfig.appId` and is used as the Firestore collection path prefix — update it if your app ID changes.

### WooCommerce Integration

The WooCommerce sync runs entirely through Firebase Cloud Functions. Configure credentials by setting environment variables in `functions/.env`:

```env
WC_BASE=https://yourdomain.com/wp-json/wc/v3
WC_KEY=ck_your_consumer_key
WC_SECRET=cs_your_consumer_secret
WC_WEBHOOK_SECRET=your_webhook_secret
```

In your WooCommerce admin → WooCommerce → Settings → Advanced → Webhooks, create webhooks for:

| Event | Delivery URL |
|---|---|
| Order created | `https://<region>-<project>.cloudfunctions.net/woocommerceWebhook` |
| Order updated | `https://<region>-<project>.cloudfunctions.net/woocommerceWebhook` |
| Order deleted | `https://<region>-<project>.cloudfunctions.net/woocommerceWebhook` |

Set the **Secret** field to the same value as `WC_WEBHOOK_SECRET`.

---

## Configuration

### Environment Variables

The frontend has **no environment variables** — the Firebase config is embedded in `src/firebase.js`.

Cloud Functions (`functions/.env`):

| Variable | Description | Required |
|---|---|---|
| `WC_BASE` | WooCommerce REST API base URL | Yes |
| `WC_KEY` | WooCommerce Consumer Key | Yes |
| `WC_SECRET` | WooCommerce Consumer Secret | Yes |
| `WC_WEBHOOK_SECRET` | HMAC-SHA256 key for webhook signature verification | Yes |

> **Security:** `functions/.env` is gitignored. Never commit credentials. For production, consider using Firebase Secret Manager (`firebase functions:secrets:set VAR_NAME`).

### Adding Authorized Users

Edit `src/utils.js`:

```js
// Google sign-in — email must be in this map
export const GOOGLE_ACCOUNTS = {
  'admin@example.com': 'master',
  'staff@example.com': 'employee',
};

// Credential sign-in — username/password
export const CREDENTIAL_ACCOUNTS = {
  'myuser': { pass: 'mypassword', role: 'employee', name: 'Display Name' },
};
```

Valid roles: `master`, `employee`, `qmt`.

---

## Database / Firestore Setup

All Firestore data lives under a single path prefix:

```
artifacts/{appId}/public/data/
```

Where `{appId}` is the Firebase App ID string from `src/firebase.js`. Collections:

| Collection | Contents | Written by |
|---|---|---|
| `orders` | All order documents | App.jsx handlers, Cloud Functions |
| `inventory` | Product/stock documents | App.jsx handlers, InventoryTab |
| `locations` | Shelf/bag/carton locations | StockLocationTab (direct Firestore) |
| `expenses` | Monthly expense records (ID: `{year}-{month}`) | MonthlyProfitTab (direct Firestore) |
| `inventoryAdjustments` | Stock movement log | `logInventoryMovement` in utils.js, Cloud Functions |

### Recommended Firestore Security Rules

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

Deploy these rules from the Firebase Console → Firestore → Rules, or via `firebase deploy --only firestore:rules` (after creating a `firestore.rules` file).

---

## OMS Features

### New Order Form

**Tab:** `/new-order` — Available to all roles.

Supports two order types (toggled at the top):

**Online order fields:**
- Date, order source (Facebook / Instagram / Whatsapp / Website / Other), profile link, shift (1/2/3)
- Products: code, size, quantity, price, per-item discount (Fixed ৳ or Percent %)
- Global discount (Fixed or Percent), delivery charge, express delivery toggle
- Advance amount → auto-calculates due amount
- Recipient: name (required), phone (11-digit, required), address, city, zone, area
- Delivery zone (Inside Dhaka / Outside Dhaka) — auto-set based on city
- Merchant Order ID (auto-incremented from highest existing OMS order ID)

**Store order fields:**
- Store Order ID (auto-incremented), sales-by name
- Payment mode: Cash / Card / bKash / Nagad / MFS / Bank Transfer / Split / Due
- Split payment: multiple payment entries, each with mode, amount, transaction reference
- Customer phone
- Products with same pricing/discount logic
- Collected amount / due amount

**Smart features:**
- **Duplicate detection** — warns if an active order exists for the same phone + product code.
- **Real-time stock validation** — checks available stock per size as products are added. Accounts for qty already added in other rows of the same form.
- **Product autocomplete** — typing 3+ characters in the code field shows matching inventory items with per-size stock counts.
- **Scanner-aware** — barcode scans auto-fill product rows (see [Barcode Scanner Integration](#barcode-scanner-integration)).

**On submit:**
1. Final stock validation (aborts if insufficient).
2. Deducts stock via `updateInventoryStock` for each product.
3. Writes order document to Firestore.
4. For online orders: calls `wooCreateOrder` Cloud Function (fire-and-forget); on response, writes `wc_order_id` back to the Firestore document.
5. Navigates to Primary Orders (online) or Store Sales (store).

---

### Primary Orders

**Tab:** `/primary` — Shows Pending online orders.

- **Call log:** 3 attempt toggle buttons per order. Each click prompts for a remark; stores `attempt1`, `attempt2`, `attempt3` timestamps and notes.
- **Duplicate phone alert:** animated warning triangle when multiple Pending orders share the same recipient phone.
- **Express Delivery badge** (`⚡ ED`) when `isExpress === true`.
- **Checkout flow:** enter Merchant Order ID in the inline input → click Confirm → order transitions to `Confirmed`.
- **Header stats:** order count + total MRP value.

---

### Confirmed Orders

**Tab:** `/confirmed` — Shows Confirmed, Dispatched, Delivered, Returned, Exchanged, and Cancelled orders.

**Filters:**
- Date range (start + end date).
- Status dropdown.
- Search: phone, name, merchantOrderId, order source, remarks.
- Pagination: 50 orders per page.

**Duplicate detection across active orders:**
- Same phone + matching product code in different orders.
- Same non-zero `dueAmount` in different orders.

**Delivery modal:** Enter received amount and any updated delivery charge. Computes `collectedAmount` and `dueAmount`. Marks order `Delivered`.

**Hold modal:** Requires a remark string. Sets status to `Hold`.

**Actions per row:** Confirm dispatch, Hold, Return (opens `OrderDetailsPopup` in return mode), Exchange (opens `ExchangeModal`), Delete (master only), Edit.

**Pathao CSV export:** Formatted for Pathao courier upload — ItemType, StoreName, MerchantOrderId, RecipientName, RecipientPhone, RecipientAddress, RecipientCity, RecipientZone, RecipientArea, AmountToCollect, ItemQuantity, ItemWeight, ItemDesc, SpecialInstruction.

**Footer totals:** Order count + total revenue excluding delivery (hidden for `qmt` role).

---

### Dispatch Tab

**Tab:** `/dispatch` — Shows Confirmed, Dispatched, and Exchanged orders.

- **Reverse SL numbering** within each status group so the newest order gets the highest serial number.
- **Express Delivery badge** (`⚡ ED`).
- **Dispatch remark** — inline text input saved on blur via `onUpdate`.
- **"Confirm Dispatch" button** — transitions order to `Dispatched`.
- **CSV export** — columns: Date, Products, Phone (prefixed with `'` to prevent Excel number formatting), Special Instructions, Remarks.

---

### Hold Orders

**Tab:** `/hold` — Shows orders with `status === 'Hold'`.

- Phone number search.
- Displays the remark entered when the order was put on hold.
- **"Unhold (To Queue)" button** — transitions order back to `Confirmed`.

---

### Exchange System

**Tab:** `/exchange` — Shows all exchange events.

Exchanges are initiated from the Confirmed Orders tab (⇌ button), which opens `ExchangeModal`.

**Full exchange:**
- Replace all products with a new set.
- Per-item discount + global discount (Fixed or Percent) on new items.
- New delivery cost.
- Financial adjustment: `(new product value) − (old product value) + new delivery charge`.
- Exchange event is appended to `exchangeHistory[]` array on the order document, preserving the full history.

**Partial exchange:**
- Check the "Exchange" checkbox on specific product rows in the modal.
- A new order document is created for the exchanged items (`status: 'Exchanged'`, `isPartialExchange: true`, ID format: `{originalId}-EXC-{6-digit-suffix}`).
- The original order is updated with the remaining items; discount and delivery are split proportionally.

**Exchange history tab** shows one row per exchange event with:
- Original products (red) vs. new products (green).
- Financial adjustment.
- "Return received" checkbox (on the latest exchange record only).

---

### Return System

Returns are initiated from the Confirmed Orders tab (↩ button), which opens `OrderDetailsPopup` in return mode.

**Full return:**
- Sets status to `Returned`.
- Restores stock for all products.
- Records `originalDeliveryCharge` for return-loss calculation in reports.

**Partial return:**
- Check the "Return" checkbox on individual product rows in the popup.
- A preview modal shows the split before confirming.
- A new order document is created for returned items (status: `Returned`, `isPartialReturn: true`, ID format: `{originalId}-RET-{6-digit-suffix}`, `dueAmount: 0`, `deliveryCharge: 0`).
- The original order is updated with the remaining items and retains its current status.

---

### Cancelled & Returned

**Tab:** `/cancelled` — Combined view of all Cancelled and Returned orders.

- **Filters:** Single date filter + search (phone, name, order ID).
- **Return received checkbox** — turns the row green when the physical product is back in hand. Only shown if the order was previously delivered or has a return status.
- **Refunded checkbox** — marks money returned to the customer. Only shown when a refund is applicable (order had advance payment or was previously delivered).
- **Refund amount display:** `|advance + collected|`.
- **Restore to Pending** button — reactivates the order.
- **Mark as Cancelled** button (for returned orders).
- **Permanent delete** (master only) — immediate optimistic hide, then calls `onDelete`.
- **CSV export:** Date, Order ID, Customer Name, Phone, Status, Reason/Note.

---

### Inventory Management

**Tab:** `/inventory` — Available to `master` and `employee` roles.

#### Product types

| Type | Stock field | Sizes |
|---|---|---|
| Variable | `stock: { S: 10, M: 5, XL: 3, … }` | XS / S / M / L / XL / 2XL / 3XL |
| Single | `totalStock: 20` | Free (no size) |

#### Inventory dashboard

- Category summary grid (14 categories: Panjabi, T-Shirt, Polo, Shirt, Trouser/Pant, Short, Jacket/Shrug, Sweater/Sweatshirt, Hoodie, Activewear, Accessories, Undergarments, Others, Orna/Dupatta).
- Total items count + total asset value (`Σ stock × unitCost`).
- Per-item table: stock per size, unit cost, MRP, sold qty, revenue, and profit/loss (cross-referenced against all delivered orders).
- Stock low alert: current stock < 5 shown in red.

#### Add / edit product

Fields: date, product name, product code (unique, uppercase), type, category, location, shelf row, unit cost, MRP, stock per size (Variable) or total stock (Single).

In edit mode: **"Set as Initial Stock" checkbox** — increments the `initialStock` field with the specified quantity and records `initialStockDate`. Used for opening stock setup.

#### CSV import

- Parses exported CSV back into Firestore.
- Skips rows where the product code already exists (no duplicates).
- Handles quoted fields containing commas.
- Variable type: parses `stock breakdown` column in format `M:95 | XL:116`.

#### CSV export

- All inventory items with stock, cost, MRP, sold qty, revenue, and profit/loss.
- UTF-8 BOM prefix (`﻿`) for correct Bangla character rendering in Microsoft Excel.

#### Inventory adjustment log

- Shows the last 100 adjustment entries from the `inventoryAdjustments` collection.
- Columns: date/time, product code, product name, size, action type, quantity change (± colored), stock before → after, user.
- 14 action types tracked: Order, Online Order, Store Sale, Exchange, Full Exchange, Partial Exchange, Return, Full Return, Partial Return, Cancel, Order Delete, Order Edit, Restore, Manual Stock Add / Minus.

---

### Stock Locations

**Tab:** `/stock-location` — Available to `master` and `employee` roles.

Manages physical storage locations (shelves, bags, cartons). Location types: Shelf, Display Shelf, Bag, Carton, Other.

Fields per location: type, name, rows (for Shelf/Display Shelf), numbering (e.g. `A-01`), location description (e.g. `Warehouse 1, 2nd Floor`).

Locations appear in the inventory product add/edit form as a dropdown.

> StockLocationTab writes directly to Firestore without going through App.jsx handlers.

---

### Store Sales

**Tab:** `/store-sales` — Available to `master` and `employee` roles.

#### Checkout queue mode

- Large search bar (autofocused) — type or scan a Store Order ID or phone number.
- Shows only Pending store orders matching the search that haven't been checked out yet.
- Per result: inline Order ID input, customer info, products, payment mode selector, grand total, Complete button.
- **Complete:** confirms the order ID → marks order `Completed`, sets `collectedAmount = grandTotal`, `dueAmount = 0`.
- **Cancel button** (with confirmation dialog).

#### Sales history mode

Filters: search (order ID or phone), category, payment mode (Cash / Card / bKash / Nagad / MFS / Bank Transfer / Split / Due), Due Orders toggle, date range.

Shows all non-cancelled/returned `Store` type orders with:
- Products, payment mode, grand total, net revenue, COGS, profit/loss.
- **Payment modal** (💳 icon) — view and edit payment entries inline (mode, amount, transaction reference, timestamp). Saves via `onUpdate` with updated `payments`, `collectedAmount`, `dueAmount`, `storePaymentMode`.
- Footer: total orders, total units sold, total revenue, total profit/loss.

**Due Orders toggle** — filters to orders where `dueAmount > 0`.

**CSV export** — order history for the current filtered view.

---

### Online Sales

**Tab:** `/online-sales` — Available to `master` and `employee` roles.

Shows only `type === 'Online'` orders with `status === 'Delivered'`.

**Filters:** search (name/phone/ID), category, date range.

**Per-order columns:** Order ID + date, receiver name, phone, products, total qty, net revenue (`grandTotal − deliveryCharge + revenueAdjustment`), profit/loss (revenue − COGS), order source, added by.

**Footer:** total order count, total units, total net revenue, total net profit (sticky).

**CSV export:** all columns, filename `online_sales_report.csv`.

**Row click** → opens `OrderDetailsPopup`.

---

### Sales Reports

**Tab:** `/reports` — **Master only.**

Combined report covering both delivered online orders and completed store orders.

**Filters:** search, category, platform (Store / WooCommerce / Facebook / Instagram / Whatsapp / Website / Daraz / Other), location zone (Inside Dhaka / Outside Dhaka / Store Sales), date range.

**Zone breakdown cards:** for each delivery zone — order count, units sold, net revenue, total discount, profit/loss.

**Summary cards (6):**
| Card | Calculation |
|---|---|
| Net Online Sales | `Σ (grandTotal − deliveryCharge + revenueAdjustment)` for delivered online orders |
| Store Sales | Same formula for completed store orders |
| Delivery Income | `Σ deliveryCharge` for delivered online orders + returned orders with `deliveryCharge > 0` |
| Total Discount | Per-product discounts + global order discount; WooCommerce orders use `(mrp − price) × qty` |
| Return Loss | `Σ originalDeliveryCharge` for returned orders where `deliveryCharge === 0` |
| Total Cash In | `(Net Online + Store) − Return Loss` |

**Table columns:** Order ID + date, zone badge, products, total qty, net revenue, profit/loss, sales source, added by.

**CSV export** with filename `sales_report_{startDate}_to_{endDate}.csv`.

---

### Sales & Inventory Report

**Tab:** `/sales-inventory-report` — Available to **all roles**.

Combined analytics and inventory movement log. Two top-level tabs:

#### Sales Report tab

- Period filter: Today / This Month / Custom date range.
- Per-product: product name, SKU, category, qty sold (in period), current stock, last sale date.
- Sorted by qty sold descending.
- Red stock indicator when current stock < 5.
- **Detail panel** (click any row): current stock breakdown per size, initial stock + date, sales history sub-tab, movement log sub-tab — each with their own period filter and CSV/Excel/PDF export.

#### Inventory Movement Log tab

- Groups all stock movements by product.
- Sources combined:
  - `source: 'order'` entries from `inventoryAdjustments` collection (written by Cloud Functions and `logInventoryMovement`).
  - Manual adjustments (no `source` field) from `inventoryAdjustments`.
  - Order-derived fallback for orders not covered by logged entries (parses status history).
- Per product: movement count, last activity, latest action type.
- Exports: CSV, Excel (`.xls` with UTF-8 BOM), PDF (print window).

**Summary cards (4):** Total Orders, Units Sold, MRP Value, Inventory Movement count.

---

### Monthly Profit

**Tab:** `/monthly-profit` — **Master only.**

Date range picker (month-to-month). Expense input form with 12 categories:

| Category | Category |
|---|---|
| Media / Advertising | Salary |
| Rent | Utility |
| VAT | COD Charge |
| Food | Transport |
| Accessories | Payment Gateway Fees |
| Maintenance & Repairs | Others |

Expenses are stored in Firestore under `expenses/{year}-{month}` and auto-load when the start month changes.

**Financial overview (right column):**
- Online net sales, store sales, return delivery loss
- Total revenue = Online + Store − Return Loss
- COGS = `Σ (unitCost × qty)` for all revenue orders, product code cross-referenced from inventory
- Operating expenses = sum of all expense fields in range
- **Net Profit = Revenue − COGS − Expenses**

> MonthlyProfitTab writes directly to Firestore (not via App.jsx handlers).

---

### Barcode Print Studio

**Tab:** `/barcodePrintView` — Triggered by the printer icon on any inventory row.

Generates one label per unit per size (5 units in size M = 5 labels in the queue).

**Label content:** Bentree brand name, product name, barcode (`{CODE}-{SIZE}` or `{CODE}` for Free size), code text, size, MRP.

**Size presets:**

| Preset | Physical size | Preview scale |
|---|---|---|
| Default | 50 × 25 mm | 200 × 100 px |
| Medium tall | 50 × 30 mm | 200 × 120 px |
| Large | 60 × 40 mm | 240 × 160 px |
| Custom | User input (mm) | 4 px/mm |

**Screen preview:** `react-barcode` renders an SVG barcode proportionally scaled to the preview area.

**Print mechanism:**
1. Builds a self-contained HTML document string with `@page` size set to the physical label dimensions.
2. Injects the document into a hidden `<iframe>` off-screen.
3. JsBarcode (loaded from CDN inside the iframe) initializes all barcodes on `window.onload`, then calls `window.print()` after 300ms.
4. After the print dialog closes (`onafterprint`), the iframe removes itself. Safety fallback removes it after 5 seconds.

**Queue navigator:** Prev/Next buttons, scrollable mini list, grid preview of all labels in queue. Print single label or all labels.

---

### Barcode Scanner Integration

The `useScanner` hook (`src/hooks/useScanner.js`) attaches a global `keydown` listener:

- **Gap detection:** if more than 100ms elapses between keystrokes, the buffer is reset. This distinguishes scanner rapid input from human typing.
- **Trigger:** `Enter` key with buffer length > 2 fires the scan callback.
- **Scan format:** `CODE-SIZE` (e.g. `BNT001-XL`) or plain `CODE`.

**Routing in App.jsx:**
- If active tab is `new-order` → passes scan to `NewOrderForm` to auto-fill product rows.
- Otherwise → searches all orders by `merchantOrderId`, `storeOrderId`, or `trackingId`; opens `OrderDetailsPopup` for the match.

Only one `useScanner` instance runs at a time (in App.jsx) to prevent duplicate events.

---

## Authentication & User Roles

Two sign-in methods:

| Method | Implementation |
|---|---|
| Google OAuth | `signInWithPopup` — email checked against `GOOGLE_ACCOUNTS` whitelist in `utils.js`; unauthorized emails trigger immediate `signOut` |
| Username/Password | `signInAnonymously` + `updateProfile(displayName)` — username/password checked against `CREDENTIAL_ACCOUNTS` in `utils.js` |

Session is persisted via `localStorage`:
- `bentree_role` — restored on page refresh via `onAuthStateChanged`
- `bentree_email` — restored on page refresh
- `bentree_tab` — last active tab, restored on next open
- `bentree_photo_{displayName}` — base64 profile photo (device-local, not in Firebase Storage)

### Role-based tab access

| Tab | master | employee | qmt |
|---|---|---|---|
| New Order | ✓ | ✓ | ✓ |
| Primary Orders | ✓ | ✓ | ✓ |
| Confirmed Orders | ✓ | ✓ | ✓ |
| Dispatch | ✓ | ✓ | ✓ |
| Hold | ✓ | ✓ | ✓ |
| Exchange | ✓ | ✓ | ✓ |
| Cancelled & Returned | ✓ | ✓ | ✓ |
| Sales & Inventory Report | ✓ | ✓ | ✓ |
| Inventory | ✓ | ✓ | — |
| Stock Location | ✓ | ✓ | — |
| Online Sales | ✓ | ✓ | — |
| Store Sales | ✓ | ✓ | — |
| Sales Reports | ✓ | — | — |
| Monthly Profit | ✓ | — | — |

Permanent delete of orders is always restricted to `master` regardless of the tab.

---

## Cloud Functions

All functions live in `functions/index.js`. Runtime: Node.js 24, firebase-functions v7.

### `woocommerceWebhook` (HTTP trigger)

Receives all WooCommerce webhook events. Processing pipeline:

1. **Ping detection** — form-urlencoded body with no topic → 200 OK.
2. **HMAC-SHA256 signature verification** — computes `base64(hmac-sha256(rawBody, WC_WEBHOOK_SECRET))` and compares with `x-wc-webhook-signature` header. Rejects with 401 on mismatch.
3. **Echo guards:**
   - `_oms_created === 'true'` on `order.created` → skip (OMS created this order, not a customer).
   - `_oms_partial_return === 'true'` → skip.
   - `date_created` within 60 seconds → skip (creation echo).
   - `_omsEditedAt` timestamp within 90 seconds → skip (bounce-back guard).
4. **Document lookup** — by `wc_order_id` field or `/orders/{wcId}` document ID.

**`order.created`:** Maps WooCommerce order to OMS schema via `mapWooOrder()`, deducts inventory, creates Firestore document (or skips if already exists with `stockDeducted: true`).

**`order.updated`:** Syncs WooCommerce status changes. If reactivating from cancelled, deducts fresh inventory. If updating products, runs `syncInventory(old, new)` to compute net delta. For OMS-originated orders (`_oms_created === 'true'`), only syncs a safe subset of fields (customer, products, pricing, notes).

**`order.deleted`:** Restores inventory, sets `status: 'Cancelled'`.

### `wooCreateOrder` (onCall)

Creates a new WooCommerce order from an OMS order object.

- Resolves WooCommerce product/variation IDs by SKU lookup for each product.
- Builds billing/shipping payload. Store orders: `status: completed, set_paid: true`. Online orders: `status: processing`.
- Adds metadata: `_oms_created: 'true'`, `_oms_order_type`.
- Returns `{ id, number }` — the `id` is saved as `wc_order_id` in Firestore.

### `wooSyncOrder` (onCall)

Syncs an edited OMS order back to WooCommerce.

- Stamps `_omsEditedAt` on the Firestore doc before pushing to prevent bounce-back.
- Resolves line_items, merges with existing WooCommerce items (reuses item IDs, zeros out removed items, appends new items).
- Updates billing/shipping address and special instructions.

### `wooUpdateOrder` (onCall)

Changes a WooCommerce order's status (e.g. `delivered` → `completed`, `cancelled`).

### `wooAdjustStock` (onCall)

Syncs product stock quantities to WooCommerce after OMS inventory edits.

- For variable products: finds the matching variation by size attribute.
- Sets `stock_quantity = max(0, current + delta × qty)`.

### WooCommerce order mapping (`mapWooOrder`)

| WooCommerce field | OMS field | Notes |
|---|---|---|
| `billing.phone` | `recipientPhone` | Strips leading `+88` |
| `shipping.city` | `recipientCity` | |
| `shipping.address_1` + `address_2` | `recipientAddress` | Joined with `, ` |
| `id` | `merchantOrderId` | Prefixed as `WC-{id}` |
| `line_items` | `products` | Size from `pa_size` / `attribute_pa_size` meta |
| `payment_method` | `paymentType` | cod→COD, stripe→Card, bacs→Bank Transfer |
| city === 'dhaka' | `deliveryZone` | Inside Dhaka / Outside Dhaka |

Country/Region codes (e.g. `BD-10`) and postal codes are intentionally excluded from address storage.

---

## URL Routing

The app uses the HTML5 History API — no React Router.

- `window.history.pushState` on tab change.
- `window.addEventListener('popstate')` for browser back/forward.
- `window.location.pathname` (strips leading `/`) on mount to restore tab from URL.
- Active tab also persisted in `localStorage['bentree_tab']`.

| URL path | Tab |
|---|---|
| `/new-order` | New Order Form |
| `/primary` | Primary Orders |
| `/confirmed` | Confirmed Orders |
| `/dispatch` | Dispatch Info |
| `/hold` | Hold Orders |
| `/exchange` | Exchange Orders |
| `/cancelled` | Cancelled & Returned |
| `/inventory` | Inventory |
| `/stock-location` | Stock Locations |
| `/online-sales` | Online Sales |
| `/store-sales` | Store Sales |
| `/reports` | Sales Reports |
| `/monthly-profit` | Monthly Profit |
| `/sales-inventory-report` | Sales & Inventory Report |
| `/barcodePrintView` | Barcode Print Studio |

The Sidebar renders each nav item as `<a href="/{tabId}">`. Normal click calls `setActiveTab` (SPA navigation); Ctrl+click / Cmd+click lets the browser open a new tab natively.

---

## Available Scripts

### Frontend (project root)

```bash
npm run dev        # Start Vite dev server (hot module replacement)
npm run build      # Production build → dist/
npm run preview    # Preview the production build locally
npm run lint       # ESLint check (0 warnings allowed)
```

### Cloud Functions (`functions/`)

```bash
npm run lint       # ESLint (Google style) — also runs as predeploy hook
npm run serve      # Start Firebase emulators for functions only
npm run shell      # Open Firebase Functions interactive shell
npm run deploy     # Deploy functions only
npm run logs       # Stream live function logs
```

---

## Build & Deployment

### Production build

```bash
npm run build
```

Vite produces the following chunks in `dist/`:

| Chunk | Contents |
|---|---|
| `vendor-react` | React + React DOM |
| `vendor-firebase` | Firebase SDK |
| `vendor-ui` | Lucide React |
| App chunk | All application code |

### Deploy to Firebase Hosting + Cloud Functions

```bash
# Deploy everything (hosting + functions)
firebase deploy

# Deploy hosting only
firebase deploy --only hosting

# Deploy Cloud Functions only (runs ESLint as predeploy)
firebase deploy --only functions
```

Firebase Hosting is configured with an SPA catch-all rewrite (`"source": "**" → "/index.html"`) so direct URL navigation and browser refresh work on any tab path.

### Deploy to Vercel

Add `vercel.json` at the project root:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Deploy to Netlify

Add `public/_redirects`:

```
/* /index.html 200
```

---

## Performance Optimizations

- **React.memo** — all 19+ components are wrapped, preventing unnecessary re-renders when unrelated state changes.
- **useCallback** — all write handlers in `App.jsx` (`handleUpdateStatus`, `handleEditOrderWithStock`, `handleCreateOrder`, `handleDeleteOrder`) are memoized with appropriate dependency arrays.
- **Scanner ref stability** — `useRef` holds the latest `orders` array so the scan callback never needs to be recreated, preventing `useScanner`'s keydown listener from detaching and reattaching on every Firestore update.
- **useMemo** — filtered/sorted order lists and computed stats in every tab are memoized on their minimal dependencies.
- **Lazy loading** — all tab components are loaded via `React.lazy` + `Suspense`. Only the active tab's JavaScript is evaluated.
- **Manual Vite chunks** — React, Firebase SDK, and Lucide React are split into separate vendor chunks for better long-term browser caching.
- **Promise.all** — inventory deduction/restoration in Cloud Functions runs all `applyStockChange` calls in parallel, not serially.
- **Firestore increment()** — all stock mutations are atomic increments; no read-modify-write round trips.
- **Debounced search** — `SearchBar` debounces input by 250ms, preventing per-keystroke filter recalculations.
- **Resource hints** — `<link rel="preconnect">` hints in `index.html` for Firestore, Firebase Auth, and Google Fonts domains.
- **Build target** — `es2020` enables modern browser optimizations (optional chaining, nullish coalescing, top-level await).

---

## Troubleshooting

**App shows blank screen after login**  
→ Check browser console for Firestore permission errors. Verify Firestore security rules allow authenticated reads/writes on the `artifacts/{appId}/public/data/` path.

**WooCommerce webhook returns 401**  
→ `WC_WEBHOOK_SECRET` in `functions/.env` must exactly match the Secret field in WooCommerce → Webhooks settings.

**Orders created in OMS don't appear in WooCommerce**  
→ Verify `WC_KEY`, `WC_SECRET`, and `WC_BASE` in `functions/.env`. Check Cloud Function logs with `firebase functions:log`. Ensure WooCommerce REST API is enabled (WooCommerce → Settings → Advanced → REST API).

**Functions deploy fails with ESLint errors**  
→ All Cloud Functions deploys run `npm run lint` as a predeploy hook. Fix all lint errors before deploying. Named async functions inside Cloud Functions must use `const fn = async () => {}` form (not `async function fn()`) to avoid the `require-jsdoc` rule.

**Stock goes negative**  
→ Both the frontend `updateInventoryStock` utility and the Cloud Function `applyStockChange` helper guard against negative stock using `FieldValue.increment()`. If a negative value appears, it likely predates these guards — manually correct the value in Firestore Console.

**Profile photo only shows on one device**  
→ Profile photos are stored in `localStorage` keyed by display name. They are device-local and are not synced to Firebase Storage.

**Barcode labels print at wrong size**  
→ Disable browser print scaling ("Scale: 100%" or "Fit to page: off") in the print dialog. The `@page` CSS rule sets the physical label size; browser scaling overrides it.

**Scanned barcode opens wrong order or nothing**  
→ Ensure the scanned barcode value matches one of `merchantOrderId`, `storeOrderId`, or `trackingId` exactly (string comparison). Check that the scanner sends an `Enter` keystroke at the end of each scan.

---

## Dependencies

### Frontend (`package.json`)

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.2.0 | UI framework |
| `react-dom` | ^18.2.0 | DOM rendering |
| `firebase` | ^11.0.0 | Firestore, Auth, Functions client SDK |
| `lucide-react` | ^0.292.0 | Icon library |
| `react-barcode` | ^1.6.1 | On-screen barcode SVG preview |

**Dev dependencies:** `vite` ^8.0.11, `@vitejs/plugin-react` ^4.2.0, `eslint` ^8.53.0, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@types/react`, `@types/react-dom`.

### Cloud Functions (`functions/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `firebase-admin` | ^13.6.0 | Firestore admin SDK |
| `firebase-functions` | ^7.0.0 | Cloud Functions runtime |
| `axios` | ^1.7.0 | WooCommerce REST API HTTP client |

**Dev dependencies:** `eslint` ^8.15.0, `eslint-config-google` ^0.14.0, `firebase-functions-test` ^3.4.1.

### Runtime CDN (not in package.json)

| Library | Version | Loaded in |
|---|---|---|
| Tailwind CSS | Play CDN | `index.html` `<script>` |
| JsBarcode | 3.11.6 | Barcode print iframe (per-print) |
| Inter font | — | `index.html` Google Fonts `<link>` |

---

## License

Private — Bentree internal use only.
