import React, { useMemo } from 'react';
import { RotateCcw, Archive } from 'lucide-react';

const InventoryArchiveTab = ({ inventory, locations, onRestore }) => {
    const archivedItems = useMemo(() => (
        [...inventory].sort((a, b) => {
            const aT = a.archivedAt?.toDate ? a.archivedAt.toDate().getTime() : 0;
            const bT = b.archivedAt?.toDate ? b.archivedAt.toDate().getTime() : 0;
            return bT - aT;
        })
    ), [inventory]);

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

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Inventory Archive</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Stock-out and manually removed products — restore within 30 days or they are permanently deleted
                        </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-center min-w-[80px]">
                        <p className="text-2xl font-bold text-amber-700">{archivedItems.length}</p>
                        <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wide">Archived</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[1000px]">
                        <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3">Product / Code</th>
                                <th className="p-3">Category</th>
                                <th className="p-3">Location</th>
                                <th className="p-3 text-center">Stock</th>
                                <th className="p-3 text-right">Unit Cost</th>
                                <th className="p-3 text-right">MRP</th>
                                <th className="p-3">Archived On</th>
                                <th className="p-3">Reason</th>
                                <th className="p-3 text-center">Days Left</th>
                                <th className="p-3 text-left">Added By</th>
                                <th className="p-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {archivedItems.map(item => {
                                const loc = locations.find(l => l.id === item.locationId);
                                const qty = item.type === 'Variable'
                                    ? Object.values(item.stock || {}).reduce((a, b) => a + Number(b || 0), 0)
                                    : Number(item.totalStock || 0);
                                const daysLeft = getDaysRemaining(item.archivedAt);
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3">
                                            <p className="font-bold text-slate-800">{item.productName || 'N/A'}</p>
                                            <p className="text-[10px] font-mono text-slate-400">{item.code}</p>
                                        </td>
                                        <td className="p-3 text-xs text-slate-500">{item.category}</td>
                                        <td className="p-3 text-xs text-slate-600">
                                            {loc?.numbering}{item.shelfRow ? ` - ${item.shelfRow}` : ''}
                                        </td>
                                        <td className="p-3 text-center font-bold text-slate-700">{qty}</td>
                                        <td className="p-3 text-right text-slate-600">৳{Number(item.unitCost || 0)}</td>
                                        <td className="p-3 text-right text-slate-600">৳{Number(item.mrp || 0)}</td>
                                        <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(item.archivedAt)}</td>
                                        <td className="p-3">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                item.archivedReason === 'stock_out'
                                                    ? 'bg-orange-100 text-orange-700'
                                                    : 'bg-slate-100 text-slate-600'
                                            }`}>
                                                {item.archivedReason === 'stock_out' ? 'Stock Out' : 'Deleted'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                daysLeft <= 7
                                                    ? 'bg-red-100 text-red-700'
                                                    : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {daysLeft}d
                                            </span>
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 truncate max-w-[100px]" title={item.addedBy}>
                                            {item.addedBy || '—'}
                                        </td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={() => {
                                                    if (confirm(`Restore "${item.productName || item.code}" to active Inventory?`)) {
                                                        onRestore(item.id);
                                                    }
                                                }}
                                                className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded transition-colors"
                                                title="Restore to Inventory"
                                            >
                                                <RotateCcw size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {archivedItems.length === 0 && (
                                <tr>
                                    <td colSpan="11" className="p-12 text-center text-slate-400">
                                        <Archive size={32} className="mx-auto mb-3 text-slate-300" />
                                        <p className="font-medium">No archived products</p>
                                        <p className="text-xs mt-1">Stock-out and deleted products will appear here</p>
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

export default React.memo(InventoryArchiveTab);
