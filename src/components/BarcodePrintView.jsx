import React from 'react';
import Barcode from 'react-barcode';
import { Printer, X } from 'lucide-react'; // FIXED: Added Printer and X imports here

const BarcodePrintView = ({ items, onClose }) => {
    if (!items || items.length === 0) return null;

    return (
        <div className="fixed inset-0 bg-white z-[100] overflow-y-auto p-8 no-scrollbar">
            {/* --- PRINT STYLES --- */}
            <style>
                {`
                @media print {
                    @page {
                        size: 38mm 25mm;
                        margin: 0;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        -webkit-print-color-adjust: exact;
                    }
                    .no-print { display: none !important; }
                    .barcode-label {
                        width: 38mm;
                        height: 25mm;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        page-break-after: always;
                        padding: 1mm;
                        box-sizing: border-box;
                    }
                }
                @media screen {
                    .barcode-preview-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                        gap: 15px;
                        margin-top: 20px;
                        padding-bottom: 50px;
                    }
                    .barcode-label {
                        border: 1px solid #e2e8f0;
                        padding: 10px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        background: white;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                }
                `}
            </style>

            {/* Header Control Panel */}
            <div className="no-print flex justify-between items-center mb-6 bg-slate-900 text-white p-4 rounded-lg shadow-lg">
                <div>
                    <h2 className="text-lg font-bold">Barcode Queue</h2>
                    <p className="text-xs text-slate-400">Total Labels generated from stock: <strong>{items.length}</strong></p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={onClose} 
                        className="px-4 py-2 text-sm font-bold bg-slate-700 hover:bg-slate-600 rounded transition-all flex items-center gap-2"
                    >
                        <X size={16} /> Close Preview
                    </button>
                    <button 
                        onClick={() => window.print()} 
                        className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 rounded transition-all shadow-md flex items-center gap-2"
                    >
                        <Printer size={16} /> Print All labels
                    </button>
                </div>
            </div>

            {/* Preview Grid */}
            <div className="barcode-preview-grid">
                {items.map((item, idx) => (
                    <div key={idx} className="barcode-label">
                        {/* PRODUCT NAME / BRAND */}
                        <div className="text-[7px] font-bold text-slate-500 uppercase tracking-wider">Bentree</div>
                        <div className="text-[9px] font-black text-slate-900 uppercase truncate w-full text-center">{item.productName}</div>
                        
                        {/* BARCODE (Using Product Code) */}
                        <div className="my-0.5">
                            <Barcode 
                                value={item.code} 
                                width={1.0} 
                                height={35} 
                                fontSize={0} 
                                margin={0}
                                background="transparent"
                            />
                        </div>

                        {/* CODE & SIZE & MRP */}
                        <div className="text-[8px] font-bold font-mono text-slate-700">{item.code}</div>
                        <div className="flex justify-between w-full px-2 mt-0.5">
                            <span className="text-[9px] font-black">{item.size !== 'Free' ? `SIZE: ${item.size}` : 'SIZE: FREE'}</span>
                            <span className="text-[9px] font-black">MRP: ৳{item.mrp}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default BarcodePrintView;