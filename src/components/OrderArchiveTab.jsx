import React, { useMemo } from 'react';
import { RotateCcw, Archive } from 'lucide-react';
import { getStatusColor } from '../utils';

const OrderArchiveTab = ({ orders, onRestore }) => {
    const archivedOrders = useMemo(() => (
        [...orders].sort((a, b) => {
            const aT = a.archivedAt?.toDate ? a.archivedAt.toDate().getTime() : 0;
            const bT = b.archivedAt?.toDate ? b.archivedAt.toDate().getTime() : 0;
            return bT - aT;
        })
    ), [orders]);

    const getDaysRemaining = (archivedAt) => {
        if (!archivedAt) return 30;
        const t = archivedAt.toDate ? archivedAt.toDate() : new Date(archivedAt);
        return Math.max(0, 30 - Math.floor((Date.now() - t.getTime()) / 86400000));
    };

    const fmtDate = (archivedAt) => {
        if (!archivedAt) return '—';
        const d = archivedAt.toDate ? archivedAt.toDate() : new Date(archivedAt);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    };

    const getOrderId = (order) => order.merchantOrderId || order.storeOrderId || order.id || '—';

    const getProductSummary = (order) => {
        const products = order.products || [];
        if (products.length === 0) return '—';
        const first = products[0];
        const name = first.name || first.code || 'Item';
        return products.length > 1 ? `${name} +${products.length - 1} more` : name;
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Order Archive</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Orders removed from Confirmed and Cancelled &amp; Returned — restore within 30 days
                        </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-center min-w-[80px]">
                        <p className="text-2xl font-bold text-amber-700">{archivedOrders.length}</p>
                        <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wide">Archived</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[1000px]">
                        <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3">Order ID</th>
                                <th className="p-3">Customer</th>
                                <th className="p-3 text-center">Type</th>
                                <th className="p-3 text-center">Status</th>
                                <th className="p-3">Products</th>
                                <th className="p-3 text-right">Total</th>
                                <th className="p-3">Archived On</th>
                                <th className="p-3 text-center">Days Left</th>
                                <th className="p-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {archivedOrders.map(order => {
                                const daysLeft = getDaysRemaining(order.archivedAt);
                                const statusColor = getStatusColor(order.status);
                                return (
                                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3">
                                            <p className="font-mono text-xs font-bold text-slate-700">{getOrderId(order)}</p>
                                            <p className="text-[10px] text-slate-400">{order.date || '—'}</p>
                                        </td>
                                        <td className="p-3">
                                            <p className="font-medium text-slate-800 text-xs">{order.recipientName || '—'}</p>
                                            <p className="text-[10px] text-slate-400">{order.recipientPhone || ''}</p>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                order.type === 'Online'
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : 'bg-purple-100 text-purple-700'
                                            }`}>
                                                {order.type || '—'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                                                {order.status || '—'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-xs text-slate-600 max-w-[160px] truncate" title={getProductSummary(order)}>
                                            {getProductSummary(order)}
                                        </td>
                                        <td className="p-3 text-right font-bold text-slate-700 text-xs">
                                            ৳{Number(order.grandTotal || order.dueAmount || 0).toLocaleString()}
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(order.archivedAt)}</td>
                                        <td className="p-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                daysLeft <= 7
                                                    ? 'bg-red-100 text-red-700'
                                                    : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {daysLeft}d
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={() => {
                                                    if (confirm(`Restore order ${getOrderId(order)} to its previous tab?`)) {
                                                        onRestore(order.id);
                                                    }
                                                }}
                                                className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded transition-colors"
                                                title="Restore to original tab"
                                            >
                                                <RotateCcw size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {archivedOrders.length === 0 && (
                                <tr>
                                    <td colSpan="9" className="p-12 text-center text-slate-400">
                                        <Archive size={32} className="mx-auto mb-3 text-slate-300" />
                                        <p className="font-medium">No archived orders</p>
                                        <p className="text-xs mt-1">Orders removed from Confirmed or Cancelled &amp; Returned will appear here</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default React.memo(OrderArchiveTab);
