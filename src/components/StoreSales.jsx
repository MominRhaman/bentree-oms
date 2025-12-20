import React, { useState, useMemo } from 'react';
import { Download, Filter, Edit, Trash2 } from 'lucide-react';
import SearchBar from './SearchBar';
import OrderDetailsPopup from './OrderDetailsPopup';
import { INVENTORY_CATEGORIES, downloadCSV } from '../utils';

const StoreSalesTab = ({ orders, inventory, onEdit, onDelete }) => {
    // --- Filter States ---
    const [searchTerm, setSearchTerm] = useState('');
    const [catFilter, setCatFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    
    // --- UI States ---
    const [selectedOrder, setSelectedOrder] = useState(null);

    // --- MAIN DATA CALCULATION ---
    const { salesData, totals } = useMemo(() => {
        const safeNum = (v) => Number(v) || 0;

        // 1. THE FIREWALL (PERMISSIVE MODE)
        // Show everything that is TYPE=STORE, unless it's explicitly Cancelled or Returned.
        // This ensures 'Delivered', 'Paid', 'Completed', or Empty statuses ALL show up.
        let processedOrders = (orders || []).filter(o => {
            const status = (o.status || '').toLowerCase();
            return (
                o.type === 'Store' && 
                status !== 'cancelled' && 
                status !== 'returned'
            );
        });

        // 2. Date Filter
        if (startDate) processedOrders = processedOrders.filter(o => o.date >= startDate);
        if (endDate) processedOrders = processedOrders.filter(o => o.date <= endDate);

        // 3. Search Filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            processedOrders = processedOrders.filter(o =>
                (o.recipientPhone || '').includes(term) ||
                (o.storeOrderId || '').toLowerCase().includes(term)
            );
        }

        // 4. Process Data (Generate Table Rows)
        const data = [];

        processedOrders.forEach(order => {
            const orderId = order.storeOrderId;
            const paymentMode = order.storePaymentMode || 'Cash';
            const addedBy = order.addedBy || 'System';

            const orderSubtotal = safeNum(order.subtotal);
            const orderDiscount = safeNum(order.discountValue);
            
            (order.products || []).forEach(prod => {
                const invItem = inventory.find(i => i.code.toUpperCase() === (prod.code || '').toUpperCase());
                const category = invItem ? invItem.category : 'N/A';

                // --- Category Filter ---
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

                // --- Net Revenue Logic ---
                const grossItemRevenue = salePrice * qty;
                
                // Distribute Discount Pro-rata
                const ratio = orderSubtotal > 0 ? (grossItemRevenue / orderSubtotal) : 0;
                const itemDiscountShare = orderDiscount * ratio;

                const netRevenue = grossItemRevenue - itemDiscountShare;
                const costOfSold = unitCost * qty;
                const profitLoss = netRevenue - costOfSold;
                const totalAssetValue = unitCost * currentStock;

                data.push({
                    uniqueKey: `${order.id}-${prod.code}-${Math.random()}`,
                    id: order.id,
                    date: order.date,
                    orderId: orderId,
                    code: prod.code,
                    category: category,
                    unitStock: currentStock,
                    costUnit: unitCost,
                    totalValue: totalAssetValue,
                    unitSold: qty,
                    revenue: netRevenue,
                    profitLoss: profitLoss,
                    paymentMode: paymentMode,
                    addedBy: addedBy,
                    originalOrder: order
                });
            });
        });

        // 5. Calculate Totals
        const totals = data.reduce((acc, row) => ({
            unitSold: acc.unitSold + row.unitSold,
            revenue: acc.revenue + row.revenue,
            profitLoss: acc.profitLoss + row.profitLoss
        }), { unitSold: 0, revenue: 0, profitLoss: 0 });

        return { salesData: data, totals };
    }, [orders, inventory, startDate, endDate, searchTerm, catFilter]);

    // --- Handlers ---
    const handleExport = () => {
        const csvData = salesData.map(row => ({
            Date: row.date,
            'Store Order ID': row.orderId,
            Code: row.code,
            Category: row.category,
            'Unit Sold': row.unitSold,
            'Net Revenue': row.revenue.toFixed(2),
            'Net Profit': row.profitLoss.toFixed(2),
            'Payment Mode': row.paymentMode,
            'Added By': row.addedBy
        }));
        downloadCSV(csvData, `store_sales_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800">Store Sales Dashboard</h2>
                <p className="text-xs text-slate-500">Live sales summary by category</p>
            </div>
            
            {/* Controls Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                    
                    {/* Left: Search & Category Filter */}
                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="w-full md:w-64">
                            <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search Order ID or Phone..." />
                        </div>
                        
                        {/* CATEGORY FILTER DROPDOWN */}
                        <div className="relative">
                            <select
                                className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-40 appearance-none cursor-pointer hover:border-emerald-400 transition-colors"
                                value={catFilter}
                                onChange={e => setCatFilter(e.target.value)}
                            >
                                <option value="">All Categories</option>
                                {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                            <Filter size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Right: Date & Export */}
                    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <div className="flex items-center bg-white border rounded px-2 py-1 gap-2 w-full md:w-auto justify-between md:justify-start">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">History:</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <span className="text-slate-300">-</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                        
                        <button 
                            onClick={handleExport} 
                            className="flex items-center justify-center gap-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-full md:w-auto"
                        >
                            <Download size={16} /> Export
                        </button>
                    </div>
                </div>

                {/* Data Table */}
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[1000px]">
                        <thead className="bg-white text-slate-600 font-bold border-b text-xs uppercase sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 bg-slate-50">Code</th>
                                <th className="p-3 bg-slate-50">Category</th>
                                <th className="p-3 bg-slate-50 text-center">Stock</th>
                                <th className="p-3 bg-slate-50 text-right">Cost</th>
                                <th className="p-3 bg-slate-50 text-center">Sold Qty</th>
                                <th className="p-3 bg-slate-50 text-right">Revenue</th>
                                <th className="p-3 bg-slate-50 text-right">Profit</th>
                                <th className="p-3 bg-slate-50">Payment</th>
                                <th className="p-3 bg-slate-50">Added By</th>
                                <th className="p-3 bg-slate-50 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {salesData.map((row) => (
                                <tr key={row.uniqueKey} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(row.originalOrder)}>
                                    <td className="p-3 font-medium text-slate-800">
                                        {row.code}
                                        <div className="text-[10px] text-slate-400 font-normal">{row.date}</div>
                                        <div className="text-[10px] text-slate-500">{row.orderId}</div>
                                    </td>
                                    <td className="p-3 text-slate-600">{row.category}</td>
                                    <td className="p-3 text-center text-slate-600">{row.unitStock}</td>
                                    <td className="p-3 text-right text-slate-600">৳{row.costUnit.toFixed(0)}</td>
                                    <td className="p-3 text-center font-medium text-slate-800">{row.unitSold}</td>
                                    <td className="p-3 text-right text-emerald-700 font-medium">৳{row.revenue.toFixed(2)}</td>
                                    <td className={`p-3 text-right font-bold ${row.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {row.profitLoss.toFixed(2)}
                                    </td>
                                    <td className="p-3 text-xs text-slate-500">{row.paymentMode}</td>
                                    <td className="p-3 text-xs text-slate-500">{row.addedBy}</td>
                                    <td className="p-3 text-center flex justify-center gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(row.originalOrder); }} className="text-blue-500 hover:bg-blue-50 p-1 rounded"><Edit size={16} /></button>
                                        <button onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if(confirm('Delete this sale? Stock will be returned.')) onDelete(row.id); 
                                        }} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16} /></button>
                                    </td>
                                </tr>
                            ))}
                            {salesData.length === 0 && (
                                <tr><td colSpan="10" className="p-10 text-center text-slate-400">No store sales found.</td></tr>
                            )}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                            <tr>
                                <td className="p-3" colSpan="4">TOTALS</td>
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

            {/* Popup */}
            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={() => 'text-purple-600 bg-purple-50'}
                    onEdit={onEdit} 
                />
            )}
        </div>
    );
};

export default StoreSalesTab;