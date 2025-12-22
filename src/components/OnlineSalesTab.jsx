import React, { useState, useMemo } from 'react';
import { Download, Filter, Edit, Trash2 } from 'lucide-react';
import SearchBar from './SearchBar';
import OrderDetailsPopup from './OrderDetailsPopup';
import { INVENTORY_CATEGORIES, downloadCSV } from '../utils';

const OnlineSalesTab = ({ orders, inventory, onEdit, onDelete }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [catFilter, setCatFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);

    // --- MAIN DATA CALCULATION ---
    const { salesData, totals } = useMemo(() => {
        let filtered = orders || [];
        
        // 1. Basic Filters
        if (startDate) filtered = filtered.filter(o => o.date >= startDate);
        if (endDate) filtered = filtered.filter(o => o.date <= endDate);

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(o =>
                (o.recipientPhone || '').includes(term) ||
                (o.recipientName || '').toLowerCase().includes(term) ||
                (o.merchantOrderId || '').toLowerCase().includes(term)
            );
        }

        const safeNum = (v) => Number(v) || 0;
        const data = [];

        filtered.forEach(order => {
            // STRICT FILTER: Only 'Delivered' ONLINE orders
            if (order.type !== 'Online' || order.status !== 'Delivered') return;

            const orderId = order.merchantOrderId;
            const salesBy = order.orderSource;
            const addedBy = order.addedBy || 'System';
            const phone = order.recipientPhone || '-'; // Phone Added
            const checkOutStatus = order.checkOutStatus || 'Pending'; // Check Out Status Added

            // Discount & Adjustment Calculations
            const orderSubtotal = safeNum(order.subtotal);
            
            // --- FIX: Handle Percentage Discount ---
            let orderDiscount = safeNum(order.discountValue);
            if (order.discountType === 'Percent') {
                orderDiscount = orderSubtotal * (orderDiscount / 100);
            }

            const orderAdj = safeNum(order.revenueAdjustment);
            const totalDeduction = orderDiscount + Math.abs(orderAdj);

            (order.products || []).forEach(prod => {
                const invItem = inventory.find(i => i.code.toUpperCase() === (prod.code || '').toUpperCase());
                const category = invItem ? invItem.category : 'N/A';

                if (catFilter && catFilter !== "" && category !== catFilter) return;

                const unitCost = invItem ? safeNum(invItem.unitCost) : 0;
                let currentStock = 0;
                if (invItem) {
                    if (invItem.type === 'Variable') {
                        currentStock = Object.values(invItem.stock || {}).reduce((a, b) => a + Number(b), 0);
                    } else {
                        currentStock = safeNum(invItem.totalStock);
                    }
                }

                const salePrice = safeNum(prod.price);
                const qty = safeNum(prod.qty);

                // Net Revenue Calculation
                const grossItemRevenue = salePrice * qty;
                const ratio = orderSubtotal > 0 ? (grossItemRevenue / orderSubtotal) : 0;
                const netRevenue = grossItemRevenue - (totalDeduction * ratio);

                const profitLoss = netRevenue - (unitCost * qty);

                data.push({
                    uniqueKey: `${order.id}-${prod.code}-${Math.random()}`,
                    id: order.id,
                    date: order.date,
                    orderId: orderId,
                    phone: phone, // Pass phone
                    checkOutStatus: checkOutStatus, // Pass status
                    code: prod.code,
                    category: category,
                    unitStock: currentStock,
                    costUnit: unitCost,
                    unitSold: qty,
                    revenue: netRevenue,
                    profitLoss: profitLoss,
                    salesBy: salesBy,
                    addedBy: addedBy,
                    lastEdited: order.lastEditedBy || '-',
                    originalOrder: order
                });
            });
        });

        // Calculate Footer Totals
        const totalStats = data.reduce((acc, row) => ({
            unitSold: acc.unitSold + row.unitSold,
            revenue: acc.revenue + row.revenue,
            profitLoss: acc.profitLoss + row.profitLoss
        }), { unitSold: 0, revenue: 0, profitLoss: 0 });

        return { salesData: data, totals: totalStats };
    }, [orders, inventory, startDate, endDate, searchTerm, catFilter]);

    const handleExport = () => {
        const csvData = salesData.map(row => ({
            Date: row.date,
            'Order ID': row.orderId,
            'Phone Number': row.phone, // Export Phone
            'Check Out': row.checkOutStatus, // Export Check Out
            Code: row.code,
            Category: row.category,
            'Unit Sold': row.unitSold,
            'Net Revenue': row.revenue.toFixed(2),
            'Net Profit': row.profitLoss.toFixed(2),
            'Sales By': row.salesBy,
            'Added By': row.addedBy
        }));
        downloadCSV(csvData, `online_sales_report.csv`);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800">Online Sales Dashboard</h2>
                <p className="text-xs text-slate-500">Live sales summary by category (Delivered Orders Only)</p>
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header Controls */}
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                    <div className="w-full md:w-auto">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search Orders..." />
                    </div>

                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="relative">
                            <select className="p-2 pl-8 border rounded w-full md:w-40 appearance-none cursor-pointer hover:border-emerald-400 transition-colors" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                                <option value="">All Categories</option>
                                {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                            <Filter size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                        </div>

                        <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                            <input type="date" className="bg-transparent text-sm w-full outline-none" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <span className="text-slate-300">-</span>
                            <input type="date" className="bg-transparent text-sm w-full outline-none" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>

                        <button onClick={handleExport} className="flex items-center justify-center gap-2 text-emerald-600 font-bold bg-white border rounded p-2 w-full md:w-auto hover:bg-emerald-50">
                            <Download size={16} /> Export
                        </button>
                    </div>
                </div>

                {/* Table Container with Max Height */}
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[1000px]">
                        {/* Sticky Header */}
                        <thead className="bg-white font-bold border-b text-slate-600 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 bg-slate-50">Code</th>
                                <th className="p-3 bg-slate-50">Phone Number</th> {/* Added Header */}
                                <th className="p-3 bg-slate-50">Check Out</th> {/* Added Header */}
                                <th className="p-3 bg-slate-50">Category</th>
                                <th className="p-3 bg-slate-50 text-center">Unit (Stock)</th>
                                <th className="p-3 bg-slate-50 text-right">Cost (Unit)</th>
                                <th className="p-3 bg-slate-50 text-center">Unit Sold</th>
                                <th className="p-3 bg-slate-50 text-right">Net Revenue</th>
                                <th className="p-3 bg-slate-50 text-right">Prof/Loss</th>
                                <th className="p-3 bg-slate-50">Sales By</th>
                                <th className="p-3 bg-slate-50">Added By</th>
                                <th className="p-3 bg-slate-50 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {salesData.map(row => (
                                <tr key={row.uniqueKey} className="hover:bg-slate-50 border-b cursor-pointer" onClick={() => setSelectedOrder(row.originalOrder)}>
                                    <td className="p-3 font-medium">
                                        {row.code}
                                        <div className="text-xs text-slate-400">{row.date}</div>
                                        <div className="text-[10px] text-slate-500">{row.orderId}</div>
                                    </td>
                                    {/* Added Phone Column */}
                                    <td className="p-3 text-slate-600 font-mono text-xs">{row.phone}</td>
                                    {/* Added Check Out Column */}
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.checkOutStatus === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {row.checkOutStatus}
                                        </span>
                                    </td>
                                    <td className="p-3 text-slate-600">{row.category}</td>
                                    <td className="p-3 text-center text-slate-600">{row.unitStock}</td>
                                    <td className="p-3 text-right text-slate-600">৳{row.costUnit.toFixed(2)}</td>
                                    <td className="p-3 text-center font-bold text-slate-800">{row.unitSold}</td>
                                    <td className="p-3 text-right text-emerald-700 font-medium">৳{row.revenue.toFixed(2)}</td>
                                    <td className={`p-3 text-right font-bold ${row.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {row.profitLoss.toFixed(2)}
                                    </td>
                                    <td className="p-3 text-xs text-slate-500">{row.salesBy}</td>
                                    <td className="p-3 text-xs text-slate-500">{row.addedBy}</td>
                                    <td className="p-3 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => setSelectedOrder(row.originalOrder)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Edit size={16} /></button>
                                        <button onClick={() => { if (confirm('Delete?')) onDelete(row.id); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={16} /></button>
                                    </td>
                                </tr>
                            ))}
                            {salesData.length === 0 && (
                                <tr>
                                    <td colSpan="12" className="p-10 text-center text-slate-400">
                                        No delivered online sales found for this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        
                        {/* Sticky Footer */}
                        <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                            <tr>
                                <td className="p-3 text-right uppercase text-xs text-slate-500" colSpan="6">TOTALS</td>
                                <td className="p-3 text-center">{totals.unitSold}</td>
                                <td className="p-3 text-right text-emerald-800">৳{totals.revenue.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                <td className={`p-3 text-right ${totals.profitLoss >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                                    ৳{totals.profitLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}
                                </td>
                                <td className="p-3" colSpan="3"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            
            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={() => 'text-green-600 bg-green-50'} 
                    onEdit={onEdit} 
                />
            )}
        </div>
    );
};

export default OnlineSalesTab;