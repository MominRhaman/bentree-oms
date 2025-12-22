import React, { useState, useMemo } from 'react';
import { Calendar, Download, AlertTriangle, CheckCircle, ArrowRightLeft, PauseCircle, Ban, X, RotateCcw, Trash2 } from 'lucide-react';
import OrderDetailsPopup from './OrderDetailsPopup';
import SearchBar from './SearchBar';
import ExchangeModal from './ExchangeModal';
import { getStatusColor, downloadCSV } from '../utils';

// ADDED: onDelete prop
const ConfirmedOrders = ({ allOrders, orders, onUpdate, onEdit, onDelete, inventory }) => {
    // --- States ---
    const [filterDate, setFilterDate] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [exchangeModal, setExchangeModal] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null);

    // New Modals for Custom Logic
    const [deliveryModal, setDeliveryModal] = useState(null); 
    const [returnPopupOrder, setReturnPopupOrder] = useState(null);
    
    // ADDED: Hold Modal State
    const [holdModal, setHoldModal] = useState(null);

    // --- 1. Duplicate Logic ---
    const duplicateIds = useMemo(() => {
        const dupeIds = new Set();
        const byPhone = {};

        const activeForCheck = allOrders.filter(o => 
            !['Delivered', 'Cancelled', 'Hold', 'Returned'].includes(o.status)
        );

        activeForCheck.forEach(o => {
            if (!o.recipientPhone) return;
            const phone = o.recipientPhone.trim();
            if (!byPhone[phone]) byPhone[phone] = [];
            byPhone[phone].push(o);
        });

        Object.values(byPhone).forEach(group => {
            if (group.length < 2) return;
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const a = group[i];
                    const b = group[j];
                    const amountMatch = (Number(a.dueAmount) === Number(b.dueAmount));
                    const productMatch = a.products?.some(ap => b.products?.some(bp => bp.code === ap.code));
                    
                    if (amountMatch || productMatch) {
                        dupeIds.add(a.id);
                        dupeIds.add(b.id);
                    }
                }
            }
        });
        return dupeIds;
    }, [allOrders]);

    // --- 2. Filter Logic ---
    const filteredOrders = useMemo(() => {
        let res = orders.filter(o => 
            o.status !== 'Pending' && 
            o.status !== 'Hold' && 
            o.type !== 'Store'
        );
        
        if (filterDate) res = res.filter(o => o.date === filterDate);
        if (filterStatus !== 'All') res = res.filter(o => o.status === filterStatus);
        
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            res = res.filter(o =>
                (o.recipientPhone && o.recipientPhone.toLowerCase().includes(term)) ||
                (o.recipientName && o.recipientName.toLowerCase().includes(term)) ||
                (o.merchantOrderId && o.merchantOrderId.toLowerCase().includes(term))
            );
        }
        return res;
    }, [orders, filterDate, searchTerm, filterStatus]);

    // --- Handlers ---
    const handleExport = () => {
        const data = filteredOrders.map(o => ({
            'Item Type': 'Parcel',
            'Store Name': 'Bentree',
            'Merchant Order ID': o.merchantOrderId || '',
            'Recipient Name': o.recipientName || '',
            'Phone Number': o.recipientPhone ? `'${o.recipientPhone}` : '',
            'Recipient Address': o.recipientAddress || '',
            'Amount To Collect': o.dueAmount || 0,
            'Status': o.status
        }));
        downloadCSV(data, 'confirmed_orders_export.csv');
    };

    // --- Custom Modal Handlers ---
    const processDelivery = (e) => {
        e.preventDefault();
        const received = Number(e.target.received.value);
        const newDeliveryCharge = Number(e.target.deliveryCharge.value);
        
        const oldDeliveryCharge = Number(deliveryModal.deliveryCharge || 0);
        const oldDue = Number(deliveryModal.dueAmount || 0);
        const oldGrandTotal = Number(deliveryModal.grandTotal || 0);

        // Recalculate based on new delivery charge
        const newDue = oldDue - oldDeliveryCharge + newDeliveryCharge;
        const newGrandTotal = oldGrandTotal - oldDeliveryCharge + newDeliveryCharge;

        const adjustment = received - newDue; 
        
        onUpdate(deliveryModal.id, 'Delivered', {
            collectedAmount: received,
            deliveryCharge: newDeliveryCharge,
            grandTotal: newGrandTotal,
            dueAmount: 0,
            revenueAdjustment: adjustment,
            paymentNote: adjustment !== 0 
                ? `Collected ${received} (Exp: ${newDue}). Loss/Adj: ${adjustment}` 
                : 'Full Payment Received'
        });
        setDeliveryModal(null);
    };

    // ADDED: Process Hold Handler
    const processHold = (e) => {
        e.preventDefault();
        const remark = e.target.holdRemark.value.trim();
        
        if (!remark) {
            alert("Please enter a remark to put this order on Hold.");
            return;
        }

        onUpdate(holdModal.id, 'Hold', {
            note: `Order put on Hold. Remarks: ${remark}`
        });
        setHoldModal(null);
    };

    return (
        <div className="space-y-4">
            {/* Header Section */}
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h2 className="text-xl font-bold text-slate-800">Confirmed Orders</h2>
                
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="w-full md:w-auto">
                        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} placeholder="Search by Phone/Name..." />
                    </div>
                    <div className="flex items-center gap-2 bg-white border rounded p-2 w-full md:w-auto">
                        <Calendar size={18} className="text-slate-500" />
                        <input type="date" className="bg-transparent text-sm w-full outline-none" onChange={(e) => setFilterDate(e.target.value)} />
                    </div>
                    <select className="p-2 border rounded text-sm bg-white w-full md:w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                        <option value="All">All Status</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Dispatched">Dispatched</option>
                        <option value="Delivered">Delivered</option>
                        <option value="Returned">Returned</option>
                        <option value="Exchanged">Exchanged</option>
                    </select>
                    <button onClick={handleExport} className="flex items-center justify-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium text-sm p-2 rounded w-full md:w-auto transition-colors">
                        <Download size={16} /> Export
                    </button>
                </div>
            </div>

            {/* Table Section */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] relative">
                    <table className="w-full text-sm text-left min-w-[800px]">
                        <thead className="bg-slate-50 text-slate-600 font-medium border-b sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 w-8"></th>
                                <th className="p-3">Date</th>
                                <th className="p-3">Recipient</th>
                                <th className="p-3">Items</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Tracking ID</th>
                                <th className="p-3 text-center">Outcome</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.map(order => (
                                <tr
                                    key={order.id}
                                    className={`border-b hover:bg-slate-50 ${getStatusColor(order.status)} bg-opacity-20 cursor-pointer`}
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    <td className="p-3">
                                        {duplicateIds.has(order.id) && (
                                            <div title="Duplicate Alert" className="text-amber-500 animate-pulse"><AlertTriangle size={16} /></div>
                                        )}
                                    </td>
                                    <td className="p-3">{order.date}</td>
                                    <td className="p-3">
                                        <div className="font-medium">{order.recipientName}</div>
                                        <div className="text-xs opacity-75">{order.recipientPhone}</div>
                                        <div className="text-[10px] font-bold text-slate-500 mt-1">Due: ৳{order.dueAmount}</div>
                                    </td>
                                    <td className="p-3 text-xs">
                                        {(order.products || []).map((p, i) => <div key={i}>{p.code} ({p.size})</div>)}
                                    </td>
                                    <td className="p-3 font-bold">
                                        <span className={`px-2 py-1 rounded ${getStatusColor(order.status)}`}>{order.status}</span>
                                    </td>
                                    <td className="p-3">
                                        <input
                                            className="border border-slate-300 rounded px-2 py-1 text-xs w-32 focus:ring-1 focus:ring-emerald-500"
                                            placeholder="Enter ID"
                                            defaultValue={order.trackingId || ''}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => onUpdate(order.id, order.status, { trackingId: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                        />
                                    </td>
                                    <td className="p-3">
                                        <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                title="Mark as Delivered"
                                                onClick={() => {
                                                    if (order.status !== 'Dispatched') return alert("Order must be Dispatched before Delivery.");
                                                    setDeliveryModal(order);
                                                }}
                                                className={`p-1.5 rounded ${order.status === 'Dispatched' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                                            >
                                                <CheckCircle size={16} />
                                            </button>
                                            
                                            <button 
                                                title="Mark as Returned" 
                                                onClick={() => setReturnPopupOrder(order)} 
                                                className="p-1.5 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                            >
                                                <RotateCcw size={16} />
                                            </button>
                                            
                                            <button title="Exchanged" onClick={() => setExchangeModal(order)} className="p-1.5 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"><ArrowRightLeft size={16} /></button>
                                            
                                            {/* CHANGED: Hold Button Triggers Modal */}
                                            <button 
                                                title="Hold" 
                                                onClick={() => setHoldModal(order)} 
                                                className="p-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                                            >
                                                <PauseCircle size={16} />
                                            </button>
                                            
                                            {/* CHANGED: Block Cancel if Delivered */}
                                            <button 
                                                title="Cancel Order" 
                                                onClick={() => { 
                                                    if (order.status === 'Delivered') {
                                                        alert("Delivered orders cannot be Cancelled.");
                                                        return;
                                                    }
                                                    if (confirm('Are you sure you want to Cancel this order?')) onUpdate(order.id, 'Cancelled'); 
                                                }} 
                                                className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                                            >
                                                <Ban size={16} />
                                            </button>

                                            {/* ADDED: DELETE BUTTON */}
                                            <button 
                                                title="Delete Permanently" 
                                                onClick={() => { 
                                                    if (confirm('⚠️ Are you sure you want to PERMANENTLY DELETE this order? This cannot be undone.')) {
                                                        if (onDelete) {
                                                            onDelete(order.id);
                                                        } else {
                                                            alert("Delete function not connected!");
                                                        }
                                                    }
                                                }} 
                                                className="p-1.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* --- Delivery Confirmation Modal --- */}
            {deliveryModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-800">Confirm Delivery</h3>
                            <button onClick={() => setDeliveryModal(null)}><X size={20} className="text-slate-400" /></button>
                        </div>
                        <form onSubmit={processDelivery} className="space-y-4">
                            <div className="bg-emerald-50 p-3 rounded border border-emerald-100">
                                <label className="block text-xs font-bold text-emerald-800 uppercase">System Due Amount</label>
                                <p className="text-2xl font-bold text-emerald-700">৳{deliveryModal.dueAmount || 0}</p>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Total Received Amount</label>
                                <input 
                                    name="received" 
                                    type="number" 
                                    defaultValue={deliveryModal.dueAmount || 0} 
                                    className="w-full p-2 border rounded font-bold"
                                    autoFocus
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Delivery Charge (Included)</label>
                                <input 
                                    name="deliveryCharge" 
                                    type="number" 
                                    defaultValue={deliveryModal.deliveryCharge || 0} 
                                    className="w-full p-2 border rounded"
                                    required
                                />
                                <p className="text-xs text-slate-500 mt-1">Change if needed.</p>
                            </div>

                            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded shadow-sm">Confirm Delivered</button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- ADDED: Hold Confirmation Modal --- */}
            {holdModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-purple-800 flex items-center gap-2">
                                <PauseCircle size={20} /> Hold Order
                            </h3>
                            <button onClick={() => setHoldModal(null)}><X size={20} className="text-slate-400" /></button>
                        </div>
                        <form onSubmit={processHold} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Reason / Remarks</label>
                                <textarea 
                                    name="holdRemark" 
                                    rows="3" 
                                    placeholder="Why is this order on hold?" 
                                    className="w-full p-2 border rounded text-sm focus:ring-1 focus:ring-purple-500 outline-none"
                                    required
                                    autoFocus
                                />
                            </div>
                            <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded shadow-sm">
                                Confirm Hold
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- Modals and Popups --- */}
            {exchangeModal && <ExchangeModal order={exchangeModal} onClose={() => setExchangeModal(null)} onConfirm={(orderId, data) => onUpdate(orderId, 'Exchanged', data)} inventory={inventory} />}
            
            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={getStatusColor} 
                    onEdit={onEdit} 
                />
            )}

            {returnPopupOrder && (
                <OrderDetailsPopup 
                    order={returnPopupOrder} 
                    onClose={() => setReturnPopupOrder(null)} 
                    getStatusColor={getStatusColor} 
                    onEdit={onEdit}
                    inventory={inventory}
                    isReturnMode={true} 
                />
            )}
        </div>
    );
};

export default ConfirmedOrders;