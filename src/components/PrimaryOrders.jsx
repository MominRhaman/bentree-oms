import React, { useState, useMemo } from 'react';
import { Calendar, AlertTriangle, CheckCircle, Edit2, Zap } from 'lucide-react'; 
import OrderDetailsPopup from './OrderDetailsPopup';
import SearchBar from './SearchBar'; 
import { getStatusColor } from '../utils'; 

const PrimaryOrders = ({ orders, onUpdate, onEdit }) => {
    const [filterDate, setFilterDate] = useState('');
    const [searchTerm, setSearchTerm] = useState(''); 
    const [selectedOrder, setSelectedOrder] = useState(null);
    
    // Track inputs locally so buttons appear instantly
    const [tempIds, setTempIds] = useState({});

    // 1. Duplicate Logic
    const duplicateIds = useMemo(() => {
        const phoneCounts = {};
        const duplicates = new Set();
        const activeOrders = orders.filter(o => o.status === 'Pending' && o.type === 'Online');
        activeOrders.forEach(o => {
            if (o.recipientPhone) {
                const phone = o.recipientPhone.trim();
                phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
            }
        });
        activeOrders.forEach(o => {
            if (o.recipientPhone && phoneCounts[o.recipientPhone.trim()] > 1) {
                duplicates.add(o.id);
            }
        });
        return duplicates;
    }, [orders]);

    // 2. View Filter Logic
    const filteredOrders = useMemo(() => {
        let res = orders.filter(o => o.status === 'Pending' || o.status === 'Cancelled');
        if (filterDate) res = res.filter(o => o.date === filterDate);
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            res = res.filter(o => 
                (o.recipientName && o.recipientName.toLowerCase().includes(term)) ||
                (o.recipientPhone && o.recipientPhone.toLowerCase().includes(term)) ||
                (o.merchantOrderId && o.merchantOrderId.toLowerCase().includes(term)) ||
                (o.products && o.products.some(p => p.code.toLowerCase().includes(term)))
            );
        }
        return res;
    }, [orders, filterDate, searchTerm]);

    // --- HANDLERS ---
    const toggleAttempt = (e, order, attemptNum) => {
        e.stopPropagation();
        const current = order.callAttempts || {};
        const key = `attempt${attemptNum}`;
        const nextState = !current[key];
        
        // Prepare base updates
        let updates = {
            callAttempts: { ...current, [key]: nextState }
        };

        let historyNote = '';

        if (nextState) {
            const remark = window.prompt(`Enter Remark for Attempt ${attemptNum}:`, order.callNote || '');
            if (remark === null) return; 
            updates[`attempt${attemptNum}Remark`] = remark;
            updates[`attempt${attemptNum}Date`] = new Date().toLocaleString(); 
            updates['callNote'] = remark;
            historyNote = `Call Attempt ${attemptNum}: ${remark}`;
        } else {
            historyNote = `Call Attempt ${attemptNum} removed`;
        }

        const newHistoryItem = {
            status: order.status,
            timestamp: new Date().toISOString(),
            note: historyNote,
            updatedBy: 'User'
        };
        updates.history = [...(order.history || []), newHistoryItem];

        onUpdate(order.id, order.status, updates);
    };

    const handleIdChange = (orderId, value) => {
        setTempIds(prev => ({ ...prev, [orderId]: value }));
    };

    const handleIdBlur = (order, value) => {
        if (value && value !== order.merchantOrderId) {
            onUpdate(order.id, order.status, { merchantOrderId: value });
        }
    };

    const handleQuickComplete = (e, order, currentId) => {
        e.stopPropagation();
        onUpdate(order.id, order.status, { 
            merchantOrderId: currentId,
            checkOutStatus: 'Completed' 
        });
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h2 className="text-xl font-bold text-slate-800">Primary Orders</h2>
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="w-full md:w-64">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search Name, Phone, ID..." />
                    </div>
                    <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                        <Calendar size={18} className="text-slate-500" />
                        <input type="date" className="bg-transparent text-sm w-full outline-none" onChange={(e) => setFilterDate(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[900px]">
                    <thead className="bg-slate-50 text-slate-600 font-medium border-b">
                        <tr>
                            <th className="p-3 w-16 text-center">Alerts</th>
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
                            
                            // Input Logic
                            const currentId = tempIds[order.id] !== undefined ? tempIds[order.id] : '';
                            const hasEnteredId = currentId && currentId.trim().length > 0;
                            const isCheckedOut = order.checkOutStatus === 'Completed';

                            // Express Check
                            const isExpress = order.isExpress === true;

                            return (
                                <tr key={order.id} className={`border-b hover:bg-slate-50 cursor-pointer ${order.status === 'Cancelled' ? 'bg-red-50' : ''} ${isDuplicate ? 'bg-amber-50' : ''} ${isExpress ? 'bg-amber-50/30' : ''}`} onClick={() => setSelectedOrder(order)}>
                                    
                                    {/* --- ALERTS COLUMN (Duplicate & Express) --- */}
                                    <td className="p-3 text-center align-middle">
                                        <div className="flex flex-col items-center gap-2">
                                            {isDuplicate && (
                                                <div className="group relative">
                                                    <AlertTriangle size={18} className="text-amber-500 animate-pulse" />
                                                    <div className="absolute left-6 top-0 bg-slate-800 text-white text-[10px] p-2 rounded w-28 hidden group-hover:block z-20 shadow-lg pointer-events-none">Duplicate Phone Number Found</div>
                                                </div>
                                            )}
                                            {/* --- EXPRESS BADGE --- */}
                                            {isExpress && (
                                                <div title="Express Delivery">
                                                    <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center shadow-sm text-amber-700 font-bold text-[10px] flex-col leading-none">
                                                        <Zap size={10} className="fill-current mb-[1px]" />
                                                        ED
                                                    </div>
                                                </div>
                                            )}
                                        </div>
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
                                                <button key={num} onClick={(e) => toggleAttempt(e, order, num)} className={`w-6 h-6 rounded-full text-xs font-bold border transition-colors ${order.callAttempts?.[`attempt${num}`] ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-400 border-slate-300 hover:border-emerald-400'}`} title={`Attempt ${num}`}>
                                                    {num}
                                                </button>
                                            ))}
                                        </div>
                                        <input placeholder="Note..." className="text-xs border rounded p-1 w-full focus:ring-1 focus:ring-emerald-500 outline-none" defaultValue={order.callNote || ''} onClick={(e) => e.stopPropagation()} onBlur={(e) => onUpdate(order.id, order.status, { callNote: e.target.value })} />
                                    </td>
                                    <td className="p-3 font-medium">৳{order.grandTotal}</td>
                                    
                                    {/* --- CHECK OUT COLUMN --- */}
                                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex flex-col gap-2 w-32">
                                            {isCheckedOut ? (
                                                <div className="flex flex-col gap-1 bg-green-50 p-2 rounded border border-green-100">
                                                    <div className="text-green-700 font-bold text-xs flex items-center gap-1">
                                                        <CheckCircle size={14} /> Done
                                                    </div>
                                                    <div className="text-[10px] text-slate-600 font-mono truncate" title={order.merchantOrderId}>
                                                        ID: {order.merchantOrderId}
                                                    </div>
                                                    <button 
                                                        onClick={() => onUpdate(order.id, order.status, { checkOutStatus: 'Pending' })} 
                                                        className="text-[10px] text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1 w-fit"
                                                    >
                                                        <Edit2 size={10} /> Edit ID
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Enter Order ID" 
                                                        className="border rounded px-2 py-1 text-xs w-full focus:ring-1 focus:ring-emerald-500 outline-none" 
                                                        value={currentId} 
                                                        onChange={(e) => handleIdChange(order.id, e.target.value)}
                                                        onBlur={(e) => handleIdBlur(order, e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' && hasEnteredId) {
                                                                handleQuickComplete(e, order, currentId);
                                                            }
                                                        }}
                                                    />
                                                    
                                                    {hasEnteredId ? (
                                                        <button 
                                                            onClick={(e) => handleQuickComplete(e, order, currentId)} 
                                                            className="w-full py-1 px-2 rounded text-xs font-bold bg-slate-800 text-white hover:bg-slate-700 shadow-sm transition-all"
                                                        >
                                                            Confirm
                                                        </button>
                                                    ) : (
                                                        <div className="text-[10px] text-red-500 italic text-center bg-red-50 rounded py-0.5 border border-red-100">
                                                            * ID Required
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </td>

                                    <td className={`p-3 font-bold text-xs uppercase ${order.status === 'Cancelled' ? 'text-red-600' : 'text-slate-600'}`}>{order.status}</td>
                                    
                                    {/* --- ACTIONS COLUMN --- */}
                                    <td className="p-3">
                                        <div className="flex justify-center gap-2">
                                            {order.status !== 'Cancelled' && (
                                                <>
                                                    {isCheckedOut ? (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Confirmed'); }} 
                                                            className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-200 transition-colors shadow-sm"
                                                        >
                                                            Confirm
                                                        </button>
                                                    ) : (
                                                        <button 
                                                            disabled 
                                                            className="bg-slate-100 text-slate-400 px-3 py-1.5 rounded text-xs font-bold cursor-not-allowed border border-slate-200"
                                                            title="Complete Check Out First"
                                                        >
                                                            Confirm
                                                        </button>
                                                    )}
                                                    
                                                    <button onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Cancelled'); }} className="bg-red-100 text-red-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-red-200 transition-colors shadow-sm">Cancel</button>
                                                </>
                                            )}
                                            {order.status === 'Cancelled' && (
                                                <button onClick={(e) => { e.stopPropagation(); onUpdate(order.id, 'Confirmed'); }} className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold hover:bg-emerald-200 border border-emerald-200">Reconfirm</button>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <input className="border rounded px-2 py-1 text-xs w-full focus:ring-1 focus:ring-emerald-500 outline-none" defaultValue={order.remarks} onClick={(e) => e.stopPropagation()} onBlur={(e) => onUpdate(order.id, order.status, { remarks: e.target.value })} placeholder="Remark..." />
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredOrders.length === 0 && <tr><td colSpan="10" className="p-8 text-center text-slate-400">No pending orders found</td></tr>}
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