import React, { useState, useMemo } from 'react';
import { Calendar, Download, AlertTriangle, CheckCircle, ArrowRightLeft, PauseCircle, Ban, X, RotateCcw, Trash2, Zap, Eye } from 'lucide-react'; 
import OrderDetailsPopup from './OrderDetailsPopup';
import SearchBar from './SearchBar';
import ExchangeModal from './ExchangeModal';
import { getStatusColor, downloadCSV } from '../utils';

const ConfirmedOrders = ({ allOrders, orders, onUpdate, onEdit, onCreate, onDelete, inventory }) => {
    // --- States ---
    const [filterDate, setFilterDate] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Custom Modals for Custom Logic
    const [deliveryModal, setDeliveryModal] = useState(null); 
    const [returnPopupOrder, setReturnPopupOrder] = useState(null);
    const [exchangeModal, setExchangeModal] = useState(null); // For full exchange
    const [exchangePopupOrder, setExchangePopupOrder] = useState(null); // For partial exchange via OrderDetailsPopup
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
                (o.merchantOrderId && o.merchantOrderId.toLowerCase().includes(term)) ||
                (o.remarks && o.remarks.toLowerCase().includes(term))
            );
        }
        return res;
    }, [orders, filterDate, searchTerm, filterStatus]);

    // --- Handlers ---
    const handleExport = () => {
        const data = filteredOrders.map(o => {
            const totalQty = (o.products || []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
            const calculatedTotalWeight = "0.20 kg";

            return {
                'Item Type': 'Parcel',
                'Store Name': 'Bentree',
                'Merchant Order ID': o.merchantOrderId || '',
                'Recipient Name': o.recipientName || '',
                'Phone Number': o.recipientPhone || '',
                'Recipient Address': o.recipientAddress || '',
                'Recipient City': o.city || o.recipientCity || '', 
                'Recipient Zone': o.zone || o.recipientZone || '',
                'Recipient Area': o.area || o.recipientArea || '',
                'Amount To Collect': o.dueAmount || 0,
                'Item Quantity': totalQty,
                'Item Weight': calculatedTotalWeight,
                'Item Description': o.itemDescription || '', 
                'Special Instructions': o.specialInstructions || o.remarks || ''
            };
        });
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

    const newDue = oldDue - oldDeliveryCharge + newDeliveryCharge;
    const newGrandTotal = oldGrandTotal - oldDeliveryCharge + newDeliveryCharge;
    const adjustment = received - newDue;
    
    // NEW REQUIREMENT: When marking as Delivered, add Advance Money to Collected Money and reset Advance to 0
    const previousAdvance = Number(deliveryModal.advanceAmount || 0);
    const previousCollected = Number(deliveryModal.collectedAmount || 0);
    const newCollectedAmount = previousAdvance + previousCollected + received;
    
    onUpdate(deliveryModal.id, 'Delivered', {
        collectedAmount: newCollectedAmount,
        advanceAmount: 0, // Reset advance money to 0
        deliveryCharge: newDeliveryCharge,
        grandTotal: newGrandTotal,
        dueAmount: 0,
        revenueAdjustment: adjustment,
        paymentNote: adjustment !== 0 
            ? `Collected ${received} (Exp: ${newDue}). Loss/Adj: ${adjustment}. Advance ৳${previousAdvance} moved to Collected.` 
            : `Full Payment Received. Advance ৳${previousAdvance} moved to Collected.`
    });
    setDeliveryModal(null);
};

    const processHold = (e) => {
        e.preventDefault();
        const remark = e.target.holdRemark.value.trim();
        
        if (!remark) {
            alert("Please enter a remark to put this order on Hold.");
            return;
        }

        onUpdate(holdModal.id, 'Hold', {
            note: `Order put on Hold. Remarks: ${remark}`,
            remarks: remark 
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
                    <table className="w-full text-sm text-left min-w-[900px]">
                        <thead className="bg-slate-50 text-slate-600 font-medium border-b sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 w-16 text-center">Alerts</th>
                                <th className="p-3">Date</th>
                                <th className="p-3">Recipient</th>
                                <th className="p-3">Items</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Tracking ID</th>
                                <th className="p-3">Refund / Remarks</th>
                                <th className="p-3 text-center">Outcome</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.map(order => {
                                const isExpress = order.isExpress === true;
                                
                                // Check if this is a NEW partial return/exchange order (created during split)
                                const isNewPartialReturnOrder = order.isPartialReturn === true;
                                const isNewPartialExchangeOrder = order.isPartialExchange === true;
                                
                                // Only hide for NEW partial orders, not original orders
                                const shouldHideFinancials = isNewPartialReturnOrder || isNewPartialExchangeOrder;
                                
                                // Fix: Combine current products with original products (if it's an exchange/return) to show all codes
                                const displayProducts = [...(order.products || [])];
                                if (order.exchangeDetails?.originalProducts) {
                                    order.exchangeDetails.originalProducts.forEach(op => {
                                        if (!displayProducts.some(dp => dp.code === op.code)) {
                                            displayProducts.push(op);
                                        }
                                    });
                                }

                                return (
                                <tr
                                    key={order.id}
                                    className={`border-b hover:bg-slate-50 ${getStatusColor(order.status)} bg-opacity-20 cursor-pointer ${isExpress ? 'bg-amber-50/30' : ''}`}
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    <td className="p-3 text-center align-middle">
                                        <div className="flex flex-col items-center gap-1">
                                            {duplicateIds.has(order.id) && (
                                                <div title="Duplicate Alert" className="text-amber-500 animate-pulse"><AlertTriangle size={16} /></div>
                                            )}
                                            {isExpress && (
                                                <div title="Express Delivery">
                                                    <div className="w-7 h-7 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center shadow-sm text-amber-700 font-bold text-[9px] flex-col leading-none">
                                                        <Zap size={9} className="fill-current mb-[1px]" />
                                                        ED
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3">{order.date}</td>
                                    <td className="p-3">
                                        <div className="font-medium">{order.recipientName}</div>
                                        <div className="text-xs opacity-75">{order.recipientPhone}</div>
                                        
                                        {!shouldHideFinancials && (
                                            <>
                                                {order.dueAmount < 0 ? (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {order.isRefunded ? (
                                                            <div className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">
                                                                REFUNDED MONEY
                                                            </div>
                                                        ) : (
                                                            <div className="text-[10px] font-bold text-red-600 animate-pulse">
                                                                REFUND: ৳{Math.abs(order.dueAmount)}
                                                            </div>
                                                        )}
                                                        <label className="flex items-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                                            <input
                                                                type="checkbox"
                                                                className="w-3 h-3 text-green-600 rounded focus:ring-green-500 cursor-pointer"
                                                                checked={order.isRefunded || false}
                                                                onChange={() => {
                                                                    const newRefundStatus = !order.isRefunded;
                                                                    onUpdate(order.id, order.status, {
                                                                        isRefunded: newRefundStatus,
                                                                        note: newRefundStatus ? 'Refund amount marked as refunded' : 'Refund status removed'
                                                                    });
                                                                }}
                                                            />
                                                        </label>
                                                    </div>
                                                ) : (
                                                    <div className="text-[10px] font-bold mt-1 text-slate-500">
                                                        Due: ৳{order.dueAmount}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        
                                        {isNewPartialReturnOrder && (
                                            <div className="text-[10px] font-bold mt-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded inline-block">
                                                PARTIAL RETURN
                                            </div>
                                        )}
                                        {isNewPartialExchangeOrder && (
                                            <div className="text-[10px] font-bold mt-1 text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded inline-block">
                                                PARTIAL EXCHANGE
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3 text-xs">
                                        {displayProducts.map((p, i) => (
                                            <div key={`${order.id}-product-${i}-${p.code}`}>
                                                {p.qty}x {p.code} ({p.size})
                                            </div>
                                        ))}
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
                                        <input
                                            className="border rounded px-2 py-1 text-xs w-full focus:ring-1 focus:ring-emerald-500 outline-none"
                                            defaultValue={order.remarks || ''}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => onUpdate(order.id, order.status, { remarks: e.target.value })}
                                            placeholder="Remark..."
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
                                            <button 
                                                title="Exchange Items (Opens Exchange Modal)" 
                                                onClick={() => setExchangeModal(order)} 
                                                className="p-1.5 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                                            >
                                                <ArrowRightLeft size={16} />
                                            </button>
                                            <button 
                                                title="Hold" 
                                                onClick={() => setHoldModal(order)} 
                                                className="p-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                                            >
                                                <PauseCircle size={16} />
                                            </button>
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
                                            <button 
                                                title="Delete Permanently" 
                                                onClick={() => { 
                                                    if (confirm('⚠️ Are you sure you want to PERMANENTLY DELETE this order? This cannot be undone.')) {
                                                        onDelete(order.id);
                                                    }
                                                }} 
                                                className="p-1.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* --- Modals and Popups --- */}
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
                                <input name="received" type="number" defaultValue={deliveryModal.dueAmount || 0} onWheel={(e) => e.target.blur()} className="w-full p-2 border rounded font-bold" autoFocus required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Delivery Charge (Included)</label>
                                <input name="deliveryCharge" type="number" defaultValue={deliveryModal.deliveryCharge || 0} onWheel={(e) => e.target.blur()} className="w-full p-2 border rounded" required />
                            </div>
                            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded shadow-sm">Confirm Delivered</button>
                        </form>
                    </div>
                </div>
            )}

            {holdModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-purple-800 flex items-center gap-2"><PauseCircle size={20} /> Hold Order</h3>
                            <button onClick={() => setHoldModal(null)}><X size={20} className="text-slate-400" /></button>
                        </div>
                        <form onSubmit={processHold} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Reason / Remarks</label>
                                <textarea name="holdRemark" rows="3" placeholder="Why is this order on hold?" className="w-full p-2 border rounded text-sm focus:ring-1 focus:ring-purple-500 outline-none" required autoFocus />
                            </div>
                            <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded shadow-sm">Confirm Hold</button>
                        </form>
                    </div>
                </div>
            )}

            {/* ORDER DETAIL POPUPS */}
            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={getStatusColor} 
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                />
            )}

            {returnPopupOrder && (
                <OrderDetailsPopup 
                    order={returnPopupOrder} 
                    onClose={() => setReturnPopupOrder(null)} 
                    getStatusColor={getStatusColor} 
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                    isReturnMode={true} 
                />
            )}

            {/* EXCHANGE MODAL - For Full/Partial Exchange */}
            {exchangeModal && (
                <ExchangeModal 
                    order={exchangeModal} 
                    onClose={() => setExchangeModal(null)} 
                    onConfirm={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                />
            )}

            {exchangePopupOrder && (
                <OrderDetailsPopup 
                    order={exchangePopupOrder} 
                    onClose={() => setExchangePopupOrder(null)} 
                    getStatusColor={getStatusColor} 
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                    isExchangeMode={true} 
                />
            )}
        </div>
    );
};

export default ConfirmedOrders;