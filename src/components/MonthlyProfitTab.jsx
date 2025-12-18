import React, { useState, useEffect, useMemo } from 'react';
import { updateDoc, doc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { EXPENSE_FIELDS, disableScroll } from '../utils';

const MonthlyProfitTab = ({ orders, inventory, expenses }) => {
    // --- State ---
    const [month, setMonth] = useState(new Date().getMonth());
    const [year, setYear] = useState(new Date().getFullYear());
    
    // Default empty expenses
    const [newExpense, setNewExpense] = useState({
        media: '', salary: '', rent: '', utility: '', vat: '',
        returnCharge: '', food: '', transport: '', accessories: '', others: ''
    });

    // --- Load Data ---
    useEffect(() => {
        const existing = expenses.find(e => e.month === Number(month) && e.year === Number(year));
        if (existing) {
            setNewExpense(existing);
        } else {
            // Reset if no data found for selected month
            setNewExpense({
                media: '', salary: '', rent: '', utility: '', vat: '',
                returnCharge: '', food: '', transport: '', accessories: '', others: ''
            });
        }
    }, [month, year, expenses]);

    // --- Actions ---
    const saveExpense = async () => {
        const id = `${year}-${month}`;
        const dataToSave = {};
        
        // Convert strings to numbers
        EXPENSE_FIELDS.forEach(k => {
            dataToSave[k] = Number(newExpense[k] || 0);
        });

        try {
            // Try updating existing doc based on ID pattern
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', id), {
                ...dataToSave,
                month: Number(month),
                year: Number(year)
            });
        } catch (e) {
            // If ID pattern doesn't exist, search by query (legacy support) or create new
            const q = query(
                collection(db, 'artifacts', appId, 'public', 'data', 'expenses'),
                where('month', '==', Number(month)),
                where('year', '==', Number(year))
            );
            const snap = await getDocs(q);

            if (!snap.empty) {
                await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', snap.docs[0].id), dataToSave);
            } else {
                await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), {
                    ...dataToSave,
                    month: Number(month),
                    year: Number(year)
                });
            }
        }
        alert("Expenses Saved");
    };

    // --- Calculations ---
    const financials = useMemo(() => {
        // 1. Filter Orders for Month/Year
        const monthlyOrders = orders.filter(o => {
            const d = new Date(o.date);
            return d.getMonth() === Number(month) &&
                   d.getFullYear() === Number(year) &&
                   o.status !== 'Cancelled' &&
                   o.status !== 'Returned';
        });

        // 2. Calculate Revenue
        const revenue = monthlyOrders.reduce((acc, o) => acc + (Number(o.grandTotal) || 0), 0);

        // 3. Calculate COGS (Cost of Goods Sold)
        let cogs = 0;
        monthlyOrders.forEach(o => {
            (o.products || []).forEach(p => {
                if (p.code) {
                    const invItem = inventory.find(i => i.code.toUpperCase() === p.code.toUpperCase());
                    if (invItem) {
                        cogs += ((Number(invItem.unitCost) || 0) * (Number(p.qty) || 0));
                    }
                }
            });
        });

        // 4. Calculate Operating Expenses
        const totalExp = EXPENSE_FIELDS.reduce((acc, key) => {
            const val = newExpense[key];
            return acc + (Number(val) || 0);
        }, 0);

        return {
            revenue,
            cogs,
            totalExp,
            netProfit: revenue - cogs - totalExp
        };
    }, [orders, inventory, newExpense, month, year]);

    return (
        <div className="space-y-6">
            
            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
               <div>
                <h2 className="text-xl font-bold text-slate-800">Monthly Profit & Loss</h2>
                <p className="text-xs text-slate-500">Live reports summary by date</p>
                </div> 
                
                <div className="flex gap-2 w-full md:w-auto">
                    <select
                        value={month}
                        onChange={e => setMonth(e.target.value)}
                        className="p-2 border rounded w-1/2 md:w-40 bg-white"
                    >
                        {Array.from({ length: 12 }, (_, i) => i).map(m => (
                            <option key={m} value={m}>
                                {new Date(0, m).toLocaleString('default', { month: 'long' })}
                            </option>
                        ))}
                    </select>
                    
                    <select
                        value={year}
                        onChange={e => setYear(e.target.value)}
                        className="p-2 border rounded w-1/2 md:w-32 bg-white"
                    >
                        <option value={2024}>2024</option>
                        <option value={2025}>2025</option>
                        <option value={2026}>2026</option>
                    </select>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Expenses Input Section */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4 border-b pb-2">Monthly Expenses</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                        {EXPENSE_FIELDS.map(key => (
                            <div key={key}>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                                    {key.replace(/([A-Z])/g, ' $1').trim()} {/* Format camelCase to spaced */}
                                </label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                    value={newExpense[key]}
                                    onChange={e => setNewExpense({ ...newExpense, [key]: e.target.value })}
                                    onWheel={disableScroll}
                                    placeholder="0"
                                />
                            </div>
                        ))}
                    </div>
                    
                    <button
                        onClick={saveExpense}
                        className="mt-6 w-full bg-slate-800 text-white py-3 rounded-lg font-bold hover:bg-slate-900 transition-colors shadow-md"
                    >
                        Save Expenses
                    </button>
                </div>

                {/* 2. Financial Overview Section */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit">
                    <h3 className="font-bold text-slate-700 mb-4 border-b pb-2">Financial Overview</h3>
                    
                    <div className="space-y-4">
                        <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                            <span className="text-emerald-800 font-medium">Total Revenue (Sales)</span>
                            <span className="text-emerald-800 font-bold text-lg">৳{financials.revenue.toLocaleString()}</span>
                        </div>
                        
                        <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-100">
                            <span className="text-red-800 font-medium">Cost of Goods Sold (COGS)</span>
                            <span className="text-red-800 font-bold text-lg">- ৳{financials.cogs.toLocaleString()}</span>
                        </div>
                        
                        <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-100">
                            <span className="text-orange-800 font-medium">Operating Expenses</span>
                            <span className="text-orange-800 font-bold text-lg">- ৳{financials.totalExp.toLocaleString()}</span>
                        </div>
                        
                        <div className="border-t pt-4 mt-4 flex justify-between items-center">
                            <span className="text-lg font-bold text-slate-800">Net Monthly Profit</span>
                            <span className={`text-2xl font-bold ${financials.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ৳{financials.netProfit.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MonthlyProfitTab;