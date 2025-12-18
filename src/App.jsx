import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { updateInventoryStock } from './utils';
import { Menu } from 'lucide-react'; // Import Menu Icon

// Component Imports
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import NewOrderForm from './components/NewOrderForm';
import InventoryTab from './components/InventoryTab';
import StockLocationTab from './components/StockLocationTab';
import MonthlyProfitTab from './components/MonthlyProfitTab';
import PrimaryOrders from './components/PrimaryOrders';
import ConfirmedOrders from './components/ConfirmedOrders';
import HoldTab from './components/HoldTab';
import DispatchTab from './components/DispatchTab';
import StoreSales from './components/StoreSales';
import ExchangeTab from './components/ExchangeTab';
import CancelledOrders from './components/CancelledOrders';
import OnlineSalesTab from './components/OnlineSalesTab';
import SalesReports from './components/SalesReports';

function App() {
    const savedRole = localStorage.getItem('bentree_role');
    const savedTab = localStorage.getItem('bentree_tab') || 'new-order';

    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(savedRole);
    const [activeTab, setActiveTab] = useState(savedTab);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); // New Sidebar State

    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [loading, setLoading] = useState(false);

    const [orders, setOrders] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [locations, setLocations] = useState([]);
    const [expenses, setExpenses] = useState([]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setIsAuthChecking(false);
            if (currentUser) {
                const storedRole = localStorage.getItem('bentree_role');
                const storedName = localStorage.getItem('bentree_name');
                const displayName = storedName || currentUser.displayName;
                const customPhoto = displayName ? localStorage.getItem(`bentree_photo_${displayName}`) : null;

                let finalUser = { ...currentUser };
                if (displayName || customPhoto) {
                    finalUser = {
                        ...currentUser,
                        displayName: displayName || currentUser.displayName,
                        photoURL: customPhoto || currentUser.photoURL
                    };
                }

                if (storedRole) {
                    setUser(finalUser);
                    setUserRole(storedRole);
                    setLoading(true);
                } else {
                    setUser(finalUser);
                }
            } else {
                setUser(null);
                setUserRole(null);
            }
        });
        return () => unsubscribe();
    }, []);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        localStorage.setItem('bentree_tab', tabId);
    };

    const handleLoginSuccess = (firebaseUser, role) => {
        localStorage.setItem('bentree_role', role);
        if (firebaseUser.displayName) localStorage.setItem('bentree_name', firebaseUser.displayName);
        
        const customPhoto = firebaseUser.displayName ? localStorage.getItem(`bentree_photo_${firebaseUser.displayName}`) : null;
        const finalUser = customPhoto ? { ...firebaseUser, photoURL: customPhoto } : firebaseUser;

        setUser(finalUser);
        setUserRole(role);
        setLoading(true);
    };

    const handleLogout = async () => {
        await signOut(auth);
        localStorage.removeItem('bentree_role');
        localStorage.removeItem('bentree_name');
        localStorage.removeItem('bentree_tab');
        setUser(null);
        setUserRole(null);
        setOrders([]);
        setInventory([]);
        setLoading(false);
    };

    // Data Fetching
    useEffect(() => {
        if (!user) return;
        const handleSnapshotError = (err) => { console.error("Firestore Error:", err); setLoading(false); };
        const unsubOrders = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setOrders(data);
        }, handleSnapshotError);
        const unsubInv = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubLoc = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'locations'), (snap) => setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubExp = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), (snap) => {
            setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, handleSnapshotError);
        return () => { unsubOrders(); unsubInv(); unsubLoc(); unsubExp(); };
    }, [user]);

    // CRUD
    const handleUpdateStatus = async (orderId, newStatus, extraData = {}) => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        if (newStatus === 'Cancelled' && order.status !== 'Cancelled') for (const p of order.products) await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
        if (newStatus === 'Confirmed' && order.status === 'Cancelled') for (const p of order.products) await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
        if (newStatus === 'Returned' && order.status !== 'Returned') for (const p of order.products) await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
        if (order.status === 'Returned' && newStatus !== 'Returned') for (const p of order.products) await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
        
        try {
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId);
            if (newStatus === 'Confirmed' && extraData.isUnhold) {
                extraData.createdAt = serverTimestamp();
                delete extraData.isUnhold;
            }
            const historyEntry = { status: newStatus, timestamp: new Date().toISOString(), note: extraData.note || '', updatedBy: user?.displayName || 'System' };
            await updateDoc(orderRef, { status: newStatus, ...extraData, history: arrayUnion(historyEntry) });
        } catch (err) { console.error(err); }
    };

    const handleEditOrderWithStock = async (orderId, updatedData) => {
        const oldOrder = orders.find(o => o.id === orderId);
        if (!oldOrder) return;
        const productsChanged = JSON.stringify(oldOrder.products) !== JSON.stringify(updatedData.products);
        if (productsChanged) {
            for (const p of (oldOrder.products || [])) await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
            for (const p of (updatedData.products || [])) await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
        }
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), updatedData);
    };

    const handleEditInventory = async (id, updatedData) => { try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id), updatedData); } catch (e) { alert("Update failed"); } };
    const handleDeleteInventory = async (id) => { try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id)); } catch (e) { alert("Delete failed"); } };
    const handleDeleteOrder = async (orderId) => {
        const order = orders.find(o => o.id === orderId);
        if (order && order.status !== 'Cancelled' && order.status !== 'Returned') for (const p of order.products) await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId));
    };

    const renderContent = () => {
        if (loading && orders.length === 0 && inventory.length === 0) return <div className="flex justify-center items-center h-64 text-slate-400 font-medium animate-pulse">Loading Data...</div>;

        const props = { inventory, locations, orders, user, onEdit: handleEditInventory, onDelete: handleDeleteInventory };
        const orderProps = { orders, onUpdate: handleUpdateStatus, onEdit: handleEditOrderWithStock, onDelete: handleDeleteOrder, inventory };

        switch (activeTab) {
            case 'new-order': return <NewOrderForm user={user} existingOrders={orders} setActiveTab={handleTabChange} inventory={inventory} />;
            case 'inventory': return <InventoryTab {...props} />;
            case 'stock-location': return <StockLocationTab locations={locations} />;
            case 'monthly-profit': return userRole === 'master' ? <MonthlyProfitTab orders={orders} inventory={inventory} expenses={expenses} /> : <div className="p-10 text-center text-slate-400">Restricted Access</div>;
            case 'primary': return <PrimaryOrders orders={orders.filter(o => o.type === 'Online' && o.status === 'Pending')} onUpdate={handleUpdateStatus} onEdit={handleEditOrderWithStock} />;
            case 'confirmed': return <ConfirmedOrders allOrders={orders} orders={orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Delivered', 'Returned', 'Exchanged', 'Hold'].includes(o.status))} {...orderProps} />;
            case 'hold': return <HoldTab orders={orders.filter(o => o.type === 'Online' && o.status === 'Hold')} onUpdate={handleUpdateStatus} />;
            case 'dispatch': return <DispatchTab orders={orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Exchanged'].includes(o.status))} onUpdate={handleUpdateStatus} />;
            case 'store-sales': return <StoreSales orders={orders.filter(o => o.type === 'Store')} {...orderProps} />;
            case 'exchange': return <ExchangeTab orders={orders.filter(o => o.type === 'Online' && (o.status === 'Exchanged' || o.exchangeDetails))} />;
            case 'cancelled': return <CancelledOrders orders={orders.filter(o => o.type === 'Online' && o.status === 'Cancelled')} onUpdate={handleUpdateStatus} />;
            case 'online-sales': return <OnlineSalesTab {...orderProps} />;
            case 'reports': return userRole === 'master' ? <SalesReports {...orderProps} /> : <div className="p-10 text-center text-slate-400">Restricted Access</div>;
            default: return <div>Select a tab</div>;
        }
    };

    if (isAuthChecking) return <div className="flex h-screen w-full items-center justify-center bg-slate-50"><div className="text-center"><div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><h2 className="text-slate-500 font-medium">Verifying Session...</h2></div></div>;
    if (!user) return <LoginPage onLogin={handleLoginSuccess} />;

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
            {/* Sidebar with mobile toggle logic */}
            <Sidebar 
                activeTab={activeTab} 
                setActiveTab={handleTabChange} 
                userRole={userRole} 
                onLogout={handleLogout} 
                user={user} 
                setUser={setUser} 
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />

            <main className="flex-1 overflow-auto w-full lg:ml-64 transition-all duration-300">
                {/* Mobile Header with Hamburger */}
                <div className="lg:hidden bg-white p-4 border-b flex items-center justify-between sticky top-0 z-10">
                    <button onClick={() => setIsSidebarOpen(true)} className="text-slate-600">
                        <Menu size={24} />
                    </button>
                    <span className="font-bold text-slate-700">Bentree OMS</span>
                    <div className="w-6"></div> {/* Spacer for center alignment */}
                </div>

                <div className="p-4 lg:p-8 min-w-[350px] lg:min-w-[1000px] overflow-x-auto">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}

export default App;