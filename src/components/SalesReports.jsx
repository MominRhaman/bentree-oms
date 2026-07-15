import React, { useState, useMemo } from 'react';
import { Download, Filter, MapPin } from 'lucide-react';
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
    const [locationFilter, setLocationFilter] = useState('');

    // --- UI States ---
    const [selectedOrder, setSelectedOrder] = useState(null);

    // --- MAIN DATA CALCULATION ---
    const { stats, salesData, totals } = useMemo(() => {
        let filteredOrders = orders || [];

        // 1. Date Filter
        if (startDate) filteredOrders = filteredOrders.filter(o => o.date >= startDate);
        if (endDate) filteredOrders = filteredOrders.filter(o => o.date <= endDate);

        // 2. Platform Filter
        if (platformFilter && platformFilter !== "") {
            if (platformFilter === 'Store') {
                filteredOrders = filteredOrders.filter(o => o.type === 'Store');
            } else {
                filteredOrders = filteredOrders.filter(o => (o.orderSource || '') === platformFilter);
            }
        }

        // 3. Search Filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredOrders = filteredOrders.filter(o =>
                (o.recipientPhone || '').includes(term) ||
                (o.recipientName || '').toLowerCase().includes(term) ||
                (o.merchantOrderId || '').toLowerCase().includes(term) ||
                (o.storeOrderId || '').toLowerCase().includes(term)
            );
        }

        // 4. Location Filter
        const getOrderZone = (order) => {
            if (order.deliveryZone) return order.deliveryZone;
            const city = (order.recipientCity || '').toLowerCase().trim();
            if (!city) return 'Store Sales';
            return city === 'dhaka' ? 'Inside Dhaka' : 'Outside Dhaka';
        };
        if (locationFilter && locationFilter !== "") {
            filteredOrders = filteredOrders.filter(o => getOrderZone(o) === locationFilter);
        }

        const safeNum = (v) => Number(v) || 0;

        // 4. Identify Orders (Using String() wrapper to prevent crashes)
        const onlineDelivered = filteredOrders.filter(o =>
            o.type === 'Online' && String(o.status || '').toLowerCase() === 'delivered'
        );
        const returns = filteredOrders.filter(o =>
            o.type === 'Online' && String(o.status || '').toLowerCase() === 'returned'
        );

        // 5. Generate Table Rows & Calculate Totals
        const realizedOrders = filteredOrders.filter(o => {
            const status = String(o.status || '').toLowerCase(); // FIX APPLIED HERE
            const isOnlineDelivered = o.type === 'Online' && status === 'delivered';
            const isStoreValid = o.type === 'Store' && status !== 'cancelled' && status !== 'returned';

            return isOnlineDelivered || isStoreValid;
        });

        const data = [];
        const uniqueOrderIds = new Set();
        let totalDiscount = 0;

        realizedOrders.forEach(order => {
            uniqueOrderIds.add(order.id);
            const orderId = order.type === 'Store' ? order.storeOrderId : order.merchantOrderId;
            const salesBy = order.type === 'Store' ? 'Store' : (order.orderSource || 'Online');
            const addedBy = order.addedBy || 'System';

            const orderSubtotal = safeNum(order.subtotal);

            // --- Discount Calculation ---
            let orderDiscount = safeNum(order.discountValue);
            if (order.discountType === 'Percent') {
                orderDiscount = orderSubtotal * (orderDiscount / 100);
            }

            if (order.orderSource === 'WooCommerce' || order.source === 'WooCommerce') {
                // WooCommerce: sale-price orders store prod.price = sale price and prod.discountValue = 0.
                // Derive the actual discount the same way OrderDetailsPopup does: (mrp - price) × qty.
                (order.products || []).forEach(p => {
                    let prodDiscount = safeNum(p.discountValue);
                    if (!prodDiscount) {
                        const invItem = inventory.find(i => i.code.toUpperCase() === (p.code || '').toUpperCase());
                        const mrp = invItem ? safeNum(invItem.mrp) : 0;
                        const price = safeNum(p.price);
                        if (mrp > price && price > 0) {
                            prodDiscount = (mrp - price) * safeNum(p.qty);
                        }
                    }
                    orderDiscount += prodDiscount;
                });
            } else {
                // OMS / Store orders: sum per-product discounts.
                // Products with no discount contribute 0; only discounted products count.
                (order.products || []).forEach(p => {
                    const prodDiscountValue = safeNum(p.discountValue);
                    if (!prodDiscountValue) return;
                    const basePrice = safeNum(p.price) * safeNum(p.qty);
                    const prodDiscount = p.discountType === 'Percent'
                        ? basePrice * (prodDiscountValue / 100)
                        : prodDiscountValue;
                    orderDiscount += prodDiscount;
                });
            }

            // --- UPDATED: Include Deductions in Total Discount ---
            const revenueAdjustment = Math.abs(safeNum(order.revenueAdjustment));

            // Add both standard discount AND manual deduction to the total stat
            totalDiscount += (orderDiscount + revenueAdjustment);

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

            data.push({
                uniqueKey: order.id,
                id: order.id,
                date: order.date,
                orderId,
                products: order.products || [],
                unitSold: totalQty,
                revenue: orderNetRevenue,
                profitLoss: orderNetRevenue - totalCOGS,
                discount: orderDiscount + revenueAdjustment,
                zone: getOrderZone(order),
                salesBy,
                addedBy,
                originalOrder: order,
                type: order.type
            });
        });

        // Zone Breakdown
        const zoneBreakdown = {};
        data.forEach(row => {
            const z = row.zone;
            if (!zoneBreakdown[z]) zoneBreakdown[z] = { orderCount: 0, unitSold: 0, revenue: 0, discount: 0, profitLoss: 0 };
            zoneBreakdown[z].orderCount += 1;
            zoneBreakdown[z].unitSold += row.unitSold;
            zoneBreakdown[z].revenue += row.revenue;
            zoneBreakdown[z].discount += row.discount;
            zoneBreakdown[z].profitLoss += row.profitLoss;
        });

        // 6. Calculate Stats
        const netProductSales = data.filter(d => d.type === 'Online').reduce((acc, item) => acc + item.revenue, 0);
        const storeSales = data.filter(d => d.type === 'Store').reduce((acc, item) => acc + item.revenue, 0);

        // --- UPDATED DELIVERY LOGIC START ---

        // A. Baseline Income: Only count Delivered orders
        let deliveryIncome = onlineDelivered.reduce((acc, o) => acc + safeNum(o.deliveryCharge), 0);
        let returnDeliveryLoss = 0;

        // B. Process Returns Logic
        returns.forEach(o => {
            const currentCharge = safeNum(o.deliveryCharge);

            if (currentCharge > 0) {
                // If delivery charge exists (>0), it means it was paid. Add to Income.
                deliveryIncome += currentCharge;
            } else {
                // If delivery charge is 0, we take the ORIGINAL charge and add to Loss.
                const originalCharge = safeNum(o.originalDeliveryCharge);
                returnDeliveryLoss += originalCharge;
            }
        });

        // --- UPDATED DELIVERY LOGIC END ---

        // Total Cash In = (Net Online Sales + Store Sales) - Return Loss
        const totalRevenue = (netProductSales + storeSales) - returnDeliveryLoss;

        const totals = data.reduce((acc, row) => ({
            unitSold: acc.unitSold + row.unitSold,
            revenue: acc.revenue + row.revenue,
            profitLoss: acc.profitLoss + row.profitLoss
        }), { unitSold: 0, revenue: 0, profitLoss: 0 });

        totals.orderCount = uniqueOrderIds.size;

        return {
            stats: { netProductSales, storeSales, deliveryIncome, returnDeliveryLoss, totalRevenue, totalDiscount, zoneBreakdown },
            salesData: data,
            totals
        };
    }, [orders, inventory, startDate, endDate, searchTerm, catFilter, platformFilter, locationFilter]);

    // --- Handlers ---
    const handleExport = () => {
        const csvData = salesData.map(row => ({
            Date: row.date,
            'Order ID': row.orderId,
            Zone: row.zone,
            Products: (row.products || []).map(p => `${p.code}${p.size ? ` (${p.size})` : ''} x${p.qty}`).join(' | '),
            'Total Qty': row.unitSold,
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

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Net Online Sales</h3>
                    <p className="text-xl font-bold text-emerald-700">৳{stats.netProductSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-emerald-600/70 mt-1">Delivered Items</p>
                </div>

                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Store Sales</h3>
                    <p className="text-xl font-bold text-purple-700">৳{stats.storeSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-purple-600/70 mt-1">Completed Items</p>
                </div>

                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Delivery Income</h3>
                    <p className="text-xl font-bold text-blue-700">৳{stats.deliveryIncome.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-blue-600/70 mt-1">Net Delivery Earnings</p>
                </div>

                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Total Discount</h3>
                    <p className="text-xl font-bold text-orange-700">৳{stats.totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-orange-600/70 mt-1">Given to Customers</p>
                </div>

                <div className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Return Loss</h3>
                    <p className="text-xl font-bold text-red-700">৳{stats.returnDeliveryLoss.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-red-600/70 mt-1">Unpaid Delivery Fees</p>
                </div>

                <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-slate-500 font-bold text-xs mb-1 uppercase">Total Cash In</h3>
                    <p className="text-xl font-bold text-slate-800">৳{stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-slate-500/70 mt-1">Online + Store - Returns</p>
                </div>
            </div>

            {/* Zone Breakdown Cards */}
            {Object.keys(stats.zoneBreakdown || {}).length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {['Inside Dhaka', 'Outside Dhaka', 'Store Sales'].map(zone => {
                        const z = (stats.zoneBreakdown || {})[zone];
                        if (!z) return null;
                        const isInside = zone === 'Inside Dhaka';
                        const isOutside = zone === 'Outside Dhaka';
                        const color = isInside ? 'blue' : isOutside ? 'orange' : 'slate';
                        return (
                            <div key={zone} className={`bg-${color}-50 p-4 rounded-xl border border-${color}-100 shadow-sm`}>
                                <div className="flex items-center gap-2 mb-3">
                                    <MapPin size={14} className={`text-${color}-500`} />
                                    <h3 className={`text-${color}-700 font-bold text-sm`}>{zone}</h3>
                                </div>
                                <div className="grid grid-cols-5 gap-2 text-center">
                                    <div><p className="text-xs text-slate-500 font-bold uppercase">Orders</p><p className={`text-lg font-bold text-${color}-700`}>{z.orderCount}</p></div>
                                    <div><p className="text-xs text-slate-500 font-bold uppercase">Qty</p><p className={`text-lg font-bold text-${color}-700`}>{z.unitSold}</p></div>
                                    <div><p className="text-xs text-slate-500 font-bold uppercase">Revenue</p><p className={`text-sm font-bold text-${color}-700`}>৳{z.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                                    <div><p className="text-xs text-slate-500 font-bold uppercase">Discount</p><p className={`text-sm font-bold text-${color}-700`}>৳{z.discount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                                    <div><p className="text-xs text-slate-500 font-bold uppercase">Profit</p><p className={`text-sm font-bold ${z.profitLoss >= 0 ? `text-${color}-700` : 'text-red-600'}`}>৳{z.profitLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">

                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="w-full md:w-64">
                            <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search product, phone, or ID..." />
                        </div>

                        {/* PLATFORM FILTER */}
                        <div className="relative">
                            <select
                                className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-40 appearance-none cursor-pointer hover:border-emerald-400 transition-colors"
                                value={platformFilter}
                                onChange={e => setPlatformFilter(e.target.value)}
                            >
                                <option value="">All Platforms</option>
                                <option value="Store">Store Sales</option>
                                <option value="WooCommerce">WooCommerce</option>
                                <option value="Facebook">Facebook</option>
                                <option value="Instagram">Instagram</option>
                                <option value="Whatsapp">Whatsapp</option>
                                <option value="Website">Website</option>
                                <option value="Daraz">Daraz</option>
                                <option value="Other">Other</option>
                            </select>
                            <Filter size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                        </div>

                        <select
                            className="p-2 border rounded text-sm bg-white outline-none w-full md:w-40 cursor-pointer hover:border-emerald-400 transition-colors"
                            value={catFilter}
                            onChange={e => setCatFilter(e.target.value)}
                        >
                            <option value="">All Categories</option>
                            {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>

                        {/* LOCATION FILTER */}
                        <div className="relative">
                            <select
                                className="p-2 pl-8 border rounded text-sm bg-white outline-none w-full md:w-44 appearance-none cursor-pointer hover:border-emerald-400 transition-colors"
                                value={locationFilter}
                                onChange={e => setLocationFilter(e.target.value)}
                            >
                                <option value="">All Locations</option>
                                <option value="Inside Dhaka">Inside Dhaka</option>
                                <option value="Outside Dhaka">Outside Dhaka</option>
                            </select>
                            <MapPin size={14} className="absolute left-2.5 top-3 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <div className="flex items-center bg-white border rounded px-2 py-1 gap-2 w-full md:w-auto justify-between md:justify-start">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">History:</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <span className="text-slate-300">-</span>
                            <input type="date" className="text-xs outline-none text-slate-600 bg-transparent cursor-pointer" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>

                        <button
                            onClick={handleExport}
                            className="flex items-center justify-center gap-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded text-sm font-medium transition-colors w-1/2 md:w-auto"
                        >
                            <Download size={16} /> Export
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-sm text-left min-w-[950px]">
                        <thead className="bg-white text-slate-600 font-bold border-b text-xs uppercase sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 bg-slate-50">Order</th>
                                <th className="p-3 bg-slate-50">Zone</th>
                                <th className="p-3 bg-slate-50">Products</th>
                                <th className="p-3 bg-slate-50 text-center">Total Qty</th>
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
                                        {row.orderId || '-'}
                                        <div className="text-[10px] text-slate-400 font-normal">{row.date}</div>
                                    </td>
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${row.zone === 'Inside Dhaka' ? 'bg-blue-100 text-blue-700' : row.zone === 'Outside Dhaka' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {row.zone}
                                        </span>
                                    </td>
                                    <td className="p-3 text-xs text-slate-600">
                                        {(row.products || []).map((p, i) => (
                                            <div key={i}>{p.code}{p.size ? ` (${p.size})` : ''} ×{p.qty}</div>
                                        ))}
                                    </td>
                                    <td className="p-3 text-center font-medium text-slate-800">{row.unitSold}</td>
                                    <td className="p-3 text-right text-emerald-700 font-medium">৳{row.revenue.toFixed(2)}</td>
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
                                    <td colSpan="8" className="p-10 text-center text-slate-400">
                                        No finalized sales found. (Only Delivered/Completed orders appear here).
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                            <tr>
                                <td className="p-3 text-right uppercase text-xs text-slate-500" colSpan="3">
                                    Total Orders: <span className="text-slate-900 text-sm ml-1">{totals.orderCount}</span> | TOTALS
                                </td>
                                <td className="p-3 text-center">{totals.unitSold}</td>
                                <td className="p-3 text-right text-emerald-800">৳{totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className={`p-3 text-right ${totals.profitLoss >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                                    ৳{totals.profitLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="p-3" colSpan="2"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

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
                    onEdit={() => { }}
                />
            )}
        </div>
    );
};

export default React.memo(SalesReports);