import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { LOCATION_TYPES } from '../utils';

const StockLocationTab = ({ locations }) => {
    const [newLoc, setNewLoc] = useState({ type: 'Shelf', name: '', rows: '2', numbering: '', location: '' });

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'locations'), {
                ...newLoc,
                createdAt: serverTimestamp()
            });
            setNewLoc({ type: 'Shelf', name: '', rows: '2', numbering: '', location: '' });
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold text-slate-800 mb-4">Add Stock Location</h2>
                <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium mb-1">Type</label>
                        <select
                            className="w-full p-2 border rounded"
                            value={newLoc.type}
                            onChange={e => setNewLoc({ ...newLoc, type: e.target.value })}
                        >
                            {LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                    </div>
                    {(newLoc.type === 'Shelf' || newLoc.type === 'Display Shelf') && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Row Count</label>
                            <input
                                type="number" min="1"
                                className="w-full p-2 border rounded"
                                value={newLoc.rows}
                                onChange={e => setNewLoc({ ...newLoc, rows: e.target.value })}
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium mb-1">Numbering/ID</label>
                        <input
                            placeholder="e.g. A-01"
                            className="w-full p-2 border rounded"
                            value={newLoc.numbering}
                            onChange={e => setNewLoc({ ...newLoc, numbering: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Physical Location</label>
                        <input
                            placeholder="e.g. Warehouse 1, 2nd Floor"
                            className="w-full p-2 border rounded"
                            value={newLoc.location}
                            onChange={e => setNewLoc({ ...newLoc, location: e.target.value })}
                        />
                    </div>
                    <button type="submit" className="bg-emerald-600 text-white p-2 rounded font-bold hover:bg-emerald-700 w-full md:w-auto">
                        Add Location
                    </button>
                </form>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[600px]">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="p-3">ID/Numbering</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Rows</th>
                            <th className="p-3">Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        {locations.map(loc => (
                            <tr key={loc.id} className="border-b hover:bg-slate-50">
                                <td className="p-3 font-mono font-bold">{loc.numbering}</td>
                                <td className="p-3">{loc.type}</td>
                                <td className="p-3">{(loc.type === 'Shelf' || loc.type === 'Display Shelf') ? loc.rows : '-'}</td>
                                <td className="p-3 text-slate-500">{loc.location}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default StockLocationTab;