import React, { useState } from 'react';
import { ArrowRightLeft, Eye, CheckCircle, Clock } from 'lucide-react';
import OrderDetailsPopup from './OrderDetailsPopup';
import { getStatusColor } from '../utils';

const ExchangeTab = ({ orders, onCreate, onEdit, inventory }) => {
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Filter to include both full exchanges and partial exchanges
    const exchangeOrders = orders.filter(o =>
        o.status === 'Exchanged' ||
        o.exchangeDetails ||
        o.isPartialExchange === true ||
        (o.history || []).some(h => h.note?.toLowerCase().includes('partial exchange'))
    );

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
                                <th className="p-3 w-10">Return</th>
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
                            {exchangeOrders.flatMap(order => {
                                // If the order has a full history array, render one row per exchange
                                const records = order.exchangeHistory && order.exchangeHistory.length > 0
                                    ? order.exchangeHistory
                                    : [order.exchangeDetails || {}]; // fallback for legacy single-exchange orders

                                return records.map((record, recordIndex) => {
                                    const isReceived = order.isReturnReceived === true;
                                    const deviation = record.priceDeviation || 0;

                                    return (
                                        <tr key={`${order.id}-${recordIndex}`} className={`hover:bg-slate-50 transition-colors ${isReceived ? 'bg-green-50/30' : ''}`}>
                                            <td className="p-3 text-center">
                                                {/* Only show checkbox on the latest record */}
                                                {recordIndex === records.length - 1 && (
                                                    <input
                                                        type="checkbox"
                                                        checked={isReceived}
                                                        onChange={(e) => {
                                                            onEdit(order.id, order.status, {
                                                                ...order,
                                                                isReturnReceived: e.target.checked
                                                            });
                                                        }}
                                                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                                        title="Mark as Product Received"
                                                    />
                                                )}
                                            </td>
                                            <td className="p-3">
                                                {record.exchangeDate || order.date}
                                                {records.length > 1 && (
                                                    <div className="text-[10px] text-slate-400 font-bold">
                                                        Exchange #{recordIndex + 1}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 font-mono">
                                                <div>{order.merchantOrderId}</div>
                                                {recordIndex === records.length - 1 && (
                                                    isReceived ? (
                                                        <span className="text-[10px] font-bold text-green-600 flex items-center gap-1 mt-1 uppercase">
                                                            <CheckCircle size={10} /> Received Product
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-red-600 flex items-center gap-1 mt-1 uppercase">
                                                            <Clock size={10} /> Awaiting Return
                                                        </span>
                                                    )
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <div className="font-bold">{order.recipientName}</div>
                                                <div className="text-xs text-slate-500">{order.recipientPhone}</div>
                                            </td>
                                            <td className="p-3">
                                                {(record.originalProducts || []).map((p, i) => (
                                                    <div key={i} className="text-xs text-red-600 flex items-center gap-1">
                                                        <ArrowRightLeft size={10} /> {p.code} ({p.size})
                                                    </div>
                                                ))}
                                            </td>
                                            <td className="p-3">
                                                {(record.newProducts || []).map((p, i) => (
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
                                                {recordIndex === records.length - 1 && (
                                                    <button
                                                        onClick={() => setSelectedOrder(order)}
                                                        className="p-1.5 bg-slate-100 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                                        title="View Details"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                });
                            })}
                            {exchangeOrders.length === 0 && (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center text-slate-400">
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
                    onEdit={onEdit}
                    onCreate={onCreate}
                    inventory={inventory}
                />
            )}
        </div>
    );
};

export default ExchangeTab;