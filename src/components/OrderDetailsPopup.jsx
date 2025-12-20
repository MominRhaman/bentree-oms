import React, { useState, useEffect } from 'react';
import { X, Edit2, Save, Trash2, Printer, MapPin, Phone, User, Package, Plus, Clock, RefreshCw, AlertTriangle, RotateCcw } from 'lucide-react';
import { disableScroll } from '../utils';

const OrderDetailsPopup = ({ order, onClose, getStatusColor, onEdit, inventory = [], isReturnMode = false }) => {
    // If opening in Return Mode, start in editing state automatically
    const [isEditing, setIsEditing] = useState(isReturnMode);
    const [editedOrder, setEditedOrder] = useState(null);
    const [errors, setErrors] = useState({});

    // Sync state when order opens
    useEffect(() => {
        if (order) {
            setEditedOrder(JSON.parse(JSON.stringify(order))); // Deep copy
            setErrors({});
            if (isReturnMode) setIsEditing(true); // Force edit mode for returns
        }
    }, [order, isReturnMode]);

    if (!order || !editedOrder) return null;

    // --- Stock Logic ---
    const getStockError = (prod) => {
        if (!inventory.length) return null;
        if (!prod.code) return null;
        const item = inventory.find(i => i.code.toUpperCase() === prod.code.toUpperCase());
        if (!item) return "Product not found";

        // Logic: Available = Database Stock + What this order is currently holding
        let qtyHeldByOrder = 0;
        const originalProd = order.products.find(p => p.code === prod.code && p.size === prod.size);
        if (originalProd) qtyHeldByOrder = Number(originalProd.qty || 0);

        let dbStock = 0;
        if (item.type === 'Variable') {
            const sizeKey = Object.keys(item.stock || {}).find(k => k.toUpperCase() === (prod.size || '').toUpperCase());
            if (!sizeKey && prod.size) return "Size not found";
            dbStock = Number(item.stock[sizeKey || ''] || 0);
        } else {
            dbStock = Number(item.totalStock || 0);
        }

        const totalAvailable = dbStock + qtyHeldByOrder;
        if (Number(prod.qty) > totalAvailable) return `Max Avail: ${totalAvailable}`;
        return null;
    };

    // --- Calculation Logic ---
    const recalculateTotals = (currentOrder) => {
        const products = currentOrder.products || [];
        const subtotal = products.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 0)), 0);
        
        let discount = 0;
        if (currentOrder.discountType === 'Percent') {
            discount = subtotal * (Number(currentOrder.discountValue || 0) / 100);
        } else {
            discount = Number(currentOrder.discountValue || 0);
        }

        const totalAfterDiscount = subtotal - discount;
        const grandTotal = totalAfterDiscount + Number(currentOrder.deliveryCharge || 0);
        const dueAmount = grandTotal - Number(currentOrder.advanceAmount || 0) - Number(currentOrder.collectedAmount || 0);

        return { ...currentOrder, subtotal, grandTotal, dueAmount };
    };

    // --- Handlers ---
    const handleInputChange = (field, value) => {
        setEditedOrder(prev => recalculateTotals({ ...prev, [field]: value }));
    };

    const handleProductChange = (index, field, value) => {
        const newProducts = [...editedOrder.products];
        newProducts[index][field] = value;
        
        // Auto-fill price
        if (field === 'code') {
            const foundItem = inventory.find(i => i.code.toUpperCase() === value.toUpperCase());
            if (foundItem) newProducts[index].price = foundItem.mrp || 0;
        }

        setEditedOrder(prev => recalculateTotals({ ...prev, products: newProducts }));
        
        // Error Check
        const error = getStockError(newProducts[index]);
        setErrors(prev => { 
            const n = { ...prev }; 
            if (error) n[index] = error; 
            else delete n[index]; 
            return n; 
        });
    };

    const addProduct = () => {
        setEditedOrder(prev => ({
            ...prev,
            products: [...prev.products, { code: '', size: '', qty: 1, price: 0 }]
        }));
    };

    const removeProduct = (index) => {
        const newProducts = editedOrder.products.filter((_, i) => i !== index);
        setEditedOrder(prev => recalculateTotals({ ...prev, products: newProducts }));
        setErrors(prev => { const n = { ...prev }; delete n[index]; return n; });
    };

    const saveChanges = () => {
        if (Object.keys(errors).length > 0) {
            alert("Please fix stock errors before saving.");
            return;
        }

        if (onEdit) {
            // Logic for Return Mode vs Normal Edit
            const statusToSave = isReturnMode ? 'Returned' : order.status;
            const noteText = isReturnMode ? 'Returned (Partial/Edited)' : 'Order details edited manually';

            const updatedOrder = {
                ...editedOrder,
                status: statusToSave,
                history: [
                    ...(order.history || []),
                    {
                        status: statusToSave,
                        timestamp: new Date().toISOString(),
                        note: noteText,
                        updatedBy: 'User'
                    }
                ]
            };
            
            // Pass Status + Object
            onEdit(order.id, statusToSave, updatedOrder);
            
            setIsEditing(false);
            if (isReturnMode) onClose(); // Close popup after returning
        }
    };

    const handleReorder = () => {
        if (!confirm("Are you sure you want to Reorder this returned item? This will reset the order to 'Pending'.")) return;
        
        const reorderUpdate = {
            ...editedOrder,
            status: 'Pending',
            trackingId: '',
            collectedAmount: 0,
            returnCashReceived: 0,
            isDeliveryFeeReceived: false,
            revenueAdjustment: 0,
            history: [
                ...(order.history || []),
                {
                    status: 'Pending',
                    timestamp: new Date().toISOString(),
                    note: 'Reordered from Returned status',
                    updatedBy: 'User'
                }
            ]
        };
        
        const finalUpdate = recalculateTotals(reorderUpdate);
        onEdit(order.id, 'Pending', finalUpdate);
        setIsEditing(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            {/* ADDED: Amber border if Return Mode to indicate special action */}
            <div className={`bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden ${isReturnMode ? 'border-4 border-amber-400' : ''}`}>
                
                {/* Header */}
                <div className={`p-4 border-b flex justify-between items-center ${isReturnMode ? 'bg-amber-50' : 'bg-slate-50'}`}>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            {isReturnMode ? (
                                <span className="flex items-center text-amber-700">
                                    <RotateCcw size={20} className="mr-2"/> Process Return
                                </span>
                            ) : (
                                <>
                                    Order #{order.merchantOrderId || order.storeOrderId}
                                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(order.status)}`}>
                                        {order.status}
                                    </span>
                                </>
                            )}
                        </h2>
                        {isReturnMode ? (
                            <p className="text-xs text-amber-600 mt-1">
                                1. Remove items that were KEPT by customer.<br/>
                                2. Adjust Delivery Charge (Return Cost).<br/>
                                3. Click Confirm Return.
                            </p>
                        ) : (
                            <p className="text-xs text-slate-500">{new Date(order.createdAt?.seconds * 1000 || order.date).toLocaleString()}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {!isEditing && onEdit && !isReturnMode && (
                            <button onClick={() => setIsEditing(true)} className="p-2 hover:bg-white rounded-full border border-transparent hover:border-slate-200 transition-all text-blue-600">
                                <Edit2 size={18} />
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-red-50 hover:text-red-600 rounded-full transition-all text-slate-400">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* Customer Info Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h3 className="font-semibold text-slate-700 flex items-center gap-2 border-b pb-2">
                                <User size={16} /> Customer Details
                            </h3>
                            {isEditing ? (
                                <div className="space-y-2">
                                    <input className="w-full p-2 border rounded text-sm" placeholder="Name" value={editedOrder.recipientName} onChange={e => handleInputChange('recipientName', e.target.value)} />
                                    <input className="w-full p-2 border rounded text-sm" placeholder="Phone" value={editedOrder.recipientPhone} onChange={e => handleInputChange('recipientPhone', e.target.value)} />
                                    <textarea className="w-full p-2 border rounded text-sm" placeholder="Address" rows="3" value={editedOrder.recipientAddress} onChange={e => handleInputChange('recipientAddress', e.target.value)} />
                                </div>
                            ) : (
                                <div className="text-sm space-y-1">
                                    <p><span className="font-medium">Name:</span> {order.recipientName}</p>
                                    <p><span className="font-medium">Phone:</span> {order.recipientPhone}</p>
                                    <p className="flex gap-1"><MapPin size={14} className="mt-1 flex-shrink-0" /> {order.recipientAddress}</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <h3 className="font-semibold text-slate-700 flex items-center gap-2 border-b pb-2">
                                <Package size={16} /> Order Info
                            </h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500 text-xs">Source</p>
                                    <p className="font-medium">{order.orderSource}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs">Type</p>
                                    <p className="font-medium">{order.type}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs">Tracking ID</p>
                                    {isEditing ? (
                                        <input className="border rounded px-1 w-full" value={editedOrder.trackingId || ''} onChange={e => handleInputChange('trackingId', e.target.value)} />
                                    ) : (
                                        <p className="font-mono bg-slate-100 px-2 py-0.5 rounded inline-block">{order.trackingId || 'N/A'}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs">Payment</p>
                                    <p className="font-medium">{order.paymentType}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Products Section */}
                    <div>
                        <h3 className="font-semibold text-slate-700 mb-3 flex justify-between items-center">
                            <span>Items ({editedOrder.products?.length})</span>
                            {isEditing && (
                                <button onClick={addProduct} className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded border border-emerald-200 flex items-center hover:bg-emerald-100">
                                    <Plus size={12} className="mr-1"/> Add Item
                                </button>
                            )}
                        </h3>
                        
                        <div className="space-y-2">
                            {editedOrder.products.map((p, i) => {
                                const hasError = errors[i];
                                return (
                                    <div key={i} className={`flex flex-col sm:flex-row gap-2 ${isEditing ? 'bg-slate-50 p-3 rounded-lg border border-slate-200' : 'border-b border-slate-100 pb-2 last:border-0'}`}>
                                        {isEditing ? (
                                            <>
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-slate-400 font-bold uppercase sm:hidden">Code</label>
                                                    <input 
                                                        className={`w-full p-2 border rounded text-sm bg-white ${hasError ? 'border-red-500 bg-red-50' : ''}`} 
                                                        placeholder="Code" 
                                                        value={p.code} 
                                                        onChange={e => handleProductChange(i, 'code', e.target.value)} 
                                                    />
                                                    {hasError && <div className="text-xs text-red-600 font-bold mt-1 flex items-center"><AlertTriangle size={12} className="mr-1"/> {hasError}</div>}
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="w-20">
                                                        <label className="text-[10px] text-slate-400 font-bold uppercase sm:hidden">Size</label>
                                                        <input className="w-full p-2 border rounded text-sm bg-white" placeholder="Size" value={p.size} onChange={e => handleProductChange(i, 'size', e.target.value)} />
                                                    </div>
                                                    <div className="w-20">
                                                        <label className="text-[10px] text-slate-400 font-bold uppercase sm:hidden">Qty</label>
                                                        <input type="number" className="w-full p-2 border rounded text-sm bg-white" placeholder="Qty" value={p.qty} onChange={e => handleProductChange(i, 'qty', e.target.value)} onWheel={disableScroll} />
                                                    </div>
                                                    <div className="w-24">
                                                        <label className="text-[10px] text-slate-400 font-bold uppercase sm:hidden">Price</label>
                                                        <input type="number" className="w-full p-2 border rounded text-sm bg-white" placeholder="Price" value={p.price} onChange={e => handleProductChange(i, 'price', e.target.value)} onWheel={disableScroll} />
                                                    </div>
                                                </div>
                                                <div className="flex items-end sm:w-auto w-full mt-2 sm:mt-0">
                                                    {editedOrder.products.length > 1 && (
                                                        <button 
                                                            onClick={() => removeProduct(i)} 
                                                            className="p-2 bg-white text-red-500 border border-red-100 hover:bg-red-50 rounded sm:w-auto w-full flex justify-center items-center shadow-sm"
                                                            title="Remove (Kept by customer?)"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between items-center w-full">
                                                <div>
                                                    <p className="font-bold text-slate-800">{p.code}</p>
                                                    <p className="text-xs text-slate-500">Size: {p.size} | Qty: {p.qty}</p>
                                                </div>
                                                <p className="font-medium">৳{Number(p.price) * Number(p.qty)}</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Financials */}
                    <div className="bg-slate-50 p-4 rounded-lg space-y-2 border border-slate-100">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Subtotal</span>
                            <span className="font-medium">৳{editedOrder.subtotal}</span>
                        </div>
                        <div className="flex justify-between text-sm items-center">
                            <span className="text-slate-500">Discount</span>
                            {isEditing ? (
                                <div className="flex gap-2 w-32">
                                    <input className="w-full p-1 border rounded text-right" value={editedOrder.discountValue} onChange={e => handleInputChange('discountValue', e.target.value)} onWheel={disableScroll} />
                                </div>
                            ) : (
                                <span className="text-red-500">- ৳{order.discountType === 'Percent' ? (order.subtotal * (order.discountValue/100)) : order.discountValue}</span>
                            )}
                        </div>
                        <div className="flex justify-between text-sm items-center">
                            <span className="text-slate-500">Delivery Charge</span>
                            {isEditing ? (
                                <input className="w-32 p-1 border rounded text-right" value={editedOrder.deliveryCharge} onChange={e => handleInputChange('deliveryCharge', e.target.value)} onWheel={disableScroll} />
                            ) : (
                                <span>৳{order.deliveryCharge}</span>
                            )}
                        </div>
                        <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg">
                            <span>Grand Total</span>
                            <span>৳{editedOrder.grandTotal}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-500 pt-1">
                            <span>Advance / Collected</span>
                            <span>- ৳{(Number(editedOrder.advanceAmount||0) + Number(editedOrder.collectedAmount||0))}</span>
                        </div>
                        <div className="flex justify-between font-bold text-emerald-600 border-t border-dashed border-slate-300 pt-2">
                            <span>Due Amount</span>
                            <span>৳{editedOrder.dueAmount}</span>
                        </div>
                    </div>

                    {/* Special Instructions */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Special Instructions</label>
                        {isEditing ? (
                            <textarea className="w-full p-2 border rounded text-sm bg-yellow-50" rows="2" value={editedOrder.specialInstructions} onChange={e => handleInputChange('specialInstructions', e.target.value)} />
                        ) : (
                            <p className="text-sm bg-yellow-50 p-2 rounded text-slate-700">{order.specialInstructions || 'None'}</p>
                        )}
                    </div>

                    {/* Transaction History */}
                    {/* Hide history while editing to save space/clutter */}
                    {!isEditing && (
                        <div className="pt-4 border-t border-slate-100">
                            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                                <Clock size={16} /> Transaction History
                            </h3>
                            <ol className="relative border-l border-slate-200 ml-2">
                                {(order.history || []).map((h, i) => {
                                    let title = h.status;
                                    const note = (h.note || '').toLowerCase();
                                    
                                    if (title === 'Pending') {
                                        if (i === 0) title = "Order Created";
                                        else if (note.includes('call') || note.includes('attempt')) title = "Call Log";
                                        else if (note.includes('check out') || note.includes('checkout')) title = "Checkout Update";
                                        else if (note.includes('edit') || note.includes('update')) title = "Order Edited";
                                        else if (note.includes('reorder')) title = "Reordered";
                                    }

                                    if (h.status === 'Pending' && title === 'Pending' && i !== 0) return null; 

                                    return (
                                        <li key={i} className="mb-6 ml-4">
                                            <div className={`absolute w-3 h-3 rounded-full mt-1.5 -left-1.5 border border-white ${h.status === 'Delivered' ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                                            <time className="mb-1 text-[10px] font-normal text-slate-400 block">
                                                {new Date(h.timestamp).toLocaleString()}
                                            </time>
                                            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
                                            <p className="text-xs text-slate-600 mt-1">{h.note || 'Status updated'}</p>
                                            {h.status === 'Delivered' && order.collectedAmount > 0 && (
                                                <div className="mt-2 inline-block px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded border border-emerald-100">
                                                    Money Received: ৳{order.collectedAmount}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        </div>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
                    {isEditing ? (
                        <>
                            <button onClick={() => { setIsEditing(false); if(isReturnMode) onClose(); else setEditedOrder(JSON.parse(JSON.stringify(order))); setErrors({}); }} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded">Cancel</button>
                            <div className="flex gap-2">
                                {/* REORDER BUTTON */}
                                {(order.status || '').toLowerCase().includes('return') && !isReturnMode && (
                                    <button onClick={handleReorder} className="px-4 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700 flex items-center gap-2">
                                        <RefreshCw size={18} /> Reorder
                                    </button>
                                )}
                                
                                {/* SAVE / CONFIRM RETURN BUTTON */}
                                <button 
                                    onClick={saveChanges} 
                                    className={`px-6 py-2 text-white font-bold rounded shadow flex items-center gap-2 ${isReturnMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                >
                                    {isReturnMode ? (
                                        <>
                                            <RotateCcw size={18} /> Confirm Return
                                        </>
                                    ) : (
                                        <>
                                            <Save size={18} /> Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="w-full flex gap-3">
                            <button className="flex-1 py-2 text-slate-600 font-bold border border-slate-300 rounded hover:bg-slate-100" onClick={onClose}>
                                Close
                            </button>
                            <button className="flex-1 py-2 bg-slate-800 text-white font-bold rounded flex justify-center items-center gap-2 hover:bg-slate-900" onClick={() => window.print()}>
                                <Printer size={18} /> Print Invoice
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderDetailsPopup;