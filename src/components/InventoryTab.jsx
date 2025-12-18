import React, { useState, useMemo, useRef } from 'react';
import { Package, DollarSign, Plus, X, Edit, Trash2, Upload, Download } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { INVENTORY_CATEGORIES, SIZES, downloadCSV } from '../utils';
import SearchBar from './SearchBar';

const InventoryTab = ({ inventory, locations, orders, user, onEdit, onDelete }) => {
    // --- Form State ---
    const [form, setForm] = useState({
        id: '',
        date: new Date().toISOString().split('T')[0],
        code: '',
        type: 'Variable',
        category: 'Panjabi',
        stock: { M: '', L: '', XL: '', '2XL': '', '3XL': '' },
        totalStock: '',
        unitCost: '',
        mrp: '',
        locationId: '',
        shelfRow: ''
    });

    // --- UI States ---
    const [showAddForm, setShowAddForm] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // --- Filter States ---
    const [searchTerm, setSearchTerm] = useState('');
    const [catFilter, setCatFilter] = useState('');
    const [historyStart, setHistoryStart] = useState('');
    const [historyEnd, setHistoryEnd] = useState('');

    const fileInputRef = useRef(null);

    // --- 1. Dashboard Summary Calculation ---
    const categorySummary = useMemo(() => {
        const summary = {};
        INVENTORY_CATEGORIES.forEach(c => summary[c] = 0);

        inventory.forEach(item => {
            const qty = item.type === 'Variable'
                ? Object.values(item.stock || {}).reduce((a, b) => a + Number(b || 0), 0)
                : Number(item.totalStock || 0);

            if (summary[item.category] !== undefined) {
                summary[item.category] += qty;
            } else {
                summary[item.category] = (summary[item.category] || 0) + qty;
            }
        });
        return summary;
    }, [inventory]);

    // --- 2. Main Inventory Logic ---
    const inventoryStats = useMemo(() => {
        let filtered = inventory;

        // Filters
        if (searchTerm) filtered = filtered.filter(i => i.code.toLowerCase().includes(searchTerm.toLowerCase()));
        if (catFilter) filtered = filtered.filter(i => i.category === catFilter);

        // Date Range Logic
        if (historyStart && historyEnd) {
            const startDate = new Date(historyStart);
            const endDate = new Date(historyEnd);
            endDate.setHours(23, 59, 59);

            filtered = filtered.filter(i => {
                let checkDate;
                if (i.date) {
                    checkDate = new Date(i.date);
                } else if (i.createdAt) {
                    checkDate = i.createdAt.toDate ? i.createdAt.toDate() : new Date(i.createdAt);
                } else {
                    return true;
                }
                return checkDate >= startDate && checkDate <= endDate;
            });
        }

        // Map and Calculate Sales Data
        return filtered.map(item => {
            const qty = item.type === 'Variable'
                ? Object.values(item.stock || {}).reduce((a, b) => a + Number(b || 0), 0)
                : Number(item.totalStock || 0);

            const totalCost = qty * Number(item.unitCost || 0);
            const totalMrpValue = qty * Number(item.mrp || 0);

            let soldQty = 0;
            let revenue = 0;

            // Cross-reference with Orders to calculate sales performance
            orders.forEach(o => {
                if (o.status !== 'Cancelled' && o.status !== 'Returned') {
                    (o.products || []).forEach(p => {
                        if (p.code && p.code.toUpperCase() === item.code.toUpperCase()) {
                            soldQty += Number(p.qty || 0);
                            revenue += Number(p.price || 0) * Number(p.qty || 0);
                        }
                    });
                }
            });

            const cogs = soldQty * Number(item.unitCost || 0);
            const deviation = revenue - cogs;

            const stockBreakdown = item.type === 'Variable'
                ? Object.entries(item.stock || {}).map(([k, v]) => `${k}:${v}`).join(' | ')
                : item.totalStock;

            return {
                ...item,
                qty,
                totalCost,
                totalMrpValue,
                revenue,
                deviation,
                soldQty,
                stockBreakdown
            };
        });
    }, [inventory, orders, searchTerm, catFilter, historyStart, historyEnd]);

    // --- 3. Grand Totals ---
    const grandTotals = useMemo(() => {
        return inventoryStats.reduce((acc, item) => {
            acc.totalQty += item.qty;
            acc.totalValue += item.totalCost;
            return acc;
        }, { totalQty: 0, totalValue: 0 });
    }, [inventoryStats]);

    // --- Handlers ---
    const handleEditClick = (item) => {
        setIsEditing(true);
        setShowAddForm(true);
        setForm({
            id: item.id,
            date: item.date || new Date().toISOString().split('T')[0],
            code: item.code,
            type: item.type,
            category: item.category,
            stock: item.stock || { M: '', L: '', XL: '', '2XL': '', '3XL': '' },
            totalStock: item.totalStock || '',
            unitCost: item.unitCost,
            mrp: item.mrp,
            locationId: item.locationId,
            shelfRow: item.shelfRow || ''
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetFormView = () => {
        setIsEditing(false);
        setShowAddForm(false);
        setForm({
            id: '',
            date: new Date().toISOString().split('T')[0],
            code: '', type: 'Variable', category: 'Panjabi',
            stock: { M: '', L: '', XL: '', '2XL': '', '3XL': '' },
            totalStock: '', unitCost: '', mrp: '', locationId: '', shelfRow: ''
        });
    };

    const handleAddOrUpdate = async (e) => {
        e.preventDefault();
        if (!form.locationId) return alert("Select a location");

        const normalizedCode = form.code.trim().toUpperCase();

        if (!isEditing && inventory.some(i => i.code.toUpperCase() === normalizedCode)) {
            return alert("Product code already exists");
        }

        const variableStock = {};
        if (form.type === 'Variable') {
            Object.keys(form.stock).forEach(key => {
                variableStock[key] = Number(form.stock[key] || 0);
            });
        }

        const payload = {
            date: form.date,
            code: normalizedCode,
            type: form.type,
            category: form.category,
            locationId: form.locationId,
            shelfRow: form.shelfRow,
            stock: form.type === 'Variable' ? variableStock : {},
            totalStock: form.type === 'Single' ? Number(form.totalStock || 0) : 0,
            unitCost: Number(form.unitCost || 0),
            mrp: Number(form.mrp || 0),
            lastEditedBy: user?.displayName || 'Unknown'
        };

        if (isEditing) {
            await onEdit(form.id, payload);
        } else {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), {
                ...payload,
                addedBy: user?.displayName || 'Unknown',
                createdAt: serverTimestamp()
            });
        }
        resetFormView();
    };

    const handleExport = () => {
        const data = inventoryStats.map(i => ({
            Date: i.date || (i.createdAt && i.createdAt.toDate ? i.createdAt.toDate().toLocaleDateString() : 'N/A'),
            Code: i.code,
            Category: i.category,
            Type: i.type,
            'Total Stock': i.qty,
            'Stock Breakdown': i.stockBreakdown,
            Cost: i.unitCost,
            MRP: i.mrp,
            'Total Cost': i.totalCost,
            'Total Value': i.totalMrpValue,
            'Sold Qty': i.soldQty,
            Revenue: i.revenue,
            Profit: i.deviation,
            'Added By': i.addedBy,
            'Last Edited': i.lastEditedBy,
        }));
        const fileName = historyStart ? `inventory_${historyStart}_to_${historyEnd}.csv` : 'inventory_full_report.csv';
        downloadCSV(data, fileName);
    };

    const handleImportCSV = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
            if (rows.length < 2) return alert("Invalid CSV: Not enough data.");

            const headers = rows[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]+/g, ''));
            
            const getIdx = (key) => headers.findIndex(h => h.includes(key));
            const idxCode = getIdx('code');
            const idxCat = getIdx('category');
            const idxCost = getIdx('cost');
            const idxMrp = getIdx('mrp');
            const idxStock = getIdx('total stock');

            if (idxCode === -1) return alert("CSV Error: Column 'Code' is required.");

            let addedCount = 0;
            let skippedCount = 0;

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
                if (!row) continue;

                const clean = (val) => val ? val.replace(/,|"/g, '').trim() : '';

                const code = clean(row[idxCode]);
                if (!code) continue;

                const exists = inventory.some(item => item.code.toUpperCase() === code.toUpperCase());
                if (exists) {
                    skippedCount++;
                    continue;
                }

                const newItem = {
                    code: code.toUpperCase(),
                    category: idxCat > -1 ? clean(row[idxCat]) : 'Uncategorized',
                    type: 'Single',
                    totalStock: idxStock > -1 ? Number(clean(row[idxStock])) || 0 : 0,
                    stock: {},
                    unitCost: idxCost > -1 ? Number(clean(row[idxCost])) || 0 : 0,
                    mrp: idxMrp > -1 ? Number(clean(row[idxMrp])) || 0 : 0,
                    date: new Date().toISOString().split('T')[0],
                    locationId: '',
                    shelfRow: '',
                    addedBy: user?.displayName || 'Import',
                    createdAt: serverTimestamp()
                };

                try {
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), newItem);
                    addedCount++;
                } catch (err) {
                    console.error("Row import failed:", err);
                }
            }
            alert(`Import Complete!\nAdded: ${addedCount}\nSkipped (Duplicates): ${skippedCount}`);
            e.target.value = '';
        };
        reader.readAsText(file);
    };

    const selectedLoc = locations.find(l => l.id === form.locationId);
    const showRows = selectedLoc && (selectedLoc.type === 'Shelf' || selectedLoc.type === 'Display Shelf');

    return (
        <div className="space-y-6">

            {/* Toggle View: Dashboard vs Input Form */}
            {(!showAddForm && !isEditing) ? (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Inventory Dashboard</h2>
                            <p className="text-xs text-slate-500">Live stock summary by category</p>
                        </div>
                        <button
                            onClick={() => setShowAddForm(true)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center gap-2 shadow-sm"
                        >
                            <Plus size={18} /> Add New Product
                        </button>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex justify-between items-center">
                            <div>
                                <h3 className="text-slate-500 font-bold text-xs uppercase">Total Inventory Items</h3>
                                <p className="text-2xl font-bold text-blue-700">{grandTotals.totalQty.toLocaleString()}</p>
                            </div>
                            <Package size={32} className="text-blue-200" />
                        </div>
                        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 flex justify-between items-center">
                            <div>
                                <h3 className="text-slate-500 font-bold text-xs uppercase">Total Asset Value</h3>
                                <p className="text-2xl font-bold text-emerald-700">৳{grandTotals.totalValue.toLocaleString()}</p>
                            </div>
                            <DollarSign size={32} className="text-emerald-200" />
                        </div>
                    </div>

                    {/* Category Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {Object.entries(categorySummary).map(([cat, count]) => (
                            <div key={cat} className="p-4 border border-slate-100 rounded-xl bg-gradient-to-br from-white to-slate-50 shadow-sm hover:shadow-md transition-all">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{cat}</h3>
                                <div className="flex items-end justify-between">
                                    <p className="text-3xl font-bold text-slate-700">{count}</p>
                                    <Package size={20} className="text-slate-300 mb-1" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-slate-800">{isEditing ? 'Edit Inventory Item' : 'Add Inventory'}</h2>
                        <button onClick={resetFormView} className="text-sm text-red-500 hover:bg-red-50 px-3 py-1 rounded transition-colors flex items-center gap-1">
                            <X size={16} /> Cancel
                        </button>
                    </div>
                    <form onSubmit={handleAddOrUpdate} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500">Date</label>
                                <input type="date" className="w-full p-2 border rounded" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Code</label>
                                <input className="w-full p-2 border rounded" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required disabled={isEditing} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Type</label>
                                <select className="w-full p-2 border rounded" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                                    <option>Variable</option><option>Single</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Category</label>
                                <select className="w-full p-2 border rounded" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                                    {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Location</label>
                                <select className="w-full p-2 border rounded" value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })} required>
                                    <option value="">Select Location</option>
                                    {locations.map(l => <option key={l.id} value={l.id}>{l.numbering} ({l.type})</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            {showRows && (
                                <div className="w-full sm:w-1/4">
                                    <label className="text-xs font-bold text-slate-500">Shelf Row</label>
                                    <select className="w-full p-2 border rounded" value={form.shelfRow} onChange={e => setForm({ ...form, shelfRow: e.target.value })}>
                                        <option value="">Select Row</option>
                                        {Array.from({ length: Number(selectedLoc.rows) }, (_, i) => i + 1).map(n => <option key={n}>Row {n}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="w-full sm:w-1/4">
                                <label className="text-xs font-bold text-slate-500">Unit Cost</label>
                                <input type="number" className="w-full p-2 border rounded" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} required />
                            </div>
                            <div className="w-full sm:w-1/4">
                                <label className="text-xs font-bold text-slate-500">MRP</label>
                                <input type="number" className="w-full p-2 border rounded" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} required />
                            </div>
                        </div>

                        <div className="bg-slate-50 p-3 rounded">
                            <label className="text-xs font-bold text-slate-500 mb-2 block">Stock Quantity</label>
                            {form.type === 'Variable' ? (
                                <div className="flex flex-wrap gap-4">
                                    {SIZES.map(sz => (
                                        <div key={sz} className="flex items-center gap-1">
                                            <span className="text-sm w-8 font-medium">{sz}</span>
                                            <input
                                                type="number" min="0"
                                                className="w-20 p-2 border rounded bg-white"
                                                value={form.stock[sz] !== undefined ? form.stock[sz] : ''}
                                                onChange={e => setForm({ ...form, stock: { ...form.stock, [sz]: e.target.value } })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <input
                                    type="number" min="0" placeholder="Total Stock"
                                    className="w-full sm:w-40 p-2 border rounded bg-white"
                                    value={form.totalStock}
                                    onChange={e => setForm({ ...form, totalStock: e.target.value })}
                                />
                            )}
                        </div>

                        <button className={`w-full py-3 rounded-lg font-bold text-white shadow-md transition-all ${isEditing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                            {isEditing ? 'Update Inventory Item' : 'Add to Inventory'}
                        </button>
                    </form>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Header for Table */}
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="w-full md:w-auto">
                            <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
                        </div>
                        <select className="p-2 border rounded text-sm bg-white w-full md:w-auto" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                            <option value="">All Categories</option>
                            {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                    </div>

                    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <div className="flex items-center bg-white border rounded px-2 py-1 gap-2 w-full md:w-auto justify-between md:justify-start">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">History:</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent" value={historyStart} onChange={e => setHistoryStart(e.target.value)} />
                            <span className="text-slate-300">-</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent" value={historyEnd} onChange={e => setHistoryEnd(e.target.value)} />
                        </div>
                        
                        <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleImportCSV} />
                        
                        <div className="flex gap-2">
                            <button onClick={() => fileInputRef.current.click()} className="flex items-center justify-center gap-1 text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-1/2 md:w-auto">
                                <Upload size={16} /> Import
                            </button>
                            <button onClick={handleExport} className="flex items-center justify-center gap-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-1/2 md:w-auto">
                                <Download size={16} /> Download
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table with Sticky Header */}
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[900px]">
                        <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3">Code</th>
                                <th className="p-3">Category</th>
                                <th className="p-3">Location</th>
                                <th className="p-3 text-center">Stock</th>
                                <th className="p-3 text-right">Unit Cost</th>
                                <th className="p-3 text-right">Total Value</th>
                                <th className="p-3 text-right">Profit/Loss</th>
                                <th className="p-3 text-left">Added By</th>
                                <th className="p-3 text-left">Last Edited</th>
                                <th className="p-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {inventoryStats.map(item => {
                                const loc = locations.find(l => l.id === item.locationId);
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3 font-medium text-slate-800">{item.code}</td>
                                        <td className="p-3 text-xs text-slate-500">{item.category}</td>
                                        <td className="p-3 text-xs text-slate-600">
                                            {loc?.numbering} {item.shelfRow ? `- ${item.shelfRow}` : ''}
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`font-bold ${item.qty < 5 ? 'text-red-600' : 'text-slate-700'}`}>
                                                {item.qty}
                                            </span>
                                            {item.type === 'Variable' && (
                                                <div className="text-[10px] text-slate-400 mt-1">
                                                    {Object.entries(item.stock).map(([k, v]) => v > 0 ? `${k}:${v} ` : '').join('')}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-right text-slate-600">৳{item.unitCost}</td>
                                        <td className="p-3 text-right text-slate-600">৳{item.totalMrpValue}</td>
                                        <td className="p-3 text-right">
                                            <div className="font-bold text-emerald-600">৳{item.deviation}</div>
                                            <div className="text-[10px] text-slate-400">Rev: {item.revenue}</div>
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 truncate max-w-[100px]" title={item.addedBy}>
                                            {item.addedBy || '-'}
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 truncate max-w-[100px]" title={item.lastEditedBy}>
                                            {item.lastEditedBy || '-'}
                                        </td>
                                        <td className="p-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleEditClick(item)}
                                                    className="text-blue-500 hover:bg-blue-50 p-1.5 rounded transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                <button
                                                    onClick={() => { if (confirm('Delete this item?')) onDelete(item.id); }}
                                                    className="text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {inventoryStats.length === 0 && (
                                <tr>
                                    <td colSpan="10" className="p-8 text-center text-slate-400">
                                        {historyStart ? 'No inventory records found for this date range.' : 'No inventory items found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default InventoryTab;