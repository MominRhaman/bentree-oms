import React, { useState } from 'react';
import { Plus, Trash2, X, RefreshCw } from 'lucide-react';

const ExchangeModal = ({ order, onClose, onConfirm, inventory = [] }) => {
    // 1. New Selections State
    const [newProducts, setNewProducts] = useState([{ code: '', size: '', qty: 1, price: 0 }]);
    const [newDeliveryCost, setNewDeliveryCost] = useState('60');
    const [discountInput, setDiscountInput] = useState('0');
    const [discountType, setDiscountType] = useState('amount');

    // --- Helpers ---
    const getAvailableSizes = (code) => {
        if (!code || !inventory.length) return [];
        const item = inventory.find(i => i.code.toUpperCase() === code.trim().toUpperCase());
        return (item && item.type === 'Variable' && item.stock) ? Object.keys(item.stock) : [];
    };

    // --- Calculation Logic (Exact Match to Your Example) ---
    
    // A. New Items Gross Total
    const newItemsTotal = newProducts.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.qty || 0)), 0);

    // B. New Discount Calculation
    const rawDiscount = Number(discountInput || 0);
    const actualDiscountAmount = discountType === 'percent' 
        ? (newItemsTotal * rawDiscount) / 100 
        : rawDiscount;

    // C. New Product Value (After Discount)
    const newProductValue = newItemsTotal - actualDiscountAmount;

    // D. Old Item Value (Frozen: Old Grand Total - Old Delivery Charge)
    const oldDeliveryCharge = Number(order.deliveryCharge || 0);
    const oldItemValue = Number(order.grandTotal || 0) - oldDeliveryCharge;

    // E. Product Difference
    const productDifference = newProductValue - oldItemValue;

    // F. Net Payable (Difference + New Delivery)
    const netPayable = productDifference + Number(newDeliveryCost || 0);

    const updateNewProduct = (idx, field, val) => {
        const np = [...newProducts];
        np[idx][field] = val;
        if (field === 'code') {
            const item = inventory.find(i => i.code.toUpperCase() === val.trim().toUpperCase());
            if (item) {
                np[idx].price = item.mrp || 0;
                const sizes = getAvailableSizes(val);
                if (sizes.length > 0) np[idx].size = sizes[0];
            }
        }
        setNewProducts(np);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Prepare New Order Object
        const newOrderPayload = {
            ...order, // Keeps customer name, phone, address, etc.
            products: newProducts.map(p => ({ 
                ...p, 
                code: p.code.toUpperCase(), 
                price: Number(p.price), 
                qty: Number(p.qty) 
            })),
            grandTotal: newProductValue + oldDeliveryCharge + Number(newDeliveryCost || 0),
            deliveryCharge: oldDeliveryCharge + Number(newDeliveryCost || 0),
            subtotal: newItemsTotal,
            discountValue: rawDiscount,
            discountType: discountType === 'percent' ? 'Percent' : 'Fixed',
            dueAmount: netPayable > 0 ? netPayable : 0,
            status: 'Exchanged',
            history: [
                ...(order.history || []),
                {
                    status: 'Exchanged',
                    timestamp: new Date().toISOString(),
                    note: `Exchange Processed. Prev Item Value: ৳${oldItemValue}. New Item Value: ৳${newProductValue}. Adjustment: ৳${netPayable}`,
                    updatedBy: 'Admin'
                }
            ],
            exchangeDetails: {
                oldOrderId: order.id,
                oldMerchantOrderId: order.merchantOrderId || '',
                priceDeviation: netPayable,
                exchangeDate: new Date().toISOString().split('T')[0]
            }
        };

        // Pass 3 args to App.jsx handler
        onConfirm(order.id, 'Exchanged', newOrderPayload);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col border border-slate-200">
                
                <div className="p-5 flex justify-between items-center border-b bg-slate-50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <RefreshCw size={22} className="text-slate-600" />
                        <h3 className="text-xl font-bold text-slate-800">Process Exchange</h3>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-slate-400 transition-all"><X size={24} /></button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* Blue Formula Box */}
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm">
                        <p className="font-bold text-slate-700 mb-1">Calculation Logic:</p>
                        <p className="font-mono text-blue-700">(New Item Value - Old Item Value) + New Delivery Cost = Net Payable</p>
                        <p className="text-[11px] text-slate-500 mt-1">*Old Item Value = Old Grand Total - Old Delivery Charge</p>
                    </div>

                    {/* New Product Entry */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Add New Items</h4>
                        {newProducts.map((p, i) => (
                            <div key={i} className="flex gap-2 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Code</label>
                                    <input placeholder="Code" value={p.code} onChange={e => updateNewProduct(i, 'code', e.target.value)} className="w-full border p-2 rounded text-sm font-bold" required />
                                </div>
                                <div className="w-24">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Size</label>
                                    <select value={p.size} onChange={e => updateNewProduct(i, 'size', e.target.value)} className="w-full border p-2 rounded text-sm outline-none">
                                        <option value="">Size</option>
                                        {getAvailableSizes(p.code).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="w-16">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Qty</label>
                                    <input type="number" value={p.qty} onChange={e => updateNewProduct(i, 'qty', e.target.value)} className="w-full border p-2 rounded text-sm" required />
                                </div>
                                <div className="w-24">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Price</label>
                                    <input type="number" value={p.price} onChange={e => updateNewProduct(i, 'price', e.target.value)} className="w-full border p-2 rounded text-sm" required />
                                </div>
                                <button type="button" onClick={() => setNewProducts(newProducts.filter((_, idx) => idx !== i))} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={18}/></button>
                            </div>
                        ))}
                        <button type="button" onClick={() => setNewProducts([...newProducts, { code: '', size: '', qty: 1, price: 0 }])} className="w-full py-2 border-2 border-dashed rounded-lg text-sm font-bold text-blue-600 hover:bg-blue-50 border-blue-200">
                            + Add New Item
                        </button>
                    </div>

                    {/* Breakdown Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border rounded-xl p-6 bg-white shadow-sm">
                        <div className="space-y-6">
                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase block mb-2">New Delivery Cost</label>
                                <input type="number" className="w-full border p-3 rounded-lg text-lg focus:ring-2 focus:ring-blue-100" value={newDeliveryCost} onChange={e => setNewDeliveryCost(e.target.value)} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase block mb-2">New Item Discount</label>
                                <div className="flex border rounded-lg overflow-hidden">
                                    <input type="number" className="flex-1 p-3 text-lg outline-none" value={discountInput} onChange={e => setDiscountInput(e.target.value)} />
                                    <select className="bg-slate-50 px-4 font-bold border-l" value={discountType} onChange={e => setDiscountType(e.target.value)}>
                                        <option value="amount">Tk</option>
                                        <option value="percent">%</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h4 className="text-right font-bold text-slate-700 text-lg mb-4">Calculation Breakdown</h4>
                            <div className="flex justify-between text-sm text-slate-400"><span>New Items Total:</span><span>৳{newItemsTotal}</span></div>
                            <div className="flex justify-between text-sm text-red-400"><span>- Discount :</span><span>-৳{actualDiscountAmount.toFixed(0)}</span></div>
                            <div className="flex justify-between font-bold text-slate-800 text-lg border-t pt-2 mt-2"><span>New Product Value:</span><span>৳{newProductValue.toFixed(0)}</span></div>
                            <div className="flex justify-between text-sm text-blue-500 font-bold"><span>- Old Item Value:</span><span>৳{oldItemValue}</span></div>
                            <p className="text-right text-[10px] text-slate-400 italic">(Old Grand Total - Old Delivery)</p>
                            <div className="border-t border-dashed my-4"></div>
                            <div className="flex justify-between text-sm font-bold text-slate-500"><span>Product Difference:</span><span>৳{productDifference.toFixed(0)}</span></div>
                            <div className="flex justify-between text-sm font-bold text-slate-500"><span>+ New Delivery:</span><span>৳{newDeliveryCost || 0}</span></div>

                            <div className={`flex justify-between items-center p-4 rounded-xl mt-6 ${netPayable >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                <span className="font-bold uppercase text-xs">{netPayable >= 0 ? 'Net Payable:' : 'Total Refund:'}</span>
                                <span className="text-2xl font-black">৳{Math.abs(netPayable).toFixed(0)}</span>
                            </div>
                        </div>
                    </div>
                </form>

                <div className="p-6 border-t flex justify-end gap-3 bg-slate-50 rounded-b-xl">
                    <button onClick={onClose} className="px-8 py-3 border rounded-lg font-bold text-slate-600 bg-white">Cancel</button>
                    <button onClick={handleSubmit} className="px-8 py-3 bg-slate-900 text-white rounded-lg font-bold flex items-center gap-2 shadow-lg">
                        <RefreshCw size={20} /> Confirm Exchange
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExchangeModal;