import React, { useState, useEffect, useMemo } from 'react';
import { updateDoc, doc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { EXPENSE_FIELDS, disableScroll } from '../utils';

const MonthlyProfitTab = ({ orders, inventory, expenses }) => {
    // --- State ---
    const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const [startMonthInput, setStartMonthInput] = useState(currentMonthStr);
    const [endMonthInput, setEndMonthInput] = useState(currentMonthStr);

    // Derived month and year for logic
    const getYearMonth = (str) => {
        if (!str) return { year: new Date().getFullYear(), month: new Date().getMonth() };
        const [y, m] = str.split('-').map(Number);
        return { year: y, month: m - 1 }; // JS months are 0-11
    };

    const start = getYearMonth(startMonthInput);
    const end = getYearMonth(endMonthInput);

    // Default empty expenses (Initialized with empty strings to prevent Controlled/Uncontrolled error)
    const [newExpense, setNewExpense] = useState({
        media: '', salary: '', rent: '', utility: '', vat: '',
        codCharge: '', food: '', transport: '', accessories: '', paymentGatewayFees: '', maintenanceRepairs: ''
    });

    // --- Load Data (Linked to START month for editing) ---
    useEffect(() => {
        const existing = expenses.find(e => Number(e.month) === start.month && Number(e.year) === start.year);
        if (existing) {
            setNewExpense(existing);
        } else {
            // Reset to empty strings to keep inputs controlled
            const emptyObj = {};
            EXPENSE_FIELDS.forEach(key => emptyObj[key] = '');
            setNewExpense(emptyObj);
        }
    }, [startMonthInput, expenses]);

    // --- Actions ---
    const saveExpense = async () => {
        const id = `${start.year}-${start.month}`;
        const dataToSave = {};

        EXPENSE_FIELDS.forEach(k => {
            dataToSave[k] = Number(newExpense[k] || 0);
        });

        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', id), {
                ...dataToSave,
                month: Number(start.month),
                year: Number(start.year)
            });
        } catch (e) {
            const q = query(
                collection(db, 'artifacts', appId, 'public', 'data', 'expenses'),
                where('month', '==', Number(start.month)),
                where('year', '==', Number(start.year))
            );
            const snap = await getDocs(q);

            if (!snap.empty) {
                await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', snap.docs[0].id), dataToSave);
            } else {
                await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), {
                    ...dataToSave,
                    month: Number(start.month),
                    year: Number(start.year)
                });
            }
        }
        alert(`Expenses Saved for ${new Date(start.year, start.month).toLocaleString('default', { month: 'long', year: 'numeric' })}`);
    };

    // --- Calculations ---
    const financials = useMemo(() => {
        const startTimeValue = start.year * 12 + start.month;
        const endTimeValue = end.year * 12 + end.month;

        // 1. Filter Orders for Range
        const rangeOrders = orders.filter(o => {
            const d = new Date(o.date);
            const orderTime = d.getFullYear() * 12 + d.getMonth();
            return orderTime >= startTimeValue && orderTime <= endTimeValue;
        });

        // 2. Identify Groups
        const revenueOrders = rangeOrders.filter(o => {
            const status = String(o.status || '').toLowerCase();
            if (o.type === 'Online') return status === 'delivered';
            if (o.type === 'Store') return status !== 'cancelled' && status !== 'returned';
            return false;
        });

        const returnOrders = rangeOrders.filter(o => o.type === 'Online' && String(o.status || '').toLowerCase() === 'returned');

        // 3. Calculate Online Net Sales
        const onlineNetSales = revenueOrders
            .filter(o => o.type === 'Online')
            .reduce((acc, o) => {
                const subtotal = Number(o.subtotal) || 0;
                let discount = Number(o.discountValue) || 0;
                if (o.discountType === 'Percent') discount = subtotal * (discount / 100);
                const adj = Math.abs(Number(o.revenueAdjustment) || 0);
                return acc + (subtotal - discount - adj);
            }, 0);

        // 4. Calculate Store Sales
        const storeSales = revenueOrders
            .filter(o => o.type === 'Store')
            .reduce((acc, o) => acc + (Number(o.grandTotal) || 0), 0);

        // 5. Calculate Return Delivery Loss
        const returnLoss = returnOrders.reduce((acc, o) => {
            const currentCharge = Number(o.deliveryCharge) || 0;
            if (currentCharge === 0) return acc + (Number(o.originalDeliveryCharge) || 0);
            return acc;
        }, 0);

        // 6. Total Revenue
        const totalRevenue = (onlineNetSales + storeSales) - returnLoss;

        // 7. Calculate COGS
        let cogs = 0;
        revenueOrders.forEach(o => {
            (o.products || []).forEach(p => {
                if (p.code) {
                    const invItem = inventory.find(i => i.code.toUpperCase() === p.code.toUpperCase());
                    if (invItem) cogs += ((Number(invItem.unitCost) || 0) * (Number(p.qty) || 0));
                }
            });
        });

        // 8. Aggregate Operating Expenses for Range
        const filteredExpenses = expenses.filter(e => {
            const expTime = Number(e.year) * 12 + Number(e.month);
            return expTime >= startTimeValue && expTime <= endTimeValue;
        });

        const totalExp = filteredExpenses.reduce((acc, curr) => {
            return acc + EXPENSE_FIELDS.reduce((sub, key) => sub + (Number(curr[key]) || 0), 0);
        }, 0);

        return { onlineNetSales, storeSales, returnLoss, totalRevenue, cogs, totalExp, netProfit: totalRevenue - cogs - totalExp };
    }, [orders, inventory, expenses, startMonthInput, endMonthInput]);

    return (
        <div className="space-y-6">

            {/* Header & Range Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Profit & Loss Analysis</h2>
                    <p className="text-xs text-slate-500">
                        Range: <strong>{new Date(start.year, start.month).toLocaleString('default', { month: 'short', year: 'numeric' })}</strong> to <strong>{new Date(end.year, end.month).toLocaleString('default', { month: 'short', year: 'numeric' })}</strong>
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
                    <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border w-full sm:w-auto">
                        <span className="text-[10px] font-bold text-slate-400 uppercase px-2">From</span>
                        <input
                            type="month"
                            className="bg-transparent text-sm font-bold text-slate-700 outline-none p-1 cursor-pointer"
                            value={startMonthInput}
                            onChange={(e) => setStartMonthInput(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border w-full sm:w-auto">
                        <span className="text-[10px] font-bold text-slate-400 uppercase px-2">To</span>
                        <input
                            type="month"
                            className="bg-transparent text-sm font-bold text-slate-700 outline-none p-1 cursor-pointer"
                            value={endMonthInput}
                            onChange={(e) => setEndMonthInput(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* 1. Expenses Input Section (Linked to Start Month) */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-center mb-4 border-b pb-2">
                        <h3 className="font-bold text-slate-700">Edit Monthly Expenses</h3>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 font-bold uppercase">
                            {new Date(start.year, start.month).toLocaleString('default', { month: 'short', year: 'numeric' })}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {EXPENSE_FIELDS.map(key => (
                            <div key={key}>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                                    {key.replace(/([A-Z])/g, ' $1').trim()}
                                </label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                    value={newExpense[key] || ''}
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
                        Save {new Date(start.year, start.month).toLocaleString('default', { month: 'short' })} Expenses
                    </button>
                </div>

                {/* 2. Financial Overview Section */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit">
                    <h3 className="font-bold text-slate-700 mb-4 border-b pb-2">Financial Overview</h3>

                    <div className="space-y-4">

                        {/* Breakdown */}
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2">
                            <div className="flex justify-between items-center text-sm text-slate-600">
                                <span>Online Sales (Product Only)</span>
                                <span className="font-medium text-emerald-600">+ ৳{financials.onlineNetSales.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-slate-600">
                                <span>Store Sales</span>
                                <span className="font-medium text-purple-600">+ ৳{financials.storeSales.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-slate-600">
                                <span>Return Delivery Loss</span>
                                <span className="font-medium text-red-500">- ৳{financials.returnLoss.toLocaleString()}</span>
                            </div>
                            <div className="border-t border-slate-200 my-1"></div>
                            <div className="flex justify-between items-center">
                                <span className="text-emerald-800 font-bold">Total Revenue (Sales)</span>
                                <span className="text-emerald-800 font-bold text-lg">৳{financials.totalRevenue.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* COGS */}
                        <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-100">
                            <span className="text-red-800 font-medium">Cost of Goods Sold (COGS)</span>
                            <span className="text-red-800 font-bold text-lg">- ৳{financials.cogs.toLocaleString()}</span>
                        </div>

                        {/* Expenses */}
                        <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-100">
                            <span className="text-orange-800 font-medium">Operating Expenses</span>
                            <span className="text-orange-800 font-bold text-lg">- ৳{financials.totalExp.toLocaleString()}</span>
                        </div>

                        {/* Net Profit */}
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