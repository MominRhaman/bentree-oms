import { doc, increment, collection, addDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db, appId } from './firebase';

// --- User Access Configuration ---
export const GOOGLE_ACCOUNTS = {
    'iftekher.ifty@gmail.com': 'master',
    'adeebkhan51@gmail.com': 'master',
    'shahmd.nadim@gmail.com': 'master',
    'mominrhaman007@gmail.com': 'master',
    'mominbackstory@gmail.com': 'employee',
    'iqramulhaque2404@gmail.com': 'employee',
};

// Username/password accounts (with their roles) now live only on the server in
// functions/accounts.js. They are verified by the credentialLogin Cloud
// Function, so passwords and roles can't be read or changed from the browser.

// --- Employee date window ---
// Employee accounts may only see the current calendar month plus the two before
// it (a rolling calendar-month window, not 90 days), e.g. in November 2026:
// 2026-09-01 → today. Computed in Bangladesh time (UTC+6, no DST) so it matches
// employeeWindowStart() in firestore.rules regardless of the browser's timezone.
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
const toYmd = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export const getEmployeeDateWindow = (now = new Date()) => {
    const bd = new Date(now.getTime() + BD_OFFSET_MS);
    const y = bd.getUTCFullYear();
    const m = bd.getUTCMonth();
    return {
        minDate: toYmd(y, m - 2, 1),        // earliest selectable date (YYYY-MM-DD)
        maxDate: toYmd(y, m, bd.getUTCDate()), // today (YYYY-MM-DD)
        monthStart: toYmd(y, m, 1),         // first day of the current month
        // minDate 00:00 Bangladesh time as an absolute instant (Firestore query bound)
        startInstant: new Date(Date.UTC(y, m - 2, 1) - BD_OFFSET_MS),
    };
};

// Keeps a YYYY-MM-DD value inside the window (empty stays empty)
export const clampToDateWindow = (value, dateWindow) => {
    if (!value) return value;
    if (value < dateWindow.minDate) return dateWindow.minDate;
    if (value > dateWindow.maxDate) return dateWindow.maxDate;
    return value;
};

// --- Constants ---
export const INVENTORY_CATEGORIES = [
    'Panjabi', 'Casual Shirt', 'Formal Shirt', 'Cuban Collar Shirt',
    'Half Sleeve Shirt', 'Tie', 'Trouser', 'Joggers', 'Denim Pant',
    'Accessories', 'Thobe', 'T-shirt', 'Katua', 'Others'
];

export const LOCATION_TYPES = ['Shelf', 'Bag', 'Carton', 'Display Shelf'];
export const SIZES = ['XS','S', 'M', 'L', 'XL', '2XL', '3XL'];

// Canonical size map: normalize legacy/alternate keys to OMS standard
export const SIZE_ALIASES = { 'XXL': '2XL', 'XXXL': '3XL' };
export const normalizeSize = (s) => {
    const upper = (s || '').trim().toUpperCase();
    return SIZE_ALIASES[upper] || upper;
};

export const EXPENSE_FIELDS = [
    'media', 'salary', 'rent', 'utility', 'vat',
    'codCharge', 'food', 'transport', 'accessories', 'paymentGatewayFees', 'maintenanceRepairs', 'others'
];

// --- Utility Functions ---
export const getStatusColor = (status) => {
    switch (status) {
        case 'Dispatched': return 'text-blue-600 bg-blue-50';
        case 'Delivered': return 'text-green-600 bg-green-50';
        case 'Returned': return 'text-red-600 bg-red-50';
        case 'Exchanged': return 'text-yellow-600 bg-yellow-50';
        case 'Hold': return 'text-purple-600 bg-purple-50';
        case 'Cancelled': return 'text-red-600 bg-red-50';
        case 'Pending': return 'text-slate-600 bg-slate-50';
        default: return 'text-slate-600 bg-slate-50';
    }
};

