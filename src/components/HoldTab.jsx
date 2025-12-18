import React, { useState, useMemo } from 'react';
import { PlayCircle } from 'lucide-react';
import SearchBar from './SearchBar';

const HoldTab = ({ orders, onUpdate }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const filtered = useMemo(() => {
        let res = orders || [];
        if (searchTerm) res = res.filter(o => (o.recipientPhone || '').includes(searchTerm));
        return res;
    }, [orders, searchTerm]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h2 className="text-xl font-bold text-slate-800">On-Hold Orders</h2>
                
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="w-full md:w-auto">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search by Phone..." />
                    </div>
                    <div className="text-sm text-slate-500 bg-slate-100 px-3 py-2 rounded text-center w-full md:w-auto">
                        {filtered.length} orders
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[700px]">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Recipient</th>
                            <th className="p-3">Items</th>
                            <th className="p-3">Total</th>
                            <th className="p-3">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(order => (
                            <tr key={order.id} className="border-b hover:bg-slate-50 bg-purple-50 bg-opacity-30">
                                <td className="p-3">{order.date}</td>
                                <td className="p-3">
                                    <div className="font-medium">{order.recipientName}</div>
                                    <div className="text-xs text-slate-500">{order.recipientPhone}</div>
                                </td>
                                <td className="p-3 text-xs">{(order.products || []).map((p, i) => <span key={i} className="mr-1">{p.code}({p.qty})</span>)}</td>
                                <td className="p-3 font-medium">৳{order.grandTotal}</td>
                                <td className="p-3">
                                    <button
                                        onClick={() => onUpdate(order.id, 'Confirmed', { isUnhold: true })}
                                        className="flex items-center gap-1 bg-purple-100 text-purple-700 px-3 py-1 rounded text-xs font-bold hover:bg-purple-200"
                                    >
                                        <PlayCircle size={14} /> Unhold (To Queue)
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-400">No orders found</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default HoldTab;