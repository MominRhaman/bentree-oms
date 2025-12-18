import React, { useState, useMemo } from 'react';
import { Download, Filter } from 'lucide-react';
import SearchBar from './SearchBar';
import OrderDetailsPopup from './OrderDetailsPopup';
import { INVENTORY_CATEGORIES, downloadCSV } from '../utils';

const SalesReports = ({ orders, inventory }) => {
    // --- Filter States ---
    const [searchTerm, setSearchTerm] = useState('');
    const [catFilter, setCatFilter] = useState('');
    const [platformFilter, setPlatformFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // --- UI States ---
    const [selectedOrder, setSelectedOrder] = useState(null);

    // --- MAIN DATA CALCULATION ---
    const { stats, salesData, totals } = useMemo(() => {
        // 1. Base Filtering (Search, Date, Platform)
        // We do NOT apply Category filter here yet, because Delivery/Returns are Order-level, not Item-level.
        let filteredOrders = orders || [];

        if (startDate) filteredOrders = filteredOrders.filter(o => o.date >= startDate);
        if (endDate) filteredOrders = filteredOrders.filter(o => o.date <= endDate);
        
        // Platform Filter
        if (platformFilter && platformFilter !== "") {
            filteredOrders = filteredOrders.filter(o => (o.orderSource || '') === platformFilter);
        }

        // Search Filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredOrders = filteredOrders.filter(o =>
                (o.recipientPhone || '').includes(term) ||
                (o.recipientName || '').toLowerCase().includes(term) ||
                (o.merchantOrderId || '').toLowerCase().includes(term) ||
                (o.storeOrderId || '').toLowerCase().includes(term)
            );
        }

        const safeNum = (v) => Number(v) || 0;

        // 2. Identify "Realized" Orders (Actual Money In)
        const onlineDelivered = filteredOrders.filter(o => o.type === 'Online' && o.status === 'Delivered');
        const storeCompleted = filteredOrders.filter(o => o.type === 'Store' && o.status === 'Completed');
        const returns = filteredOrders.filter(o => o.type === 'Online' && o.status === 'Returned');

        // 3. Generate Table Rows (Product Level Data) & Apply Category Filter
        const data = [];
        
        // Combine Online Delivered & Store Completed for the Product Table
        const realizedOrders = [...onlineDelivered, ...storeCompleted];

        realizedOrders.forEach(order => {
            const orderId = order.type === 'Store' ? order.storeOrderId : order.merchantOrderId;
            const salesBy = order.type === 'Online' ? order.orderSource : (order.storePaymentMode || 'Store');
            const addedBy = order.addedBy || 'System';

            // --- Advanced Revenue Distribution Logic ---
            const orderSubtotal = safeNum(order.subtotal);
            const orderDiscount = safeNum(order.discountValue);
            const revenueAdjustment = Math.abs(safeNum(order.revenueAdjustment)); // E.g. Short payment
            
            const totalDeductions = orderDiscount + revenueAdjustment;

            (order.products || []).forEach(prod => {
                const invItem = inventory.find(i => i.code.toUpperCase() === (prod.code || '').toUpperCase());
                const category = invItem ? invItem.category : 'N/A';

                // --- CATEGORY FILTERING APPLIED HERE ---
                if (catFilter && catFilter !== "" && category !== catFilter) return;

                const unitCost = invItem ? safeNum(invItem.unitCost) : 0;
                
                // Inventory State
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

                // --- Item Math ---
                const grossItemRevenue = salePrice * qty;
                
                // Calculate Pro-rated Deduction for this item
                const ratio = orderSubtotal > 0 ? (grossItemRevenue / orderSubtotal) : 0;
                const itemDeductionShare = totalDeductions * ratio;

                const netRevenue = grossItemRevenue - itemDeductionShare;
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
                    salesBy: salesBy,
                    addedBy: addedBy,
                    originalOrder: order,
                    type: order.type
                });
            });
        });

        // 4. Calculate Stats (Dynamic based on filtered data)
        
        // Summing up from 'data' ensures Category Filter is respected for Sales
        const netProductSales = data.filter(d => d.type === 'Online').reduce((acc, item) => acc + item.revenue, 0);
        const storeSales = data.filter(d => d.type === 'Store').reduce((acc, item) => acc + item.revenue, 0);

        // (Usually delivery fee isn't "categorized" by product, so we keep order-level sums)
        const deliveryIncome = onlineDelivered.reduce((acc, o) => acc + safeNum(o.deliveryCharge), 0);
        
        const returnDeliveryLoss = returns.reduce((acc, o) => 
            !o.isDeliveryFeeReceived ? acc + safeNum(o.deliveryCharge) : acc, 0);

        // UPDATED FORMULA: (Sales + Delivery) - Return Loss
        const totalRevenue = (netProductSales + storeSales + deliveryIncome) - returnDeliveryLoss;

        // 5. Calculate Table Footer Totals
        const totals = data.reduce((acc, row) => ({
            unitSold: acc.unitSold + row.unitSold,
            revenue: acc.revenue + row.revenue,
            profitLoss: acc.profitLoss + row.profitLoss
        }), { unitSold: 0, revenue: 0, profitLoss: 0 });

        return {
            stats: { netProductSales, storeSales, deliveryIncome, returnDeliveryLoss, totalRevenue },
            salesData: data,
            totals
        };
    }, [orders, inventory, startDate, endDate, searchTerm, catFilter, platformFilter]);

    // --- Handlers ---
    const handleExport = () => {
        const csvData = salesData.map(row => ({
            Date: row.date,
            'Order ID': row.orderId,
            Code: row.code,
            Category: row.category,
            'Unit Sold': row.unitSold,
            'Net Revenue': row.revenue.toFixed(2),
            'Net Profit': row.profitLoss.toFixed(2),
            'Sales Source': row.salesBy,
            'Added By': row.addedBy
        }));
        downloadCSV(csvData, `sales_report_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800">Sales Reports Dashboard</h2>
                <p className="text-xs text-slate-500">Live reports summary by category</p>
            </div>

            {/* 1. Summary Cards Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Net Online Sales</h3>
                    <p className="text-xl font-bold text-emerald-700">৳{stats.netProductSales.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                    <p className="text-[10px] text-emerald-600/70 mt-1">Delivered Items</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Store Sales</h3>
                    <p className="text-xl font-bold text-purple-700">৳{stats.storeSales.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                    <p className="text-[10px] text-purple-600/70 mt-1">Completed Items</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Delivery Income</h3>
                    <p className="text-xl font-bold text-blue-700">৳{stats.deliveryIncome.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Return Loss</h3>
                    <p className="text-xl font-bold text-red-700">৳{stats.returnDeliveryLoss.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                    <p className="text-[10px] text-red-600/70 mt-1">Unpaid Delivery Fees</p>
                </div>
                <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Total Cash In</h3>
                    <p className="text-xl font-bold text-slate-800">৳{stats.totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                </div>
            </div>

            {/* 2. Controls & Filters Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                    
                    {/* Left Side: Filters */}
                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="w-full md:w-64">
                            <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search product, phone, or ID..." />
                        </div>
                        
                        {/* Platform Filter */}
                        <div className="relative">
                            <select
                                className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-40 appearance-none cursor-pointer hover:border-emerald-400 transition-colors"
                                value={platformFilter}
                                onChange={e => setPlatformFilter(e.target.value)}
                            >
                                <option value="">All Platforms</option>
                                <option value="Facebook">Facebook</option>
                                <option value="Instagram">Instagram</option>
                                <option value="Whatsapp">Whatsapp</option>
                                <option value="Website">Website</option>
                                <option value="Daraz">Daraz</option>
                                <option value="Other">Other</option>
                            </select>
                            <Filter size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                        </div>

                        {/* Category Filter */}
                        <select
                            className="p-2 border rounded text-sm bg-white outline-none w-full md:w-40 cursor-pointer hover:border-emerald-400 transition-colors"
                            value={catFilter}
                            onChange={e => setCatFilter(e.target.value)}
                        >
                            <option value="">All Categories</option>
                            {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                    </div>

                    {/* Right Side: Actions & Date */}
                    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <div className="flex items-center bg-white border rounded px-2 py-1 gap-2 w-full md:w-auto justify-between md:justify-start">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">History:</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <span className="text-slate-300">-</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                        
                        <div className="flex gap-2 w-full md:w-auto">
                            <button 
                                onClick={handleExport} 
                                className="flex items-center justify-center gap-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-1/2 md:w-auto"
                            >
                                <Download size={16} /> Export
                            </button>
                        </div>
                    </div>
                </div>

                {/* 3. Detailed Data Table (Sticky Header + Footer Totals) */}
                <div className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-sm text-left min-w-[1000px]">
                        <thead className="bg-white text-slate-600 font-bold border-b text-xs uppercase sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 bg-slate-50">Code</th>
                                <th className="p-3 bg-slate-50">Category</th>
                                <th className="p-3 bg-slate-50 text-center">Unit (Stock)</th>
                                <th className="p-3 bg-slate-50 text-right">Cost (Unit)</th>
                                <th className="p-3 bg-slate-50 text-right">Total Asset</th>
                                <th className="p-3 bg-slate-50 text-center">Sold Qty</th>
                                <th className="p-3 bg-slate-50 text-right">Net Revenue</th>
                                <th className="p-3 bg-slate-50 text-right">Net Profit</th>
                                <th className="p-3 bg-slate-50">Sales Source</th>
                                <th className="p-3 bg-slate-50">Added By</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {salesData.map((row) => (
                                <tr key={row.uniqueKey} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(row.originalOrder)}>
                                    <td className="p-3 font-medium text-slate-800">
                                        {row.code}
                                        <div className="text-[10px] text-slate-400 font-normal">{row.date}</div>
                                    </td>
                                    <td className="p-3 text-slate-600">{row.category}</td>
                                    <td className="p-3 text-center text-slate-600">{row.unitStock}</td>
                                    <td className="p-3 text-right text-slate-600">৳{row.costUnit.toFixed(2)}</td>
                                    <td className="p-3 text-right text-slate-400">৳{row.totalValue.toFixed(0)}</td>
                                    <td className="p-3 text-center font-medium text-slate-800">{row.unitSold}</td>
                                    
                                    <td className="p-3 text-right text-emerald-700 font-medium">
                                        ৳{row.revenue.toFixed(2)}
                                    </td>
                                    
                                    <td className={`p-3 text-right font-bold ${row.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {row.profitLoss.toFixed(2)}
                                    </td>
                                    
                                    <td className="p-3 text-xs text-slate-500 truncate max-w-[100px]" title={row.salesBy}>
                                        {row.salesBy}
                                    </td>
                                    <td className="p-3 text-xs text-slate-500 truncate max-w-[100px]" title={row.addedBy}>
                                        {row.addedBy}
                                    </td>
                                </tr>
                            ))}
                            {salesData.length === 0 && (
                                <tr>
                                    <td colSpan="10" className="p-10 text-center text-slate-400">
                                        No finalized sales found. (Only Delivered/Completed orders appear here).
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700 z-10">
                            <tr>
                                <td className="p-3" colSpan="5">TOTALS</td>
                                <td className="p-3 text-center">{totals.unitSold}</td>
                                <td className="p-3 text-right text-emerald-800">৳{totals.revenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                <td className={`p-3 text-right ${totals.profitLoss >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                                    ৳{totals.profitLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                </td>
                                <td className="p-3" colSpan="2"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Order Details Popup */}
            {selectedOrder && (
                <OrderDetailsPopup
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    getStatusColor={(status) => {
                        switch (status) {
                            case 'Delivered': return 'text-green-600 bg-green-50';
                            case 'Completed': return 'text-purple-600 bg-purple-50';
                            default: return 'text-slate-600 bg-slate-50';
                        }
                    }}
                    onEdit={() => {}} 
                />
            )}
        </div>
    );
};

export default SalesReports;