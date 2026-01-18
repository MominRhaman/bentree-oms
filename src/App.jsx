import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, addDoc } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { updateInventoryStock } from './utils';
import { Menu } from 'lucide-react'; 

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
    
    // --- 1. Clean URL Routing Logic ---
    const getInitialTab = () => {
        const path = window.location.pathname.substring(1);
        if (path && path.length > 0) return path;
        return localStorage.getItem('bentree_tab') || 'new-order';
    };

    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(savedRole);
    const [activeTab, setActiveTab] = useState(getInitialTab); 
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); 

    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [loading, setLoading] = useState(false);

    const [orders, setOrders] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [locations, setLocations] = useState([]);
    const [expenses, setExpenses] = useState([]);

    // --- 2. Authentication Observer ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setIsAuthChecking(false);
            if (currentUser) {
                const storedRole = localStorage.getItem('bentree_role');
                const storedName = localStorage.getItem('bentree_name');
                const displayName = storedName || currentUser.displayName;
                const customPhoto = displayName ? localStorage.getItem(`bentree_photo_${displayName}`) : null;

                let finalUser = { 
                    ...currentUser,
                    displayName: displayName || currentUser.displayName,
                    photoURL: customPhoto || currentUser.photoURL
                };

                setUser(finalUser);
                if (storedRole) setUserRole(storedRole);
                setLoading(true);
            } else {
                setUser(null);
                setUserRole(null);
            }
        });
        
        const handlePopState = () => {
            const path = window.location.pathname.substring(1);
            if (path) setActiveTab(path);
        };
        window.addEventListener('popstate', handlePopState);
        
        return () => {
            unsubscribe();
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    // --- 3. Tab Navigation & URL Sync ---
    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        localStorage.setItem('bentree_tab', tabId);
        const newUrl = `/${tabId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
    };

    const handleLoginSuccess = (firebaseUser, role) => {
        localStorage.setItem('bentree_role', role);
        if (firebaseUser.displayName) localStorage.setItem('bentree_name', firebaseUser.displayName);
        setUser(firebaseUser);
        setUserRole(role);
        setLoading(true);
    };

    const handleLogout = async () => {
        await signOut(auth);
        localStorage.clear();
        setUser(null);
        setUserRole(null);
        setOrders([]);
        setInventory([]);
        setLoading(false);
    };

    // --- 4. Real-time Data Listeners ---
    useEffect(() => {
        if (!user) return;
        const handleSnapshotError = (err) => console.error("Firestore Error:", err);
        
        const unsubOrders = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setOrders(data);
        }, handleSnapshotError);

        const unsubInv = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubLoc = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'locations'), (snap) => setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubExp = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);

        return () => { unsubOrders(); unsubInv(); unsubLoc(); unsubExp(); };
    }, [user]);

    // --- 5. INVENTORY IMPACT LOGIC: Status Changes (Cancel/Return/Restore) ---
    const handleUpdateStatus = async (orderId, newStatus, extraData = {}) => {
        // Find order by ID or fallback to Merchant ID if ID changed during exchange
        let order = orders.find(o => o.id === orderId);
        if (!order && (extraData.merchantOrderId || extraData.storeOrderId)) {
            const mId = extraData.merchantOrderId || extraData.storeOrderId;
            order = orders.find(o => o.merchantOrderId === mId || o.storeOrderId === mId);
        }

        if (!order) return;
        
        const activeId = order.id;
        const inactiveStatuses = ['Cancelled', 'Returned'];
        const becomingInactive = inactiveStatuses.includes(newStatus);
        const wasActive = !inactiveStatuses.includes(order.status);
        const isRestoring = !becomingInactive && !wasActive;

        if (becomingInactive && wasActive) {
            for (const p of order.products) {
                await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
            }
        }
        if (isRestoring) {
            for (const p of order.products) {
                await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
            }
        }
        
        try {
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', activeId);
            const historyEntry = { 
                status: newStatus, 
                timestamp: new Date().toISOString(), 
                note: extraData.note || `Status updated to ${newStatus}`, 
                updatedBy: user?.displayName || 'Admin' 
            };
            
            const { id, createdAt, ...cleanExtraData } = extraData;

            await updateDoc(orderRef, { 
                ...cleanExtraData, 
                status: newStatus, 
                history: arrayUnion(historyEntry) 
            });
        } catch (err) { console.error("Update Status Error:", err); }
    };

    // --- 6. INVENTORY IMPACT LOGIC: Edits & Exchanges ---
    const handleEditOrderWithStock = async (orderId, newStatus, updatedData) => {
        // Find the order in the current local state
        const oldOrder = orders.find(o => o.id === orderId);
        
        // SAFETY: If the order isn't found, stop execution to prevent the 'products' undefined error
        if (!oldOrder) {
            console.error("Critical Sync Error: Order not found in state.");
            return;
        }

        try {
            // STEP 1: Restore old stock (Restore if the order was active)
            if (!['Cancelled', 'Returned'].includes(oldOrder.status)) {
                const oldProducts = oldOrder.products || [];
                for (const p of oldProducts) {
                    await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
                }
            }

            // STEP 2: Deduct new stock (Deduct if the new status is active)
            if (!['Cancelled', 'Returned'].includes(newStatus)) {
                const newProducts = updatedData.products || [];
                for (const p of newProducts) {
                    await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
                }
            }

            // STEP 3: Database Operation
            // We use updateDoc to keep the ID stable so other buttons don't break
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId);
            const { id, ...dataToSave } = updatedData;

            await updateDoc(orderRef, {
                ...dataToSave,
                status: newStatus,
                lastEditedBy: user?.displayName || 'Admin'
            });

            if (newStatus === 'Exchanged') alert("Exchange Successful!");

        } catch (err) { 
            console.error("Inventory Sync Failure:", err); 
            alert("Error syncing inventory. Check console for details.");
        }
    };

    // --- NEW: CREATE ORDER (for Partial Returns) ---
    const handleCreateOrder = async (orderData) => {
        try {
            console.log(' Creating new return order...');
            console.log('Order data:', { status: orderData.status, products: orderData.products?.length });
            
            // CRITICAL: For RETURNED/CANCELLED orders, we DON'T touch inventory
            // The inventory restoration happens when we update the original order's status
            // through handleEditOrderWithStock which is called separately
            
            // Only deduct inventory if creating a new ACTIVE order (not a return)
            if (!['Cancelled', 'Returned'].includes(orderData.status)) {
                console.log('Deducting inventory for active order...');
                const products = orderData.products || [];
                for (const p of products) {
                    await updateInventoryStock(p.code, p.size, -Number(p.qty), inventory);
                }
            } else {
                console.log('Skipping inventory deduction for return/cancelled order');
            }

            // Create new document in Firebase using your custom path
            const ordersRef = collection(db, 'artifacts', appId, 'public', 'data', 'orders');
            
            // Remove any existing id field before creating
            const { id, ...cleanOrderData } = orderData;
            
            const docRef = await addDoc(ordersRef, {
                ...cleanOrderData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: user?.displayName || 'Admin'
            });
            
            console.log(' New return order created with ID:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('❌ Error creating new order:', error);
            console.error('Error details:', error);
            alert(`Failed to create return order: ${error.message}`);
            throw error;
        }
    };

    // --- 7. INVENTORY IMPACT LOGIC: Permanent Deletion ---
    const handleDeleteOrder = async (orderId) => {
        const order = orders.find(o => o.id === orderId);
        if (order && !['Cancelled', 'Returned'].includes(order.status)) {
            for (const p of order.products) {
                await updateInventoryStock(p.code, p.size, Number(p.qty), inventory);
            }
        }
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId));
    };

    const handleEditInventory = async (id, updatedData) => {
        try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id), updatedData); } 
        catch (e) { alert("Inventory update failed"); }
    };
    const handleDeleteInventory = async (id) => {
        try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id)); } 
        catch (e) { alert("Inventory delete failed"); }
    };

    const renderContent = () => {
        if (loading && orders.length === 0 && inventory.length === 0) {
            return <div className="flex justify-center items-center h-64 text-slate-400 animate-pulse font-bold tracking-widest uppercase">Initializing System...</div>;
        }

        const commonProps = { inventory, locations, orders, user, onEdit: handleEditInventory, onDelete: handleDeleteInventory };
        const orderProps = { 
            orders, 
            onUpdate: handleUpdateStatus, 
            onEdit: handleEditOrderWithStock, 
            onCreate: handleCreateOrder, 
            onDelete: handleDeleteOrder, 
            inventory 
        };

        switch (activeTab) {
            case 'new-order': return <NewOrderForm user={user} existingOrders={orders} setActiveTab={handleTabChange} inventory={inventory} />;
            case 'inventory': return <InventoryTab {...commonProps} />;
            case 'stock-location': return <StockLocationTab locations={locations} />;
            case 'monthly-profit': return userRole === 'master' ? <MonthlyProfitTab orders={orders} inventory={inventory} expenses={expenses} /> : <div className="p-10 text-center text-slate-400">Master access required.</div>;
            case 'primary': return <PrimaryOrders orders={orders.filter(o => o.type === 'Online' && o.status === 'Pending')} onUpdate={handleUpdateStatus} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} />;
            case 'confirmed': return <ConfirmedOrders allOrders={orders} orders={orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Delivered', 'Returned', 'Exchanged', 'Hold'].includes(o.status))} {...orderProps} />;
            case 'hold': return <HoldTab orders={orders.filter(o => o.type === 'Online' && o.status === 'Hold')} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} />;
            case 'dispatch': return <DispatchTab orders={orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Exchanged'].includes(o.status))} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} />;
            case 'store-sales': return <StoreSales orders={orders.filter(o => o.type === 'Store')} {...orderProps} />;
            case 'exchange': return <ExchangeTab orders={orders.filter(o => o.type === 'Online' && (o.status === 'Exchanged' || o.exchangeDetails || o.isPartialExchange))} onCreate={handleCreateOrder} onEdit={handleEditOrderWithStock} inventory={inventory} />;
            case 'cancelled': return <CancelledOrders orders={orders.filter(o => o.type === 'Online' && (o.status === 'Cancelled' || o.status === 'Returned'))} onUpdate={handleUpdateStatus} onDelete={handleDeleteOrder} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} />;
            case 'online-sales': return <OnlineSalesTab {...orderProps} />;
            case 'reports': return userRole === 'master' ? <SalesReports {...orderProps} /> : <div className="p-10 text-center text-slate-400">Master access required.</div>;
            default: return <div className="p-10 text-center">Invalid Tab Selected</div>;
        }
    };

    if (isAuthChecking) return <div className="flex h-screen w-full items-center justify-center bg-slate-50"><div className="text-center"><div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><h2 className="text-slate-500 font-bold uppercase text-xs tracking-widest">Securing Session...</h2></div></div>;
    if (!user) return <LoginPage onLogin={handleLoginSuccess} />;

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
            <Sidebar activeTab={activeTab} setActiveTab={handleTabChange} userRole={userRole} onLogout={handleLogout} user={user} setUser={setUser} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
            <main className="flex-1 overflow-auto w-full lg:ml-64 transition-all duration-300 relative">
                <div className="lg:hidden bg-white p-4 border-b flex items-center justify-between sticky top-0 z-20">
                    <button onClick={() => setIsSidebarOpen(true)} className="text-slate-600"><Menu size={24} /></button>
                    <span className="font-bold text-slate-700 tracking-tight">BENTREE OMS</span>
                    <div className="w-6"></div>
                </div>
                <div className="p-4 lg:p-8 min-w-[350px] lg:min-w-[1000px]">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}

export default App;