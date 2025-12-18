import React, { useState, useMemo } from 'react';
import { Calendar, AlertTriangle } from 'lucide-react';
import OrderDetailsPopup from './OrderDetailsPopup';
import { getStatusColor } from '../utils';

const PrimaryOrders = ({ orders, onUpdate, onEdit }) => {
    const [filterDate, setFilterDate] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);

    // 1. Duplicate Logic: Check ALL Pending orders for duplicate phones
    const duplicateIds = useMemo(() => {
        const phoneCounts = {};
        const duplicates = new Set();

        // Filter only relevant orders for duplicate checking (Pending & Online)
        const activeOrders = orders.filter(o => o.status === 'Pending' && o.type === 'Online');

        // Count phone numbers
        activeOrders.forEach(o => {
            if (o.recipientPhone) {
                const phone = o.recipientPhone.trim();
                phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
            }
        });

        // Identify duplicates
        activeOrders.forEach(o => {
            if (o.recipientPhone && phoneCounts[o.recipientPhone.trim()] > 1) {
                duplicates.add(o.id);
            }
        });

        return duplicates;
    }, [orders]);

    // 2. View Filter Logic: Date filtering for display
    const filteredOrders = useMemo(() => {
        let res = orders.filter(o => o.status === 'Pending' || o.status === 'Cancelled');
        if (filterDate) {
            res = res.filter(o => o.date === filterDate);
        }
        return res;
    }, [orders, filterDate]);

    const toggleAttempt = (e, order, attemptNum) => {
        e.stopPropagation();
        const current = order.callAttempts || {};
        const key = `attempt${attemptNum}`;
        onUpdate(order.id, order.status, {
            callAttempts: { ...current, [key]: !current[key] }
        });
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h2 className="text-xl font-bold text-slate-800">Primary Orders</h2>
                
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                        <Calendar size={18} className="text-slate-500" />
                        <input 
                            type="date" 
                            className="bg-transparent text-sm w-full outline-none" 
                            onChange={(e) => setFilterDate(e.target.value)} 
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[900px]">
                    <thead className="bg-slate-50 text-slate-600 font-medium border-b">
                        <tr>
                            <th className="p-3 w-10"></th> {/* Duplicate Indicator Column */}
                            <th className="p-3">Date</th>
                            <th className="p-3">Products</th>
                            <th className="p-3">Recipient</th>
                            <th className="p-3">Call Log</th>
                            <th className="p-3">Total</th>
                            <th className="p-3">Check Out</th>
                            <th className="p-3">Status</th>
                            <th className="p-3 text-center">Actions</th>
                            <th className="p-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            const isDuplicate = duplicateIds.has(order.id);
                            return (
                                <tr
                                    key={order.id}
                                    className={`border-b hover:bg-slate-50 cursor-pointer ${order.status === 'Cancelled' ? 'bg-red-50' : ''} ${isDuplicate ? 'bg-amber-50' : ''}`}
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    {/* Duplicate Icon */}
                                    <td className="p-3 text-center">
                                        {isDuplicate && (
                                            <div className="group relative">
                                                <AlertTriangle size={18} className="text-amber-500 animate-pulse" />
                                                {/* Tooltip */}
                                                <div className="absolute left-6 top-0 bg-slate-800 text-white text-[10px] p-2 rounded w-28 hidden group-hover:block z-20 shadow-lg pointer-events-none">
                                                    Duplicate Phone Number Found
                                                </div>
                                            </div>
                                        )}
                                    </td>

                                    <td className="p-3">{order.date}</td>
                                    
                                    <td className="p-3">
                                        {(order.products || []).map((p, i) => (
                                            <div key={i} className="text-xs font-mono bg-slate-100 rounded px-1 mb-1 inline-block mr-1 text-slate-700 border border-slate-200">
                                                {p.code} ({p.size}) x{p.qty}
                                            </div>
                                        ))}
                                    </td>
                                    
                                    <td className="p-3">
                                        <div className="font-bold text-slate-700">{order.recipientName}</div>
                                        <div className="text-xs text-slate-500 font-mono">{order.recipientPhone}</div>
                                    </td>
                                    
                                    <td className="p-3">
                                        <div className="flex gap-1 mb-1">
                                            {[1, 2, 3].map(num => (
                                                <button
                                                    key={num}
                                                    onClick={(e) => toggleAttempt(e, order, num)}
                                                    className={`w-6 h-6 rounded-full text-xs font-bold border transition-colors ${order.callAttempts?.[`attempt${num}`] ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-400 border-slate-300 hover:border-emerald-400'}`}
                                                    title={`Attempt ${num}`}
                                                >
                                                    {num}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            placeholder="Note..."
                                            className="text-xs border rounded p-1 w-full focus:ring-1 focus:ring-emerald-500 outline-none"
                                            defaultValue={order.callNote || ''}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => onUpdate(order.id, order.status, { callNote: e.target.value })}
                                        />
                                    </td>
                                    
                                    <td className="p-3 font-medium">৳{order.grandTotal}</td>
                                    
                                    <td className="p-3">
                                        <select
                                            className={`border rounded p-1 text-xs ${order.checkOutStatus === 'Completed' ? 'bg-green-100 text-green-700 font-bold' : 'bg-slate-100 text-slate-600'}`}
                                            value={order.checkOutStatus || 'Pending'}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => onUpdate(order.id, order.status, { checkOutStatus: e.target.value })}
                                        >
                                            <option value="Pending">Pending</option>
                                            <option value="Completed">Completed</option>
                                        </select>
                                    </td>
                                    
                                    <td className={`p-3 font-bold text-xs uppercase ${order.status === 'Cancelled' ? 'text-red-600' : 'text-slate-600'}`}>
                                        {order.status}
                                    </td>
                                    
                                    <td className="p-3">
                                        <div className="flex justify-center gap-2">
                                            {order.status !== 'Cancelled' && (
                                                <>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Confirmed'); }}
                                                        className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-200 transition-colors shadow-sm"
                                                    >
                                                        Confirm
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Cancelled'); }}
                                                        className="bg-red-100 text-red-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-red-200 transition-colors shadow-sm"
                                                    >
                                                        Cancel
                                                    </button>
                                                </>
                                            )}
                                            {order.status === 'Cancelled' && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Confirmed'); }}
                                                    className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold hover:bg-emerald-200 border border-emerald-200"
                                                >
                                                    Reconfirm
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    
                                    <td className="p-3">
                                        <input
                                            className="border rounded px-2 py-1 text-xs w-full focus:ring-1 focus:ring-emerald-500 outline-none"
                                            defaultValue={order.remarks}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => onUpdate(order.id, order.status, { remarks: e.target.value })}
                                            placeholder="Remark..."
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                        
                        {filteredOrders.length === 0 && (
                            <tr><td colSpan="10" className="p-8 text-center text-slate-400">No pending orders found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedOrder && (
                <OrderDetailsPopup
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    getStatusColor={getStatusColor}
                    onEdit={onEdit}
                />
            )}
        </div>
    );
};

export default PrimaryOrders;