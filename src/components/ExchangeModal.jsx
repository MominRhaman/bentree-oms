import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { updateInventoryStock } from '../utils';

const ExchangeModal = ({ order, onClose, onConfirm, inventory }) => {
    const [newProducts, setNewProducts] = useState(
        order.products.map(p => ({
            code: p.code,
            size: p.size || '', 
            qty: p.qty,
            price: p.price
        }))
    );
    const [newDeliveryCost, setNewDeliveryCost] = useState('');

    const newTotal = newProducts.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.qty || 0)), 0);
    const deviation = newTotal - (order.subtotal || 0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Stock Validation
        for (const p of newProducts) {
            if (!p.code) continue;
            const normalizedCode = p.code.trim().toUpperCase();
            const invItem = inventory.find(i => i.code.toUpperCase() === normalizedCode);
            if (!invItem) { alert(`Product ${p.code} not found in inventory.`); return; }

            const qtyNeeded = Number(p.qty);
            if (invItem.type === 'Variable') {
                const sizeKey = p.size ? p.size.trim().toUpperCase() : '';
                if (!sizeKey) { alert(`Size is mandatory for Variable product: ${p.code}`); return; }
                const stockKeys = Object.keys(invItem.stock || {});
                const exactKey = stockKeys.find(k => k.toUpperCase() === sizeKey);
                
                if (!exactKey) { alert(`Size ${p.size} not found for ${p.code}`); return; }
                const available = invItem.stock[exactKey];
                
                if (available < qtyNeeded) { alert(`Insufficient stock for ${p.code} (${p.size}). Available: ${available}`); return; }
            } else {
                if (invItem.totalStock < qtyNeeded) { alert(`Insufficient stock for ${p.code}. Available: ${invItem.totalStock}`); return; }
            }
        }

        for (const p of (order.products || [])) await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
        for (const p of newProducts) await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);

        const newGrandTotal = newTotal + Number(newDeliveryCost || 0);
        const newDueAmount = newGrandTotal - Number(order.advanceAmount || 0);

        onConfirm(order.id, {
            products: newProducts.map(p => ({ ...p, code: p.code.toUpperCase(), size: p.size ? p.size.toUpperCase() : '', price: Number(p.price), qty: Number(p.qty) })),
            grandTotal: newGrandTotal,
            dueAmount: newDueAmount,
            exchangeDetails: {
                originalProducts: order.products,
                newProducts: newProducts.map(p => ({ ...p, price: Number(p.price), qty: Number(p.qty) })),
                newDeliveryCost: Number(newDeliveryCost || 0),
                priceDeviation: deviation,
                exchangeDate: new Date().toISOString().split('T')[0]
            },
            note: 'Exchange Processed'
        });
        onClose();
    };

    const updateNewProduct = (idx, field, val) => {
        const np = [...newProducts];
        np[idx][field] = val;

        // --- NEW: AUTO-PRICE FETCH LOGIC ---
        if (field === 'code') {
            const normalizedCode = val.trim().toUpperCase();
            const foundItem = inventory.find(i => i.code.toUpperCase() === normalizedCode);
            if (foundItem) {
                np[idx].price = foundItem.mrp || '';
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
                    <h3 className="font-bold text-lg">Process Exchange</h3>
                    <button onClick={onClose}><X size={24} className="text-slate-400" /></button>
                </div>
                
                <p className="text-xs text-slate-500 mb-4 bg-yellow-50 p-2 rounded border border-yellow-200">
                    <strong>Note:</strong> Modify the list below. Removing an item returns it to stock. Adding an item deducts from stock.
                </p>
                
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    <div className="overflow-y-auto pr-2 flex-1">
                        {newProducts.map((p, i) => (
                            <div key={i} className="flex flex-col sm:flex-row gap-2 mb-3 bg-slate-50 p-3 rounded border border-slate-100">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Code</label>
                                    <input placeholder="Code" value={p.code} onChange={e => updateNewProduct(i, 'code', e.target.value)} className="border p-2 w-full rounded text-sm" required />
                                </div>
                                <div className="flex gap-2">
                                    <div className="w-24">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Size</label>
                                        <input placeholder="Size" value={p.size} onChange={e => updateNewProduct(i, 'size', e.target.value)} className="border p-2 w-full rounded text-sm" />
                                    </div>
                                    <div className="w-16">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Qty</label>
                                        <input type="number" value={p.qty} onChange={e => updateNewProduct(i, 'qty', e.target.value)} className="border p-2 w-full rounded text-sm" required />
                                    </div>
                                    <div className="w-24">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Price</label>
                                        <input type="number" value={p.price} onChange={e => updateNewProduct(i, 'price', e.target.value)} className="border p-2 w-full rounded text-sm" required />
                                    </div>
                                </div>
                                <div className="flex items-end justify-end sm:justify-start">
                                    <button type="button" onClick={() => removeProduct(i)} className="text-red-500 hover:bg-red-100 p-2 rounded bg-white border" title="Remove (Restock)">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={addProduct} className="text-xs text-blue-600 font-bold mb-4 flex items-center mt-2 p-2 hover:bg-blue-50 rounded w-full justify-center border border-dashed border-blue-200"><Plus size={14} className="mr-1" /> Add New Item</button>
                    </div>

                    <div className="border-t pt-4 mt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="text-sm font-medium block mb-1">New Delivery Charge</label>
                                <input type="number" className="w-full border p-2 rounded" value={newDeliveryCost} onChange={e => setNewDeliveryCost(e.target.value)} placeholder="0" />
                            </div>
                            <div className="text-right bg-slate-50 p-2 rounded">
                                <p className="text-xs text-slate-500">Previous Total: ৳{order.subtotal}</p>
                                <p className="text-xs text-slate-500">New Product Total: ৳{newTotal}</p>
                                <p className={`font-bold ${deviation >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    Difference: {deviation > 0 ? '+' : ''}{deviation} Tk
                                </p>
                                <p className="mt-2 font-bold text-lg text-slate-800 border-t pt-1 border-slate-200">
                                    Net Payable: ৳{newTotal + Number(newDeliveryCost || 0) - (Number(order.advanceAmount || 0))}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 border rounded font-medium hover:bg-slate-50 flex-1 sm:flex-none">Cancel</button>
                            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 shadow-sm flex-1 sm:flex-none">Confirm Exchange</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ExchangeModal;