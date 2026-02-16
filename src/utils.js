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
    'user1': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 01' },
    'user2': { pass: 'bentree21345', role: 'qmt', name: 'Team Member 02' },
    'user3': { pass: 'bentree13245', role: 'qmt', name: 'Team Member 03' },
    'user4': { pass: 'bentree12354', role: 'qmt', name: 'Team Member 04' },
    'user5': { pass: 'bentree12543', role: 'qmt', name: 'Team Member 05' },
    'user6': { pass: 'bentree32145', role: 'qmt', name: 'Team Member 06' },
    'user7': { pass: 'bentree32154', role: 'qmt', name: 'Team Member 07' },
    'user8': { pass: 'bentree14325', role: 'qmt', name: 'Team Member 08' },
    'user9': { pass: 'bentree15432', role: 'qmt', name: 'Team Member 09' },
    'user10': { pass: 'bentree15243', role: 'qmt', name: 'Team Member 10' },
    'user11': { pass: 'bentree51234', role: 'qmt', name: 'Team Member 11' },
    'user12': { pass: 'bentree12553', role: 'qmt', name: 'Team Member 12' },
};

// --- Constants ---
export const INVENTORY_CATEGORIES = [
    'Panjabi', 'Casual Shirt', 'Formal Shirt', 'Cuban Collar Shirt',
    'Half Sleeve Shirt', 'Tie', 'Trouser', 'Joggers', 'Denim Pant',
    'Accessories', 'Thobe', 'T-shirt', 'Katua', 'Others'
];

export const LOCATION_TYPES = ['Shelf', 'Bag', 'Carton', 'Display Shelf'];
export const SIZES = ['M', 'L', 'XL', '2XL', '3XL'];

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
            const sizeKey = size ? size.trim().toUpperCase() : null;
            if (!sizeKey) return false;

            // Ensure we use the exact case-sensitive key stored in Firestore to prevent field duplication
            const actualKey = Object.keys(product.stock || {}).find(k => k.toUpperCase() === sizeKey) || sizeKey;

            await updateDoc(docRef, {
                [`stock.${actualKey}`]: increment(qtyChange)
            });
        } else {
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