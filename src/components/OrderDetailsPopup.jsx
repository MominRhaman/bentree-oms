import React, { useState, useEffect } from 'react';
import { X, Edit2, Save, Trash2, Printer, MapPin, Phone, User, Package, Plus, Clock, RefreshCw, AlertTriangle, RotateCcw, CheckCircle, Eye, Zap, ArrowLeft } from 'lucide-react';
import { disableScroll, updateInventoryStock } from '../utils';
import InvoiceGenerator from './InvoiceGenerator';

const OrderDetailsPopup = ({ order, onClose, getStatusColor, onEdit, inventory = [], isReturnMode = false }) => {
    const [isEditing, setIsEditing] = useState(isReturnMode);
    const [editedOrder, setEditedOrder] = useState(null);
    const [errors, setErrors] = useState({});
    
    // --- State for History Detail Popup & Invoice ---
    const [historyModalData, setHistoryModalData] = useState(null);
    const [showInvoice, setShowInvoice] = useState(false);

    // Sync state when order opens
    useEffect(() => {
        if (order) {
            const deepCopy = JSON.parse(JSON.stringify(order));
            setEditedOrder(deepCopy);
            setErrors({});
            if (isReturnMode) setIsEditing(true); 
        }
    }, [order, isReturnMode]);

    if (!order || !editedOrder) return null;

    // --- Helper: Get Sizes for a Code ---
    const getAvailableSizes = (code) => {
        if (!code || !inventory.length) return [];
        const item = inventory.find(i => i.code.toUpperCase() === code.toUpperCase());
        if (!item) return [];
        if (item.type === 'Variable' && item.stock) {
            return Object.keys(item.stock);
        }
        return [];
    };

    // --- Stock Logic ---
    const getStockError = (prod) => {
        if (!inventory.length) return null;
        if (!prod.code) return null;
        const item = inventory.find(i => i.code.toUpperCase() === prod.code.toUpperCase());
        if (!item) return "Product not found";

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
        
        const collected = Number(currentOrder.collectedAmount || 0);
        const advance = Number(currentOrder.advanceAmount || 0);
        const dueAmount = grandTotal - advance - collected;

        return { ...currentOrder, subtotal, grandTotal, dueAmount, collectedAmount: collected };
    };

    // --- Handlers ---
    const handleInputChange = (field, value) => {
        setEditedOrder(prev => recalculateTotals({ ...prev, [field]: value }));
    };

    const handleProductChange = (index, field, value) => {
        const newProducts = [...editedOrder.products];
        newProducts[index][field] = value;
        
        if (field === 'code' && inventory.length > 0) {
            const foundItem = inventory.find(i => i.code.toUpperCase() === value.toUpperCase());
            if (foundItem) {
                newProducts[index].price = foundItem.mrp || 0;
                if(foundItem.type === 'Variable' && foundItem.stock) {
                    const sizes = Object.keys(foundItem.stock);
                    if(sizes.length > 0) newProducts[index].size = sizes[0];
                }
            }
        }

        setEditedOrder(prev => recalculateTotals({ ...prev, products: newProducts }));
        
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
        setErrors(prev => { 
            const n = { ...prev }; 
            delete n[index]; 
            return n; 
        });
    };

    const sanitizeForFirebase = (obj) => {
        return JSON.parse(JSON.stringify(obj));
    };

    // --- SAVE / CONFIRM RETURN HANDLER ---
    const saveChanges = async () => {
        if (Object.keys(errors).length > 0) {
            alert("Please fix stock errors before saving.");
            return;
        }

        if (onEdit) {
            const safeStatus = typeof order.status === 'string' ? order.status : (editedOrder.status || 'Pending');
            const statusToSave = isReturnMode ? 'Returned' : safeStatus;
            
            const prevProductsSnapshot = (order.products || []).map(p => 
                `[Code: ${p.code || '-'} | Size: ${p.size || '-'} | Qty: ${p.qty || 0} | Price: ${p.price || 0}]`
            ).join('  ,  ');

            const noteBase = isReturnMode ? 'Returned (Partial/Edited)' : 'Order Details Updated';
            const noteText = `${noteBase}. Previous Content: { ${prevProductsSnapshot || 'None'} }`;

            let originalChargeToSave = order.originalDeliveryCharge; 
            if (isReturnMode) {
                if (!originalChargeToSave) {
                    originalChargeToSave = Number(order.deliveryCharge || 0);
                }
            }

            const rawUpdatedOrder = {
                ...editedOrder,
                status: statusToSave,
                originalDeliveryCharge: originalChargeToSave, 
                history: [
                    ...(order.history || []),
                    {
                        status: statusToSave,
                        timestamp: new Date().toISOString(),
                        note: noteText,
                        updatedBy: 'Admin'
                    }
                ]
            };
            
            const sanitizedOrder = sanitizeForFirebase(rawUpdatedOrder);
            // TRIGGER ATOMIC INVENTORY UPDATE via handleEditOrderWithStock in App.jsx
            onEdit(order.id, statusToSave, sanitizedOrder);
            
            setIsEditing(false);
            if (isReturnMode) onClose();
        } else {
            console.error("onEdit function is missing!");
        }
    };

    const handleReorder = () => {
        if (!confirm("Are you sure you want to Reorder?")) return;
        const reorderUpdate = {
            ...editedOrder,
            status: 'Pending',
            trackingId: '',
            merchantOrderId: '', 
            storeOrderId: '',    
            collectedAmount: 0,
            returnCashReceived: 0,
            isDeliveryFeeReceived: false,
            revenueAdjustment: 0,
            originalDeliveryCharge: 0, 
            history: [
                ...(order.history || []),
                {
                    status: 'Pending',
                    timestamp: new Date().toISOString(),
                    note: 'Reordered',
                    updatedBy: 'Admin'
                }
            ]
        };
        
        onEdit(order.id, 'Pending', sanitizeForFirebase(recalculateTotals(reorderUpdate)));
        setIsEditing(false);
        onClose();
    };

    // --- INVOICE VIEW ---
    if (showInvoice) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden">
                    <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                        <button onClick={() => setShowInvoice(false)} className="flex items-center gap-2 text-slate-600 font-bold text-xs uppercase hover:text-slate-900 transition-colors">
                            <ArrowLeft size={16} /> Back to Details
                        </button>
                        <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded font-bold text-xs flex items-center gap-2 shadow-md">
                            <Printer size={14} /> Print Now
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto bg-white p-4">
                        <InvoiceGenerator orders={[editedOrder]} />
                    </div>
                </div>
            </div>
        );
    }

    const safeStatus = (typeof order.status === 'string') ? order.status : 'Unknown';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className={`bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden ${isReturnMode ? 'border-4 border-amber-400' : ''}`}>
                
                {/* --- Header --- */}
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
                                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(safeStatus)}`}>
                                        {safeStatus}
                                    </span>
                                    {order.isExpress && (
                                        <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-1 rounded-full border border-amber-200 flex items-center gap-1">
                                            <Zap size={10} className="fill-current" /> Express
                                        </span>
                                    )}
                                </>
                            )}
                        </h2>
                        {isReturnMode ? (
                            <p className="text-xs text-amber-600 mt-1">
                                1. Remove kept items. 2. Adjust Delivery Charge. 3. Confirm.
                            </p>
                        ) : (
                            <p className="text-xs text-slate-500">{new Date(order.createdAt?.seconds * 1000 || order.date).toLocaleString()}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {/* Always visible print button */}
                        <button 
                            onClick={() => setShowInvoice(true)} 
                            className="p-2 hover:bg-white rounded-full border border-transparent hover:border-slate-200 transition-all text-slate-600"
                            title="Print Invoice"
                        >
                            <Printer size={18} />
                        </button>

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
                    
                    {/* Customer Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h3 className="font-semibold text-slate-700 flex items-center gap-2 border-b pb-2">
                                <User size={16} /> Customer Details
                            </h3>
                            {isEditing ? (
                                <div className="space-y-2">
                                    <input className="w-full p-2 border rounded text-sm" value={editedOrder.recipientName} onChange={e => handleInputChange('recipientName', e.target.value)} placeholder="Name" />
                                    <input className="w-full p-2 border rounded text-sm" value={editedOrder.recipientPhone} onChange={e => handleInputChange('recipientPhone', e.target.value)} placeholder="Phone" />
                                    <textarea className="w-full p-2 border rounded text-sm" rows="3" value={editedOrder.recipientAddress} onChange={e => handleInputChange('recipientAddress', e.target.value)} placeholder="Address" />
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
                                <div className="col-span-2">
                                    <p className="text-slate-500 text-xs">Order ID</p>
                                    {isEditing ? (
                                        <input className="border rounded px-2 py-1 w-full text-sm bg-yellow-50 focus:bg-white transition-colors" value={editedOrder.merchantOrderId || editedOrder.storeOrderId || ''} onChange={e => { handleInputChange('merchantOrderId', e.target.value); handleInputChange('storeOrderId', e.target.value); }} />
                                    ) : (
                                        <p className="font-mono bg-slate-100 px-2 py-0.5 rounded inline-block">{order.merchantOrderId || order.storeOrderId || 'N/A'}</p>
                                    )}
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 text-xs">Check Out Status</p>
                                    {isEditing ? (
                                        <select className="border rounded px-2 py-1 w-full text-sm" value={editedOrder.checkOutStatus || 'Pending'} onChange={e => handleInputChange('checkOutStatus', e.target.value)}>
                                            <option value="Pending">Pending</option>
                                            <option value="Completed">Completed</option>
                                        </select>
                                    ) : (
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${editedOrder.checkOutStatus === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                            {editedOrder.checkOutStatus || 'Pending'}
                                        </span>
                                    )}
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
                                const availableSizes = getAvailableSizes(p.code);
                                return (
                                    <div key={i} className={`flex flex-col sm:flex-row gap-2 ${isEditing ? 'bg-slate-50 p-3 rounded-lg border border-slate-200' : 'border-b border-slate-100 pb-2 last:border-0'}`}>
                                        {isEditing ? (
                                            <>
                                                <div className="flex-1">
                                                    <input className={`w-full p-2 border rounded text-sm bg-white ${hasError ? 'border-red-500 bg-red-50' : ''}`} value={p.code} onChange={e => handleProductChange(i, 'code', e.target.value)} placeholder="Code"/>
                                                    {hasError && <div className="text-xs text-red-600 font-bold mt-1 flex items-center"><AlertTriangle size={12} className="mr-1"/> {hasError}</div>}
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="w-20">
                                                        {availableSizes.length > 0 ? (
                                                            <select className="w-full p-2 border rounded text-sm bg-white" value={p.size} onChange={e => handleProductChange(i, 'size', e.target.value)}>
                                                                {!availableSizes.includes(p.size) && <option value={p.size}>{p.size}</option>}
                                                                {availableSizes.map(sz => <option key={sz} value={sz}>{sz}</option>)}
                                                            </select>
                                                        ) : (
                                                            <input className="w-full p-2 border rounded text-sm bg-white" value={p.size} onChange={e => handleProductChange(i, 'size', e.target.value)} placeholder="Size"/>
                                                        )}
                                                    </div>
                                                    <div className="w-20"><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={p.qty} onChange={e => handleProductChange(i, 'qty', e.target.value)} onWheel={disableScroll} /></div>
                                                    <div className="w-24"><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={p.price} onChange={e => handleProductChange(i, 'price', e.target.value)} onWheel={disableScroll} /></div>
                                                    <button onClick={() => removeProduct(i)} className="p-2 bg-white text-red-500 border border-red-100 hover:bg-red-50 rounded shadow-sm"><Trash2 size={18} /></button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between items-center w-full">
                                                <div><p className="font-bold text-slate-800">{p.code}</p><p className="text-xs text-slate-500">Size: {p.size} | Qty: {p.qty}</p></div>
                                                <p className="font-medium">৳{Number(p.price) * Number(p.qty)}</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="bg-slate-50 p-4 rounded-lg space-y-2 border border-slate-100">
                        <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-medium">৳{editedOrder.subtotal}</span></div>
                        <div className="flex justify-between text-sm items-center">
                            <span className="text-slate-500">Discount</span>
                            {isEditing ? <input className="w-24 p-1 border rounded text-right" value={editedOrder.discountValue} onChange={e => handleInputChange('discountValue', e.target.value)} onWheel={disableScroll} /> : <span className="text-red-500">- ৳{order.discountType === 'Percent' ? (order.subtotal * (order.discountValue/100)) : order.discountValue}</span>}
                        </div>
                        <div className="flex justify-between text-sm items-center">
                            <span className="text-slate-500">Delivery Charge</span>
                            {isEditing ? <input className="w-24 p-1 border rounded text-right" value={editedOrder.deliveryCharge} onChange={e => handleInputChange('deliveryCharge', e.target.value)} onWheel={disableScroll} /> : <span>৳{order.deliveryCharge}</span>}
                        </div>
                        <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg"><span>Grand Total</span><span>৳{editedOrder.grandTotal}</span></div>
                        <div className="flex justify-between text-sm text-slate-500 pt-1 items-center">
                            <span>Advance / Collected</span>
                            {isEditing ? <input className="w-32 p-1 border rounded text-right bg-white" value={editedOrder.collectedAmount} onChange={e => handleInputChange('collectedAmount', e.target.value)} onWheel={disableScroll} /> : <span>- ৳{(Number(editedOrder.advanceAmount||0) + Number(editedOrder.collectedAmount||0))}</span>}
                        </div>
                        <div className="flex justify-between font-bold text-emerald-600 border-t border-dashed border-slate-300 pt-2">
                            <span>{editedOrder.dueAmount < 0 ? "Refund Due" : "Due Amount"}</span>
                            <span className={editedOrder.dueAmount < 0 ? "text-red-600" : "text-emerald-600"}>{editedOrder.dueAmount < 0 ? `- ৳${Math.abs(editedOrder.dueAmount)}` : `৳${editedOrder.dueAmount}`}</span>
                        </div>
                    </div>

                    {/* Special Instructions */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Special Instructions</label>
                        {isEditing ? (
                            <textarea className="w-full p-2 border rounded text-sm bg-yellow-50" rows="2" value={editedOrder.specialInstructions || ''} onChange={e => handleInputChange('specialInstructions', e.target.value)} />
                        ) : (
                            <p className="text-sm bg-yellow-50 p-2 rounded text-slate-700">{order.specialInstructions || 'None'}</p>
                        )}
                    </div>

                    {/* History */}
                    {!isEditing && (
                        <div className="pt-4 border-t border-slate-100">
                            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2"><Clock size={16} /> Transaction History</h3>
                            <ol className="relative border-l border-slate-200 ml-2">
                                {(order.history || []).map((h, i) => (
                                    <li key={i} className="mb-6 ml-4">
                                        <div className="absolute w-3 h-3 bg-slate-300 rounded-full mt-1.5 -left-1.5 border border-white"></div>
                                        <time className="text-[10px] text-slate-400">{new Date(h.timestamp).toLocaleString()}</time>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-bold text-slate-800">{h.status}</h3>
                                            {h.note?.includes('Previous Content:') && (
                                                <button onClick={() => setHistoryModalData(h.note)} className="text-blue-500 hover:text-blue-700 bg-blue-50 p-1 rounded-full"><Eye size={14} /></button>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-600">{h.note || 'Status updated'}</p>
                                    </li>
                                ))}
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
                                {(safeStatus || '').toLowerCase().includes('return') && !isReturnMode && (
                                    <button onClick={handleReorder} className="px-4 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700 flex items-center gap-2">
                                        <RefreshCw size={18} /> Reorder
                                    </button>
                                )}
                                <button onClick={saveChanges} className={`px-6 py-2 text-white font-bold rounded shadow flex items-center gap-2 ${isReturnMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                                    {isReturnMode ? <><RotateCcw size={18} /> Confirm Return</> : <><Save size={18} /> Save Changes</>}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="w-full flex gap-3">
                            <button className="flex-1 py-2 text-slate-600 font-bold border border-slate-300 rounded hover:bg-slate-100" onClick={onClose}>Close</button>
                            <button className="flex-1 py-2 bg-slate-800 text-white font-bold rounded flex justify-center items-center gap-2 hover:bg-slate-900" onClick={() => setShowInvoice(true)}>
                                <Printer size={18} /> Print Invoice
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* History Detail Modal */}
            {historyModalData && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 relative">
                        <button onClick={() => setHistoryModalData(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        <h3 className="font-bold text-lg text-slate-800 mb-4 border-b pb-2">History Details</h3>
                        <div className="bg-slate-50 p-4 rounded border border-slate-100 text-sm text-slate-700 font-mono whitespace-pre-wrap">{historyModalData}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderDetailsPopup;