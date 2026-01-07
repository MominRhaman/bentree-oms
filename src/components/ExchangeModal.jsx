import React, { useState } from 'react';
import { Plus, Trash2, X, RefreshCw } from 'lucide-react';
import { updateInventoryStock } from '../utils';

const ExchangeModal = ({ order, onClose, onConfirm, inventory }) => {
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

    // C. Calculate Difference (Product Level)
    const productDifference = newProductValue - oldProductValue;

    // D. Final Adjustment (Payable/Refund)
    const finalAdjustment = productDifference + Number(newDeliveryCost || 0);

    // E. Financials for Database (Sales Report)
    const totalSystemDeliveryCharge = oldDeliveryCharge + Number(newDeliveryCost || 0);
    
    // 2. System Grand Total = New Product Value + Total Delivery Income
    const systemNewGrandTotal = newProductValue + totalSystemDeliveryCharge;

    const handleExchange = async () => {
        if (newProducts.some(p => !p.code || !p.qty || !p.price)) {
            return alert("Please fill all new product details");
        }

        const updatedOrder = {
            ...order,
            products: newProducts,
            exchangeDetails: {
                exchangeDate: new Date().toISOString().split('T')[0],
                originalProducts: order.products,
                newProducts: newProducts,
                priceDeviation: finalAdjustment,
            },
            history: [
                ...(order.history || []),
                {
                    status: 'Exchanged',
                    timestamp: new Date().toISOString(),
                    note: `Exchange Processed. Adj: ৳${finalAdjustment}`,
                    updatedBy: 'Admin'
                }
            ]
        };

        // This uses the SAME ID, so buttons in Dispatch Tab stay working!
        await onConfirm(order.id, 'Exchanged', updatedOrder);
        onClose();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // 1. Stock Validation (Check if new items are available)
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

        // 2. Prepare the clean payload for App.jsx
        const updatedPayload = {
            ...order,
            products: newProducts.map(p => ({
                ...p,
                code: p.code.toUpperCase(),
                size: p.size?.toUpperCase() || '',
                price: Number(p.price),
                qty: Number(p.qty)
            })),
            grandTotal: systemNewGrandTotal,
            deliveryCharge: totalSystemDeliveryCharge,
            dueAmount: finalAdjustment > 0 ? finalAdjustment : 0,
            exchangeDetails: {
                originalProducts: order.products,
                newProducts: newProducts,
                priceDeviation: finalAdjustment,
                exchangeDate: new Date().toISOString().split('T')[0]
            },
            history: [
                ...(order.history || []),
                {
                    status: 'Exchanged',
                    timestamp: new Date().toISOString(),
                    note: `Exchanged: Net Adj ৳${finalAdjustment}`,
                    updatedBy: 'Admin'
                }
            ]
        };

        // 3. Send to App.jsx
        await onConfirm(order.id, 'Exchanged', updatedPayload);
        onClose();
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
    const removeProduct = (idx) => { if (newProducts.length > 0) setNewProducts(newProducts.filter((_, i) => i !== idx)); };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <RefreshCw size={20} /> Process Exchange
                    </h3>
                    <button onClick={onClose}><X size={24} className="text-slate-400" /></button>
                </div>
                
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    <div className="overflow-y-auto pr-2 flex-1">
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
                                                <select 
                                                    value={p.size} 
                                                    onChange={e => updateNewProduct(i, 'size', e.target.value)} 
                                                    className="border p-2 w-full rounded text-sm bg-white"
                                                >
                                                    {!availableSizes.includes(p.size) && p.size && <option value={p.size}>{p.size}</option>}
                                                    {availableSizes.map(sz => <option key={sz} value={sz}>{sz}</option>)}
                                                </select>
                                            ) : (
                                                <input placeholder="Size" value={p.size} onChange={e => updateNewProduct(i, 'size', e.target.value)} className="border p-2 w-full rounded text-sm" />
                                            )}
                                        </div>
                                        <div className="w-16">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Qty</label>
                                            <input type="number" value={p.qty} onChange={e => updateNewProduct(i, 'qty', e.target.value)} onWheel={(e) => e.target.blur()} className="border p-2 w-full rounded text-sm" required />
                                        </div>
                                        <div className="w-24">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Price</label>
                                            <input type="number" value={p.price} onChange={e => updateNewProduct(i, 'price', e.target.value)} onWheel={(e) => e.target.blur()} className="border p-2 w-full rounded text-sm" required />
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-end sm:justify-start">
                                        <button type="button" onClick={() => removeProduct(i)} className="text-red-500 hover:bg-red-100 p-2 rounded bg-white border border-red-200 shadow-sm" title="Remove Item">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        <button type="button" onClick={addProduct} className="text-xs text-blue-600 font-bold mb-4 flex items-center mt-2 p-3 hover:bg-blue-50 rounded w-full justify-center border border-dashed border-blue-300 bg-blue-50"><Plus size={14} className="mr-1" /> Add New Item</button>
                    </div>

                    <div className="border-t pt-4 mt-2 bg-slate-50 p-4 rounded-lg">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-700 uppercase block mb-1">New Delivery Cost</label>
                                    <input type="number" className="w-full border p-2 rounded shadow-sm" value={newDeliveryCost} onChange={e => setNewDeliveryCost(e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0" />
                                </div>
                                
                                <div>
                                    <label className="text-xs font-bold text-slate-700 uppercase block mb-1">New Discount</label>
                                    <div className="flex">
                                        <input 
                                            type="number" 
                                            className="w-full border p-2 rounded-l border-r-0 outline-none focus:ring-1 focus:ring-emerald-500 shadow-sm" 
                                            value={discountInput} 
                                            onChange={e => setDiscountInput(e.target.value)} 
                                            onWheel={(e) => e.target.blur()}
                                            placeholder="0" 
                                        />
                                        <select 
                                            className="border p-2 rounded-r bg-white text-slate-700 font-bold outline-none border-l-0 shadow-sm"
                                            value={discountType}
                                            onChange={(e) => setDiscountType(e.target.value)}
                                        >
                                            <option value="amount">Tk</option>
                                            <option value="percent">%</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="text-right space-y-1">
                                <h4 className="font-bold text-slate-700 border-b pb-1 mb-2">Calculation Breakdown</h4>
                                
                                <div className="text-xs text-slate-500 flex justify-between">
                                    <span>New Items Total:</span>
                                    <span>৳{newProductTotal}</span>
                                </div>
                                <div className="text-xs text-slate-500 flex justify-between">
                                    <span>- Discount {discountType === 'percent' ? `(${discountInput}%)` : ''}:</span>
                                    <span className="text-red-500">-৳{Number(actualDiscountAmount).toFixed(0)}</span>
                                </div>
                                <div className="font-bold text-slate-800 flex justify-between border-t border-slate-200 pt-1 mt-1">
                                    <span>New Product Value:</span>
                                    <span>৳{newProductValue.toFixed(0)}</span>
                                </div>

                                <div className="text-xs text-blue-600 flex justify-between mt-2 font-medium">
                                    <span>- Old Item Value:</span>
                                    <span>৳{oldProductValue}</span>
                                </div>

                                {/* ADDED: Previous Advance Money Display */}
                                <div className="text-xs text-blue-600 flex justify-between font-medium">
                                    <span>Previous Advance:</span>
                                    <span>৳{order.advanceAmount || 0}</span>
                                </div>

                                <div className="text-[10px] text-slate-400 italic text-right mb-1">
                                    (Old Grand Total - Old Delivery)
                                </div>

                                <div className="border-b border-dashed border-slate-300 my-1"></div>

                                <div className="text-xs text-slate-500 flex justify-between">
                                    <span>Product Difference:</span>
                                    <span className={productDifference >= 0 ? 'text-slate-700' : 'text-red-500'}>
                                        {productDifference >= 0 ? '৳' + productDifference : '-৳' + Math.abs(productDifference)}
                                    </span>
                                </div>
                                <div className="text-xs text-slate-500 flex justify-between mt-1">
                                    <span>+ New Delivery:</span>
                                    <span>৳{Number(newDeliveryCost || 0)}</span>
                                </div>

                                <div className={`flex justify-between items-center mt-3 p-2 rounded ${finalAdjustment >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                    <span className="font-bold uppercase text-xs">
                                        {finalAdjustment >= 0 ? 'Net Payable:' : 'Refund Amount:'}
                                    </span>
                                    <span className="font-bold text-lg">
                                        {finalAdjustment >= 0 ? '৳' + finalAdjustment.toFixed(0) : '-৳' + Math.abs(finalAdjustment).toFixed(0)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-4 border-t pt-4 border-slate-200">
                            <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 bg-white border rounded font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                            <button type="submit" className="px-8 py-2.5 bg-slate-900 text-white rounded font-bold hover:bg-slate-800 shadow-md transition-colors flex items-center gap-2">
                                <RefreshCw size={18} /> Confirm Exchange
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ExchangeModal;