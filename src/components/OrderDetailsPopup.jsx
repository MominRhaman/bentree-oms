import React, { useState, useEffect } from 'react';
import { X, Edit2, Save, Trash2, Printer, MapPin, Phone, User, Package, Plus, Clock, RefreshCw, AlertTriangle, RotateCcw, CheckCircle, Eye, Zap, PhoneCall, DollarSign, List, ArrowLeft } from 'lucide-react';
import InvoiceGenerator from './InvoiceGenerator'; // Ensure path is correct

const OrderDetailsPopup = ({ order, onClose, getStatusColor, onEdit, inventory = [], isReturnMode = false }) => {
    const [isEditing, setIsEditing] = useState(isReturnMode);
    const [editedOrder, setEditedOrder] = useState(null);
    const [showInvoice, setShowInvoice] = useState(false); // State to toggle invoice view

    useEffect(() => {
        if (order) {
            const deepCopy = JSON.parse(JSON.stringify(order));
            setEditedOrder(deepCopy);
            if (isReturnMode) setIsEditing(true); 
        }
    }, [order, isReturnMode]);

    if (!order || !editedOrder) return null;

    const saveChanges = async () => {
        if (onEdit) {
            const statusToSave = isReturnMode ? 'Returned' : (editedOrder.status || order.status);
            const historyItem = { 
                status: statusToSave, 
                timestamp: new Date().toISOString(), 
                note: isReturnMode ? 'Return Confirmed' : 'Order Updated', 
                updatedBy: 'Bentree Master' 
            };
            const payload = { ...editedOrder, status: statusToSave, history: [...(order.history || []), historyItem] };
            await onEdit(order.id, statusToSave, payload);
            setIsEditing(false);
            if (isReturnMode) onClose();
        }
    };

    const callAttemptsCount = (order.history || []).filter(h => h.note?.toLowerCase().includes('call attempt')).length;

    // --- RENDER INVOICE VIEW ---
    if (showInvoice) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden">
                    <div className="p-4 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                        <button 
                            onClick={() => setShowInvoice(false)}
                            className="flex items-center gap-2 text-slate-600 font-bold text-xs uppercase hover:text-slate-900 transition-colors"
                        >
                            <ArrowLeft size={16} /> Back to Details
                        </button>
                        <button 
                            onClick={() => window.print()}
                            className="bg-slate-800 text-white px-4 py-2 rounded font-bold text-xs flex items-center gap-2 hover:bg-slate-900 shadow-lg"
                        >
                            <Printer size={14} /> Print Now
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <InvoiceGenerator orders={[order]} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm font-sans" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
                
                {/* --- HEADER --- */}
                <div className="p-5 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-bold text-[#0f2d52] tracking-tighter">Order #{order.merchantOrderId || order.id}</h2>
                        <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider ${getStatusColor(order.status)}`}>
                            {order.status}
                        </span>
                        {order.isExpress && (
                            <div className="bg-[#fff9e6] text-[#b37d00] px-3 py-1 rounded-full border border-[#ffe082] flex items-center gap-1.5 font-bold text-xs uppercase shadow-sm">
                                <Zap size={14} className="fill-current" /> Express
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* --- INVOICE PRINT ICON (Left of Edit) --- */}
                        <button 
                            onClick={() => setShowInvoice(true)} 
                            className="p-2.5 text-slate-500 hover:bg-slate-100 rounded-full transition-all active:scale-95"
                            title="View Invoice"
                        >
                            <Printer size={20} />
                        </button>

                        <button onClick={() => setIsEditing(!isEditing)} className="p-2.5 text-blue-500 hover:bg-blue-50 rounded-full transition-all active:scale-95" title="Edit Order">
                            <Edit2 size={20} />
                        </button>
                        <button onClick={onClose} className="p-2.5 text-slate-400 hover:text-red-500 transition-all active:scale-95">
                            <X size={28} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-10">
                    {/* ... (Existing Customer Details, Order Info, Call Logs, Items, and History logic remains unchanged) ... */}
                    
                    <div className="grid grid-cols-2 gap-12 text-slate-600 font-normal">
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-2"><User size={14} /> Customer Details</h3>
                            <div className="space-y-2.5">
                                <p className="text-xl font-bold text-slate-800 leading-none">{order.recipientName}</p>
                                <p className="text-lg font-medium text-[#10b981] flex items-center gap-2"><Phone size={16} /> {order.recipientPhone}</p>
                                <p className="text-base font-normal text-slate-500 flex items-start gap-2 pt-1"><MapPin size={18} className="mt-1 flex-shrink-0 text-slate-300" /> {order.recipientAddress}</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-2"><Package size={14} /> Order Info</h3>
                            <div className="grid grid-cols-2 gap-y-5 text-sm font-semibold">
                                <div><p className="text-[10px] text-slate-400 uppercase">Source</p><p>{order.orderSource || 'Manual'}</p></div>
                                <div><p className="text-[10px] text-slate-400 uppercase">Type</p><p>{order.type || 'Online'}</p></div>
                                <div><p className="text-[10px] text-slate-400 uppercase">Check Out</p><p className="text-[#10b981]">{order.checkOutStatus || 'Pending'}</p></div>
                                <div><p className="text-[10px] text-slate-400 uppercase">Payment</p><p className="uppercase">{order.paymentMethod || 'COD'}</p></div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><PhoneCall size={14} /> Call Attempts</h3>
                        <div className="flex gap-4">
                            {[1, 2, 3].map(num => (
                                <div key={num} className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${num <= callAttemptsCount ? 'bg-[#ebf5ff] border-[#3b82f6] text-[#3b82f6]' : 'bg-white text-slate-200 border-slate-100'}`}>{num}</div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Items ({order.products?.length || 0})</h3>
                        <div className="bg-slate-50 p-5 rounded-xl space-y-4 divide-y">
                            {order.products.map((p, i) => (
                                <div key={i} className="flex justify-between items-center py-2 first:pt-0">
                                    <div><p className="font-bold text-slate-800">{p.code}</p><p className="text-xs text-slate-400">Size: {p.size} | Qty: {p.qty}</p></div>
                                    <span className="font-bold text-slate-700">৳{Number(p.price) * Number(p.qty)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-8 pt-6 border-t font-normal">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><Clock size={14} /> Transaction History</h3>
                        <div className="space-y-0 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100">
                            {(order.history || []).map((h, idx) => (
                                <div key={idx} className="flex gap-8 relative pb-12 last:pb-0">
                                    <div className={`w-4 h-4 rounded-full z-10 mt-1 border-[3px] border-white ring-2 ${idx === (order.history.length - 1) ? 'bg-[#10b981] ring-[#10b981]/20' : 'bg-slate-300 ring-slate-100'}`}></div>
                                    <div className="flex-1 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm transition-all">
                                        <p className="text-[10px] font-medium text-slate-300 uppercase">{new Date(h.timestamp).toLocaleString()}</p>
                                        <p className="text-lg font-semibold text-slate-800 uppercase leading-none">{h.status}</p>
                                        <p className="text-sm text-slate-500 font-medium italic">"{h.note}"</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* --- FOOTER --- */}
                <div className="p-6 border-t flex justify-center gap-4 bg-slate-50 shadow-inner">
                    <button onClick={onClose} className="flex-1 py-4 bg-white border-2 border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-slate-100 transition-all active:scale-95">
                        Close
                    </button>
                    {isEditing && (
                        <button onClick={saveChanges} className="flex-1 py-4 bg-emerald-600 text-white font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95">
                            <Save size={18} /> Save Changes
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderDetailsPopup;