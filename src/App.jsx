import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, addDoc } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { getStatusColor, updateInventoryStock, computeStockBefores, logInventoryMovement } from './utils';
import { adjustWooStock, wooUpdateOrder, wooSyncOrder } from './WooAPI/wooStock';
import { useScanner } from './hooks/useScanner';
import { Menu } from 'lucide-react';

// Component Imports — eagerly loaded (always visible)
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';

// Component Imports — lazy loaded (only one tab is active at a time)
const NewOrderForm = lazy(() => import('./components/NewOrderForm'));
const InventoryTab = lazy(() => import('./components/InventoryTab'));
const StockLocationTab = lazy(() => import('./components/StockLocationTab'));
const MonthlyProfitTab = lazy(() => import('./components/MonthlyProfitTab'));
const PrimaryOrders = lazy(() => import('./components/PrimaryOrders'));
const ConfirmedOrders = lazy(() => import('./components/ConfirmedOrders'));
const HoldTab = lazy(() => import('./components/HoldTab'));
const DispatchTab = lazy(() => import('./components/DispatchTab'));
const StoreSales = lazy(() => import('./components/StoreSales'));
const ExchangeTab = lazy(() => import('./components/ExchangeTab'));
const CancelledOrders = lazy(() => import('./components/CancelledOrders'));
const OnlineSalesTab = lazy(() => import('./components/OnlineSalesTab'));
const SalesReports = lazy(() => import('./components/SalesReports'));
const SalesInventoryReport = lazy(() => import('./components/SalesInventoryReport'));
const BarcodePrintView = lazy(() => import('./components/BarcodePrintView'));
const OrderDetailsPopup = lazy(() => import('./components/OrderDetailsPopup'));

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
    // --- NEW: SCANNER STATE ---
    const [scannedOrder, setScannedOrder] = useState(null);
    const [barcodePrintQueue, setBarcodePrintQueue] = useState([]);

    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [loading, setLoading] = useState(false);
    const [isDataReceived, setIsDataReceived] = useState(false);

    const [orders, setOrders] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [locations, setLocations] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [inventoryAdjustments, setInventoryAdjustments] = useState([]);

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
    const handleTabChange = useCallback((tabId) => {
        setActiveTab(tabId);
        localStorage.setItem('bentree_tab', tabId);
        const newUrl = `/${tabId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }, []);

    const handleLoginSuccess = useCallback((firebaseUser, role) => {
        localStorage.setItem('bentree_role', role);
        if (firebaseUser.displayName) localStorage.setItem('bentree_name', firebaseUser.displayName);
        setUser(firebaseUser);
        setUserRole(role);
        setLoading(true);
    }, []);

    const handleLogout = useCallback(async () => {
        await signOut(auth);
        localStorage.clear();
        setUser(null);
        setUserRole(null);
        setOrders([]);
        setInventory([]);
        setLoading(false);
    }, []);

    // --- 4. Real-time Data Listeners ---
    useEffect(() => {
        if (!user) return;
        const handleSnapshotError = (err) => console.error("Firestore Error:", err);

        const unsubOrders = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), (snap) => {
            
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setOrders(data);
            setIsDataReceived(true);
        }, handleSnapshotError);

        const unsubInv = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubLoc = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'locations'), (snap) => setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubExp = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);
        const unsubAdj = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'inventoryAdjustments'), (snap) => setInventoryAdjustments(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);

        return () => { unsubOrders(); unsubInv(); unsubLoc(); unsubExp(); unsubAdj(); };
    }, [user]);

    // --- SCANNER INTEGRATION ---
    useScanner((code) => {
        // Search orders by Merchant ID, Store ID, or Tracking ID
        const found = orders.find(o =>
            (o.merchantOrderId && o.merchantOrderId.toString() === code) ||
            (o.storeOrderId && o.storeOrderId.toString() === code) ||
            (o.trackingId && o.trackingId.toString() === code)
        );

        if (found) {
            setScannedOrder(found);
        } else {
            console.log("No order found for scanned code:", code);
        }
    });

    // Called from InventoryTab when user clicks the printer icon
    const handleOpenBarcodePrint = useCallback((labels) => {
        setBarcodePrintQueue(labels);
        handleTabChange('barcodePrintView');
    }, [handleTabChange]);

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

        // Inventory flags to sync with Cloud Function tracking
        let stockFlags = {};

        if (becomingInactive && wasActive) {
            const s0 = computeStockBefores(order.products, inventory);
            await Promise.all(order.products.map(p =>
                updateInventoryStock(p.code, p.size, Number(p.qty), inventory)
            ));
            stockFlags = { stockDeducted: false, deductedProducts: [] };
            const aType = newStatus === 'Cancelled' ? 'Cancel' : 'Full Return';
            const ref0  = order.merchantOrderId || order.storeOrderId || activeId;
            order.products.forEach((p, i) => {
                let sb = s0[i]; const qty = Number(p.qty || 0);
                for (let u = 0; u < qty; u++) {
                    logInventoryMovement({ productCode: p.code, productName: p.name || p.code, size: p.size, qtyChange: +1, stockBefore: sb, actionType: aType, reference: ref0, user });
                    if (typeof sb === 'number') sb += 1;
                }
            });
        }
        if (isRestoring) {
            const s1 = computeStockBefores(order.products, inventory);
            await Promise.all(order.products.map(p =>
                updateInventoryStock(p.code, p.size, -Number(p.qty), inventory)
            ));
            stockFlags = { stockDeducted: true, deductedProducts: order.products };
            const ref1 = order.merchantOrderId || order.storeOrderId || activeId;
            order.products.forEach((p, i) => {
                let sb = s1[i]; const qty = Number(p.qty || 0);
                for (let u = 0; u < qty; u++) {
                    logInventoryMovement({ productCode: p.code, productName: p.name || p.code, size: p.size, qtyChange: -1, stockBefore: sb, actionType: 'Restore', reference: ref1, user });
                    if (typeof sb === 'number') sb -= 1;
                }
            });
        }

        // WooCommerce status to sync to, if this status change is actually changing
        // (guard prevents re-firing wooUpdateOrder on an already-Returned order, e.g.
        // the return record created during a partial return, which would overwrite
        // the original WooCommerce order's Firestore data via its webhook).
        const WC_STATUS = {
            'Delivered':  'completed',
            'Completed':  'completed', // Store checkout
            'Cancelled':  'cancelled',
            'Returned':   'cancelled',
        };
        const wcStatus = (order.wc_order_id && order.status !== newStatus) ?
            WC_STATUS[newStatus] : null;

        try {
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', activeId);
            const historyEntry = {
                status: newStatus,
                timestamp: new Date().toISOString(),
                note: extraData.note || `Status updated to ${newStatus}`,
                updatedBy: user?.displayName || 'Admin'
            };

            const { id, createdAt, ...cleanExtraData } = extraData;

            // Stamp BEFORE any background WooCommerce call starts (not after), so
            // guard 4c in the webhook handler reliably skips the resulting bounce-back.
            await updateDoc(orderRef, {
                ...cleanExtraData,
                ...stockFlags,
                status: newStatus,
                history: arrayUnion(historyEntry),
                ...(order.wc_order_id ? { _omsEditedAt: serverTimestamp() } : {})
            });
        } catch (err) {
            console.error("Update Status Error:", err);
            return;
        }

        // Background WooCommerce sync — fires only after the Firestore write above
        // (including the _omsEditedAt stamp) has committed.
        if (becomingInactive && wasActive && order.type === 'Online' && !order.wc_order_id) {
            // Orders without a wc_order_id need manual WooCommerce stock restore
            adjustWooStock(order.products, +1).catch(e =>
                console.error('[WooStock] Cancel restore failed:', e)
            );
        }
        if (isRestoring && order.type === 'Online') {
            adjustWooStock(order.products, -1).catch(e =>
                console.error('[WooStock] Re-activate deduct failed:', e)
            );
        }
        if (wcStatus) {
            wooUpdateOrder(order.wc_order_id, wcStatus).catch(e =>
                console.error(`[WooOrder] ${newStatus}→${wcStatus} sync failed:`, e)
            );
        }
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
            const newProducts = updatedData.products || [];
            const isActiveStatus = !['Cancelled', 'Returned'].includes(newStatus);

            // Determine semantic action types from the updated data / new status
            const logHint = updatedData._logActionType;
            const editRef  = oldOrder.merchantOrderId || oldOrder.storeOrderId || orderId;
            const step1ActionType = logHint
                || (newStatus === 'Returned'
                    ? (updatedData._oms_partial_return ? 'Partial Return' : 'Full Return')
                    : newStatus === 'Cancelled' ? 'Cancel'
                    : newStatus === 'Exchanged'
                        ? (updatedData.isPartialExchange ? 'Partial Exchange' : 'Full Exchange')
                    : 'Order Edit');
            const step2ActionType = logHint
                || (newStatus === 'Exchanged'
                    ? (updatedData.isPartialExchange ? 'Partial Exchange' : 'Full Exchange')
                    : 'Order Edit');

            // STEP 1: Restore old stock (if the order was active before the edit)
            // Each updateInventoryStock targets a different inventory doc via increment(),
            // so all calls within a batch can run concurrently.
            if (!['Cancelled', 'Returned'].includes(oldOrder.status)) {
                const s1 = computeStockBefores(oldOrder.products || [], inventory);
                await Promise.all((oldOrder.products || []).map(p =>
                    updateInventoryStock(p.code, p.size, Number(p.qty), inventory)
                ));
                (oldOrder.products || []).forEach((p, i) => {
                    let sb = s1[i]; const qty = Number(p.qty || 0);
                    for (let u = 0; u < qty; u++) {
                        logInventoryMovement({ productCode: p.code, productName: p.name || p.code, size: p.size, qtyChange: +1, stockBefore: sb, actionType: step1ActionType, reference: editRef, user });
                        if (typeof sb === 'number') sb += 1;
                    }
                });
            }

            // STEP 2: Deduct new stock (if the resulting status is active).
            // React state lags behind the Firestore increments done in STEP 1, so build
            // an effectiveInventory that reflects those restorations for the guard check.
            if (isActiveStatus) {
                const wasActiveBeforeEdit = !['Cancelled', 'Returned'].includes(oldOrder.status);
                const restoredProducts = wasActiveBeforeEdit ? (oldOrder.products || []) : [];
                const effectiveInventory = restoredProducts.length === 0
                    ? inventory
                    : inventory.map(item => {
                        const code = (item.code || '').toUpperCase();
                        const toRestore = restoredProducts.filter(p => (p.code || '').toUpperCase() === code);
                        if (toRestore.length === 0) return item;
                        if (item.type === 'Variable') {
                            const newStock = { ...item.stock };
                            toRestore.forEach(p => {
                                const sz = (p.size || '').toUpperCase();
                                const key = Object.keys(newStock).find(k => k.toUpperCase() === sz) || sz;
                                newStock[key] = Number(newStock[key] || 0) + Number(p.qty || 0);
                            });
                            return { ...item, stock: newStock };
                        }
                        const addedQty = toRestore.reduce((s, p) => s + Number(p.qty || 0), 0);
                        return { ...item, totalStock: Number(item.totalStock || 0) + addedQty };
                    });
                const s2 = computeStockBefores(newProducts, effectiveInventory);
                await Promise.all(newProducts.map(p =>
                    updateInventoryStock(p.code, p.size, -Number(p.qty), effectiveInventory)
                ));
                newProducts.forEach((p, i) => {
                    let sb = s2[i]; const qty = Number(p.qty || 0);
                    for (let u = 0; u < qty; u++) {
                        logInventoryMovement({ productCode: p.code, productName: p.name || p.code, size: p.size, qtyChange: -1, stockBefore: sb, actionType: step2ActionType, reference: editRef, user });
                        if (typeof sb === 'number') sb -= 1;
                    }
                });
            }

            // STEP 3: Database Operation
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId);
            // eslint-disable-next-line no-unused-vars
            const { id, _logActionType, createdAt, ...dataToSave } = updatedData;

            await updateDoc(orderRef, {
                ...dataToSave,
                status: newStatus,
                lastEditedBy: user?.displayName || 'Admin',
                stockDeducted: isActiveStatus,
                deductedProducts: isActiveStatus ? newProducts : [],
                // Stamp BEFORE any background WooCommerce call starts (not inside
                // wooSyncOrder) so the webhook bounce-back guard is active from the
                // earliest possible moment. adjustWooStock and wooSyncOrder run
                // concurrently below — if adjustWooStock's product-stock PUT were
                // to trigger an order-related webhook before wooSyncOrder reaches
                // its own stamp, that webhook would arrive unguarded and read the
                // order's still-stale line items, causing the webhook's
                // syncInventory to deduct the original product again instead of
                // restoring it.
                ...(oldOrder.type === 'Online' ? { _omsEditedAt: serverTimestamp() } : {})
            });

            // Sync WooCommerce stock for Online orders.
            // Awaited sequentially: both calls read-then-write stock quantities,
            // so running them concurrently causes a race condition where the second
            // call overwrites the first (e.g. kept items end up double-deducted).
            // Fire-after-commit: Firestore is already saved, so WooCommerce sync
            // runs without blocking the UI response.
            if (oldOrder.type === 'Online') {
                // Will the status-sync call below transition this order to
                // Cancelled/Returned on WooCommerce? If so, WooCommerce's own
                // built-in stock restoration fires automatically for that
                // transition (same reason handleUpdateStatus skips its manual
                // restore when wc_order_id is set). Explicitly restoring via
                // adjustWooStock as well would double the website stock.
                const wooWillAutoRestock = !!oldOrder.wc_order_id &&
                    oldOrder.status !== newStatus &&
                    ['Cancelled', 'Returned'].includes(newStatus);

                (async () => {
                    if (!['Cancelled', 'Returned'].includes(oldOrder.status) && !wooWillAutoRestock) {
                        await adjustWooStock(oldOrder.products || [], +1);
                    }
                    if (isActiveStatus) {
                        await adjustWooStock(newProducts, -1);
                    }
                })().catch(e => console.error('[WooStock] Background sync failed:', e));

                // Sync order details to WooCommerce (non-blocking)
                wooSyncOrder({
                    ...updatedData,
                    wc_order_id: oldOrder.wc_order_id,
                    products: newProducts
                }).catch(e => console.error('[WooSync] Background sync failed:', e));

                // Sync status to WooCommerce when transitioning to Cancelled/Returned
                // (e.g. the "Full Return" action, which goes through this function
                // rather than handleUpdateStatus). Both OMS statuses map to the
                // website's Cancelled status.
                if (wooWillAutoRestock) {
                    const WC_STATUS_FOR_EDIT = {
                        'Cancelled': 'cancelled',
                        'Returned': 'cancelled',
                    };
                    const wcStatus = WC_STATUS_FOR_EDIT[newStatus];
                    if (wcStatus) {
                        wooUpdateOrder(oldOrder.wc_order_id, wcStatus).catch(e =>
                            console.error(`[WooOrder] ${newStatus}→${wcStatus} sync failed:`, e)
                        );
                    }
                }
            }

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

            // Only deduct inventory if creating a new ACTIVE order (not a return)
            if (!['Cancelled', 'Returned'].includes(orderData.status)) {
                console.log('Deducting inventory for active order...');
                const products = orderData.products || [];
                await Promise.all(products.map(p =>
                    updateInventoryStock(p.code, p.size, -Number(p.qty), inventory)
                ));
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
            const delRef = order.merchantOrderId || order.storeOrderId || orderId;
            const delBefore = computeStockBefores(order.products, inventory);
            await Promise.all(order.products.map(p =>
                updateInventoryStock(p.code, p.size, Number(p.qty), inventory)
            ));
            order.products.forEach((p, i) => {
                let sb = delBefore[i]; const qty = Number(p.qty || 0);
                for (let u = 0; u < qty; u++) {
                    logInventoryMovement({ productCode: p.code, productName: p.name || p.code, size: p.size, qtyChange: +1, stockBefore: sb, actionType: 'Order Delete', reference: delRef, user });
                    if (typeof sb === 'number') sb += 1;
                }
            });
            // Restore WooCommerce stock for Online orders (fire-and-forget)
            if (order.type === 'Online') {
                adjustWooStock(order.products, +1).catch(e =>
                    console.error('[WooStock] Delete restore failed:', e)
                );
            }
        }
        // Cancel corresponding WooCommerce order when a store order is deleted
        if (order && order.type === 'Store' && order.wc_order_id) {
            wooUpdateOrder(order.wc_order_id, 'cancelled').catch(e =>
                console.error('[WooOrder] Store delete cancel failed:', e)
            );
        }
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId));
    };

    const handleEditInventory = useCallback(async (id, updatedData) => {
        try {
            const oldItem = inventory.find(i => i.id === id);
            await updateDoc(
                doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id),
                updatedData
            );
            if (!oldItem) return;

            const code = (updatedData.code || oldItem.code || '').toUpperCase();
            const adjCol = collection(db, 'artifacts', appId, 'public', 'data', 'inventoryAdjustments');
            const dateStr = new Date().toISOString().split('T')[0];
            const adjustedBy = user?.displayName || 'Admin';

            const logAndSync = async (size, oldQty, newQty) => {
                const diff = newQty - oldQty;
                if (diff === 0) return;
                const adjustmentType = diff > 0 ? 'Add' : 'Minus';
                await addDoc(adjCol, {
                    productCode: code,
                    productName: updatedData.productName || oldItem.productName || '',
                    category: updatedData.category || oldItem.category || '',
                    size,
                    previousQty: oldQty,
                    newQty,
                    change: diff,
                    adjustmentType,
                    adjustedBy,
                    date: dateStr,
                    timestamp: serverTimestamp()
                });
                adjustWooStock(
                    [{ code, size: size === 'Free' ? '' : size, qty: Math.abs(diff) }],
                    diff > 0 ? +1 : -1
                ).catch(e => console.error('[WooStock] Inventory adj failed:', e));
            };

            if (oldItem.type === 'Variable' && updatedData.type === 'Variable') {
                const oldStock = oldItem.stock || {};
                const newStock = updatedData.stock || {};
                const sizes = new Set([...Object.keys(oldStock), ...Object.keys(newStock)]);
                for (const size of sizes) {
                    await logAndSync(size, Number(oldStock[size] || 0), Number(newStock[size] || 0));
                }
            } else if (oldItem.type === 'Single') {
                await logAndSync('Free', Number(oldItem.totalStock || 0), Number(updatedData.totalStock || 0));
            }
        } catch (e) {
            alert("Inventory update failed");
        }
    }, [inventory, user]);
    const handleDeleteInventory = useCallback(async (id) => {
        try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id)); }
        catch (e) { alert("Inventory delete failed"); }
    }, []);

    // Logs initial stock when a brand-new product is added to inventory
    const handleAddInventory = useCallback(async (payload) => {
        const code = (payload.code || '').toUpperCase();
        const adjCol = collection(db, 'artifacts', appId, 'public', 'data', 'inventoryAdjustments');
        const dateStr = new Date().toISOString().split('T')[0];
        const adjustedBy = user?.displayName || localStorage.getItem('bentree_name') || 'Unknown';
        try {
            if (payload.type === 'Variable') {
                for (const [size, qty] of Object.entries(payload.stock || {})) {
                    if (Number(qty) > 0) {
                        await addDoc(adjCol, {
                            productCode: code, productName: payload.productName || '',
                            category: payload.category || '', size,
                            previousQty: 0, newQty: Number(qty), change: Number(qty),
                            adjustmentType: 'Add', actionType: 'Manual Stock Add',
                            adjustedBy, date: dateStr, timestamp: serverTimestamp(),
                        });
                    }
                }
            } else {
                const qty = Number(payload.totalStock || 0);
                if (qty > 0) {
                    await addDoc(adjCol, {
                        productCode: code, productName: payload.productName || '',
                        category: payload.category || '', size: 'Free',
                        previousQty: 0, newQty: qty, change: qty,
                        adjustmentType: 'Add', actionType: 'Manual Stock Add',
                        adjustedBy, date: dateStr, timestamp: serverTimestamp(),
                    });
                }
            }
        } catch (e) { console.error('[AddInventory] Failed to log initial stock:', e); }
    }, [user]);

    // Memoize filtered order subsets so child components only re-render when their slice changes
    const primaryOrders = useMemo(() => orders.filter(o => o.type === 'Online' && o.status === 'Pending'), [orders]);
    const confirmedOrders = useMemo(() => orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Delivered', 'Returned', 'Exchanged', 'Hold'].includes(o.status)), [orders]);
    const holdOrders = useMemo(() => orders.filter(o => o.type === 'Online' && o.status === 'Hold'), [orders]);
    const dispatchOrders = useMemo(() => orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Exchanged'].includes(o.status)), [orders]);
    const storeOrders = useMemo(() => orders.filter(o => o.type === 'Store'), [orders]);
    const exchangeOrders = useMemo(() => orders.filter(o => o.type === 'Online' && (o.status === 'Exchanged' || o.exchangeDetails || o.isPartialExchange)), [orders]);
    const cancelledReturnedOrders = useMemo(() => orders.filter(o => o.type === 'Online' && (o.status === 'Cancelled' || o.status === 'Returned')), [orders]);

    // Pre-index inventory by uppercase code for O(1) lookups in child components
    const inventoryMap = useMemo(() => {
        const map = new Map();
        inventory.forEach(item => { if (item.code) map.set(item.code.toUpperCase(), item); });
        return map;
    }, [inventory]);

    // Memoize shared prop objects so child components receive stable references
    const commonProps = useMemo(() => ({ inventory, locations, orders, user, onEdit: handleEditInventory, onDelete: handleDeleteInventory, onAdd: handleAddInventory, adjustments: inventoryAdjustments }), [inventory, locations, orders, user, handleEditInventory, handleDeleteInventory, handleAddInventory, inventoryAdjustments]);
    const orderProps = useMemo(() => ({
        orders,
        onUpdate: handleUpdateStatus,
        onEdit: handleEditOrderWithStock,
        onCreate: handleCreateOrder,
        onDelete: handleDeleteOrder,
        inventory
    }), [orders, handleUpdateStatus, handleEditOrderWithStock, handleCreateOrder, handleDeleteOrder, inventory]);

    const handleBarcodeClose = useCallback(() => handleTabChange('inventory'), [handleTabChange]);

    const tabFallback = <div className="flex justify-center items-center h-64 text-slate-400 animate-pulse font-bold tracking-widest uppercase">Loading...</div>;

    const renderContent = () => {
        if (loading && !isDataReceived) {
            return <div className="flex justify-center items-center h-64 text-slate-400 animate-pulse font-bold tracking-widest uppercase">Initializing System...</div>;
        }

        switch (activeTab) {
            case 'new-order': return <NewOrderForm user={user} existingOrders={orders} setActiveTab={handleTabChange} inventory={inventory} />;
            case 'inventory': return ( <InventoryTab {...commonProps} onOpenBarcodePrint={handleOpenBarcodePrint} /> );
            case 'stock-location': return <StockLocationTab locations={locations} />;
            case 'monthly-profit': return userRole === 'master' ? <MonthlyProfitTab orders={orders} inventory={inventory} expenses={expenses} /> : <div className="p-10 text-center text-slate-400">Master access required.</div>;
            case 'primary': return <PrimaryOrders orders={primaryOrders} onUpdate={handleUpdateStatus} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} />;
            case 'confirmed': return <ConfirmedOrders allOrders={orders} orders={confirmedOrders} {...orderProps} userRole={userRole} />;
            case 'hold': return <HoldTab orders={holdOrders} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} />;
            case 'dispatch': return <DispatchTab orders={dispatchOrders} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} />;
            case 'store-sales': return <StoreSales orders={storeOrders} {...orderProps} />;
            case 'exchange': return <ExchangeTab orders={exchangeOrders} onCreate={handleCreateOrder} onEdit={handleEditOrderWithStock} inventory={inventory} />;
            case 'cancelled': return <CancelledOrders orders={cancelledReturnedOrders} onUpdate={handleUpdateStatus} onDelete={handleDeleteOrder} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} userRole={userRole} />;
            case 'online-sales': return <OnlineSalesTab {...orderProps} />;
            case 'sales-inventory-report': return <SalesInventoryReport orders={orders} inventory={inventory} adjustments={inventoryAdjustments} />;
            case 'reports': return userRole === 'master' ? <SalesReports {...orderProps} /> : <div className="p-10 text-center text-slate-400">Master access required.</div>;
            case 'barcodePrintView': return ( <BarcodePrintView items={barcodePrintQueue} onClose={handleBarcodeClose} /> );
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
                    <Suspense fallback={tabFallback}>
                        {renderContent()}
                    </Suspense>
                </div>
            </main>

            {/* --- GLOBAL SCANNER POPUP --- */}
            {scannedOrder && (
                <Suspense fallback={null}>
                    <OrderDetailsPopup
                        order={scannedOrder}
                        onClose={() => setScannedOrder(null)}
                        getStatusColor={getStatusColor}
                        onEdit={handleEditOrderWithStock}
                        onCreate={handleCreateOrder}
                        inventory={inventory}
                    />
                </Suspense>
            )}
        </div>
    );
}

export default App;