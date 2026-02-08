import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Save, AlertTriangle, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { updateInventoryStock, disableScroll } from '../utils';

const NewOrderForm = ({ user, existingOrders, setActiveTab, inventory }) => {
    // --- State ---
    const [orderType, setOrderType] = useState('Online');
    const [formData, setFormData] = useState({
        date: new Date().toISOString().split('T')[0],
        shift: 'Shift 1',
        orderSource: 'Facebook',
        orderProfile: '',
        paymentType: 'COD',
        products: [{ code: '', size: '', qty: 1, price: '' }],
        discountType: 'Fixed',
        discountValue: '',
        deliveryCharge: '',
        isExpress: false,
        advanceAmount: '',
        receiver: '',
        recipientName: '',
        recipientPhone: '',
        recipientAddress: '',
        recipientCity: '',
        recipientZone: '',
        recipientArea: '',
        merchantOrderId: '',
        specialInstructions: '',
        remarks: '',
        checkOutStatus: 'Pending',
        storePaymentMode: 'Cash',
        storeOrderId: '',
        storeCheckoutStatus: 'Pending'
    });

    const [errors, setErrors] = useState({});
    const [globalError, setGlobalError] = useState('');
    const [isDuplicate, setIsDuplicate] = useState(false);
    // NEW: States for product suggestions and input focus management
    const [suggestions, setSuggestions] = useState({ index: null, list: [] });
    const suggestionRef = useRef(null);
    const productRefs = useRef([]);

    // --- Switch Logic (Reset Form) ---
    const switchType = (type) => {
        setOrderType(type);
        setErrors({});
        setGlobalError('');
        setFormData(prev => ({
            ...prev,
            date: new Date().toISOString().split('T')[0],
            products: [{ code: '', size: '', qty: 1, price: '' }],
            recipientName: '',
            recipientPhone: '',
            recipientAddress: '',
            specialInstructions: '',
            remarks: '',
            isExpress: false
        }));
    };

    // --- Auto ID Generation ---
    useEffect(() => {
        const fetchLastId = async () => {
            let maxMerchantId = 1000;
            let maxStoreId = 2000;

            existingOrders.forEach(o => {
                if (o.type === 'Online') {
                    const mid = parseInt(o.merchantOrderId);
                    if (!isNaN(mid) && mid > maxMerchantId) maxMerchantId = mid;
                }
                if (o.type === 'Store') {
                    const sid = parseInt(o.storeOrderId);
                    if (!isNaN(sid) && sid > maxStoreId) maxStoreId = sid;
                }
            });

            setFormData(prev => ({
                ...prev,
                merchantOrderId: (maxMerchantId + 1).toString(),
                storeOrderId: (maxStoreId + 1).toString()
            }));
        };

        if (existingOrders.length > 0) {
            fetchLastId();
        } else {
            setFormData(prev => ({ ...prev, merchantOrderId: '1001', storeOrderId: '2001' }));
        }
    }, [existingOrders, orderType]);

    // --- Calculations ---
    const totals = useMemo(() => {
        const subtotal = formData.products.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.qty || 0)), 0);
        const totalQty = formData.products.reduce((acc, p) => acc + Number(p.qty || 0), 0);

        let discount = 0;
        if (formData.discountType === 'Fixed') {
            discount = Number(formData.discountValue || 0);
        } else {
            discount = subtotal * (Number(formData.discountValue || 0) / 100);
        }

        const totalAfterDiscount = subtotal - discount;
        const grandTotal = totalAfterDiscount + Number(formData.deliveryCharge || 0);
        const due = grandTotal - Number(formData.advanceAmount || 0);

        const productDesc = `${totalQty} item cost ${subtotal} tk`;
        // FIX: Only change this line to show exactly 0.20
        const weight = "0.20 kg";

        return { subtotal, discount, totalAfterDiscount, grandTotal, due, totalQty, productDesc, weight };
    }, [formData]);

    // --- Duplicate Detection ---
    useEffect(() => {
        if (!formData.recipientPhone || formData.products.length === 0) {
            setIsDuplicate(false);
            return;
        }
        const hasProductCode = formData.products.some(p => p.code);
        if (!hasProductCode) return;

        const found = existingOrders.some(o =>
            // Logic: Only flag if the old order is ACTIVE (not Cancelled, Returned, or Delivered)
            !['Cancelled', 'Returned', 'Delivered'].includes(o.status) &&
            o.recipientPhone === formData.recipientPhone &&
            o.products.some(op => formData.products.some(fp => fp.code.toUpperCase() === op.code.toUpperCase()))
        );
        setIsDuplicate(found);
    }, [formData.recipientPhone, formData.products, existingOrders]);

    // --- STRICT INVENTORY CHECKER ---
    const getStockError = (p) => {
        if (!p.code) return null;
        const normalizedCode = p.code.trim().toUpperCase();
        const invItem = inventory.find(i => i.code.toUpperCase() === normalizedCode);

        // 1. Check if Code Exists
        if (!invItem) return "Product code not found in inventory.";

        const qtyNeeded = Number(p.qty);

        // 2. Check Variable Stock (Size)
        if (invItem.type === 'Variable') {
            if (!p.size) return "Size is required for this product.";
            const sizeKey = p.size.trim().toUpperCase();

            const stockKeys = Object.keys(invItem.stock || {});
            const exactKey = stockKeys.find(k => k.toUpperCase() === sizeKey);

            if (!exactKey) return `Size '${p.size}' not found. Avail: ${stockKeys.join(', ')}`;

            const available = Number(invItem.stock[exactKey] || 0);
            if (available < qtyNeeded) return `Insufficient Stock (Avail: ${available})`;
        }
        // 3. Check Single Stock
        else {
            const available = Number(invItem.totalStock || 0);
            if (available < qtyNeeded) return `Insufficient Stock (Avail: ${available})`;
        }
        return null;
    };

    // --- FORM VALIDATION ---
    const validateForm = () => {
        const newErrors = {};
        let isValid = true;

        // Logic: STOP the process immediately if the detection hook found a duplicate
        if (isDuplicate) {
            setGlobalError("A duplicate active order (Phone + Product) already exists.");
            // return false;
        }
        const phoneRegex = /^\d{11}$/;

        if (!formData.recipientPhone) {
            newErrors.recipientPhone = "Phone number is required";
            isValid = false;
        } else if (!phoneRegex.test(formData.recipientPhone)) {
            newErrors.recipientPhone = "Must be exactly 11 digits";
            isValid = false;
        }

        if (orderType === 'Online') {
            if (!formData.recipientName) { newErrors.recipientName = "Name is required"; isValid = false; }
            if (!formData.recipientAddress) { newErrors.recipientAddress = "Address is required"; isValid = false; }
        }

        const productErrors = {};
        formData.products.forEach((p, idx) => {
            const rowErrors = {};
            if (!p.code) rowErrors.code = "Required";
            if (!p.qty || Number(p.qty) <= 0) rowErrors.qty = "Invalid";
            if (!p.price) rowErrors.price = "Required";

            const stockMsg = getStockError(p);
            if (stockMsg) rowErrors.stock = stockMsg;

            if (Object.keys(rowErrors).length > 0) {
                productErrors[idx] = rowErrors;
                isValid = false;
            }
        });

        if (Object.keys(productErrors).length > 0) {
            newErrors.products = productErrors;
        }

        setErrors(newErrors);
        return isValid;
    };

    // --- SUBMIT HANDLER ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        setGlobalError('');

        if (!validateForm()) {
            if (!globalError) setGlobalError("Please fix the highlighted errors before submitting.");
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return; // Stops execution here
        }

        if (!user) {
            setGlobalError("You must be logged in.");
            return;
        }

        const initialHistory = [{
            status: orderType === 'Store' ? 'Completed' : 'Pending',
            timestamp: new Date().toISOString(),
            note: 'Order Created',
            updatedBy: user.displayName || 'User'
        }];

        const payload = {
            type: orderType,
            createdAt: serverTimestamp(),
            date: formData.date,
            addedBy: user?.displayName || 'Unknown',
            products: formData.products.map(p => ({
                ...p,
                code: p.code.toUpperCase(),
                size: p.size ? p.size.toUpperCase() : '',
                price: Number(p.price || 0),
                qty: Number(p.qty || 0)
            })),
            discountType: formData.discountType,
            discountValue: Number(formData.discountValue || 0),
            subtotal: totals.subtotal,
            totalDiscount: totals.discount,
            grandTotal: totals.grandTotal,
            status: orderType === 'Store' ? 'Completed' : 'Pending',
            history: initialHistory,
            recipientPhone: formData.recipientPhone
        };

        if (orderType === 'Online') {
            Object.assign(payload, {
                shift: formData.shift,
                orderSource: formData.orderSource,
                orderProfile: formData.orderProfile,
                paymentType: formData.paymentType,
                deliveryCharge: Number(formData.deliveryCharge || 0),
                isExpress: formData.isExpress, // --- SAVE EXPRESS STATUS ---
                advanceAmount: Number(formData.advanceAmount || 0),
                dueAmount: totals.due,
                itemQuantity: totals.totalQty,
                itemWeight: totals.weight,
                itemDescription: totals.productDesc,
                receiver: formData.receiver,
                merchantOrderId: formData.merchantOrderId,
                recipientName: formData.recipientName,
                recipientAddress: formData.recipientAddress,
                recipientCity: formData.recipientCity,
                recipientZone: formData.recipientZone,
                recipientArea: formData.recipientArea,
                specialInstructions: formData.specialInstructions,
                remarks: formData.remarks,
                checkOutStatus: formData.checkOutStatus,
                source: 'Bentree Website',
                itemType: 'Parcel',
                storeName: 'Bentree'
            });
        } else {
            Object.assign(payload, {
                storePaymentMode: formData.storePaymentMode,
                storeOrderId: formData.storeOrderId,
                checkOutStatus: formData.storeCheckoutStatus
            });
        }

        try {
            for (const p of formData.products) {
                await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
            }
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), payload);

            if (orderType === 'Online') setActiveTab('primary');
            else setActiveTab('store-sales');

        } catch (error) {
            console.error(error);
            setGlobalError("Database Error: Could not save order.");
        }
    };

    // NEW: Function to handle clicking a suggestion
    const selectSuggestion = (index, item) => {
        const newProducts = [...formData.products];
        newProducts[index].code = item.code;
        newProducts[index].price = item.mrp || '';
        setFormData({ ...formData, products: newProducts });
        setSuggestions({ index: null, list: [] });

        // NEW: Auto-focus back to input
        setTimeout(() => { if (productRefs.current[index]) productRefs.current[index].focus(); }, 10);
    };

    const updateProduct = (index, field, value) => {
        const newProducts = [...formData.products];
        newProducts[index][field] = value;

        // NEW: Suggestion logic (Last 3 digits search)
        if (field === 'code') {
            const val = value.trim();
            if (val.length >= 3) {
                const searchStr = val.toUpperCase();
                const matches = inventory.filter(i =>
                    i.code.toUpperCase().endsWith(searchStr) ||
                    i.code.toUpperCase().includes(searchStr)
                );
                setSuggestions({ index, list: matches.slice(0, 5) });
            } else {
                setSuggestions({ index: null, list: [] });
            }
        }

        // Auto-fill price if code is found
        if (field === 'code') {
            const normalizedCode = value.trim().toUpperCase();
            const foundItem = inventory.find(i => i.code.toUpperCase() === normalizedCode);
            if (foundItem) {
                newProducts[index].price = foundItem.mrp || '';
            }
        }

        setFormData({ ...formData, products: newProducts });

        // --- REAL-TIME ERROR CHECKING ---
        const stockError = getStockError(newProducts[index]);

        setErrors(prev => {
            const currentProductsErrors = prev.products ? { ...prev.products } : {};
            const currentRowErrors = currentProductsErrors[index] ? { ...currentProductsErrors[index] } : {};

            // 1. Inside updateProduct: Filter out "Not Found" from real-time updates
            if (stockError && stockError !== "Product code not found in inventory.") {
                currentRowErrors.stock = stockError; // Only shows stock/size errors
            } else if (!stockError) {
                delete currentRowErrors.stock;
            }

            if (Object.keys(currentRowErrors).length === 0) {
                delete currentProductsErrors[index];
            } else {
                currentProductsErrors[index] = currentRowErrors;
            }

            return { ...prev, products: currentProductsErrors };
        });
    };

    const handleCodeBlur = (index) => {
        setTimeout(() => {
            const product = formData.products[index];
            const stockError = getStockError(product);
            if (stockError === "Product code not found in inventory.") {
                setErrors(prev => {
                    const currentProductsErrors = prev.products ? { ...prev.products } : {};
                    const currentRowErrors = currentProductsErrors[index] ? { ...currentProductsErrors[index] } : {};
                    currentRowErrors.stock = stockError;
                    currentProductsErrors[index] = currentRowErrors;
                    return { ...prev, products: currentProductsErrors };
                });
            }
        }, 100); // 100ms delay to allow clicking suggestions
    };

    const addProduct = () => setFormData({ ...formData, products: [...formData.products, { code: '', size: '', qty: 1, price: '' }] });
    const removeProduct = (idx) => setFormData({ ...formData, products: formData.products.filter((_, i) => i !== idx) });

    return (
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <h2 className="text-xl font-bold text-slate-800">Create New Order</h2>
                <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto">
                    <button onClick={() => switchType('Online')} className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-all ${orderType === 'Online' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Online Order</button>
                    <button onClick={() => switchType('Store')} className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-all ${orderType === 'Store' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Store Order</button>
                </div>
            </div>

            {/* Global Error */}
            {globalError && (
                <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700 font-bold animate-pulse">
                    <XCircle size={20} className="mr-2" /> {globalError}
                </div>
            )}

            <form onSubmit={handleSubmit} className="p-6 space-y-6">

                {/* Date Field */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Order Date</label>
                        <input type="date" required className="w-full p-2 border border-slate-300 rounded-md" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                    </div>

                    {orderType === 'Online' && (
                        <div className="space-y-4">
                            {/* Row 1: Source, Profile */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Source</label><select className="w-full p-2 border rounded-md" value={formData.orderSource} onChange={(e) => setFormData({ ...formData, orderSource: e.target.value })}><option>Facebook</option><option>Instagram</option><option>Whatsapp</option><option>Website</option><option>Other</option></select></div>
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Profile</label><input className="w-full p-2 border rounded-md" value={formData.orderProfile} onChange={(e) => setFormData({ ...formData, orderProfile: e.target.value })} /></div>
                            </div>
                            {/* Row 2: Receiver, Shift */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Order Receiver Name</label>
                                    <input
                                        className="w-full p-2 border rounded-md bg-white"
                                        placeholder="Name of person taking order"
                                        value={formData.receiver}
                                        onChange={(e) => setFormData({ ...formData, receiver: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Shift</label>
                                    <select className="w-full p-2 border rounded-md" value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value })}>
                                        <option>Shift 1</option>
                                        <option>Shift 2</option>
                                        <option>Shift 3</option>
                                    </select>
                                </div>
                            </div>
                            {/* Row 3: Status */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Checkout Status</label>
                                <select className="w-full p-2 border rounded-md" value={formData.checkOutStatus} onChange={(e) => setFormData({ ...formData, checkOutStatus: e.target.value })}>
                                    <option value="Pending">Pending</option>
                                    <option value="Completed">Completed</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>

                {/* Product Section */}
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-slate-700">Products <span className="text-red-500">*</span></h3>
                        {isDuplicate && <span className="flex items-center text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-sm font-bold"><AlertTriangle size={16} className="mr-1" /> Duplicate Detected</span>}
                    </div>

                    <div className="space-y-4">
                        {formData.products.map((prod, idx) => {
                            const rowError = errors.products?.[idx];
                            return (
                                <div key={idx} className="flex flex-col sm:flex-row gap-2 sm:items-start relative bg-white p-3 rounded border sm:border-none sm:bg-transparent shadow-sm sm:shadow-none">
                                    <div className="flex-1 relative w-full">
                                        <label className="text-xs text-slate-500 sm:hidden">Code</label>
                                        <input ref={el => productRefs.current[idx] = el}
                                            placeholder="Code"
                                            className={`w-full p-2 border rounded ${rowError?.code || rowError?.stock ? 'border-red-500 bg-red-50' : ''}`}
                                            value={prod.code}
                                            onChange={e => updateProduct(idx, 'code', e.target.value)}
                                            onBlur={() => handleCodeBlur(idx)}
                                            autoComplete="off"
                                        />

                                        {/* NEW: DROPDOWN UI LOOP */}
                                        {suggestions.index === idx && suggestions.list.length > 0 && (
                                            <div ref={suggestionRef} className="absolute left-0 right-0 top-full bg-white border border-slate-200 rounded-b-lg shadow-xl z-[100] max-h-64 overflow-y-auto">
                                                {suggestions.list.map((item) => (
                                                    <button key={item.id} type="button" onClick={() => selectSuggestion(idx, item)} className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-slate-50 last:border-0 group">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className="font-bold text-slate-800">{item.code}</span>
                                                            <span className="text-xs font-bold text-emerald-600">৳{item.mrp}</span>
                                                        </div>
                                                        {/* Size list logic inside button */}
                                                        <div className="flex flex-wrap gap-1">
                                                            {item.type === 'Variable' ? (
                                                                Object.entries(item.stock || {}).map(([sz, qty]) => (
                                                                    qty > 0 && <span key={sz} className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">{sz}: {qty}</span>
                                                                ))
                                                            ) : (
                                                                <span className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">Stock: {item.totalStock}</span>
                                                            )}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {rowError?.stock && <div className="text-xs text-red-600 font-bold mt-1 flex items-center"><AlertTriangle size={12} className="mr-1" /> {rowError.stock}</div>}
                                        {rowError?.code && <p className="text-xs text-red-500">{rowError.code}</p>}
                                    </div>
                                    <div className="flex gap-2 w-full sm:w-auto">
                                        {/* SIZE DROPDOWN */}
                                        <div className="flex-1 sm:w-24">
                                            <select
                                                className={`w-full p-2 border rounded ${rowError?.stock ? 'border-red-500 bg-red-50' : ''}`}
                                                value={prod.size}
                                                onChange={e => updateProduct(idx, 'size', e.target.value)}
                                            >
                                                <option value="">Size</option>
                                                <option value="S">S</option>
                                                <option value="M">M</option>
                                                <option value="L">L</option>
                                                <option value="XL">XL</option>
                                                <option value="2XL">2XL</option>
                                                <option value="3XL">3XL</option>
                                            </select>
                                        </div>

                                        <div className="flex-1 sm:w-20"><input type="number" min="1" className={`w-full p-2 border rounded ${rowError?.qty ? 'border-red-500' : ''}`} value={prod.qty} onChange={e => updateProduct(idx, 'qty', e.target.value)} onWheel={disableScroll} /></div>
                                        <div className="flex-1 sm:w-28"><input type="number" min="0" placeholder="Price" className={`w-full p-2 border rounded ${rowError?.price ? 'border-red-500' : ''}`} value={prod.price} onChange={e => updateProduct(idx, 'price', e.target.value)} onWheel={disableScroll} /></div>
                                        {formData.products.length > 1 && <button type="button" onClick={() => removeProduct(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={18} /></button>}
                                    </div>
                                </div>
                            );
                        })}
                        <button type="button" onClick={addProduct} className="flex items-center text-sm text-emerald-600 font-bold hover:bg-emerald-50 p-2 rounded border border-dashed border-emerald-200 w-full justify-center sm:justify-start"><Plus size={16} className="mr-1" /> Add Product</button>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Discount</label>
                            <div className="flex gap-2">
                                <input type="number" className="w-full p-2 border rounded" value={formData.discountValue} onChange={e => setFormData({ ...formData, discountValue: e.target.value })} onWheel={disableScroll} />
                                <select className="p-2 border rounded bg-white" value={formData.discountType} onChange={e => setFormData({ ...formData, discountType: e.target.value })}><option value="Fixed">Tk</option><option value="Percent">%</option></select>
                            </div>
                        </div>
                        <div className="text-right space-y-1">
                            <p className="text-sm text-slate-500">Subtotal: <span className="font-medium text-slate-800">{totals.subtotal}</span></p>
                            <p className="text-sm text-slate-500">Total Bill: <span className="font-bold text-emerald-600 text-lg">{totals.totalAfterDiscount.toFixed(2)}</span></p>
                        </div>
                    </div>
                </div>

                {orderType === 'Online' && (
                    <>
                        {/* --- PAYMENT & DELIVERY SECTION (Modified Layout) --- */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Delivery Charge</label>
                                <input type="number" className="w-full p-2 border rounded" value={formData.deliveryCharge} onChange={e => setFormData({ ...formData, deliveryCharge: e.target.value })} onWheel={disableScroll} />
                            </div>

                            {/* --- NEW: EXPRESS DELIVERY CHECKBOX (Placed Between) --- */}
                            <div className="flex flex-col justify-end">
                                <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer transition-all h-[42px] ${formData.isExpress ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white hover:bg-slate-50'}`}>
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                        checked={formData.isExpress}
                                        onChange={(e) => setFormData({ ...formData, isExpress: e.target.checked })}
                                    />
                                    <span className={`text-sm font-bold flex-1 ${formData.isExpress ? 'text-amber-700' : 'text-slate-600'}`}>
                                        Express Delivery
                                    </span>
                                    {formData.isExpress && <Zap size={16} className="text-amber-500 fill-current" />}
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Advance Amount</label>
                                <input type="number" className="w-full p-2 border rounded" value={formData.advanceAmount} onChange={e => setFormData({ ...formData, advanceAmount: e.target.value })} onWheel={disableScroll} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Due Bill (Collect)</label>
                                <input type="text" readOnly className="w-full p-2 border rounded bg-slate-100 text-slate-500 font-bold" value={totals.due.toFixed(2)} />
                            </div>
                        </div>

                        {/* ORDER DETAILS SECTION */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                            <div className="space-y-4">
                                <h4 className="font-semibold text-emerald-800">Recipient Info</h4>
                                <div><input placeholder="Name *" className={`w-full p-2 border rounded ${errors.recipientName ? 'border-red-500 bg-red-50' : ''}`} value={formData.recipientName} onChange={e => setFormData({ ...formData, recipientName: e.target.value })} />{errors.recipientName && <p className="text-xs text-red-500 mt-1">{errors.recipientName}</p>}</div>
                                <div><input placeholder="Phone Number (11 digits) *" className={`w-full p-2 border rounded ${errors.recipientPhone ? 'border-red-500 bg-red-50' : ''}`} value={formData.recipientPhone} onChange={e => { const val = e.target.value.replace(/\D/g, ''); if (val.length <= 11) setFormData({ ...formData, recipientPhone: val }); }} />{errors.recipientPhone && <p className="text-xs text-red-500 mt-1">{errors.recipientPhone}</p>}</div>
                                <div><textarea placeholder="Address *" className={`w-full p-2 border rounded h-20 ${errors.recipientAddress ? 'border-red-500 bg-red-50' : ''}`} value={formData.recipientAddress} onChange={e => setFormData({ ...formData, recipientAddress: e.target.value })} />{errors.recipientAddress && <p className="text-xs text-red-500 mt-1">{errors.recipientAddress}</p>}</div>
                                <div className="grid grid-cols-3 gap-2"><input placeholder="City" className="w-full p-2 border rounded" value={formData.recipientCity} onChange={e => setFormData({ ...formData, recipientCity: e.target.value })} /><input placeholder="Zone" className="w-full p-2 border rounded" value={formData.recipientZone} onChange={e => setFormData({ ...formData, recipientZone: e.target.value })} /><input placeholder="Area" className="w-full p-2 border rounded" value={formData.recipientArea} onChange={e => setFormData({ ...formData, recipientArea: e.target.value })} /></div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="font-semibold text-emerald-800">Order Details</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-emerald-700">Item Type</label>
                                        <input value="Parcel" readOnly className="w-full p-2 border rounded bg-white text-slate-500" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-emerald-700">Store Name</label>
                                        <input value="Bentree" readOnly className="w-full p-2 border rounded bg-white text-slate-500" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-emerald-700">Merchant Order ID (Auto)</label>
                                        <input className="w-full p-2 border rounded" value={formData.merchantOrderId} onChange={e => setFormData({ ...formData, merchantOrderId: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-emerald-700">Payment Type</label>
                                        <select className="w-full p-2 border rounded bg-white" value={formData.paymentType} onChange={e => setFormData({ ...formData, paymentType: e.target.value })}>
                                            <option>COD</option>
                                            <option>Advance</option>
                                            <option>Partial</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-emerald-700">Auto Generated Description</label>
                                    <input value={totals.productDesc} readOnly className="w-full p-2 border rounded bg-slate-100 text-slate-600 text-sm" />
                                </div>
                                <div>
                                    <label className="text-xs text-emerald-700">Total Weight</label>
                                    <input value={totals.weight} readOnly className="w-full p-2 border rounded bg-slate-100 text-slate-600 text-sm" />
                                </div>
                            </div>
                        </div>
                        <div><label className="block text-sm font-medium mb-1">Special Instructions</label><textarea className="w-full p-2 border rounded h-16" value={formData.specialInstructions} onChange={e => setFormData({ ...formData, specialInstructions: e.target.value })} /></div>
                    </>
                )}

                {orderType === 'Store' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div><label className="block text-sm font-medium mb-1">Order ID</label><input className="w-full p-2 border rounded bg-slate-50" value={formData.storeOrderId} readOnly /></div>
                            <div><label className="block text-sm font-medium mb-1">Payment Mode</label><select className="w-full p-2 border rounded" value={formData.storePaymentMode} onChange={e => setFormData({ ...formData, storePaymentMode: e.target.value })}><option>Cash</option><option>Card</option><option>MFS</option></select></div>
                        </div>
                        <div className="space-y-4">
                            <div><label className="block text-sm font-medium mb-1">Customer Phone *</label><input className={`w-full p-2 border rounded ${errors.recipientPhone ? 'border-red-500 bg-red-50' : ''}`} placeholder="Enter phone number" value={formData.recipientPhone} onChange={e => { const val = e.target.value.replace(/\D/g, ''); if (val.length <= 11) setFormData({ ...formData, recipientPhone: val }); }} required />{errors.recipientPhone && <p className="text-xs text-red-500 mt-1">{errors.recipientPhone}</p>}</div>
                            {/* Row 3: Status */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Checkout Status</label>
                                <select className="w-full p-2 border rounded-md" value={formData.checkOutStatus} onChange={(e) => setFormData({ ...formData, checkOutStatus: e.target.value })}>
                                    <option value="Pending">Pending</option>
                                    <option value="Completed">Completed</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                <div className="pt-4">
                    <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow-md transition-all flex justify-center items-center">
                        <Save size={20} className="mr-2" /> Create Order
                    </button>
                </div>
            </form>
        </div>
    );
};

export default NewOrderForm;