import React from 'react';

const InvoiceGenerator = ({ orders }) => {
    if (!orders || orders.length === 0) return <div className="p-4 text-center text-slate-500">No orders selected for printing.</div>;

    return (
        <div>
            {/* --- PRINT ONLY STYLES --- */}
            <style>
                {`
                    @media print {
                        body * {
                            visibility: hidden;
                        }
                        #print-area, #print-area * {
                            visibility: visible;
                        }
                        #print-area {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                        }
                        .invoice-page {
                            page-break-after: always;
                            margin-bottom: 0 !important;
                            border: none !important;
                            box-shadow: none !important;
                        }
                        /* Hide scrollbars during print */
                        ::-webkit-scrollbar {
                            display: none;
                        }
                    }
                `}
            </style>

            <div id="print-area" className="flex flex-col gap-8 bg-slate-100 p-4 print:p-0 print:bg-white">
                {orders.map((order, index) => {
                    // --- Calculations ---
                    const subtotal = (order.products || []).reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 0)), 0);
                    let discount = Number(order.discountValue || 0);
                    if (order.discountType === 'Percent') {
                        discount = subtotal * (discount / 100);
                    }
                    const delivery = Number(order.deliveryCharge || 0);
                    const advance = Number(order.advanceAmount || 0);
                    const collected = Number(order.collectedAmount || 0);
                    const grandTotal = (subtotal + delivery) - discount;
                    const dueAmount = grandTotal - advance - collected;

                    return (
                        <div key={order.id || index} className="invoice-page bg-white w-full max-w-[800px] mx-auto p-8 shadow-sm border border-slate-200 print:max-w-full">
                            
                            {/* --- HEADER --- */}
                            <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-6">
                                <div>
                                    <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">BENTREE</h1>
                                    <p className="text-sm text-slate-500 mt-1">Fashion & Lifestyle</p>
                                    <p className="text-xs text-slate-400 mt-1">Dhaka, Bangladesh</p>
                                    <p className="text-xs text-slate-400">Phone: +880 1XXXXXXXXX</p>
                                </div>
                                <div className="text-right">
                                    <h2 className="text-xl font-bold text-slate-700">INVOICE</h2>
                                    <p className="text-sm font-mono text-slate-600 mt-1">#{order.merchantOrderId || order.storeOrderId || 'PENDING'}</p>
                                    <p className="text-xs text-slate-500 mt-1">Date: {order.date}</p>
                                    {order.isExpress && (
                                        <div className="mt-2 inline-block bg-slate-800 text-white text-[10px] font-bold px-2 py-1 uppercase tracking-wider">
                                            Express Delivery
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* --- CUSTOMER --- */}
                            <div className="mb-6 bg-slate-50 p-4 rounded-sm border border-slate-100">
                                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Bill To:</p>
                                <h3 className="font-bold text-slate-800 text-lg">{order.recipientName || 'Guest Customer'}</h3>
                                <p className="text-sm text-slate-600 mt-1"><strong>Phone:</strong> {order.recipientPhone}</p>
                                <p className="text-sm text-slate-600 mt-1"><strong>Address:</strong> {order.recipientAddress || 'N/A'}</p>
                            </div>

                            {/* --- ITEMS TABLE --- */}
                            <table className="w-full text-sm text-left mb-6">
                                <thead className="bg-slate-800 text-white uppercase text-xs">
                                    <tr>
                                        <th className="p-3">Product Code</th>
                                        <th className="p-3 text-center">Size</th>
                                        <th className="p-3 text-center">Qty</th>
                                        <th className="p-3 text-right">Price</th>
                                        <th className="p-3 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(order.products || []).map((p, i) => (
                                        <tr key={i}>
                                            <td className="p-3 font-bold text-slate-700">{p.code}</td>
                                            <td className="p-3 text-center">{p.size}</td>
                                            <td className="p-3 text-center">{p.qty}</td>
                                            <td className="p-3 text-right">৳{p.price}</td>
                                            <td className="p-3 text-right font-medium">৳{Number(p.price) * Number(p.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* --- TOTALS --- */}
                            <div className="flex justify-end">
                                <div className="w-64 space-y-2 text-sm">
                                    <div className="flex justify-between text-slate-600">
                                        <span>Subtotal:</span>
                                        <span>৳{subtotal}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Delivery Charge:</span>
                                        <span>৳{delivery}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Discount:</span>
                                        <span>- ৳{discount.toFixed(0)}</span>
                                    </div>
                                    {(advance > 0 || collected > 0) && (
                                        <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-2">
                                            <span>Paid / Advance:</span>
                                            <span>- ৳{(advance + collected)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-lg font-bold text-slate-800 border-t border-slate-800 pt-2">
                                        <span>Total Due:</span>
                                        <span>৳{dueAmount > 0 ? dueAmount : 0}</span>
                                    </div>
                                </div>
                            </div>

                            {/* --- FOOTER --- */}
                            <div className="mt-12 pt-6 border-t border-slate-200 text-center">
                                <p className="text-sm font-bold text-slate-700 mb-2">Thank you for shopping with Bentree!</p>
                                <p className="text-xs text-slate-400">
                                    For any queries, please contact us within 24 hours. <br/>
                                    Note: Products can be exchanged within 3 days if unused and tags attached.
                                </p>
                                <div className="mt-8 flex justify-between items-end px-8">
                                    <div className="text-center">
                                        <div className="w-32 border-t border-slate-400"></div>
                                        <p className="text-[10px] text-slate-500 mt-1">Customer Signature</p>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-32 border-t border-slate-400"></div>
                                        <p className="text-[10px] text-slate-500 mt-1">Authorized Signature</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default InvoiceGenerator;