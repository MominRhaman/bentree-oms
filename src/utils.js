import { doc, updateDoc, increment } from 'firebase/firestore';
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

export const CREDENTIAL_ACCOUNTS = {
    'bentree': { pass: 'bentree12321', role: 'master', name: 'Bentree Master' },
    'bentreeteam1': { pass: 'bentree321', role: 'employee', name: 'Internal Member 01' },
    'bentreeteam2': { pass: 'bentree112', role: 'employee', name: 'Internal Member 02' },
    'bentreeteam3': { pass: 'bentree123', role: 'employee', name: 'Internal Member 03' },
    'user1': { pass: 'bnt', role: 'qmt', name: 'Team Member 01' },
    'user2': { pass: 'bentree21345', role: 'qmt', name: 'Team Member 02' },
    'user3': { pass: 'bnt', role: 'qmt', name: 'Team Member 03' },
    'user4': { pass: 'bentree12354', role: 'qmt', name: 'Team Member 04' },
    'user5': { pass: 'bnt', role: 'qmt', name: 'Team Member 05' },
    'user6': { pass: 'bnt', role: 'qmt', name: 'Team Member 06' },
    'user7': { pass: 'bnt', role: 'qmt', name: 'Team Member 07' },
    'user8': { pass: 'bnt', role: 'qmt', name: 'Team Member 08' },
    'user9': { pass: 'bnt', role: 'qmt', name: 'Team Member 09' },
    'user10': { pass: 'bnt', role: 'qmt', name: 'Team Member 10' },
    'user11': { pass: 'bnt', role: 'qmt', name: 'Team Member 11' },
    'user12': { pass: 'bnt', role: 'qmt', name: 'Team Member 12' },
    'user13': { pass: 'bnt', role: 'qmt', name: 'Team Member 13' },
    'user14': { pass: 'bnt', role: 'qmt', name: 'Team Member 14' },
    'user15': { pass: 'bnt', role: 'qmt', name: 'Team Member 15' },
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