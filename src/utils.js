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
    'bentreeteam1': { pass: 'bentree12345', role: 'employee', name: 'Internal Member 01' },
    'bentreeteam2': { pass: 'bentree12345', role: 'employee', name: 'Internal Member 02' },
    'bentreeteam3': { pass: 'bentree12345', role: 'employee', name: 'Internal Member 03' },
    'team1': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 01' },
    'team2': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 02' },
    'team3': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 03' },
    'team4': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 04' },
    'team5': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 05' },
    'team6': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 06' },
    'team7': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 07' },
    'team8': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 08' },
    'team9': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 09' },
    'team10': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 10' },
    'team11': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 11' },
    'team12': { pass: 'bentree12345', role: 'qmt', name: 'Team Member 12' },
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
    'codCharge', 'food', 'transport', 'accessories', 'others', 'others', 'others'
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
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).map(val => `"${val}"`).join(','));
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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