export const downloadCSV = (data, filename) => {
    if (!data || !data.length) return;

    // 1. Generate Headers and Rows
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj =>
        Object.values(obj).map(val => {
            let str = val === null || val === undefined ? '' : String(val);
            // Protects structure by escaping internal quotes
            return `"${str.replace(/"/g, '""')}"`;
        }).join(',')
    ).join('\n');

    const csvContent = headers + '\n' + rows;

    // 2. THE CRITICAL CHANGE:
    // Adding '\uFEFF' (BOM) tells Excel: "This is Bangla/UTF-8 text"
    // Using 'Blob' instead of 'encodeURI' allows symbols like #, $, &, % to export without failing
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // 3. Trigger Download
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();

    // 4. Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const disableScroll = (e) => e.target.blur();

// --- ATOMIC STOCK LOGIC ---
// Applies signed stock changes [{code, size, qty}] (qty < 0 deducts, qty > 0
// restores) in ONE Firestore transaction. Each inventory doc is read fresh
// inside the transaction (React state can be stale, and other users can
// change stock at the same time), so:
//   - no item can end below 0: the whole change is refused with an
//     "Insufficient stock" error and nothing is written;
//   - several products change all together or not at all;
//   - opts.orderRef + opts.expectOrder(order) re-check the order inside the
//     same transaction (return true to go on, or an error message), so a
//     double click / a second user can't apply the same change twice;
//   - opts.write(tx, results) adds the order write to the same transaction.
// Returns [{code, size, type, before, after}] for every item that changed:
// the exact OMS quantities, used to set the same quantity on the website.
export const applyInventoryChanges = async (changes, inventoryList, opts = {}) => {
    const list = [];
    for (const c of (changes || [])) {
        const qty = Number(c.qty || 0);
        if (!c.code || qty === 0) continue;
        const targetCode = c.code.trim().toUpperCase();
        const product = (inventoryList || []).find(p => p.code && p.code.toUpperCase() === targetCode);
        if (!product) {
            console.warn(`Stock Sync: Product ${c.code} not found in current inventory state.`);
            continue;
        }
        if (product.type === 'Variable' && !(c.size ? normalizeSize(c.size) : null)) continue;
        list.push({ ...c, qty, targetCode, product });
    }

    return runTransaction(db, async (tx) => {
        // All reads first.
        if (opts.orderRef && opts.expectOrder) {
            const os = await tx.get(opts.orderRef);
            const ok = opts.expectOrder(os.exists() ? os.data() : null);
            if (ok !== true) {
                throw new Error(typeof ok === 'string' ? ok : 'This order was changed meanwhile. Reload and try again.');
            }
        }
        const ids = [...new Set(list.map(c => c.product.id))];
        const snaps = await Promise.all(ids.map(id =>
            tx.get(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id))));
        const fresh = {};
        ids.forEach((id, i) => { fresh[id] = snaps[i].exists() ? snaps[i].data() : null; });

        const slots = new Map();
        for (const c of list) {
            const item = fresh[c.product.id];
            if (!item) throw new Error(`Product ${c.targetCode} no longer exists in inventory`);
            let field; let sizeKey = ''; let before;
            if (item.type === 'Variable') {
                const want = normalizeSize(c.size);
                // Match by canonical form so "2XL" finds "XXL" keys and vice versa
                sizeKey = Object.keys(item.stock || {}).find(k => normalizeSize(k) === want) || want;
                field = `stock.${sizeKey}`;
                before = Number(item.stock?.[sizeKey] || 0);
            } else {
                field = 'totalStock';
                before = Number(item.totalStock || 0);
            }
            const k = `${c.product.id}|${field}`;
            if (!slots.has(k)) slots.set(k, { id: c.product.id, field, code: c.targetCode, size: sizeKey, type: item.type, start: before, cur: before });
            slots.get(k).cur += c.qty;
        }

        // Guard: refuse any change that would push stock below 0
        for (const s of slots.values()) {
            if (s.cur < 0 && s.cur < s.start) {
                console.warn(`Stock guard: ${s.code}${s.size ? ` (${s.size})` : ''} has ${s.start}, cannot deduct ${s.start - s.cur}`);
                throw new Error(`Insufficient stock for ${s.code}${s.size ? ` (${s.size})` : ''}: available ${s.start}, requested ${s.start - s.cur}`);
            }
        }

        for (const s of slots.values()) {
            if (s.cur !== s.start) {
                tx.update(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', s.id), {
                    [s.field]: increment(s.cur - s.start)
                });
            }
        }
        const results = [...slots.values()]
            .filter(s => s.cur !== s.start)
            .map(s => ({ code: s.code, size: s.size, type: s.type, before: s.start, after: s.cur }));
        if (opts.write) opts.write(tx, results);
        return results;
    });
};

