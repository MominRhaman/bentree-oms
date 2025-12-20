import React, { useState, useMemo } from 'react';
import { Calendar, Download, Trash2, RefreshCw, Ban } from 'lucide-react';
import OrderDetailsPopup from './OrderDetailsPopup';
import SearchBar from './SearchBar';
import { getStatusColor, downloadCSV } from '../utils';

const CancelledOrders = ({ orders, onUpdate, onDelete, onEdit }) => {
    // --- States ---
    const [filterDate, setFilterDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);

    // --- Filter Logic (Fixed: Broad Match) ---
    const filteredOrders = useMemo(() => {
        let res = orders.filter(o => {
            if (!o.status) return false;
            const s = o.status.toLowerCase();
            // CHECK ROOT WORDS: "return" catches Returned/Return, "cancel" catches Cancelled/Cancel
            return s.includes('return') || s.includes('cancel');
        });
        
        if (filterDate) res = res.filter(o => o.date === filterDate);
        
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            res = res.filter(o =>
                (o.recipientPhone && o.recipientPhone.toLowerCase().includes(term)) ||
                (o.recipientName && o.recipientName.toLowerCase().includes(term)) ||
                (o.merchantOrderId && o.merchantOrderId.toLowerCase().includes(term)) ||
                (o.storeOrderId && o.storeOrderId.toLowerCase().includes(term))
            );
        }
        return res;
    }, [orders, filterDate, searchTerm]);

    // --- Handlers ---
    const handleExport = () => {
        const data = filteredOrders.map(o => ({
            Date: o.date,
            'Order ID': o.merchantOrderId || o.storeOrderId,
            'Customer Name': o.recipientName,
            'Phone': o.recipientPhone,
            'Status': o.status,
            'Reason/Note': o.note || o.history?.[o.history.length - 1]?.note || '-'
        }));
        downloadCSV(data, 'cancelled_returned_orders.csv');
    };

    const handleRestore = (order) => {
        if (confirm(`Restore order #${order.merchantOrderId || order.storeOrderId} to Pending?`)) {
            onUpdate(order.id, 'Pending', {
                note: 'Restored from Cancelled/Returned'
            });
        }
    };

    // Helper for badge color to ensure high visibility
    const getBadgeColor = (statusRaw) => {
        const s = (statusRaw || '').toLowerCase();
        if (s.includes('return')) return 'bg-red-100 text-red-800 border border-red-200';
        if (s.includes('cancel')) return 'bg-slate-100 text-slate-600 border border-slate-200';
        return getStatusColor(statusRaw);
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Cancelled & Returned</h2>
                    <p className="text-xs text-slate-500">Manage failed deliveries and returns</p>
                </div>
                
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="w-full md:w-64">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search Orders..." />
                    </div>
                    <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                        <Calendar size={18} className="text-slate-500" />
                        <input type="date" className="bg-transparent text-sm w-full outline-none" onChange={(e) => setFilterDate(e.target.value)} />
                    </div>
                    <button onClick={handleExport} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium text-sm p-2 rounded w-full md:w-auto transition-colors">
                        <Download size={16} /> Export
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[800px]">
                    <thead className="bg-slate-50 text-slate-600 font-medium border-b">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Order ID</th>
                            <th className="p-3">Customer</th>
                            <th className="p-3">Items (Product)</th>
                            <th className="p-3">Status</th>
                            <th className="p-3 text-right">Amount</th>
                            <th className="p-3 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => (
                            <tr 
                                key={order.id} 
                                className="border-b hover:bg-slate-50 cursor-pointer"
                                onClick={() => setSelectedOrder(order)}
                            >
                                <td className="p-3">{order.date}</td>
                                <td className="p-3 font-mono text-xs">{order.merchantOrderId || order.storeOrderId}</td>
                                <td className="p-3">
                                    <div className="font-medium">{order.recipientName}</div>
                                    <div className="text-xs text-slate-500">{order.recipientPhone}</div>
                                </td>
                                <td className="p-3 text-xs text-slate-700">
                                    {(order.products || []).map((p, i) => (
                                        <div key={i} className="font-medium">
                                            {p.qty}x <span className="text-slate-900">{p.code}</span> <span className="text-slate-500">({p.size})</span>
                                        </div>
                                    ))}
                                </td>
                                <td className="p-3">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${getBadgeColor(order.status)}`}>
                                        {order.status}
                                    </span>
                                </td>
                                <td className="p-3 text-right font-medium">
                                    ৳{order.grandTotal}
                                </td>
                                <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex justify-center gap-2">
                                        {/* RESTORE BUTTON */}
                                        <button 
                                            onClick={() => handleRestore(order)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                            title="Restore to Pending"
                                        >
                                            <RefreshCw size={16} />
                                        </button>
                                        
                                        {/* CANCEL BUTTON (Hidden if already Cancelled) */}
                                        {!(order.status || '').toLowerCase().includes('cancel') && (
                                            <button 
                                                onClick={() => { if(confirm('Mark as Cancelled?')) onUpdate(order.id, 'Cancelled'); }}
                                                className="p-1.5 text-orange-600 hover:bg-orange-50 rounded"
                                                title="Mark as Cancelled"
                                            >
                                                <Ban size={16} />
                                            </button>
                                        )}

                                        {/* DELETE BUTTON */}
                                        <button 
                                            onClick={() => { if(confirm('Permanently delete?')) onDelete(order.id); }}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                            title="Delete Permanently"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredOrders.length === 0 && (
                            <tr>
                                <td colSpan="7" className="p-8 text-center text-slate-400">
                                    No cancelled or returned orders found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={getBadgeColor} 
                    onEdit={onEdit} 
                />
            )}
        </div>
    );
};

export default CancelledOrders;