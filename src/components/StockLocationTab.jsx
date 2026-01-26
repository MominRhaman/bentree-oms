import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { LOCATION_TYPES } from '../utils';
import { Edit2, Trash2, X, Save } from 'lucide-react';

const StockLocationTab = ({ locations }) => {
    const [newLoc, setNewLoc] = useState({ type: 'Shelf', name: '', rows: '2', numbering: '', location: '' });
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState(null);

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

    const handleEdit = (loc) => {
        setEditingId(loc.id);
        setEditForm({ ...loc });
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        try {
            const locRef = doc(db, 'artifacts', appId, 'public', 'data', 'locations', editingId);
            const { id, ...updateData } = editForm; // Exclude ID from update
            await updateDoc(locRef, updateData);
            setEditingId(null);
            setEditForm(null);
        } catch (err) {
            console.error("Update failed:", err);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this location?")) return;
        try {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'locations', id));
        } catch (err) {
            console.error("Delete failed:", err);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold text-slate-800 mb-4">
                    {editingId ? 'Edit Stock Location' : 'Add Stock Location'}
                </h2>
                <form onSubmit={editingId ? handleUpdate : handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium mb-1">Type</label>
                        <select
                            className="w-full p-2 border rounded"
                            value={editingId ? editForm.type : newLoc.type}
                            onChange={e => editingId ? setEditForm({ ...editForm, type: e.target.value }) : setNewLoc({ ...newLoc, type: e.target.value })}
                        >
                            {LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                    </div>
                    {((editingId ? editForm.type : newLoc.type) === 'Shelf' || (editingId ? editForm.type : newLoc.type) === 'Display Shelf') && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Row Count</label>
                            <input
                                type="number" min="1"
                                className="w-full p-2 border rounded"
                                value={editingId ? editForm.rows : newLoc.rows}
                                onChange={e => editingId ? setEditForm({ ...editForm, rows: e.target.value }) : setNewLoc({ ...newLoc, rows: e.target.value })}
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium mb-1">Numbering/ID</label>
                        <input
                            placeholder="e.g. A-01"
                            className="w-full p-2 border rounded"
                            value={editingId ? editForm.numbering : newLoc.numbering}
                            onChange={e => editingId ? setEditForm({ ...editForm, numbering: e.target.value }) : setNewLoc({ ...newLoc, numbering: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Physical Location</label>
                        <input
                            placeholder="e.g. Warehouse 1, 2nd Floor"
                            className="w-full p-2 border rounded"
                            value={editingId ? editForm.location : newLoc.location}
                            onChange={e => editingId ? setEditForm({ ...editForm, location: e.target.value }) : setNewLoc({ ...newLoc, location: e.target.value })}
                        />
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className={`${editingId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white p-2 rounded font-bold w-full md:w-auto flex items-center justify-center gap-2`}>
                            {editingId ? <><Save size={18} /> Update Location</> : 'Add Location'}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={() => { setEditingId(null); setEditForm(null); }}
                                className="bg-slate-200 text-slate-600 p-2 rounded font-bold hover:bg-slate-300 flex items-center justify-center gap-2"
                            >
                                <X size={18} /> Cancel
                            </button>
                        )}
                    </div>
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
                            <th className="p-3 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {locations.map(loc => (
                            <tr key={loc.id} className={`border-b hover:bg-slate-50 ${editingId === loc.id ? 'bg-blue-50' : ''}`}>
                                <td className="p-3 font-mono font-bold">{loc.numbering}</td>
                                <td className="p-3">{loc.type}</td>
                                <td className="p-3">{(loc.type === 'Shelf' || loc.type === 'Display Shelf') ? loc.rows : '-'}</td>
                                <td className="p-3 text-slate-500">{loc.location}</td>
                                <td className="p-3">
                                    <div className="flex justify-center gap-2">
                                        <button
                                            onClick={() => handleEdit(loc)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            title="Edit Location"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(loc.id)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Delete Location"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default StockLocationTab;