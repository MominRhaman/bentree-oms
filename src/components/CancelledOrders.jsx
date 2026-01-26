import React, { useState, useMemo } from 'react';
import { Calendar, Download, Trash2, RefreshCw, Ban, CheckCircle, Clock } from 'lucide-react';
import { doc, deleteDoc } from "firebase/firestore";
import { getStatusColor, downloadCSV } from '../utils';

// IMPORTANT: Using db from your firebase configuration
import { db } from "../firebase";
import OrderDetailsPopup from './OrderDetailsPopup';
import SearchBar from './SearchBar';

const CancelledOrders = ({ orders, onUpdate, onDelete, onEdit, onCreate, inventory, userRole }) => {
    // --- States ---
    const [filterDate, setFilterDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Local state to hide rows immediately after deletion
    const [deletedIds, setDeletedIds] = useState(new Set());

    // --- Filter Logic ---
    const filteredOrders = useMemo(() => {
        let res = orders.filter(o => {
            // 1. Immediately hide items that were just deleted
            if (deletedIds.has(o.id)) return false;

            if (!o.status) return false;
            const s = o.status.toLowerCase();
            // Match 'returned', 'return', 'cancelled', 'cancel'
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
    }, [orders, filterDate, searchTerm, deletedIds]);

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
        if (window.confirm(`Restore order #${order.merchantOrderId || order.storeOrderId} to Pending?`)) {
            onUpdate(order.id, 'Pending', {
                note: 'Restored from Cancelled/Returned'
            });
        }
    };

    // --- DELETE LOGIC ---
    const processDelete = async (orderId) => {
        const confirmed = window.confirm('⚠️ Are you sure you want to PERMANENTLY delete this order?\n\nThis cannot be undone.');
        if (!confirmed) return;

        try {
            setDeletedIds(prev => {
                const newSet = new Set(prev);
                newSet.add(orderId);
                return newSet;
            });
            if (onDelete) onDelete(orderId);
        } catch (error) {
            console.error("Delete failed:", error);
            alert("Error deleting order: " + error.message);
        }
    };

    // Helper for badge color
    const getBadgeColor = (order) => {
        // REQUIREMENT: Change status color from red to green when Return (isReturnReceived) is checked
        if (order.isReturnReceived) return 'bg-green-100 text-green-800 border border-green-200';
        if (order.isRefunded) return 'bg-emerald-50 text-emerald-700 border border-emerald-200';

        const s = (order.status || '').toLowerCase();
        if (s.includes('return')) return 'bg-red-100 text-red-800 border border-red-200';
        if (s.includes('cancel')) return 'bg-slate-100 text-slate-600 border border-slate-200';
        return getStatusColor(order.status);
    };

    // --- Access Control Robust Check ---
    const isMasterUser = String(userRole || '').trim().toLowerCase() === 'master';

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
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b">
                        <tr>
                            <th className="p-3 w-10 text-center">Return</th>
                            <th className="p-3">Date</th>
                            <th className="p-3">Order ID</th>
                            <th className="p-3">Customer</th>
                            <th className="p-3">Items (Product)</th>
                            <th className="p-3 text-center">Status</th>
                            <th className="p-3 text-right">Amount / Refund</th>
                            <th className="p-3 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            // Fix: Show original products if current products list is empty (Full Return)
                            let displayProducts = [...(order.products || [])];

                            if (displayProducts.length === 0) {
                                if (order.exchangeDetails?.originalProducts) {
                                    displayProducts = [...order.exchangeDetails.originalProducts];
                                } else if (order.history) {
                                    // Extract products from the history note snippet we saved during 'Confirm Return'
                                    const lastProductNote = [...order.history].reverse().find(h => h.note && h.note.includes('Products: {'));
                                    if (lastProductNote) {
                                        const match = lastProductNote.note.match(/\[Code: (.*?) \| Size: (.*?) \| Qty: (.*?)\]/g);
                                        if (match) {
                                            displayProducts = match.map(m => {
                                                const parts = m.match(/\[Code: (.*?) \| Size: (.*?) \| Qty: (.*?)\]/);
                                                return { code: parts[1], size: parts[2], qty: parts[3] };
                                            });
                                        }
                                    }
                                }
                            } else if (order.exchangeDetails?.originalProducts) {
                                order.exchangeDetails.originalProducts.forEach(op => {
                                    if (!displayProducts.some(dp => dp.code === op.code)) {
                                        displayProducts.push(op);
                                    }
                                });
                            }

                            const isReceived = order.isReturnReceived === true;

                            return (
                                <tr
                                    key={order.id}
                                    className={`border-b hover:bg-slate-50 cursor-pointer transition-colors ${isReceived ? 'bg-green-50/20' : ''}`}
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    {/* REQUIREMENT: Return Checkbox under Return Column */}
                                    <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={order.isReturnReceived || false}
                                            onChange={(e) => {
                                                onUpdate(order.id, order.status, { isReturnReceived: e.target.checked });
                                            }}
                                            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="p-3 text-slate-500">{order.date?.includes('T') ? order.date.split('T')[0] : order.date}</td>
                                    <td className="p-3 font-mono text-xs font-bold">{order.merchantOrderId || order.storeOrderId}</td>
                                    <td className="p-3">
                                        <div className="font-bold text-slate-700">{order.recipientName}</div>
                                        <div className="text-xs text-slate-500">{order.recipientPhone}</div>
                                    </td>
                                    <td className="p-3 text-xs text-slate-700">
                                        {displayProducts.map((p, i) => (
                                            <div key={i} className="font-medium">
                                                {p.qty}x <span className="text-slate-900">{p.code}</span> <span className="text-slate-500">({p.size})</span>
                                            </div>
                                        ))}
                                    </td>
                                    <td className="p-3 text-center">
                                        <span className={`px-2 py-1 rounded text-xs font-bold transition-all duration-300 ${getBadgeColor(order)}`}>
                                            {order.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="text-xs text-slate-400 line-through">৳{order.grandTotal}</div>

                                            <div className="flex flex-col items-end min-h-[36px]">
                                                {/* REQUIREMENT: Show "Received Product" when checked */}
                                                {isReceived ? (
                                                    <span className="text-green-600 font-black text-[10px] flex items-center gap-1 uppercase mb-1">
                                                        <CheckCircle size={12} className="fill-current" /> Received Product
                                                    </span>
                                                ) : (
                                                    <span className="text-red-600 font-bold text-[10px] flex items-center gap-1 uppercase mb-1 opacity-50">
                                                        <Clock size={12} /> Awaiting Return
                                                    </span>
                                                )}

                                                {order.isRefunded ? (
                                                    <span className="text-emerald-600 font-black text-sm">Refunded</span>
                                                ) : (
                                                    <div className="text-red-600 font-black text-sm">
                                                        Refund: ৳{Math.abs(order.dueAmount || 0)}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 mt-1">
                                                <label className="flex items-center gap-1 cursor-pointer" title="Mark as Refunded">
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Refunded</span>
                                                    <input
                                                        type="checkbox"
                                                        checked={order.isRefunded || false}
                                                        onChange={(e) => {
                                                            onUpdate(order.id, order.status, { isRefunded: e.target.checked });
                                                        }}
                                                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex justify-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRestore(order);
                                                }}
                                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                title="Restore to Pending"
                                            >
                                                <RefreshCw size={16} />
                                            </button>

                                            {!(order.status || '').toLowerCase().includes('cancel') && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm('Mark as Cancelled?')) onUpdate(order.id, 'Cancelled');
                                                    }}
                                                    className="p-1.5 text-orange-600 hover:bg-orange-50 rounded"
                                                    title="Mark as Cancelled"
                                                >
                                                    <Ban size={16} />
                                                </button>
                                            )}

                                            {/* ROLE-BASED ACCESS BUTTON */}
                                            <button
                                                title={isMasterUser ? "Delete Permanently" : "Restricted: Master Access Only"}
                                                disabled={!isMasterUser}
                                                onClick={(e) => {
                                                    if (!isMasterUser) return;
                                                    if (confirm('⚠️ Are you sure you want to PERMANENTLY DELETE this order? This cannot be undone.')) {
                                                        onDelete(order.id);
                                                    }
                                                }}
                                                className={`p-1.5 rounded border border-slate-200 transition-all ${isMasterUser
                                                    ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                                                    : 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-40'
                                                    }`}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {selectedOrder && (
                <OrderDetailsPopup
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    getStatusColor={() => getBadgeColor(selectedOrder)}
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                />
            )}
        </div>
    );
};

export default CancelledOrders;