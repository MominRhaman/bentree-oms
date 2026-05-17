import React, { useState, useRef } from 'react';
import Barcode from 'react-barcode';
import { Printer, X, ArrowLeft, ChevronLeft, ChevronRight, Settings, Tag } from 'lucide-react';

// --- LABEL SIZE PRESETS ---
const SIZE_PRESETS = [
    { label: '50mm × 25mm (Default)', width: '50mm', height: '25mm', previewW: 200, previewH: 100 },
    { label: '50mm × 30mm', width: '50mm', height: '30mm', previewW: 200, previewH: 120 },
    { label: '60mm × 40mm', width: '60mm', height: '40mm', previewW: 240, previewH: 160 },
    { label: 'Custom', width: '', height: '', previewW: 0, previewH: 0 },
];

const BarcodePrintView = ({ items, onClose }) => {
    // --- State ---
    const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
    const [customW, setCustomW] = useState('45');
    const [customH, setCustomH] = useState('28');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [printMode, setPrintMode] = useState('single');

    const printFrameRef = useRef(null);

    if (!items || items.length === 0) {
        return (
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3 mb-4">
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1 text-sm font-medium">
                            <ArrowLeft size={16} /> Back to Inventory
                        </button>
                    </div>
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Tag size={48} className="mb-4 text-slate-200" />
                        <p className="font-bold text-lg">No Labels in Queue</p>
                        <p className="text-sm mt-1">Return to inventory and click the print icon on a product.</p>
                    </div>
                </div>
            </div>
        );
    }

    // --- Resolve active size ---
    const preset = SIZE_PRESETS[selectedPresetIdx];
    const isCustom = preset.label === 'Custom';
    const activeWidth = isCustom ? `${customW}mm` : preset.width;
    const activeHeight = isCustom ? `${customH}mm` : preset.height;
    // Preview pixel dimensions (scaled for screen display)
    const previewW = isCustom ? Math.max(100, Number(customW) * 4) : preset.previewW;
    const previewH = isCustom ? Math.max(60, Number(customH) * 4) : preset.previewH;

    // --- Current item for single print ---
    const currentItem = items[currentIndex];

    // --- Build barcode value: "CODE-SIZE" for variable, just "CODE" for free size ---
    const getBarcodeValue = (item) =>
        item.size && item.size !== 'Free'
            ? `${item.code}-${item.size}`
            : item.code;

    // --- Determine barcode dimensions based on label size ---
    const getBarcodeProps = (w, h) => {
        const wNum = parseFloat(w) || 38;
        const hNum = parseFloat(h) || 25;
        return {
            width: Math.max(0.6, wNum / 38),        
            height: Math.max(18, hNum * 1.0),      
        };
    };

    const barcodeProps = getBarcodeProps(activeWidth, activeHeight);

    const handlePrint = (mode) => {
        const labelsToPrint = mode === 'single' ? [currentItem] : items;

        // FIX 4: Build label HTML with idx so last label gets no page-break-after.
        const labelsHTML = labelsToPrint.map((item, idx) => {
            const safeId = `bc_${idx}`;
            const isLast = idx === labelsToPrint.length - 1;
            return `
        <div class="barcode-label${isLast ? ' last-label' : ''}">
            <div class="brand">Bentree</div>
            <div class="product-name">${item.productName || item.category || ''}</div>
            <div class="barcode-wrap">
                <svg id="${safeId}"></svg>
            </div>
            <div class="code-text">${item.code}</div>
            <div class="bottom-row">
                <span>${item.size !== 'Free' ? `SIZE: ${item.size}` : 'SIZE: FREE'}</span>
                <span>MRP: &#2547;${item.mrp}</span>
            </div>
        </div>`;
        }).join('');

        // Build barcode init script — safe numeric index IDs (avoids invalid CSS selectors
        const barcodeScripts = labelsToPrint.map((item, idx) => {
            const value = getBarcodeValue(item);
            const safeId = `bc_${idx}`;
            return `
                try {
                    JsBarcode("#${safeId}", "${value}", {
                        width: ${barcodeProps.width},
                        height: ${Math.max(20, parseFloat(activeHeight) * 1.2)},
                        fontSize: 0,
                        margin: 0,
                        background: "transparent",
                        lineColor: "#000"
                    });
                } catch(e) { console.warn("Barcode render error idx ${idx}:", e); }
            `;
        }).join('\n');

        const printDoc = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>

    @page {
        size: ${activeWidth} ${activeHeight};
        margin-top: 0mm;
        margin-right: 0mm;
        margin-bottom: 0mm;
        margin-left: 0mm;
    }

    html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${activeWidth};
        height: ${activeHeight};
        max-height: ${activeHeight};
        overflow: hidden;
        background: white;
        font-family: Arial, sans-serif;
        /* Both prefixes required: -webkit- for Chrome/Edge/Safari, unprefixed for Firefox */
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    .barcode-label {
        width: ${activeWidth};
        height: ${activeHeight};
        max-height: ${activeHeight};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1mm 1.5mm;
        page-break-after: always;
        overflow: hidden;
    }
    .barcode-label.last-label {
        /* FIX 4 continued: explicitly remove page-break on last label */
        page-break-after: avoid;
    }

    /* Font sizes in pt — physical unit, consistent across all printer DPIs (1pt = 0.353mm) */
    .brand {
        font-size: 6pt;
        font-weight: bold;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 1pt;
        line-height: 1;
    }
    .product-name {
        font-size: 8pt;
        font-weight: 900;
        color: #000;
        text-transform: uppercase;
        text-align: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.2;
        margin-bottom: 0.3mm;
    }
    .barcode-wrap {
        margin: 0;
        padding: 0;
        display: flex;
        justify-content: center;
        width: 100%;
    }
    /* max-width: 100% prevents the barcode SVG from overflowing and triggering a wider layout */
    .barcode-wrap svg {
        max-width: 100%;
        display: block;
    }
    .code-text {
        font-size: 12pt;
        font-weight: 900;
        font-family: monospace;
        color: #333;
        line-height: 1;
        margin-top: 0.1mm;
        letter-spacing: 1pt;
    }
    .bottom-row {
        display: flex;
        justify-content: space-between;
        width: 100%;
        padding: 0 1mm;
        margin-top: 0.3mm;
    }
    .bottom-row span {
        font-size: 8pt;
        font-weight: 900;
        color: #000;
        line-height: 1;
    }
</style>
</head>
<body>
${labelsHTML}
<script>
    window.onload = function() {
        ${barcodeScripts}
        setTimeout(function() { window.print(); window.close(); }, 300);
    };
<\/script>
</body>
</html>`;

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:800px; height:600px; border:none; visibility:hidden;';
        document.body.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(printDoc);
        iframe.contentDocument.close();

        // FIX 8: onafterprint fires after the print dialog is dismissed in modern browsers.
        iframe.contentWindow.onafterprint = () => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        };
        setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 5000);
    };

    return (
        <div className="space-y-6">

            {/* ── PAGE HEADER ── */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                    <button
                        onClick={onClose}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm font-semibold transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
                    >
                        <ArrowLeft size={16} /> Back to Inventory
                    </button>
                    <div className="text-right">
                        <h2 className="text-xl font-bold text-slate-800">Barcode Print Studio</h2>
                        <p className="text-xs text-slate-400">{items.length} label{items.length !== 1 ? 's' : ''} in queue</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── LEFT PANEL: Settings ── */}
                <div className="lg:col-span-1 space-y-5">

                    {/* Size Selector */}
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center gap-2 mb-4">
                            <Settings size={16} className="text-slate-500" />
                            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Label Size</h3>
                        </div>
                        <div className="space-y-2">
                            {SIZE_PRESETS.map((p, idx) => (
                                <label
                                    key={p.label}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                        selectedPresetIdx === idx
                                            ? 'border-emerald-500 bg-emerald-50'
                                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="sizePreset"
                                        className="accent-emerald-600"
                                        checked={selectedPresetIdx === idx}
                                        onChange={() => setSelectedPresetIdx(idx)}
                                    />
                                    <span className="text-sm font-medium text-slate-700">{p.label}</span>
                                </label>
                            ))}
                        </div>

                        {/* Custom size inputs */}
                        {isCustom && (
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">Width (mm)</label>
                                    <input
                                        type="number" min="20" max="200"
                                        className="w-full p-2 border rounded text-sm"
                                        value={customW}
                                        onChange={e => setCustomW(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">Height (mm)</label>
                                    <input
                                        type="number" min="15" max="200"
                                        className="w-full p-2 border rounded text-sm"
                                        value={customH}
                                        onChange={e => setCustomH(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500 font-medium">Active Size</p>
                            <p className="text-sm font-bold text-slate-800 mt-0.5">{activeWidth} × {activeHeight}</p>
                        </div>
                    </div>

                    {/* Queue Navigator */}
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center gap-2 mb-4">
                            <Tag size={16} className="text-slate-500" />
                            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Label Queue</h3>
                        </div>

                        {/* Navigator controls */}
                        <div className="flex items-center justify-between mb-3">
                            <button
                                onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                                disabled={currentIndex === 0}
                                className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <span className="text-sm font-bold text-slate-700">
                                {currentIndex + 1} / {items.length}
                            </span>
                            <button
                                onClick={() => setCurrentIndex(i => Math.min(items.length - 1, i + 1))}
                                disabled={currentIndex === items.length - 1}
                                className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>

                        {/* Current item info */}
                        <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
                            <div><span className="font-bold">Product:</span> {currentItem.productName || currentItem.category}</div>
                            <div><span className="font-bold">Code:</span> <span className="font-mono">{currentItem.code}</span></div>
                            <div><span className="font-bold">Size:</span> {currentItem.size !== 'Free' ? currentItem.size : 'Free Size'}</div>
                            <div><span className="font-bold">MRP:</span> ৳{currentItem.mrp}</div>
                        </div>

                        {/* Scrollable mini list */}
                        <div className="mt-3 max-h-40 overflow-y-auto space-y-1 pr-1">
                            {items.map((item, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentIndex(idx)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                                        currentIndex === idx
                                            ? 'bg-emerald-600 text-white font-bold'
                                            : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    <span className="font-mono">{item.code}</span>
                                    {item.size !== 'Free' && <span className="ml-1 opacity-70">({item.size})</span>}
                                    <span className="ml-1 opacity-70">#{idx + 1}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── RIGHT PANEL: Preview + Print Actions ── */}
                <div className="lg:col-span-2 space-y-5">

                    {/* Preview Card */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-5">Label Preview</h3>

                        {/* Screen preview of the label */}
                        <div className="flex justify-center items-center bg-slate-100 rounded-xl p-8 min-h-[200px]">
                            <div
                                className="bg-white shadow-lg border border-slate-200 rounded flex flex-col items-center justify-center overflow-hidden"
                                style={{ width: previewW, height: previewH, padding: '4px' }}
                            >
                                {/* Brand */}
                                <div style={{ fontSize: Math.max(7, previewH * 0.07) + 'px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Bentree
                                </div>
                                {/* Product Name */}
                                <div style={{ fontSize: Math.max(8, previewH * 0.09) + 'px', fontWeight: '900', color: '#111', textTransform: 'uppercase', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                    {currentItem.productName || currentItem.category}
                                </div>
                                {/* Barcode */}
                                <div style={{ margin: '2px 0' }}>
                                    <Barcode
                                        value={getBarcodeValue(currentItem)}
                                        width={Math.max(0.6, previewW / 160)}
                                        height={Math.max(18, previewH * 0.38)}
                                        fontSize={0}
                                        margin={0}
                                        background="transparent"
                                    />
                                </div>
                                {/* Code */}
                                <div style={{ fontSize: Math.max(16, previewH * 0.16) + 'px', fontWeight: '900', fontFamily: 'monospace', color: '#555', lineHeight: 0.7, marginTop: '-1px' }}>
                                    {currentItem.code}
                                </div>
                                {/* Size & MRP */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0 4px', marginTop: '2px' }}>
                                    <span style={{ fontSize: Math.max(7, previewH * 0.075) + 'px', fontWeight: '900', color: '#000' }}>
                                        {currentItem.size !== 'Free' ? `SIZE: ${currentItem.size}` : 'SIZE: FREE'}
                                    </span>
                                    <span style={{ fontSize: Math.max(7, previewH * 0.075) + 'px', fontWeight: '900', color: '#000' }}>
                                        MRP: ৳{currentItem.mrp}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <p className="text-center text-xs text-slate-400 mt-3">
                            Preview shown at screen scale — actual print will be {activeWidth} × {activeHeight}
                        </p>
                    </div>

                    {/* Print Action Buttons */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-4">Print Options</h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Single Label Print */}
                            <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Printer size={18} className="text-emerald-600" />
                                    <span className="font-bold text-emerald-800 text-sm">Print This Label</span>
                                </div>
                                <p className="text-xs text-emerald-700 mb-4">
                                    Prints only label #{currentIndex + 1} ({currentItem.code}
                                    {currentItem.size !== 'Free' ? ` - ${currentItem.size}` : ''})
                                </p>
                                <button
                                    onClick={() => handlePrint('single')}
                                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Printer size={16} /> Print Single
                                </button>
                            </div>

                            {/* All Labels Print */}
                            <div className="border border-slate-200 bg-slate-50 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Printer size={18} className="text-slate-600" />
                                    <span className="font-bold text-slate-700 text-sm">Print All Labels</span>
                                </div>
                                <p className="text-xs text-slate-500 mb-4">
                                    Prints all {items.length} label{items.length !== 1 ? 's' : ''} in queue at once
                                </p>
                                <button
                                    onClick={() => handlePrint('all')}
                                    className="w-full py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Printer size={16} /> Print All ({items.length})
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* All Labels Grid Preview */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">All Labels in Queue</h3>
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full font-medium">{items.length} total</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[320px] overflow-y-auto pr-1">
                            {items.map((item, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentIndex(idx)}
                                    className={`flex flex-col items-center p-3 rounded-xl border transition-all text-left ${
                                        currentIndex === idx
                                            ? 'border-emerald-500 bg-emerald-50 shadow-md'
                                            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                                    }`}
                                >
                                    {/* Mini barcode preview */}
                                    <div className="pointer-events-none" style={{ transform: 'scale(0.55)', transformOrigin: 'center top', height: 40, overflow: 'hidden' }}>
                                        <Barcode
                                            value={getBarcodeValue(item)}
                                            width={0.8}
                                            height={50}
                                            fontSize={0}
                                            margin={0}
                                            background="transparent"
                                        />
                                    </div>
                                    <div className="text-[10px] font-mono font-bold text-slate-600 mt-1 truncate w-full text-center">{item.code}</div>
                                    <div className="text-[10px] text-slate-400 truncate w-full text-center">
                                        {item.size !== 'Free' ? item.size : 'Free'} · ৳{item.mrp}
                                    </div>
                                    <div className="text-[9px] text-slate-300 mt-0.5">#{idx + 1}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BarcodePrintView;