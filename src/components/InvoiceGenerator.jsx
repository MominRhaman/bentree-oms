import React from 'react';

const InvoiceGenerator = ({ orders }) => {
    if (!orders || orders.length === 0) return <div className="p-4 text-center text-slate-500">No orders selected for printing.</div>;

    return (
        <div>
            {/* --- PRINT ONLY STYLES --- */}
            <style>
                {`
                    @media screen {
                        .invoice-page {
                            margin: 0px auto;
                            box-shadow: 0 0 10px rgba(0,0,0,0.1);
                            width: 148mm;
                            min-height: 210mm;
                            padding: 5px;
                        }
                    }
                    @media print {
                        @page {
                            size: A5 portrait; /* Set physical paper size to A5 */
                            margin: 0;
                        }
                        body {
                            margin: 0;
                            padding: 0;
                            background: white;
                        }
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
                            width: 148mm; 
                            min-height: 209mm; 
                            page-break-after: always;
                            margin-bottom: 0 !important;
                            padding: 8px !important;
                            border: none !important;
                            box-shadow: none !important;
                            display: flex;
                            flex-direction: column;
                            box-sizing: border-box;
                            background: white;
                        }
                        .invoice-content {
                            flex: 1 0 auto; /* Allows content to grow */
                        }
                        /* FIX: Force background colors to appear in print */
                        .bg-slate-800 {
                            background-color: #1e293b !important;
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        .bg-slate-50 {
                            background-color: #f8fafc !important;
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        /* Hide scrollbars during print */
                        ::-webkit-scrollbar {
                            display: none;
                        }
                    }
                `}
            </style>

            <div id="print-area" className="flex flex-col gap-4 bg-slate-100 p-4 print:p-0 print:bg-white">
                {orders.map((order, index) => {
                    // --- UPDATED Calculations for Product Discounts ---
                    const subtotal = (order.products || []).reduce((sum, p) => {
                        const base = Number(p.price || 0) * Number(p.qty || 0);
                        let itemDisc = 0;
                        if (p.discountType === 'Percent') {
                            itemDisc = base * (Number(p.discountValue || 0) / 100);
                        } else {
                            itemDisc = Number(p.discountValue || 0);
                        }
                        return sum + (base - itemDisc);
                    }, 0);

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
                        <div key={order.id || index} className="invoice-page bg-white mx-auto border border-slate-200 print:border-none">
                            <div className="invoice-content">
                                {/* --- HEADER --- */}
                                <div className="flex justify-between items-start border-b-2 border-slate-800 pb-2 mb-3">
                                    <div>
                                        <img
                                            src="/bentree_logo.webp"
                                            alt="Bentree"
                                            className="h-[25px] w-auto object-contain"
                                        />
                                        <p className="text-[9px] text-slate-500 mt-1 leading-tight">House 62, Level 4, Road 3, <br />Block B, Niketon, Gulshan 1, Dhaka 1212</p>
                                        <p className="text-[9px] text-slate-500">Phone: +880 1870630402</p>
                                        <p className="text-[9px] text-slate-500">Email: bentreebd@gmail.com</p>
                                    </div>
                                    <div className="text-right">
                                        <h2 className="text-sm font-bold text-slate-700">INVOICE</h2>
                                        <p className="text-sm font-mono text-slate-600 mt-1">#{order.merchantOrderId || order.storeOrderId || 'PENDING'}</p>
                                        <p className="text-xs text-slate-500 mt-1">Date: {order.date}</p>
                                        {order.isExpress && (
                                            <div className="mt-1 inline-block bg-slate-800 text-white text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-wider">
                                                Express Delivery
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* --- CUSTOMER --- */}
                                <div className="mb-3 bg-slate-50 p-2 rounded-sm border border-slate-100">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Bill To:</p>
                                    <h3 className="font-bold text-slate-800 text-sm leading-tight">{order.recipientName || 'Guest Customer'}</h3>
                                    <p className="text-xs text-slate-600 mt-1"><strong>Phone:</strong> {order.recipientPhone}</p>
                                    <p className="text-xs text-slate-600 mt-1"><strong>Address:</strong> {order.recipientAddress || 'N/A'}</p>
                                </div>

                                {/* --- ITEMS TABLE --- */}
                                <table className="w-full text-[10px] text-left mb-3 border-collapse">
                                    <thead className="bg-slate-800 text-white uppercase text-[8px]">
                                        <tr>
                                            <th className="p-2">Product Code</th>
                                            <th className="p-2 text-center">Size</th>
                                            <th className="p-2 text-center">Qty</th>
                                            <th className="p-2 text-right">Price</th>
                                            <th className="p-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(order.products || []).map((p, i) => {
                                            const lineBase = Number(p.price || 0) * Number(p.qty || 0);
                                            let lineDisc = p.discountType === 'Percent' ? lineBase * (Number(p.discountValue || 0) / 100) : Number(p.discountValue || 0);
                                            const lineTotal = lineBase - lineDisc;

                                            return (
                                                <tr key={i}>
                                                    <td className="p-2">
                                                        <div className="font-bold text-slate-700">{p.code}</div>
                                                        {lineDisc > 0 && (
                                                            <div className="text-[10px] text-red-500 italic">
                                                                Discount: {p.discountType === 'Percent' ? `${p.discountValue}%` : `৳${p.discountValue}`}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-center">{p.size}</td>
                                                    <td className="p-2 text-center">{p.qty}</td>
                                                    <td className="p-2 text-right">৳{p.price}</td>
                                                    <td className="p-2 text-right font-medium">৳{lineTotal.toFixed(0)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* --- TOTALS & FOOTER --- */}
                            <div className="mt-auto">
                                <div className="flex justify-end mb-4">
                                    <div className="w-40 space-y-1 text-[10px]">
                                        <div className="flex justify-between text-slate-600">
                                            <span>Subtotal:</span>
                                            <span>৳{subtotal.toFixed(0)}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-600">
                                            <span>Delivery Charge:</span>
                                            <span>৳{delivery}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-600">
                                            <span>Global Discount:</span>
                                            <span>- ৳{discount.toFixed(0)}</span>
                                        </div>
                                        {(advance > 0 || collected > 0) && (
                                            <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-1">
                                                <span>Paid / Advance:</span>
                                                <span>- ৳{(advance + collected)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-lg font-bold text-slate-800 border-t border-slate-800 pt-2">
                                            <span>Total Due:</span>
                                            <span>৳{dueAmount > 0 ? dueAmount.toFixed(0) : 0}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* --- FOOTER --- */}
                                <div className="mt-8 pt-6 border-t border-slate-200 text-center">
                                    <p className="text-sm font-bold text-slate-700 mb-2">Thank you for shopping with Bentree!</p>
                                    <p className="text-xs text-slate-400">
                                        For any queries, please contact us within 24 hours. <br />
                                        Note: Products can be exchanged within 3 days if unused and tags attached.
                                    </p>
                                    <div className="mt-8 flex justify-between items-end px-8">
                                        <div className="text-center">
                                            <div className="w-32 border-t border-slate-400"></div>
                                            <p className="text-[10px] text-slate-500 mt-1 uppercase">Customer Signature</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="w-32 border-t border-slate-400"></div>
                                            <p className="text-[10px] text-slate-500 mt-1 uppercase">Authorized Signature</p>
                                        </div>
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