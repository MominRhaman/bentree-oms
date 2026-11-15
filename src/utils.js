import { doc, updateDoc, increment, collection, addDoc, serverTimestamp } from 'firebase/firestore';
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

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', product.id);

    try {
        if (product.type === 'Variable') {
            const sizeKey = size ? normalizeSize(size) : null;
            if (!sizeKey) return false;

            // Match by canonical form so "2XL" finds "XXL" keys and vice versa
            const actualKey = Object.keys(product.stock || {}).find(k => normalizeSize(k) === sizeKey) || sizeKey;

            // Guard: refuse deduction if it would push stock below 0
            if (qtyChange < 0) {
                const currentStock = Number(product.stock?.[actualKey] || 0);
                if (currentStock + qtyChange < 0) {
                    console.warn(`Stock guard: ${targetCode} (${actualKey}) has ${currentStock}, cannot deduct ${Math.abs(qtyChange)}`);
                    throw new Error(`Insufficient stock for ${targetCode} (${actualKey}): available ${currentStock}, requested ${Math.abs(qtyChange)}`);
                }
            }

            await updateDoc(docRef, {
                [`stock.${actualKey}`]: increment(qtyChange)
            });
        } else {
            // Guard: refuse deduction if it would push stock below 0
            if (qtyChange < 0) {
                const currentStock = Number(product.totalStock || 0);
                if (currentStock + qtyChange < 0) {
                    console.warn(`Stock guard: ${targetCode} has ${currentStock}, cannot deduct ${Math.abs(qtyChange)}`);
                    throw new Error(`Insufficient stock for ${targetCode}: available ${currentStock}, requested ${Math.abs(qtyChange)}`);
                }
            }

            await updateDoc(docRef, {
                totalStock: increment(qtyChange)
            });
        }
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