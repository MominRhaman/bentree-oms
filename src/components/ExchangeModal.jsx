import React, { useState } from 'react';
import { Plus, Trash2, X, RefreshCw, AlertCircle } from 'lucide-react';
import { updateInventoryStock } from '../utils';

// Added 'user' to the props list below
const ExchangeModal = ({ order, onClose, onConfirm, onCreate, inventory, user }) => {
    // Detect if this is completing a partial exchange that was already created
    const isCompletingPartialExchange = order.isPartialExchange === true || order.exchangeDetails?.isPartial === true;
    const originalOrderId = order.originalOrderId || null;
    
    // Debug: Log props to help identify the issue
    console.log('ExchangeModal Props:', { 
        hasOnCreate: !!onCreate, 
        hasOnConfirm: !!onConfirm,
        orderId: order?.merchantOrderId || order?.storeOrderId,
        isCompleting: isCompletingPartialExchange
    });

    // 1. Initialize with Old Products
    const [newProducts, setNewProducts] = useState(
        order.products.map(p => ({
            code: p.code,
            size: p.size || '', 
            qty: p.qty,
            price: p.price
        }))
    );
    const [newDeliveryCost, setNewDeliveryCost] = useState('');
    
    // --- Discount States ---
    const [discountInput, setDiscountInput] = useState(''); 
    const [discountType, setDiscountType] = useState('amount');
    
    // --- NEW: Partial Exchange Items Selection ---
    const [partialExchangeItems, setPartialExchangeItems] = useState(new Set());

    // --- REVISED CALCULATIONS ---

    // A. Calculate New Product Value (After Discount)
    const newProductTotal = newProducts.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.qty || 0)), 0);
    
    let actualDiscountAmount = 0;
    const rawDiscount = Number(discountInput || 0);
    
    if (discountType === 'percent') {
        actualDiscountAmount = (newProductTotal * rawDiscount) / 100;
    } else {
        actualDiscountAmount = rawDiscount;
    }
    
    // New Product Net Value
    const newProductValue = newProductTotal - actualDiscountAmount;

    // B. Calculate Old Product Value
    const oldDeliveryCharge = Number(order.deliveryCharge || 0);
    const oldGrandTotal = Number(order.grandTotal || 0);
    const oldProductValue = oldGrandTotal - oldDeliveryCharge; 

    // Calculate the absolute amount of the old discount for display
    const oldDiscountAbsolute = (Number(order.subtotal || 0) - oldProductValue);

    // C. Calculate Difference (Product Level)
    const productDifference = newProductValue - oldProductValue;

    // D. Final Adjustment (Payable/Refund)
    // For all order, advance money and delivery complete collection money will be added
    const totalCollectedSoFar = Number(order.advanceAmount || 0) + Number(order.collectedAmount || 0);
    const finalAdjustment = productDifference + Number(newDeliveryCost || 0);

    // E. Financials for Database (Sales Report)
    const totalSystemDeliveryCharge = oldDeliveryCharge + Number(newDeliveryCost || 0);
    
    // 2. System Grand Total = New Product Value + Total Delivery Income
    const systemNewGrandTotal = newProductValue + totalSystemDeliveryCharge;

    const togglePartialExchange = (index) => {
        setPartialExchangeItems(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    // Helper function to get clean date
    const getCleanDate = () => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    };

    const sanitizeForFirebase = (obj) => {
        return JSON.parse(JSON.stringify(obj));
    };

    // --- NEW: Handle Partial Exchange Process ---
    const handlePartialExchangeProcess = async () => {
        const exchangedItems = order.products.filter((_, i) => partialExchangeItems.has(i));
        const keptItems = order.products.filter((_, i) => !partialExchangeItems.has(i));
        // Get newly added items for the partial exchange order
        const itemsToCreateInNewOrder = newProducts.filter((_, i) => partialExchangeItems.has(i));

        if (exchangedItems.length === 0) {
            alert("Please mark at least one item for partial exchange.");
            return;
        }

        // Generate a new Exchange Order ID
        const originalOrderId = order.merchantOrderId || order.storeOrderId || 'N/A';
        const exchangeOrderId = `${originalOrderId}-EXC-${Date.now().toString().slice(-6)}`;
        
        // --- NEW REQUIREMENT CALCULATIONS ---
        // Subtotal = Product Value (Raw Total)
        const partialProductValue = itemsToCreateInNewOrder.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 0)), 0);
        
        // Calculate proportional discount for this partial order
        const partialDiscount = actualDiscountAmount > 0 ? (partialProductValue / newProductTotal) * actualDiscountAmount : 0;
        
        // Grand Total = (Product Value - Discount) + New Delivery Charge
        const partialDeliveryCharge = Number(newDeliveryCost || 0);
        const partialGrandTotal = (partialProductValue - partialDiscount) + partialDeliveryCharge;

        // 1. Create a NEW Order Record specifically for the Exchanged items
        const exchangeOrderRecord = {
            ...order,
            merchantOrderId: exchangeOrderId,
            storeOrderId: exchangeOrderId,
            products: itemsToCreateInNewOrder,
            status: 'Exchanged',
            orderSource: order.orderSource,
            type: order.type,
            date: getCleanDate(),
            createdAt: { seconds: Math.floor(Date.now() / 1000) },
            isPartialExchange: true,
            originalOrderId: originalOrderId,
            subtotal: partialProductValue, // Requirement: Subtotal = Product Value
            discountValue: partialDiscount,
            discountType: 'amount',
            deliveryCharge: partialDeliveryCharge, 
            grandTotal: partialGrandTotal, // Requirement: (Product Value - Discount) + Delivery
            dueAmount: partialGrandTotal, 
            advanceAmount: 0,
            collectedAmount: 0,
            exchangeDetails: {
                exchangeDate: getCleanDate(),
                originalProducts: exchangedItems,
                newProducts: itemsToCreateInNewOrder, 
                priceDeviation: 0,
                isPartial: true
            },
            history: [{
                status: 'Exchanged',
                timestamp: new Date().toISOString(),
                note: `Partial Exchange processed. Order: ${exchangeOrderId}. Delivery Applied: ৳${partialDeliveryCharge}`,
                updatedBy: user?.displayName || 'Admin'
            }]
        };

        // 2. Calculate financials for kept items (Original Order)
        const keptSubtotal = keptItems.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 0)), 0);
        
        let keptDiscount = 0;
        if (order.discountType === 'Percent') {
            keptDiscount = keptSubtotal * (Number(order.discountValue || 0) / 100);
        } else {
            const originalSubtotal = order.subtotal || 1;
            keptDiscount = (keptSubtotal / originalSubtotal) * Number(order.discountValue || 0);
        }
        
        const keptGrandTotal = keptSubtotal - keptDiscount + Number(order.deliveryCharge || 0);
        
        // Logic: During dispatch, original order shows due amount correctly
        const keptDueAmount = Math.max(0, keptGrandTotal - totalCollectedSoFar);

        const originalStatus = keptItems.length === 0 ? 'Exchanged' : order.status;

        // 3. Update the ORIGINAL Order entry
        const updatedOriginalOrder = {
            ...order,
            products: keptItems,
            status: originalStatus, 
            subtotal: keptSubtotal,
            grandTotal: keptGrandTotal,
            dueAmount: keptDueAmount,
            history: [
                ...(order.history || []),
                {
                    status: originalStatus,
                    timestamp: new Date().toISOString(),
                    note: `Partial Exchange processed. ${exchangedItems.length} item(s) marked for exchange. Exchange Order ID: ${exchangeOrderId}`,
                    updatedBy: user?.displayName || 'Admin'
                }
            ]
        };

        try {
            const sanitizedExchangeOrder = sanitizeForFirebase(exchangeOrderRecord);
            
            if (!onCreate) {
                console.error('❌ CRITICAL: onCreate function not provided');
                throw new Error('onCreate function not provided.');
            }

            console.log('🔄 Creating partial exchange order...');
            await onCreate(sanitizedExchangeOrder);

            await new Promise(resolve => setTimeout(resolve, 500));

            console.log('📝 Updating original order...');
            const sanitizedOriginalOrder = sanitizeForFirebase(updatedOriginalOrder);
            await onConfirm(order.id, updatedOriginalOrder.status, sanitizedOriginalOrder);

            onClose();
            alert(`Partial Exchange processed successfully!\n\nNew Delivery Charge Applied: ৳${partialDeliveryCharge}`);
        } catch (error) {
            console.error("❌ Error processing partial exchange:", error);
            alert(`Failed: ${error.message || 'Unknown error'}`);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (partialExchangeItems.size > 0 && !isCompletingPartialExchange) {
            await handlePartialExchangeProcess();
            return;
        }
        
        for (const p of newProducts) {
            if (!p.code) continue;
            const invItem = inventory.find(i => i.code.toUpperCase() === p.code.trim().toUpperCase());
            if (!invItem) { alert(`Product ${p.code} not found.`); return; }
            
            const qtyNeeded = Number(p.qty);
            if (invItem.type === 'Variable') {
                const sizeKey = p.size?.trim().toUpperCase();
                const stockVal = invItem.stock?.[Object.keys(invItem.stock).find(k => k.toUpperCase() === sizeKey)];
                if ((stockVal || 0) < qtyNeeded) { alert(`Insufficient stock for ${p.code} (${p.size})`); return; }
            } else if (invItem.totalStock < qtyNeeded) {
                alert(`Insufficient stock for ${p.code}`); return; }
        }

        const updatedPayload = {
            ...order,
            products: newProducts.map(p => ({
                ...p,
                code: p.code.toUpperCase(),
                size: p.size?.toUpperCase() || '',
                price: Number(p.price),
                qty: Number(p.qty)
            })),
            subtotal: newProductTotal, // Requirement: Subtotal = Product Value
            discountValue: actualDiscountAmount,
            discountType: discountType === 'percent' ? 'Percent' : 'Amount',
            grandTotal: systemNewGrandTotal, // Requirement: (Product Total - Discount) + Delivery
            deliveryCharge: totalSystemDeliveryCharge,
            dueAmount: finalAdjustment > 0 ? finalAdjustment : 0,
            refundAmount: finalAdjustment < 0 ? Math.abs(finalAdjustment) : 0,
            advanceAmount: totalCollectedSoFar,
            status: 'Exchanged',
            exchangeDetails: {
                originalProducts: order.exchangeDetails?.originalProducts || order.products,
                newProducts: newProducts.map(p => ({
                    ...p,
                    code: p.code.toUpperCase(),
                    size: p.size?.toUpperCase() || '',
                    price: Number(p.price),
                    qty: Number(p.qty)
                })),
                priceDeviation: finalAdjustment,
                exchangeDate: new Date().toISOString().split('T')[0],
                isPartial: isCompletingPartialExchange,
                originalOrderId: originalOrderId || undefined
            },
            history: [
                ...(order.history || []),
                {
                    status: 'Exchanged',
                    timestamp: new Date().toISOString(),
                    note: isCompletingPartialExchange 
                        ? `Partial Exchange completed. Adj: ৳${finalAdjustment}`
                        : `Full Exchange completed. Adj: ৳${finalAdjustment}`,
                    updatedBy: user?.displayName || 'Admin'
                }
            ]
        };

        await onConfirm(order.id, 'Exchanged', updatedPayload);
        onClose();
        alert(`Exchange completed successfully!`);
    };

    const updateNewProduct = (idx, field, val) => {
        const np = [...newProducts];
        np[idx][field] = val;
        if (field === 'code') {
            const normalizedCode = val.trim().toUpperCase();
            const foundItem = inventory.find(i => i.code.toUpperCase() === normalizedCode);
            if (foundItem) {
                np[idx].price = foundItem.mrp || '';
                if (foundItem.type === 'Variable' && foundItem.stock) {
                    const sizes = Object.keys(foundItem.stock);
                    if (sizes.length > 0) np[idx].size = sizes[0];
                } else {
                    np[idx].size = '';
                }
            }
        }
        setNewProducts(np);
    };

    const addProduct = () => setNewProducts([...newProducts, { code: '', size: '', qty: 1, price: '' }]);
    const removeProduct = (idx) => { 
        if (newProducts.length > 0) setNewProducts(newProducts.filter((_, i) => i !== idx));
        setPartialExchangeItems(prev => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <RefreshCw size={20} /> 
                        {isCompletingPartialExchange ? 'Complete Partial Exchange' : 'Process Exchange'}
                    </h3>
                    <button onClick={onClose}><X size={24} className="text-slate-400" /></button>
                </div>
                
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    <div className="overflow-y-auto pr-2 flex-1">
                        <h4 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">
                            {isCompletingPartialExchange ? 'New Items to Give:' : 'Product Items:'}
                        </h4>
                        {newProducts.map((p, i) => {
                            const invItem = inventory.find(inv => inv.code.toUpperCase() === (p.code || '').toUpperCase());
                            const availableSizes = (invItem && invItem.type === 'Variable' && invItem.stock) ? Object.keys(invItem.stock) : [];

                            return (
                                <div key={i} className="flex flex-col sm:flex-row gap-2 mb-3 bg-slate-50 p-3 rounded border border-slate-200">
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Code</label>
                                        <input placeholder="Code" value={p.code} onChange={e => updateNewProduct(i, 'code', e.target.value)} className="border p-2 w-full rounded text-sm font-medium" required />
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="w-24">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Size</label>
                                            {availableSizes.length > 0 ? (
                                                <select value={p.size} onChange={e => updateNewProduct(i, 'size', e.target.value)} className="border p-2 w-full rounded text-sm bg-white">
                                                    {!availableSizes.includes(p.size) && p.size && <option value={p.size}>{p.size}</option>}
                                                    {availableSizes.map(sz => <option key={sz} value={sz}>{sz}</option>)}
                                                </select>
                                            ) : (
                                                <input placeholder="Size" value={p.size} onChange={e => updateNewProduct(i, 'size', e.target.value)} className="border p-2 w-full rounded text-sm" />
                                            )}
                                        </div>
                                        <div className="w-16">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Qty</label>
                                            <input type="number" value={p.qty} onChange={e => updateNewProduct(i, 'qty', e.target.value)} onWheel={e => e.target.blur()} className="border p-2 w-full rounded text-sm" required />
                                        </div>
                                        <div className="w-24">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Price</label>
                                            <input type="number" value={p.price} onChange={e => updateNewProduct(i, 'price', e.target.value)} onWheel={e => e.target.blur()} className="border p-2 w-full rounded text-sm" required />
                                        </div>
                                    </div>
                                    <div className="flex items-end gap-3 ml-2 border-l pl-3 border-slate-300">
                                        {!isCompletingPartialExchange && (
                                            <label className="flex flex-col items-center cursor-pointer group">
                                                <span className="text-[9px] font-black text-yellow-600 uppercase mb-0.5">Exchange</span>
                                                <input type="checkbox" className="w-5 h-5 rounded border-yellow-300 text-yellow-600 focus:ring-yellow-500 cursor-pointer shadow-sm" checked={partialExchangeItems.has(i)} onChange={() => togglePartialExchange(i)} />
                                            </label>
                                        )}
                                        <button type="button" onClick={() => removeProduct(i)} className="text-red-500 hover:bg-red-100 p-2 rounded bg-white border border-red-200"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            );
                        })}
                        <button type="button" onClick={addProduct} className="text-xs text-blue-600 font-bold mb-4 flex items-center mt-2 p-3 hover:bg-blue-50 rounded w-full justify-center border border-dashed border-blue-300 bg-blue-50">
                            <Plus size={14} className="mr-1" /> Add New Item
                        </button>
                    </div>

                    <div className="border-t pt-4 mt-2 bg-slate-50 p-4 rounded-lg">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-700 uppercase block mb-1">New Delivery Cost</label>
                                    <input type="number" className="w-full border p-2 rounded shadow-sm" value={newDeliveryCost} onChange={e => setNewDeliveryCost(e.target.value)} onWheel={e => e.target.blur()} placeholder="0" disabled={partialExchangeItems.size > 0 && !isCompletingPartialExchange} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-700 uppercase block mb-1">New Discount</label>
                                    <div className="flex">
                                        <input type="number" className="w-full border p-2 rounded-l border-r-0 outline-none shadow-sm" value={discountInput} onChange={e => setDiscountInput(e.target.value)} onWheel={e => e.target.blur()} placeholder="0" disabled={partialExchangeItems.size > 0 && !isCompletingPartialExchange} />
                                        <select className="border p-2 rounded-r bg-white text-slate-700 font-bold outline-none border-l-0 shadow-sm" value={discountType} onChange={(e) => setDiscountType(e.target.value)} disabled={partialExchangeItems.size > 0 && !isCompletingPartialExchange}>
                                            <option value="amount">Tk</option>
                                            <option value="percent">%</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            {(partialExchangeItems.size === 0 || isCompletingPartialExchange) && (
                                <div className="text-right space-y-1">
                                    <h4 className="font-bold text-slate-700 border-b pb-1 mb-2">Calculation Breakdown</h4>
                                    <div className="text-xs text-slate-500 flex justify-between"><span>New Items Total:</span><span>৳ {newProductTotal}</span></div>
                                    <div className="text-xs text-slate-500 flex justify-between"><span>New Discount {discountType === 'percent' && discountInput ? `(${discountInput}%)` : ''}:</span><span className="text-red-500">- ৳ {Number(actualDiscountAmount).toFixed(0)}</span></div>
                                    <div className="font-bold text-slate-800 flex justify-between border-t border-slate-200 pt-1 mt-1"><span>New Product Value:</span><span>৳ {newProductValue.toFixed(0)}</span></div>
                                    <div className="text-xs text-blue-600 flex justify-between mt-2 font-medium"><span>Old Item Value:</span><span>- ৳ {oldProductValue}</span></div>
                                    {oldDiscountAbsolute > 0 && (
                                        <div className="text-xs text-slate-400 flex justify-between italic">
                                            <span>Incl. Old Discount {order.discountType === 'Percent' ? `(${order.discountValue}%)` : ''}:</span>
                                            <span>- ৳ {oldDiscountAbsolute.toFixed(0)}</span>
                                        </div>
                                    )}
                                    {oldDeliveryCharge > 0 && (
                                        <div className="text-xs text-slate-400 flex justify-between italic"><span>Delivery Charge (Included):</span><span>৳ {oldDeliveryCharge}</span></div>
                                    )}
                                    <div className="text-xs text-emerald-600 flex justify-between font-medium"><span>Advance/Collected:</span><span>- ৳ {totalCollectedSoFar}</span></div>
                                    <div className="border-b border-dashed border-slate-300 my-1"></div>
                                    <div className="text-xs text-slate-500 flex justify-between"><span>Product Diff:</span><span>৳ {productDifference.toFixed(0)}</span></div>
                                    <div className="text-xs text-slate-500 flex justify-between mt-1"><span>New Delivery:</span><span>+ ৳ {Number(newDeliveryCost || 0)}</span></div>
                                    <div className={`flex justify-between items-center mt-3 p-2 rounded ${finalAdjustment >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                        <span className="font-bold uppercase text-xs">{finalAdjustment >= 0 ? 'Net Due:' : 'Refund Amount:'}</span>
                                        <span className="font-bold text-lg">৳ {Math.abs(finalAdjustment).toFixed(0)}</span>
                                    </div>
                                </div>
                            )}
                            {partialExchangeItems.size > 0 && !isCompletingPartialExchange && (
                                <div className="flex items-center justify-center">
                                    <p className="text-sm text-slate-500 italic text-center">Financial calculations will be completed<br/>when you process the partial exchange.</p>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 mt-4 border-t pt-4 border-slate-200">
                            <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 bg-white border rounded font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                            {partialExchangeItems.size > 0 && !isCompletingPartialExchange ? (
                                <button type="submit" className="px-8 py-2.5 bg-yellow-600 text-white rounded font-bold hover:bg-yellow-700 shadow-md flex items-center gap-2">
                                    <RefreshCw size={18} /> Process Partial Exchange ({partialExchangeItems.size})
                                </button>
                            ) : (
                                <button type="submit" className="px-8 py-2.5 bg-slate-900 text-white rounded font-bold hover:bg-slate-800 shadow-md flex items-center gap-2">
                                    <RefreshCw size={18} /> {isCompletingPartialExchange ? 'Complete Exchange' : 'Confirm Exchange'}
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ExchangeModal;