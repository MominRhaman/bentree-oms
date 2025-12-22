import React, { useState } from 'react';
import { ArrowRightLeft, Eye } from 'lucide-react';
import OrderDetailsPopup from './OrderDetailsPopup';
import { getStatusColor } from '../utils';

const ExchangeTab = ({ orders }) => {
    const [selectedOrder, setSelectedOrder] = useState(null);

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-4">
                    <div className="bg-yellow-100 p-2 rounded-lg text-yellow-700">
                        <ArrowRightLeft size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-slate-800">Exchange History</h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 font-bold border-b">
                            <tr>
                                <th className="p-3">Date</th>
                                <th className="p-3">Order ID</th>
                                <th className="p-3">Customer</th>
                                <th className="p-3">Original Items (Returned)</th>
                                <th className="p-3">New Items (Given)</th>
                                <th className="p-3 text-right">Financial Adj.</th>
                                <th className="p-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {orders.map(order => {
                                const details = order.exchangeDetails || {};
                                // This deviation now comes from the corrected formula in ExchangeModal
                                const deviation = details.priceDeviation || 0;
                                
                                return (
                                    <tr key={order.id} className="hover:bg-slate-50">
                                        <td className="p-3">{details.exchangeDate || order.date}</td>
                                        <td className="p-3 font-mono">{order.merchantOrderId}</td>
                                        <td className="p-3">
                                            <div className="font-bold">{order.recipientName}</div>
                                            <div className="text-xs text-slate-500">{order.recipientPhone}</div>
                                        </td>
                                        <td className="p-3">
                                            {(details.originalProducts || []).map((p, i) => (
                                                <div key={i} className="text-xs text-red-600 flex items-center gap-1">
                                                    <ArrowRightLeft size={10} /> {p.code} ({p.size})
                                                </div>
                                            ))}
                                        </td>
                                        <td className="p-3">
                                            {(details.newProducts || []).map((p, i) => (
                                                <div key={i} className="text-xs text-green-600 font-bold">
                                                    + {p.code} ({p.size})
                                                </div>
                                            ))}
                                        </td>
                                        <td className="p-3 text-right">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${deviation >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {deviation >= 0 ? `Customer Paid: ৳${deviation}` : `Store Refunded: ৳${Math.abs(deviation)}`}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <button 
                                                onClick={() => setSelectedOrder(order)}
                                                className="text-slate-500 hover:text-emerald-600"
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {orders.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="p-8 text-center text-slate-400">
                                        No exchange records found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedOrder && (
                <OrderDetailsPopup 
                    order={selectedOrder} 
                    onClose={() => setSelectedOrder(null)} 
                    getStatusColor={getStatusColor}
                    onEdit={() => alert("Exchange logs are read-only.")} 
                />
            )}
        </div>
    );
};

export default ExchangeTab;