// What an order currently holds (has deducted) from inventory. deductedProducts
// follows every stock change of the order (edits, website refund restocks, ...);
// an explicit stockDeducted false holds nothing (e.g. a website order whose stock
// could not be deducted); orders saved before the flag existed hold their products.
export const heldByOrder = (order) => {
    if (!order) return [];
    if (order.stockDeducted === true) {
        return Array.isArray(order.deductedProducts) ? order.deductedProducts : (order.products || []);
    }
    if (order.stockDeducted === false) return [];
    return order.products || [];
};

export const updateInventoryStock = async (productCode, size, qtyChange, inventoryList) => {
    if (!productCode || qtyChange === 0) return false;

    // Normalize code
    const targetCode = productCode.trim().toUpperCase();

    // Find Product
    const product = (inventoryList || []).find(p => p.code && p.code.toUpperCase() === targetCode);

    if (!product) {
        console.warn(`Stock Sync: Product ${productCode} not found in current inventory state.`);
        return false;
    }
    if (product.type === 'Variable' && !(size ? normalizeSize(size) : null)) return false;

    try {
        // Same transaction as applyInventoryChanges: fresh read, never below 0
        await applyInventoryChanges([{ code: productCode, size, qty: qtyChange }], inventoryList);
        return true;
    } catch (err) {
        console.error("CRITICAL: updateInventoryStock failed:", err);
        // We throw the error so the calling function (App.jsx) knows to stop the DB swap
        throw err;
    }
};

// Returns an array of current-stock values (one per product entry) snapshotted
// BEFORE any inventory operation runs. Tracks a running balance per CODE|SIZE
// so multiple rows with the same product chain sequentially.
export const computeStockBefores = (products, inventoryList) => {
    const running = new Map();
    return (products || []).map(p => {
        const code = (p.code || '').toUpperCase();
        const sizeNorm = normalizeSize(p.size || '');
        const key = `${code}|${sizeNorm}`;
        if (!running.has(key)) {
            const item = (inventoryList || []).find(i => (i.code || '').toUpperCase() === code);
            let stock = null;
            if (item) {
                if (item.type === 'Variable') {
                    const actualKey = Object.keys(item.stock || {})
                        .find(k => normalizeSize(k) === sizeNorm);
                    stock = actualKey !== undefined ? Number(item.stock[actualKey] || 0) : null;
                } else {
                    stock = Number(item.totalStock || 0);
                }
            }
            running.set(key, stock);
        }
        const sb = running.get(key);
        const qty = Number(p.qty || 0);
        if (typeof sb === 'number') running.set(key, sb - qty);
        return sb;
    });
};

// Writes one Firestore entry per call (qtyChange = ±1 per unit) with source:'order'
// so buildAllMovements can deduplicate against the order-derived fallback.
export const logInventoryMovement = ({
    productCode, productName, size,
    qtyChange, stockBefore, actionType, reference, user,
}) => {
    try {
        const adjustedBy = typeof user === 'string'
            ? user
            : user?.displayName
                || (typeof localStorage !== 'undefined' ? localStorage.getItem('bentree_name') : null)
                || user?.email?.split('@')[0]
                || 'Unknown';
        const stockAfter = typeof stockBefore === 'number' ? stockBefore + qtyChange : null;
        const adjCol = collection(db, 'artifacts', appId, 'public', 'data', 'inventoryAdjustments');
        addDoc(adjCol, {
            productCode: (productCode || '').toUpperCase(),
            productName: productName || '',
            size: size || 'Free',
            previousQty: stockBefore ?? null,
            newQty: stockAfter,
            change: qtyChange,
            adjustmentType: qtyChange > 0 ? 'Add' : 'Minus',
            actionType,
            adjustedBy,
            reference: reference || '—',
            date: new Date().toISOString().split('T')[0],
            timestamp: serverTimestamp(),
            source: 'order',
        }).catch(e => console.error('[logInventoryMovement] failed:', e));
    } catch (e) {
        console.error('[logInventoryMovement] failed:', e);
    }
};