import React, { useState, useMemo, useRef } from 'react';
import {
    Search, Download, FileText, X,
    Package, TrendingUp, ArrowUpDown, ChevronRight
} from 'lucide-react';
import { downloadCSV } from '../utils';

// ── Date helpers ──────────────────────────────────────────────────────────────

const PERIODS = [
    { id: 'today',     label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'week',      label: 'This Week' },
    { id: 'month',     label: 'This Month' },
    { id: 'custom',    label: 'Custom' },
];

function getDateRange(period, customStart, customEnd) {
    const now        = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    switch (period) {
        case 'today':     return { start: todayStart, end: todayEnd };
        case 'yesterday': {
            const s = new Date(todayStart); s.setDate(s.getDate() - 1);
            const e = new Date(s);          e.setHours(23, 59, 59, 999);
            return { start: s, end: e };
        }
        case 'week': {
            const s = new Date(todayStart); s.setDate(s.getDate() - 6);
            return { start: s, end: todayEnd };
        }
        case 'month': {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: s, end: todayEnd };
        }
        case 'custom':
            if (customStart && customEnd) {
                const s = new Date(customStart);
                const e = new Date(customEnd); e.setHours(23, 59, 59, 999);
                return { start: s, end: e };
            }
            return { start: todayStart, end: todayEnd };
        default:
            return { start: todayStart, end: todayEnd };
    }
}

// ── Type / colour helpers ────────────────────────────────────────────────────

function getSaleType(order) {
    if (order.isPartialExchange) return 'Partial Exchange';
    if (order.exchangeDetails)   return 'Exchange';
    if (order.type === 'Store')  return 'Store Sale';
    return 'Online Order';
}

const ACTION_BADGE = {
    'Order':              'bg-blue-100 text-blue-700',
    'Online Order':       'bg-blue-100 text-blue-700',
    'Store Sale':         'bg-indigo-100 text-indigo-700',
    'Exchange':           'bg-yellow-100 text-yellow-700',
    'Partial Exchange':   'bg-orange-100 text-orange-700',
    'Return':             'bg-red-100 text-red-700',
    'Partial Return':     'bg-rose-100 text-rose-700',
    'Cancel':             'bg-slate-100 text-slate-600',
    'Manual Stock Add':   'bg-emerald-100 text-emerald-700',
    'Manual Stock Minus': 'bg-red-100 text-red-700',
};

// ── Print helper ─────────────────────────────────────────────────────────────

