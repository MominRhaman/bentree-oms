import React, { useState, useMemo } from 'react';
import { Download, Filter, Edit, Trash2, CheckCircle, ShoppingBag, XCircle, Search, CreditCard } from 'lucide-react';
import SearchBar from './SearchBar';
import OrderDetailsPopup from './OrderDetailsPopup';
import { INVENTORY_CATEGORIES, downloadCSV } from '../utils';

const CANCEL_ORDER_CONFIRM = 'Cancel this Store Order? Stock will be restored and recorded in Movement Log.';
const PAYMENT_MODES = ['Cash', 'Card', 'bKash', 'Nagad', 'MFS', 'Bank Transfer'];

const StoreSalesTab = ({ orders, inventory, onUpdate, onEdit, onCreate, onDelete }) => {
    // --- States ---
    const [isCheckoutMode, setIsCheckoutMode] = useState(false);
    const [checkoutSearch, setCheckoutSearch] = useState('');
    const [tempIds, setTempIds] = useState({}); // Local state for inputs (starts blank)

    // --- Standard Filter States ---
    const [searchTerm, setSearchTerm] = useState('');
    const [catFilter, setCatFilter] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [dueFilter, setDueFilter] = useState(false);
    const [paymentModal, setPaymentModal] = useState(null);
    const [editedPayments, setEditedPayments] = useState([]);

    // --- CHECKOUT LOGIC (Like Primary Orders) ---
    // 1. Start with BLANK list. Only show if search has value.
    const checkoutResult = useMemo(() => {
        if (!isCheckoutMode || !checkoutSearch.trim()) return [];

        const term = checkoutSearch.toLowerCase();
        return orders.filter(o =>
            o.type === 'Store' &&
            o.checkOutStatus !== 'Completed' &&
            o.status !== 'Cancelled' &&
            (
                (o.storeOrderId && o.storeOrderId.toLowerCase().includes(term)) ||
                (o.recipientPhone && o.recipientPhone.includes(term))
            )
        );
    }, [orders, isCheckoutMode, checkoutSearch]);

    // --- HISTORY DATA LOGIC ---
    const { salesData, totals } = useMemo(() => {
        if (isCheckoutMode) return { salesData: [], totals: {} };

        const safeNum = (v) => Number(v) || 0;
        let processedOrders = (orders || []).filter(o => {
            const status = String(o.status || '').toLowerCase();
            return (o.type === 'Store' && status !== 'cancelled' && status !== 'returned');
        });

        if (startDate) processedOrders = processedOrders.filter(o => o.date >= startDate);
        if (endDate) processedOrders = processedOrders.filter(o => o.date <= endDate);

        // Payment Mode Filter — checks payments[] array; falls back to storePaymentMode for old orders
        if (paymentFilter === 'Due') {
            processedOrders = processedOrders.filter(o => Number(o.dueAmount || 0) > 0);
        } else if (paymentFilter) {
            processedOrders = processedOrders.filter(o => {
                const pmts = o.payments || [];
                if (pmts.length > 0) return pmts.some(p => p.mode === paymentFilter);
                return (o.storePaymentMode || 'Cash') === paymentFilter;
            });
        }

        // Due Orders Filter
        if (dueFilter) processedOrders = processedOrders.filter(o => Number(o.dueAmount || 0) > 0);

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            processedOrders = processedOrders.filter(o =>
                String(o.recipientPhone || '').includes(term) ||
                String(o.storeOrderId || '').toLowerCase().includes(term)
            );
        }

        const data = [];
        const uniqueOrderIds = new Set();
        processedOrders.forEach(order => {
            uniqueOrderIds.add(order.id);
            const orderId = order.storeOrderId;
            const paymentMode = order.storePaymentMode || 'Cash';
            const addedBy = order.addedBy || 'System';
            const phone = order.recipientPhone || '-';
            const checkOutStatus = order.checkOutStatus || 'Pending';
            // Category filter: include order if any product matches
            if (catFilter && catFilter !== "") {
                const hasMatch = (order.products || []).some(p => {
                    const inv = inventory.find(i => i.code.toUpperCase() === (p.code || '').toUpperCase());
                    return (inv ? inv.category : 'N/A') === catFilter;
                });
                if (!hasMatch) return;
            }

            // Order-level revenue and COGS
            const orderNetRevenue = safeNum(order.grandTotal) - safeNum(order.deliveryCharge) + safeNum(order.revenueAdjustment);
            let totalQty = 0;
            let totalCOGS = 0;
            (order.products || []).forEach(prod => {
                const invItem = inventory.find(i => i.code.toUpperCase() === (prod.code || '').toUpperCase());
                const unitCost = invItem ? safeNum(invItem.unitCost) : 0;
                totalQty += safeNum(prod.qty);
                totalCOGS += unitCost * safeNum(prod.qty);
            });

            // When a payment method filter is active, displayRevenue = amount collected via that method
            const pmts = order.payments || [];
            const displayRevenue = (paymentFilter && paymentFilter !== 'Due')
                ? (pmts.length > 0
                    ? pmts.filter(p => p.mode === paymentFilter).reduce((s, p) => s + Number(p.amount || 0), 0)
                    : Number(order.collectedAmount || order.grandTotal || 0))
                : orderNetRevenue;

            data.push({
                uniqueKey: order.id,
                originalOrder: order,
                id: order.id,
                date: order.date,
                orderId, phone, checkOutStatus,
                products: order.products || [],
                unitSold: totalQty,
                revenue: orderNetRevenue,
                displayRevenue,
                profitLoss: orderNetRevenue - totalCOGS,
                paymentMode, addedBy,
                dueAmount: Number(order.dueAmount || 0),
                collectedAmount: Number(order.collectedAmount || 0),
                payments: pmts,
                grandTotal: safeNum(order.grandTotal)
            });
        });

        const totals = data.reduce((acc, row) => ({
            unitSold: acc.unitSold + row.unitSold,
            revenue: acc.revenue + row.revenue,
            displayRevenue: acc.displayRevenue + row.displayRevenue,
            profitLoss: acc.profitLoss + row.profitLoss
        }), { unitSold: 0, revenue: 0, displayRevenue: 0, profitLoss: 0 });

        totals.orderCount = uniqueOrderIds.size;

        return { salesData: data, totals };
    }, [orders, inventory, startDate, endDate, searchTerm, catFilter, paymentFilter, dueFilter, isCheckoutMode]);

    // --- Input Handlers (Primary Order Style) ---
    const handleIdChange = (orderId, value) => {
        setTempIds(prev => ({ ...prev, [orderId]: value }));
    };

    const handleCheckoutComplete = (e, order, scannedId) => {
        e.stopPropagation();

        if (confirm(`Confirm Payment of ৳${order.grandTotal} and Complete Order?`)) {
            onUpdate(order.id, 'Completed', {
                storeOrderId: scannedId, // Save the typed ID to the database
                checkOutStatus: 'Completed',
                collectedAmount: Number(order.grandTotal),
                dueAmount: 0
            });
            // Clear local input state after completion
            setTempIds(prev => {
                const next = { ...prev };
                delete next[order.id];
                return next;
            });
        }
    };

    const handleExport = () => {
        const csvData = salesData.map(row => ({
            Date: row.date, 'Order ID': row.orderId, 'Phone': row.phone, 'Status': row.checkOutStatus,
            Products: (row.products || []).map(p => `${p.code}${p.size ? ` (${p.size})` : ''} x${p.qty}`).join(' | '),
            'Total Qty': row.unitSold, 'Revenue': row.revenue, 'Profit': row.profitLoss
        }));
        downloadCSV(csvData, 'store_sales_report.csv');
    };

    return (
        <div className="space-y-6">

            {/* --- TOP HEADER & TOGGLE --- */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">
                        {isCheckoutMode ? 'Store Checkout Counter' : 'Store Sales Dashboard'}
                    </h2>
                    <p className="text-xs text-slate-500">
                        {isCheckoutMode ? 'Scan Order ID to process payment' : 'Live sales summary by category'}
                    </p>
                </div>

                <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
                    <button
                        onClick={() => setIsCheckoutMode(false)}
                        className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${!isCheckoutMode ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <ShoppingBag size={16} /> Sales History
                    </button>
                    <button
                        onClick={() => { setIsCheckoutMode(true); setCheckoutSearch(''); }}
                        className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${isCheckoutMode ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <CheckCircle size={16} /> Checkout Queue
                    </button>
                </div>
            </div>

            {/* --- VIEW 1: CHECKOUT QUEUE (Input Driven) --- */}
            {isCheckoutMode ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[400px] flex flex-col">

                    {/* Big Search Bar */}
                    <div className="p-8 border-b bg-slate-50 flex justify-center">
                        <div className="relative w-full max-w-2xl">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600" size={24} />
                            <input
                                autoFocus
                                className="w-full pl-12 pr-4 py-4 text-lg border-2 border-emerald-200 rounded-xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 outline-none transition-all shadow-sm"
                                placeholder="Scan or Type Store Order ID / Phone Number..."
                                value={checkoutSearch}
                                onChange={(e) => setCheckoutSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Result Table (Primary Order Style) */}
                    <div className="flex-1 p-6">
                        {checkoutResult.length > 0 ? (
                            <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-600 font-bold border-b">
                                        <tr>
                                            <th className="p-4 w-48">Confirm Order ID</th>
                                            <th className="p-4">Customer</th>
                                            <th className="p-4">Products</th>
                                            <th className="p-4 text-center">Payment</th>
                                            <th className="p-4 text-right">Total Bill</th>
                                            <th className="p-4 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {checkoutResult.map(order => {
                                            // --- FIX: Force blank start by only using tempIds state ---
                                            const currentId = tempIds[order.id] || '';
                                            const hasEnteredId = currentId.trim().length > 0;

                                            return (
                                                <tr key={order.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedOrder(order)}>
                                                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="text"
                                                            placeholder="Scan / Type ID"
                                                            className="border-2 border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none font-mono font-bold"
                                                            value={currentId}
                                                            required
                                                            onChange={(e) => handleIdChange(order.id, e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && hasEnteredId) {
                                                                    handleCheckoutComplete(e, order, currentId);
                                                                }
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-medium text-slate-800">{order.recipientPhone}</div>
                                                        <div className="text-xs text-slate-500">Store Guest</div>
                                                    </td>
                                                    <td className="p-4">
                                                        {(order.products || []).map((p, i) => (
                                                            <div key={i} className="text-xs font-mono bg-slate-100 rounded px-2 py-1 mb-1 inline-block mr-1 border border-slate-200">
                                                                {p.code} <span className="text-slate-400">|</span> {p.size} <span className="font-bold text-emerald-600">x{p.qty}</span>
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <select
                                                            className="bg-slate-100 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-emerald-500"
                                                            value={order.storePaymentMode}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => onUpdate(order.id, order.status, { storePaymentMode: e.target.value })}
                                                        >
                                                            <option>Cash</option>
                                                            <option>Card</option>
                                                            <option>MFS</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <span className="text-xl font-bold text-emerald-700">৳{order.grandTotal}</span>
                                                    </td>
                                                    <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex justify-center gap-2">
                                                            {/* Only show button if user has typed something */}
                                                            {hasEnteredId && (
                                                                <button
                                                                    onClick={(e) => handleCheckoutComplete(e, order, currentId)}
                                                                    className="bg-emerald-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-emerald-700 shadow-md transition-all flex items-center gap-2 animate-in fade-in"
                                                                >
                                                                    <CheckCircle size={16} /> Complete
                                                                </button>
                                                            )}

                                                            <button
                                                                onClick={() => { if (confirm(CANCEL_ORDER_CONFIRM)) onUpdate(order.id, 'Cancelled'); }}
                                                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                title="Cancel Order"
                                                            >
                                                                <XCircle size={20} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            // BLANK STATE VISUAL
                            <div className="h-64 flex flex-col items-center justify-center text-slate-300">
                                {checkoutSearch ? (
                                    <>
                                        <XCircle size={48} className="mb-2 text-slate-200" />
                                        <p>No Pending Store Order found for "{checkoutSearch}"</p>
                                    </>
                                ) : (
                                    <>
                                        <ShoppingBag size={48} className="mb-2 opacity-20" />
                                        <p className="font-medium text-slate-400">Checkout Counter is Ready</p>
                                        <p className="text-xs mt-1">Scan or type Order ID to begin transaction</p>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ) : (

                /* --- VIEW 2: SALES HISTORY (Existing Table) --- */
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                            <div className="w-full md:w-64">
                                <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search Order ID or Phone..." />
                            </div>
                            <div className="relative">
                                <select className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-40 appearance-none cursor-pointer hover:border-emerald-400 transition-colors" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                                    <option value="">All Categories</option>
                                    {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                                </select>
                                <Filter size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                            </div>

                            {/* Payment Mode Filter */}
                            <div className="relative">
                                <select
                                    className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-44 appearance-none cursor-pointer hover:border-emerald-400 transition-colors"
                                    value={paymentFilter}
                                    onChange={e => setPaymentFilter(e.target.value)}
                                >
                                    <option value="">All Payments</option>
                                    <option value="Cash">Cash</option>
                                    <option value="Card">Card</option>
                                    <option value="bKash">bKash</option>
                                    <option value="Nagad">Nagad</option>
                                    <option value="MFS">MFS</option>
                                    <option value="Bank Transfer">Bank Transfer</option>
                                    <option value="Split">Split</option>
                                    <option value="Due">Due</option>
                                </select>
                                <CreditCard size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                            </div>
                            <button
                                onClick={() => setDueFilter(f => !f)}
                                className={`px-3 py-2 rounded text-sm font-bold border transition-colors whitespace-nowrap ${dueFilter ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-500 border-red-200 hover:bg-red-50'}`}
                            >
                                Due Orders
                            </button>
                        </div>
                        <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                            <div className="flex items-center bg-white border rounded px-2 py-1 gap-2 w-full md:w-auto justify-between md:justify-start">
                                <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={startDate} onChange={e => setStartDate(e.target.value)} />
                                <span className="text-slate-300">-</span>
                                <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={endDate} onChange={e => setEndDate(e.target.value)} />
                            </div>
                            <button onClick={handleExport} className="flex items-center justify-center gap-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-full md:w-auto">
                                <Download size={16} /> Export
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto max-h-[600px] relative">
                        <table className="w-full text-sm text-left min-w-[900px]">
                            <thead className="bg-white text-slate-600 font-bold border-b text-xs uppercase sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-3 bg-slate-50">Order</th>
                                    <th className="p-3 bg-slate-50">Phone Number</th>
                                    <th className="p-3 bg-slate-50">Check Out</th>
                                    <th className="p-3 bg-slate-50">Products</th>
                                    <th className="p-3 bg-slate-50 text-center">Total Qty</th>
                                    <th className="p-3 bg-slate-50 text-right">Revenue</th>
                                    <th className="p-3 bg-slate-50 text-right">Profit</th>
                                    <th className="p-3 bg-slate-50">Payment</th>
                                    <th className="p-3 bg-slate-50">Added By</th>
                                    <th className="p-3 bg-slate-50 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {salesData.map((row) => {
                                    // --- HISTORY VIEW INPUT LOGIC ---
                                    // Ensures field starts blank and only shows session typing
                                    const currentIdHistory = tempIds[row.id] || '';
                                    const hasEnteredIdHistory = currentIdHistory.trim().length > 0;

                                    return (
                                        <tr key={row.uniqueKey} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(row.originalOrder)}>
                                            <td className="p-3 font-medium text-slate-800">
                                                {row.orderId || '-'}
                                                <div className="text-[10px] text-slate-400 font-normal">{row.date}</div>
                                            </td>
                                            <td className="p-3 text-slate-600 font-mono text-xs">{row.phone}</td>

                                            {/* Check Out Column (History) */}
                                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex flex-col gap-1 w-28">
                                                    {row.checkOutStatus !== 'Completed' && (
                                                        <input
                                                            type="text"
                                                            placeholder="Order ID"
                                                            className="border rounded px-2 py-1 text-[10px] w-full focus:ring-1 focus:ring-emerald-500 outline-none font-bold"
                                                            value={currentIdHistory} //孤立した状態
                                                            required
                                                            onChange={(e) => handleIdChange(row.id, e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && hasEnteredIdHistory) {
                                                                    onUpdate(row.id, row.originalOrder.status, {
                                                                        storeOrderId: currentIdHistory,
                                                                        checkOutStatus: 'Completed',
                                                                        collectedAmount: Number(row.originalOrder.grandTotal),
                                                                        dueAmount: 0
                                                                    });
                                                                    // Clear input after save
                                                                    setTempIds(prev => { const n = { ...prev }; delete n[row.id]; return n; });
                                                                }
                                                            }}
                                                        />
                                                    )}

                                                    {/* Button only appears if input is filled or ID exists in DB */}
                                                    {row.originalOrder.storeOrderId || hasEnteredIdHistory ? (
                                                        <button
                                                            onClick={() => onUpdate(row.id, row.originalOrder.status, {
                                                                storeOrderId: currentIdHistory || row.originalOrder.storeOrderId,
                                                                checkOutStatus: row.checkOutStatus === 'Completed' ? 'Pending' : 'Completed',
                                                                collectedAmount: row.checkOutStatus !== 'Completed' ? Number(row.originalOrder.grandTotal) : 0
                                                            })}
                                                            className={`w-full py-1 px-1 rounded text-[10px] font-bold flex items-center justify-center gap-1
                                                        ${row.checkOutStatus === 'Completed'
                                                                    ? 'bg-green-100 text-green-700 border border-green-200'
                                                                    : 'bg-slate-800 text-white shadow-sm hover:bg-emerald-600 transition-colors'
                                                                }`}
                                                        >
                                                            {row.checkOutStatus === 'Completed' ? <><CheckCircle size={10} /> Done</> : 'Complete'}
                                                        </button>
                                                    ) : (
                                                        <div className="text-[9px] text-red-500 italic text-center bg-red-50 rounded border border-red-100 uppercase font-bold p-1">ID Required</div>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="p-3 text-xs text-slate-600">
                                                {(row.products || []).map((p, i) => (
                                                    <div key={i}>{p.code}{p.size ? ` (${p.size})` : ''} ×{p.qty}</div>
                                                ))}
                                            </td>
                                            <td className="p-3 text-center font-medium text-slate-800">{row.unitSold}</td>
                                            <td className="p-3 text-right text-emerald-700 font-medium">
                                                ৳{row.displayRevenue.toFixed(2)}
                                                {row.dueAmount > 0 && (
                                                    <div className="text-[10px] text-red-500 font-bold">Due ৳{row.dueAmount.toFixed(0)}</div>
                                                )}
                                            </td>
                                            <td className={`p-3 text-right font-bold ${row.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {row.profitLoss.toFixed(2)}
                                            </td>
                                            <td className="p-3 text-xs text-slate-500">{row.paymentMode}</td>
                                            <td className="p-3 text-xs text-slate-500">{row.addedBy}</td>
                                            <td className="p-3 text-center flex justify-center gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditedPayments((row.payments || []).map(p => ({ ...p })));
                                                        setPaymentModal({ id: row.id, orderId: row.orderId, grandTotal: row.grandTotal, collectedAmount: row.collectedAmount, dueAmount: row.dueAmount, payments: row.payments || [], status: row.originalOrder.status });
                                                    }}
                                                    className={`p-1 rounded ${row.dueAmount > 0 ? 'text-red-500 hover:bg-red-50' : 'text-slate-400 hover:bg-slate-100'}`}
                                                    title="Manage Payments"
                                                >
                                                    <CreditCard size={16} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(row.originalOrder); }} className="text-blue-500 hover:bg-blue-50 p-1 rounded"><Edit size={16} /></button>
                                                <button onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm(CANCEL_ORDER_CONFIRM)) onUpdate(row.id, 'Cancelled');
                                                }} className="text-orange-500 hover:bg-orange-50 p-1 rounded" title="Cancel Order"><XCircle size={16} /></button>
                                                <button onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm('Delete this sale? Stock will be returned.')) onDelete(row.id);
                                                }} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16} /></button>
                                            </td>
                                        </tr>
                                    )
                                })}
                                {salesData.length === 0 && <tr><td colSpan="10" className="p-10 text-center text-slate-400">No store sales found.</td></tr>}
                            </tbody>
                            <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                                <tr>
                                    <td className="p-3 text-right uppercase text-xs text-slate-500" colSpan="3">
                                        Total Orders: <span className="text-slate-900 text-sm ml-1">{totals.orderCount}</span> | TOTALS
                                    </td>
                                    <td className="p-3 text-center" colSpan="2">{totals.unitSold}</td>
                                    <td className="p-3 text-right text-emerald-800">৳{(totals.displayRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                    <td className={`p-3 text-right ${totals.profitLoss >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>৳{totals.profitLoss.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                    <td className="p-3" colSpan="3"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* Payment Modal */}
            {paymentModal && (() => {
                const epTotal = editedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
                const epDue   = Math.max(0, paymentModal.grandTotal - epTotal);
                const isOver  = epTotal > paymentModal.grandTotal + 0.01;
                const handleSave = () => {
                    const valid = editedPayments
                        .filter(p => Number(p.amount || 0) > 0)
                        .map(p => ({ ...p, amount: Number(p.amount) }));
                    const paid = valid.reduce((s, p) => s + p.amount, 0);
                    const due  = Math.max(0, paymentModal.grandTotal - paid);
                    const mode = valid.length === 0 ? 'Due' : valid.length === 1 ? valid[0].mode : 'Split';
                    onUpdate(paymentModal.id, paymentModal.status, { collectedAmount: paid, dueAmount: due, storePaymentMode: mode, payments: valid });
                    setPaymentModal(null);
                };
                return (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                        {/* Header */}
                        <div className="p-5 border-b flex justify-between items-start">
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">Payments — #{paymentModal.orderId || '—'}</h3>
                                <div className="flex gap-3 text-xs mt-1 flex-wrap">
                                    <span className="text-slate-500">Total: <span className="font-bold text-slate-700">৳{paymentModal.grandTotal.toFixed(2)}</span></span>
                                    <span className="text-slate-500">Paid: <span className="font-bold text-emerald-600">৳{epTotal.toFixed(2)}</span></span>
                                    {epDue > 0 ? <span className="font-bold text-red-600">Due: ৳{epDue.toFixed(2)}</span> : <span className="font-bold text-emerald-600">Fully Paid</span>}
                                    {isOver && <span className="font-bold text-orange-600">Overpaid!</span>}
                                </div>
                            </div>
                            <button onClick={() => setPaymentModal(null)} className="text-slate-400 hover:text-slate-600 ml-4 flex-shrink-0"><XCircle size={20} /></button>
                        </div>
                        {/* Editable Payment Entries */}
                        <div className="p-5 overflow-y-auto flex-1">
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-xs font-bold text-slate-500 uppercase">Payment Entries</p>
                                <p className="text-xs text-slate-400">Mode · Amount · Ref# · Date</p>
                            </div>
                            {editedPayments.length === 0 && <p className="text-xs text-slate-400 italic mb-3">No payments recorded yet.</p>}
                            <div className="space-y-2 mb-3">
                                {editedPayments.map((p, i) => (
                                    <div key={i} className="flex gap-2 items-center bg-slate-50 rounded-lg px-2 py-2 border">
                                        <select
                                            className="w-28 p-1.5 border rounded text-xs bg-white"
                                            value={p.mode || 'Cash'}
                                            onChange={e => { const n = [...editedPayments]; n[i] = { ...n[i], mode: e.target.value }; setEditedPayments(n); }}
                                        >
                                            {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
                                        </select>
                                        <input
                                            type="number"
                                            className="w-24 p-1.5 border rounded text-xs"
                                            value={p.amount}
                                            onChange={e => { const n = [...editedPayments]; n[i] = { ...n[i], amount: e.target.value }; setEditedPayments(n); }}
                                            min="0"
                                            placeholder="Amount"
                                        />
                                        <input
                                            className="flex-1 p-1.5 border rounded text-xs"
                                            value={p.txRef || ''}
                                            onChange={e => { const n = [...editedPayments]; n[i] = { ...n[i], txRef: e.target.value }; setEditedPayments(n); }}
                                            placeholder="Ref# (optional)"
                                        />
                                        <span className="text-slate-400 text-[10px] whitespace-nowrap">
                                            {p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-GB') : 'new'}
                                        </span>
                                        <button onClick={() => setEditedPayments(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 flex-shrink-0">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => setEditedPayments(prev => [...prev, { mode: 'Cash', amount: '', txRef: '', timestamp: new Date().toISOString() }])}
                                className="flex items-center text-sm text-emerald-600 font-bold hover:bg-emerald-50 p-2 rounded border border-dashed border-emerald-300 w-full justify-center"
                            >
                                + Add Payment Row
                            </button>
                        </div>
                        {/* Footer */}
                        <div className="p-5 border-t flex gap-2">
                            <button
                                onClick={handleSave}
                                disabled={isOver}
                                className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${isOver ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                            >
                                Save Changes
                            </button>
                            <button onClick={() => setPaymentModal(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Popup */}
            {selectedOrder && (
                <OrderDetailsPopup
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    getStatusColor={() => 'text-purple-600 bg-purple-50'}
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                />
            )}
        </div>
    );
};

export default React.memo(StoreSalesTab);