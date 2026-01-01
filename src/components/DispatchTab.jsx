import React, { useState, useMemo } from 'react';
import { Download, CheckCircle, Calendar, Zap } from 'lucide-react'; // Added Zap
import SearchBar from './SearchBar';
import { downloadCSV } from '../utils';

const DispatchTab = ({ orders, onUpdate }) => {
    const [filterDate, setFilterDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const filtered = useMemo(() => {
        let res = orders || [];
        if (filterDate) res = res.filter(o => o.date === filterDate);
        if (searchTerm) res = res.filter(o => (o.recipientPhone || '').includes(searchTerm));
        return res;
    }, [orders, filterDate, searchTerm]);

    const handleExport = () => {
        const data = filtered.map(o => ({
            Date: o.date,
            Products: (o.products || []).map(p => `${p.code}-${p.size} (x${p.qty})`).join(' | '),
            Phone: o.recipientPhone ? `'${o.recipientPhone}` : '',
            SpecialInstructions: o.specialInstructions,
            Remarks: o.dispatchRemark || '' // Added Remarks to export
        }));
        downloadCSV(data, 'dispatch_sheet.csv');
    };

    return (
        <div className="space-y-4">
            {/* Responsive Header Section */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                
                {/* 1. Title */}
                <h2 className="text-xl font-bold text-slate-800">Dispatch Info</h2>
                
                {/* Controls Container */}
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    
                    {/* 2. Search Bar */}
                    <div className="w-full md:w-auto">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search by Phone..." />
                    </div>

                    {/* 3. Date Picker */}
                    <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                        <Calendar size={18} className="text-slate-500" />
                        <input 
                            type="date" 
                            className="bg-transparent text-sm w-full outline-none" 
                            onChange={(e) => setFilterDate(e.target.value)} 
                        />
                    </div>

                    {/* 4. Export Button */}
                    <button 
                        onClick={handleExport} 
                        className="flex items-center justify-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 font-medium text-sm p-2 rounded w-full md:w-auto transition-colors"
                    >
                        <Download size={16} /> Download Sheet
                    </button>
                </div>
            </div>

            {/* Table Section */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[800px]">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="p-3 w-16 text-center">Alerts</th> {/* Added Header */}
                            <th className="p-3">Order Info</th>
                            <th className="p-3">Product Details (Code/Size/Qty)</th>
                            <th className="p-3">Instructions</th>
                            <th className="p-3">Remarks</th> 
                            <th className="p-3">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(order => {
                            const isExpress = order.isExpress === true;
                            return (
                            <tr key={order.id} className={`border-b ${order.status === 'Dispatched' ? 'text-blue-600 bg-blue-50' : ''} ${order.status === 'Exchanged' ? 'bg-yellow-50' : ''} ${isExpress ? 'bg-amber-50/30' : ''}`}>
                                
                                {/* --- EXPRESS BADGE COLUMN --- */}
                                <td className="p-3 text-center align-middle">
                                    {isExpress && (
                                        <div title="Express Delivery" className="flex justify-center">
                                            <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center shadow-sm text-amber-700 font-bold text-[10px] flex-col leading-none">
                                                <Zap size={10} className="fill-current mb-[1px]" />
                                                ED
                                            </div>
                                        </div>
                                    )}
                                </td>

                                <td className="p-3">
                                    <div className="font-bold">{order.recipientPhone}</div>
                                    <div className="text-xs text-slate-500">{order.date}</div>
                                    {order.status === 'Exchanged' && <span className="inline-block mt-1 bg-yellow-100 text-yellow-800 text-[10px] font-bold px-1.5 py-0.5 rounded">EXCHANGE</span>}
                                </td>
                                <td className="p-3">{(order.products || []).map((p, i) => (<div key={i} className="font-mono bg-slate-100 inline-block px-2 py-1 rounded mr-2 mb-1">{p.code} / {p.size} / Qty: {p.qty}</div>))}</td>
                                <td className="p-3 text-xs italic max-w-xs">{order.specialInstructions || 'None'}</td>
                                
                                {/* Remarks Column */}
                                <td className="p-3">
                                    <input
                                        type="text"
                                        placeholder="Reason / Note..."
                                        className="border rounded px-2 py-1 text-xs w-full focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                                        defaultValue={order.dispatchRemark || ''}
                                        // Save to DB on Blur (clicking away) to avoid re-renders while typing
                                        onBlur={(e) => onUpdate(order.id, order.status, { dispatchRemark: e.target.value })}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </td>

                                <td className="p-3">
                                    {order.status === 'Confirmed' || order.status === 'Exchanged' ? (
                                        <button onClick={() => onUpdate(order.id, 'Dispatched')} className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700">Confirm Dispatch</button>
                                    ) : (
                                        <span className="flex items-center text-blue-600 text-xs font-bold"><CheckCircle size={14} className="mr-1" /> Dispatched</span>
                                    )}
                                </td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DispatchTab;