function openPrintWindow(title, tableHtml) {
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#333}
h2{font-size:14px;margin-bottom:4px}p{margin:0 0 10px;font-size:10px;color:#666}
table{border-collapse:collapse;width:100%}
th{background:#f0f0f0;border:1px solid #ccc;padding:5px 7px;text-align:left;font-weight:bold}
td{border:1px solid #ddd;padding:4px 7px}
tr:nth-child(even) td{background:#fafafa}</style></head>
<body><h2>${title}</h2><p>Generated: ${new Date().toLocaleString()}</p>${tableHtml}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 250);
}

// ── Build full movement log from orders + adjustments ────────────────────────

function buildAllMovements(orders, adjustments, inventoryMap) {
    const entries = [];

    // 1. Manual stock adjustments
    adjustments.forEach(adj => {
        const ts = adj.timestamp?.toDate ? adj.timestamp.toDate() : new Date(adj.date || 0);
        entries.push({
            date:        ts,
            productCode: (adj.productCode || '').toUpperCase(),
            productName: adj.productName || '—',
            actionType:  adj.adjustmentType === 'Add' ? 'Manual Stock Add' : 'Manual Stock Minus',
            change:      Number(adj.change || 0),
            reference:   '—',
            stockBefore: adj.previousQty ?? '—',
            stockAfter:  adj.newQty      ?? '—',
            user:        adj.adjustedBy  || '—',
        });
    });

    // 2. Order-derived movements
    orders.forEach(order => {
        const reference = order.merchantOrderId || order.storeOrderId || order.id;
        const createdAt = order.createdAt?.toDate
            ? order.createdAt.toDate()
            : new Date(order.date || 0);
        const wasActive = order.stockDeducted ||
            !['Cancelled', 'Returned'].includes(order.status);

        (order.products || []).forEach(mp => {
            const code = (mp.code || '').toUpperCase();
            if (!code) return;
            const qty = Number(mp.qty || 0);
            if (qty === 0) return;

            // Resolve product name: prefer inventory, fallback to order product name
            const productName = inventoryMap.get(code)?.productName || mp.name || code;

            if (wasActive) {
                entries.push({
                    date:        createdAt,
                    productCode: code,
                    productName,
                    actionType:  getSaleType(order),
                    change:      -qty,
                    reference,
                    stockBefore: '—',
                    stockAfter:  '—',
                    user:        order.addedBy || order.createdBy || '—',
                });
            }

            (order.history || []).forEach(h => {
                if (!h.timestamp) return;
                const d = new Date(h.timestamp);
                if (h.status === 'Cancelled') {
                    entries.push({
                        date: d, productCode: code, productName,
                        actionType: 'Cancel', change: +qty,
                        reference, stockBefore: '—', stockAfter: '—',
                        user: h.updatedBy || '—',
                    });
                }
                if (h.status === 'Returned') {
                    entries.push({
                        date: d, productCode: code, productName,
                        actionType: order._oms_partial_return ? 'Partial Return' : 'Return',
                        change: +qty,
                        reference, stockBefore: '—', stockAfter: '—',
                        user: h.updatedBy || '—',
                    });
                }
            });
        });
    });

    return entries;
}

// ── Main component ────────────────────────────────────────────────────────────

const SalesInventoryReport = ({ orders, inventory, adjustments }) => {
    // Shared filter state
    const [period,      setPeriod]      = useState('week');
    const [customStart, setCustomStart] = useState('');
    const [customEnd,   setCustomEnd]   = useState('');
    const [search,      setSearch]      = useState('');

    // Top-level view
    const [topTab, setTopTab] = useState('sales'); // 'sales' | 'movement'

    // Per-product detail panel
    const [selected,          setSelected]          = useState(null);
    const [detailTab,         setDetailTab]         = useState('sales');
    const [detailPeriod,      setDetailPeriod]      = useState('all');
    const [detailCustomStart, setDetailCustomStart] = useState('');
    const [detailCustomEnd,   setDetailCustomEnd]   = useState('');

    const mainSalesRef    = useRef(null);
    const mainMovementRef = useRef(null);
    const detailRef       = useRef(null);

    const dateRange = useMemo(
        () => getDateRange(period, customStart, customEnd),
        [period, customStart, customEnd]
    );

    // Inventory code → item map for name lookups
    const inventoryMap = useMemo(() => {
        const m = new Map();
        inventory.forEach(i => { if (i.code) m.set(i.code.toUpperCase(), i); });
        return m;
    }, [inventory]);

    // ── Products with sales in selected period ────────────────────────────────
    const productSales = useMemo(() => {
        const { start, end } = dateRange;
        const map = {};
        orders.forEach(order => {
            if (['Cancelled', 'Returned'].includes(order.status)) return;
            const d = order.createdAt?.toDate
                ? order.createdAt.toDate()
                : new Date(order.date || 0);
            if (d < start || d > end) return;
            (order.products || []).forEach(p => {
                const code = (p.code || '').toUpperCase();
                if (!code) return;
                if (!map[code]) map[code] = { soldQty: 0, lastSaleDate: null };
                map[code].soldQty += Number(p.qty || 0);
                if (!map[code].lastSaleDate || d > map[code].lastSaleDate) {
                    map[code].lastSaleDate = d;
                }
            });
        });

        return Object.entries(map)
            .map(([code, data]) => {
                const inv = inventoryMap.get(code);
                const currentStock = inv
                    ? (inv.type === 'Variable'
                        ? Object.values(inv.stock || {}).reduce((a, b) => a + Number(b || 0), 0)
                        : Number(inv.totalStock || 0))
                    : 0;
                return {
                    code,
                    productName:  inv?.productName || code,
                    category:     inv?.category    || '—',
                    soldQty:      data.soldQty,
                    currentStock,
                    lastSaleDate: data.lastSaleDate,
                };
            })
            .sort((a, b) => b.soldQty - a.soldQty);
    }, [orders, inventoryMap, dateRange]);

    // ── All movements (orders + manual adjustments) ───────────────────────────
    const allMovements = useMemo(
        () => buildAllMovements(orders, adjustments, inventoryMap),
        [orders, adjustments, inventoryMap]
    );

    // Movements filtered by date + search (top-level Movement Log tab)
    const filteredMovements = useMemo(() => {
        const { start, end } = dateRange;
        let list = allMovements.filter(e => e.date >= start && e.date <= end);
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(e =>
                e.productCode.toLowerCase().includes(q) ||
                e.productName.toLowerCase().includes(q)
            );
        }
        return [...list].sort((a, b) => b.date - a.date);
    }, [allMovements, dateRange, search]);

    // ── Sales table filtered by search ────────────────────────────────────────
    const displayProducts = useMemo(() => {
        if (!search) return productSales;
        const q = search.toLowerCase();
        return productSales.filter(r =>
            r.code.toLowerCase().includes(q) ||
            r.productName.toLowerCase().includes(q)
        );
    }, [productSales, search]);

    // ── Summary ───────────────────────────────────────────────────────────────
    const summary = useMemo(() => {
        const { start, end } = dateRange;
        const orderIds = new Set(
            orders
                .filter(o => !['Cancelled', 'Returned'].includes(o.status))
                .filter(o => {
                    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.date || 0);
                    return d >= start && d <= end;
                })
                .map(o => o.id)
        );
        return {
            products:     displayProducts.length,
            totalOrders:  orderIds.size,
            totalQtySold: displayProducts.reduce((s, r) => s + r.soldQty, 0),
            movements:    filteredMovements.length,
        };
    }, [displayProducts, orders, dateRange, filteredMovements]);

    // ── Per-product detail ────────────────────────────────────────────────────
    const detailDateRange = useMemo(
        () => detailPeriod === 'all' ? null : getDateRange(detailPeriod, detailCustomStart, detailCustomEnd),
        [detailPeriod, detailCustomStart, detailCustomEnd]
    );

    const salesHistory = useMemo(() => {
        if (!selected) return [];
        const code = selected.code;
        const dr   = detailDateRange;
        const rows = [];
        orders.forEach(order => {
            const mp = (order.products || []).find(p => (p.code || '').toUpperCase() === code);
            if (!mp) return;
            const d = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.date || 0);
            if (dr && (d < dr.start || d > dr.end)) return;
            rows.push({
                date:     d,
                orderId:  order.merchantOrderId || order.storeOrderId || order.id,
                qty:      Number(mp.qty || 0),
                saleType: getSaleType(order),
                status:   order.status,
                user:     order.addedBy || order.createdBy || '—',
            });
        });
        return rows.sort((a, b) => b.date - a.date);
    }, [selected, orders, detailDateRange]);

    const productMovements = useMemo(() => {
        if (!selected) return [];
        const code = selected.code;
        const dr   = detailDateRange;
        const list = allMovements.filter(e => {
            if (e.productCode !== code) return false;
            if (dr && (e.date < dr.start || e.date > dr.end)) return false;
            return true;
        });
        return [...list].sort((a, b) => b.date - a.date);
    }, [selected, allMovements, detailDateRange]);

    // ── Period label ──────────────────────────────────────────────────────────
    const periodLabel = period === 'custom' && customStart && customEnd
        ? `${customStart} → ${customEnd}`
        : (PERIODS.find(p => p.id === period)?.label || '');

    // ── Exports ───────────────────────────────────────────────────────────────
    const exportMovementCSV = () => {
        const data = filteredMovements.map(e => ({
            'Date & Time':   e.date.toLocaleString(),
            'Product Code':  e.productCode,
            'Product Name':  e.productName,
            'Action Type':   e.actionType,
            'Reference':     e.reference,
            'Stock Before':  e.stockBefore,
            'Change':        e.change > 0 ? `+${e.change}` : `${e.change}`,
            'Stock After':   e.stockAfter,
            'User':          e.user,
        }));
        downloadCSV(data, `movement_log_${period}_${new Date().toISOString().split('T')[0]}.csv`);
    };

    const exportMovementExcel = () => {
        const headers = ['Date & Time','Product Code','Product Name','Action Type','Reference','Stock Before','Change','Stock After','User'];
        const rows = filteredMovements.map(e => [
            e.date.toLocaleString(), e.productCode, e.productName, e.actionType,
            e.reference, e.stockBefore,
            e.change > 0 ? `+${e.change}` : `${e.change}`,
            e.stockAfter, e.user,
        ]);
        const html = [
            '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table>',
            `<tr>${headers.map(h => `<th style="font-weight:bold;background:#f4f4f4">${h}</th>`).join('')}</tr>`,
            rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join(''),
            '</table></body></html>',
        ].join('');
        const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `movement_log_${period}_${new Date().toISOString().split('T')[0]}.xls`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    const exportSalesCSV = () => {
        const data = displayProducts.map(r => ({
            'Product Name':   r.productName,
            'SKU':            r.code,
            'Category':       r.category,
            'Qty Sold':       r.soldQty,
            'Current Stock':  r.currentStock,
            'Last Sale Date': r.lastSaleDate ? r.lastSaleDate.toLocaleDateString() : '—',
        }));
        downloadCSV(data, `sales_report_${period}_${new Date().toISOString().split('T')[0]}.csv`);
    };

    const exportDetailCSV = () => {
        const name = selected?.productName || selected?.code || 'product';
        if (detailTab === 'sales') {
            const data = salesHistory.map(r => ({
                'Date & Time': r.date.toLocaleString(),
                'Order ID': r.orderId, 'Qty Sold': r.qty,
                'Sale Type': r.saleType, 'Status': r.status, 'User': r.user,
            }));
            downloadCSV(data, `sales_${name}_${new Date().toISOString().split('T')[0]}.csv`);
        } else {
            const data = productMovements.map(e => ({
                'Date & Time': e.date.toLocaleString(),
                'Action Type': e.actionType, 'Reference': e.reference,
                'Stock Before': e.stockBefore,
                'Change': e.change > 0 ? `+${e.change}` : `${e.change}`,
                'Stock After': e.stockAfter, 'User': e.user,
            }));
            downloadCSV(data, `movement_${name}_${new Date().toISOString().split('T')[0]}.csv`);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-5">

            {/* ── Header + filters ─────────────────────────────────────────── */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Sales & Inventory Report</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            {topTab === 'sales' ? `Products with sales — ` : `Inventory movement log — `}
                            <span className="font-semibold">{periodLabel}</span>
                        </p>
                    </div>
                    {/* Export buttons per active top tab */}
                    {topTab === 'sales' ? (
                        <div className="flex gap-2">
                            <button onClick={exportSalesCSV} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors">
                                <Download size={13} /> CSV
                            </button>
                            <button onClick={() => openPrintWindow(`Sales Report — ${periodLabel}`, mainSalesRef.current?.outerHTML || '')} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors">
                                <FileText size={13} /> PDF
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button onClick={exportMovementCSV} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors">
                                <Download size={13} /> CSV
                            </button>
                            <button onClick={exportMovementExcel} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors">
                                <Download size={13} /> Excel
                            </button>
                            <button onClick={() => openPrintWindow(`Movement Log — ${periodLabel}`, mainMovementRef.current?.outerHTML || '')} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors">
                                <FileText size={13} /> PDF
                            </button>
                        </div>
                    )}
                </div>

                {/* Shared filters */}
                <div className="mt-4 flex flex-wrap gap-3 items-center">
                    <div className="flex gap-0.5 bg-slate-100 p-1 rounded-lg">
                        {PERIODS.map(p => (
                            <button key={p.id} onClick={() => setPeriod(p.id)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${period === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {period === 'custom' && (
                        <div className="flex items-center gap-2">
                            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 outline-none focus:border-blue-400" />
                            <span className="text-slate-400 text-xs">to</span>
                            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 outline-none focus:border-blue-400" />
                        </div>
                    )}
                    <div className="relative ml-auto">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="Search by name or SKU…" value={search} onChange={e => setSearch(e.target.value)}
                            className="pl-8 pr-4 py-1.5 text-xs border rounded-lg w-56 outline-none focus:border-blue-400" />
                    </div>
                </div>
            </div>

            {/* ── Summary cards ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Products Sold',    value: summary.products,     color: 'text-blue-700',    icon: <Package size={22} className="text-blue-200" /> },
                    { label: 'Total Orders',     value: summary.totalOrders,  color: 'text-slate-700',   icon: <ArrowUpDown size={22} className="text-slate-200" /> },
                    { label: 'Units Sold',       value: summary.totalQtySold, color: 'text-emerald-700', icon: <TrendingUp size={22} className="text-emerald-200" /> },
                    { label: 'Movement Entries', value: summary.movements,    color: 'text-purple-700',  icon: <ArrowUpDown size={22} className="text-purple-200" /> },
                ].map(c => (
                    <div key={c.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{c.label}</p>
                            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                        </div>
                        {c.icon}
                    </div>
                ))}
            </div>

            {/* ── Top-level tab selector ───────────────────────────────────── */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setTopTab('sales')}
                    className={`px-5 py-2 text-sm font-bold rounded-lg transition-colors ${topTab === 'sales' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Sales Report
                    {displayProducts.length > 0 && (
                        <span className="ml-2 bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {displayProducts.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setTopTab('movement')}
                    className={`px-5 py-2 text-sm font-bold rounded-lg transition-colors ${topTab === 'movement' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Inventory Movement Log
                    {filteredMovements.length > 0 && (
                        <span className="ml-2 bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {filteredMovements.length}
                        </span>
                    )}
                </button>
            </div>

            {/* ── Sales Report tab ─────────────────────────────────────────── */}
            {topTab === 'sales' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto max-h-[600px] relative">
                        <table ref={mainSalesRef} className="w-full text-sm text-left min-w-[700px]">
                            <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-3">Product Name</th>
                                    <th className="p-3">SKU</th>
                                    <th className="p-3">Category</th>
                                    <th className="p-3 text-center">Qty Sold</th>
                                    <th className="p-3 text-center">Current Stock</th>
                                    <th className="p-3">Last Sale Date</th>
                                    <th className="p-3 text-center">Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {displayProducts.map((row, i) => (
                                    <tr key={row.code + i} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3 font-medium text-slate-800">{row.productName}</td>
                                        <td className="p-3 font-mono text-xs text-slate-500">{row.code}</td>
                                        <td className="p-3 text-xs text-slate-500">{row.category}</td>
                                        <td className="p-3 text-center font-bold text-blue-700">{row.soldQty}</td>
                                        <td className="p-3 text-center">
                                            <span className={`font-bold ${row.currentStock < 5 ? 'text-red-600' : 'text-slate-700'}`}>
                                                {row.currentStock}
                                            </span>
                                        </td>
                                        <td className="p-3 text-xs text-slate-500">
                                            {row.lastSaleDate ? row.lastSaleDate.toLocaleDateString() : '—'}
                                        </td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={() => { setSelected(row); setDetailTab('sales'); setDetailPeriod('all'); }}
                                                className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                                            >
                                                View <ChevronRight size={13} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {displayProducts.length === 0 && (
                                    <tr>
                                        <td colSpan="7" className="p-12 text-center text-slate-400">
                                            No sales found for this period. Try changing the filter to <span className="font-bold">This Week</span> or <span className="font-bold">This Month</span>.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Inventory Movement Log tab ───────────────────────────────── */}
            {topTab === 'movement' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto max-h-[600px] relative">
                        <table ref={mainMovementRef} className="w-full text-sm text-left min-w-[900px]">
                            <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-3">Date & Time</th>
                                    <th className="p-3">Product Code</th>
                                    <th className="p-3">Product Name</th>
                                    <th className="p-3 text-center">Action Type</th>
                                    <th className="p-3">Reference</th>
                                    <th className="p-3 text-right">Stock Before</th>
                                    <th className="p-3 text-center">Change</th>
                                    <th className="p-3 text-right">Stock After</th>
                                    <th className="p-3">User</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredMovements.map((entry, i) => (
                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                                            {entry.date.toLocaleDateString()} {entry.date.toLocaleTimeString()}
                                        </td>
                                        <td className="p-3 font-mono text-xs font-bold text-slate-700">{entry.productCode}</td>
                                        <td className="p-3 text-xs text-slate-600 max-w-[140px] truncate" title={entry.productName}>
                                            {entry.productName}
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ACTION_BADGE[entry.actionType] || 'bg-slate-100 text-slate-600'}`}>
                                                {entry.actionType}
                                            </span>
                                        </td>
                                        <td className="p-3 font-mono text-xs text-slate-600">{entry.reference}</td>
                                        <td className="p-3 text-right text-xs text-slate-500">{entry.stockBefore}</td>
                                        <td className={`p-3 text-center font-bold ${Number(entry.change) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {Number(entry.change) > 0 ? `+${entry.change}` : entry.change}
                                        </td>
                                        <td className="p-3 text-right text-xs text-slate-500">{entry.stockAfter}</td>
                                        <td className="p-3 text-xs text-slate-500">{entry.user}</td>
                                    </tr>
                                ))}
                                {filteredMovements.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="p-12 text-center text-slate-400">
                                            No inventory movements found for this period.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Per-product detail overlay ───────────────────────────────── */}
            {selected && (
                <div className="fixed inset-0 z-50 flex">
                    <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setSelected(null)} />
                    <div className="relative ml-auto w-full max-w-4xl bg-white h-full shadow-2xl flex flex-col overflow-hidden">

                        {/* Panel header */}
                        <div className="flex items-start justify-between p-5 border-b bg-slate-50 flex-shrink-0">
                            <div>
                                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wide mb-0.5">Product Details</p>
                                <h3 className="text-lg font-bold text-slate-800">{selected.productName}</h3>
                                <p className="text-xs text-slate-500 font-mono mt-0.5">SKU: {selected.code}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={exportDetailCSV} className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg border border-emerald-200 transition-colors">
                                    <Download size={12} /> CSV
                                </button>
                                <button onClick={() => openPrintWindow(
                                    detailTab === 'sales' ? `Sales History — ${selected.productName}` : `Movement Log — ${selected.productName}`,
                                    detailRef.current?.outerHTML || ''
                                )} className="flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg border border-red-200 transition-colors">
                                    <FileText size={12} /> PDF
                                </button>
                                <button onClick={() => setSelected(null)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                                    <X size={18} className="text-slate-600" />
                                </button>
                            </div>
                        </div>

                        {/* Detail date filter */}
                        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b bg-white flex-shrink-0">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Period:</span>
                            <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                                <button onClick={() => setDetailPeriod('all')} className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${detailPeriod === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                    All Time
                                </button>
                                {PERIODS.map(p => (
                                    <button key={p.id} onClick={() => setDetailPeriod(p.id)} className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${detailPeriod === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {detailPeriod === 'custom' && (
                                <div className="flex items-center gap-2">
                                    <input type="date" value={detailCustomStart} onChange={e => setDetailCustomStart(e.target.value)} className="text-xs border rounded-lg px-2 py-1 outline-none" />
                                    <span className="text-slate-400 text-xs">to</span>
                                    <input type="date" value={detailCustomEnd} onChange={e => setDetailCustomEnd(e.target.value)} className="text-xs border rounded-lg px-2 py-1 outline-none" />
                                </div>
                            )}
                        </div>

                        {/* Detail tabs */}
                        <div className="flex gap-1 px-5 pt-3 bg-white border-b flex-shrink-0">
                            {[
                                { id: 'sales',    label: `Sales History (${salesHistory.length})` },
                                { id: 'movement', label: `Movement Log (${productMovements.length})` },
                            ].map(t => (
                                <button key={t.id} onClick={() => setDetailTab(t.id)}
                                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${detailTab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        {/* Detail content */}
                        <div className="flex-1 overflow-auto">

                            {detailTab === 'sales' && (
                                <table ref={detailRef} className="w-full text-sm text-left min-w-[600px]">
                                    <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="p-3">Date & Time</th>
                                            <th className="p-3">Order ID</th>
                                            <th className="p-3 text-center">Qty Sold</th>
                                            <th className="p-3 text-center">Sale Type</th>
                                            <th className="p-3 text-center">Status</th>
                                            <th className="p-3">User</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {salesHistory.map((row, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                                                    {row.date.toLocaleDateString()} {row.date.toLocaleTimeString()}
                                                </td>
                                                <td className="p-3 font-mono text-xs text-slate-700">{row.orderId}</td>
                                                <td className="p-3 text-center font-bold text-blue-700">{row.qty}</td>
                                                <td className="p-3 text-center">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ACTION_BADGE[row.saleType] || 'bg-slate-100 text-slate-600'}`}>
                                                        {row.saleType}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${row.status === 'Delivered' ? 'bg-green-100 text-green-700' : row.status === 'Cancelled' || row.status === 'Returned' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {row.status}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-xs text-slate-500">{row.user}</td>
                                            </tr>
                                        ))}
                                        {salesHistory.length === 0 && (
                                            <tr><td colSpan="6" className="p-10 text-center text-slate-400">No sales records found.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            )}

                            {detailTab === 'movement' && (
                                <table ref={detailRef} className="w-full text-sm text-left min-w-[700px]">
                                    <thead className="bg-white text-slate-600 font-bold border-b sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="p-3">Date & Time</th>
                                            <th className="p-3 text-center">Action Type</th>
                                            <th className="p-3">Reference</th>
                                            <th className="p-3 text-right">Stock Before</th>
                                            <th className="p-3 text-center">Change</th>
                                            <th className="p-3 text-right">Stock After</th>
                                            <th className="p-3">User</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {productMovements.map((entry, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                                                    {entry.date.toLocaleDateString()} {entry.date.toLocaleTimeString()}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ACTION_BADGE[entry.actionType] || 'bg-slate-100 text-slate-600'}`}>
                                                        {entry.actionType}
                                                    </span>
                                                </td>
                                                <td className="p-3 font-mono text-xs text-slate-600">{entry.reference}</td>
                                                <td className="p-3 text-right text-xs text-slate-500">{entry.stockBefore}</td>
                                                <td className={`p-3 text-center font-bold ${Number(entry.change) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {Number(entry.change) > 0 ? `+${entry.change}` : entry.change}
                                                </td>
                                                <td className="p-3 text-right text-xs text-slate-500">{entry.stockAfter}</td>
                                                <td className="p-3 text-xs text-slate-500">{entry.user}</td>
                                            </tr>
                                        ))}
                                        {productMovements.length === 0 && (
                                            <tr><td colSpan="7" className="p-10 text-center text-slate-400">No movement records found.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(SalesInventoryReport);
