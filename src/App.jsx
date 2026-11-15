import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, addDoc, query, orderBy, limit } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { getStatusColor, updateInventoryStock, computeStockBefores, logInventoryMovement, GOOGLE_ACCOUNTS } from './utils';
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
const InventoryArchiveTab = lazy(() => import('./components/InventoryArchiveTab'));
const OrderArchiveTab = lazy(() => import('./components/OrderArchiveTab'));

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
    const recentlyRestoredRef = useRef(new Set());

    // --- QMT ACCESS GUARD ---
    // QMT accounts may only create and view orders. Every handler that changes an
    // existing order (or inventory) checks this first. Firestore rules and the
    // Cloud Functions enforce the same restriction on the server.
    const userRoleRef = useRef(userRole);
    useEffect(() => { userRoleRef.current = userRole; }, [userRole]);
    const QMT_DENIED_MESSAGE = 'Permission denied: QMT accounts can only create and view orders.';
    const isQmtBlocked = useCallback(() => {
        if (userRoleRef.current !== 'qmt') return false;
        alert(QMT_DENIED_MESSAGE);
        return true;
    }, []);

    // --- 2. Authentication Observer ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                // Trust only the server-issued role claim (credential login) or the
                // Google allow-list — never localStorage alone, which can be edited.
                let verifiedRole = null;
                try {
                    const tokenResult = await currentUser.getIdTokenResult();
                    verifiedRole = tokenResult.claims.role || GOOGLE_ACCOUNTS[currentUser.email] || null;
                } catch (err) {
                    console.error('Role verification failed:', err);
                }
                if (!verifiedRole) {
                    // Old anonymous session without a server-issued role → log in again
                    localStorage.removeItem('bentree_role');
                    await signOut(auth);
                    setIsAuthChecking(false);
                    return;
                }
                localStorage.setItem('bentree_role', verifiedRole);
                setIsAuthChecking(false);
                const storedRole = verifiedRole;
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
                setIsAuthChecking(false);
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
        // Limit adjustments to the 500 most recent — this collection grows unboundedly and
        // most views only need recent entries. Full history is in Firestore if ever needed.
        const adjQuery = query(
            collection(db, 'artifacts', appId, 'public', 'data', 'inventoryAdjustments'),
            orderBy('timestamp', 'desc'),
            limit(500)
        );
        const unsubAdj = onSnapshot(adjQuery, (snap) => setInventoryAdjustments(snap.docs.map(d => ({ id: d.id, ...d.data() }))), handleSnapshotError);

        return () => { unsubOrders(); unsubInv(); unsubLoc(); unsubExp(); unsubAdj(); };
    }, [user]);

    // --- ONE-TIME INITIAL STOCK MIGRATION ---
    // Runs once per session. Sets initialStock + initialStockDate on any existing
    // product that was created before this feature was added.
    const initialStockMigrated = useRef(false);
    useEffect(() => {
        if (initialStockMigrated.current || inventory.length === 0) return;
        const unmigrated = inventory.filter(item => item.initialStock == null);
        initialStockMigrated.current = true;
        if (unmigrated.length === 0) return;
        unmigrated.forEach(item => {
            const initialStockData = item.type === 'Variable'
                ? { ...item.stock }
                : Number(item.totalStock || 0);
            const dateStr = item.createdAt?.toDate
                ? item.createdAt.toDate().toISOString().split('T')[0]
                : (item.date || new Date().toISOString().split('T')[0]);
            updateDoc(
                doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id),
                { initialStock: initialStockData, initialStockDate: dateStr }
            ).catch(e => console.error('[InitialStock Migration]', item.code, e));
        });
    }, [inventory]);

    // --- SCANNER INTEGRATION ---
    // Keep latest orders in a ref so the scan callback stays stable.
    // Without this, every Firestore orders snapshot would recreate the callback,
    // causing useScanner to detach and reattach the keydown listener on every update.
    const ordersRef = useRef(orders);
    useEffect(() => { ordersRef.current = orders; }, [orders]);

    const onScanCallback = useCallback((code) => {
        const found = ordersRef.current.find(o =>
            (o.merchantOrderId && o.merchantOrderId.toString() === code) ||
            (o.storeOrderId && o.storeOrderId.toString() === code) ||
            (o.trackingId && o.trackingId.toString() === code)
        );
        if (found) {
            setScannedOrder(found);
        } else {
            console.log("No order found for scanned code:", code);
        }
    }, []);

    useScanner(onScanCallback);

    // Called from InventoryTab when user clicks the printer icon
    const handleOpenBarcodePrint = useCallback((labels) => {
        setBarcodePrintQueue(labels);
        handleTabChange('barcodePrintView');
    }, [handleTabChange]);

    // --- 5. INVENTORY IMPACT LOGIC: Status Changes (Cancel/Return/Restore) ---
    const handleUpdateStatus = useCallback(async (orderId, newStatus, extraData = {}) => {
        if (isQmtBlocked()) return;
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
            const aType = newStatus === 'Cancelled' ? (order.type === 'Store' ? 'Store Order Cancel' : 'Cancel') : 'Full Return';
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
    }, [orders, inventory, user]);

    // --- 6. INVENTORY IMPACT LOGIC: Edits & Exchanges ---
    const handleEditOrderWithStock = useCallback(async (orderId, newStatus, updatedData) => {
        if (isQmtBlocked()) return;
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

            // Dispatching a partial-return record is a tracking-only status change.
            // The returned items were already restored to stock during the partial-return
            // flow; re-deducting them here (OMS STEP 2 and WooCommerce -1) would be wrong.
            const isDispatchingReturnOrder =
                !!updatedData.isPartialReturn &&
                oldOrder.status === 'Returned' &&
                isActiveStatus;

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
            // Skip when dispatching a return order — no stock movement needed.
            if (isActiveStatus && !isDispatchingReturnOrder) {
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

                const isPartialReturn = !!updatedData._oms_partial_return;
                // True when this edit was initiated by handlePartialExchangeProcess — a separate
                // exchange order was already created via handleCreateOrder (which calls
                // adjustWooStock for the exchange items). This flag prevents double-adjustment:
                // (1) wooSyncOrder is skipped so WooCommerce doesn't auto-restock zeroed items,
                // (2) newProducts (keptItems) are not re-deducted in the isPartialReturn branch.
                const isPartialExchangeFlow = !!updatedData._oms_partial_exchange;

                (async () => {
                    if (isPartialReturn) {
                        // Delta-based restore: only adjust the items that were actually removed
                        // from the original order (returned or exchanged), not the full
                        // restore+re-deduct cycle that causes double-adjustment with wooSyncOrder.
                        if (!wooWillAutoRestock) {
                            const oldQtyMap = {};
                            for (const p of (oldOrder.products || [])) {
                                const key = `${(p.code || '').toUpperCase()}|${(p.size || '').toUpperCase()}`;
                                if (!oldQtyMap[key]) oldQtyMap[key] = { p, qty: 0 };
                                oldQtyMap[key].qty += Number(p.qty || 0);
                            }
                            const newQtyMap = {};
                            for (const p of newProducts) {
                                const key = `${(p.code || '').toUpperCase()}|${(p.size || '').toUpperCase()}`;
                                if (!newQtyMap[key]) newQtyMap[key] = 0;
                                newQtyMap[key] += Number(p.qty || 0);
                            }
                            const returnedItems = [];
                            for (const [key, entry] of Object.entries(oldQtyMap)) {
                                const returnedQty = entry.qty - (newQtyMap[key] || 0);
                                if (returnedQty > 0) returnedItems.push({ ...entry.p, qty: returnedQty });
                            }
                            if (returnedItems.length > 0) await adjustWooStock(returnedItems, +1);
                            // For a full exchange after partial return: the replacement items are
                            // in newProducts and must be deducted here. For a partial exchange the
                            // separate exchange order's handleCreateOrder already deducted them.
                            if (!isPartialExchangeFlow && newProducts.length > 0) {
                                await adjustWooStock(newProducts, -1);
                            }
                        }
                        // Skip wooSyncOrder for partial returns/exchanges — WooCommerce order keeps
                        // original products; only OMS tracks the kept/returned split.
                    } else if (!isDispatchingReturnOrder) {
                        if (!['Cancelled', 'Returned'].includes(oldOrder.status) && !wooWillAutoRestock) {
                            await adjustWooStock(oldOrder.products || [], +1);
                        }
                        if (isActiveStatus) {
                            await adjustWooStock(newProducts, -1);
                        }
                    }
                    // isDispatchingReturnOrder: status-only change, no WooCommerce stock movement.
                })().catch(e => console.error('[WooStock] Background sync failed:', e));

                // Sync order details to WooCommerce (non-blocking) — skipped for partial returns,
                // partial exchange flows (exchange order's handleCreateOrder handles stock directly),
                // and for dispatching return orders (no product data changed).
                if (!isPartialReturn && !isPartialExchangeFlow && !isDispatchingReturnOrder) {
                    wooSyncOrder({
                        ...updatedData,
                        wc_order_id: oldOrder.wc_order_id,
                        products: newProducts
                    }).catch(e => console.error('[WooSync] Background sync failed:', e));
                }

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
    }, [orders, inventory, user]);

    // --- NEW: CREATE ORDER (for Partial Returns) ---
    const handleCreateOrder = useCallback(async (orderData) => {
        // Only used for return/exchange split records — not allowed for QMT.
        // Throw (not return) so callers stop before updating the original order.
        if (userRoleRef.current === 'qmt') throw new Error(QMT_DENIED_MESSAGE);
        try {
            // Block active orders that include archived inventory products
            if (!['Cancelled', 'Returned'].includes(orderData.status)) {
                const archivedProducts = (orderData.products || []).filter(p => {
                    const inv = inventoryMap.get((p.code || '').toUpperCase());
                    return inv && inv.archived;
                });
                if (archivedProducts.length > 0) {
                    const codes = archivedProducts.map(p => p.code).join(', ');
                    throw new Error(`Cannot create order: [${codes}] is archived and unavailable.`);
                }
            }

            // CRITICAL: For RETURNED/CANCELLED orders, we DON'T touch inventory

            // Only deduct inventory if creating a new ACTIVE order (not a return)
            if (!['Cancelled', 'Returned'].includes(orderData.status)) {
                const products = orderData.products || [];
                await Promise.all(products.map(p =>
                    updateInventoryStock(p.code, p.size, -Number(p.qty), inventory)
                ));
            }

            // Create new document in Firebase using your custom path
            const ordersRef = collection(db, 'artifacts', appId, 'public', 'data', 'orders');

            // Remove any existing id field before creating
            const { id, ...cleanOrderData } = orderData;

            const isActiveOrder = !['Cancelled', 'Returned'].includes(orderData.status);

            const docRef = await addDoc(ordersRef, {
                ...cleanOrderData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: user?.displayName || 'Admin',
                stockDeducted: isActiveOrder,
                deductedProducts: isActiveOrder ? (orderData.products || []) : [],
            });

            // Deduct WooCommerce stock for new active online orders (e.g. partial exchange items).
            // Return orders have status 'Returned' — isActiveOrder is false, no deduction.
            if (isActiveOrder && orderData.type === 'Online') {
                adjustWooStock(orderData.products || [], -1).catch(e =>
                    console.error('[WooStock] New active order deduct failed:', e)
                );
            }

            return docRef.id;
        } catch (error) {
            console.error('❌ Error creating new order:', error);
            alert(`Failed to create return order: ${error.message}`);
            throw error;
        }
    }, [inventory, user, adjustWooStock]);

    // --- 7. INVENTORY IMPACT LOGIC: Permanent Deletion ---
    const handleDeleteOrder = useCallback(async (orderId) => {
        if (isQmtBlocked()) return;
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
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), {
            archived: true,
            archivedAt: serverTimestamp(),
            archivedReason: 'deleted',
        });
    }, [orders, inventory, user]);

    const handleRestoreOrder = useCallback(async (orderId) => {
        if (isQmtBlocked()) return;
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), {
                archived: false,
                archivedAt: null,
                archivedReason: null,
            });
        } catch (e) { alert("Order restore failed"); }
    }, []);

    const handleEditInventory = useCallback(async (id, updatedData) => {
        if (isQmtBlocked()) return;
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

            // Auto-archive when stock reaches 0
            if (!oldItem.archived && !recentlyRestoredRef.current.has(id)) {
                let newTotalStock = 0;
                if (oldItem.type === 'Variable') {
                    const newStock = updatedData.stock || oldItem.stock || {};
                    newTotalStock = Object.values(newStock).reduce((a, b) => a + Number(b || 0), 0);
                } else {
                    newTotalStock = Number(updatedData.totalStock !== undefined ? updatedData.totalStock : (oldItem.totalStock || 0));
                }
                if (newTotalStock === 0) {
                    await updateDoc(
                        doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id),
                        { archived: true, archivedAt: serverTimestamp(), archivedReason: 'stock_out' }
                    );
                }
            }
        } catch (e) {
            alert("Inventory update failed");
        }
    }, [inventory, user]);
    const handleDeleteInventory = useCallback(async (id) => {
        if (isQmtBlocked()) return;
        try {
            await updateDoc(
                doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id),
                { archived: true, archivedAt: serverTimestamp(), archivedReason: 'deleted' }
            );
        } catch (e) { alert("Inventory delete failed"); }
    }, []);

    const handleRestoreInventory = useCallback(async (id) => {
        if (isQmtBlocked()) return;
        try {
            await updateDoc(
                doc(db, 'artifacts', appId, 'public', 'data', 'inventory', id),
                { archived: false, archivedAt: null, archivedReason: null }
            );
            recentlyRestoredRef.current.add(id);
            setTimeout(() => recentlyRestoredRef.current.delete(id), 60000);
        } catch (e) { alert("Restore failed"); }
    }, []);

    // Logs initial stock when a brand-new product is added to inventory
    const handleAddInventory = useCallback(async (payload) => {
        if (isQmtBlocked()) return;
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
    const confirmedOrders = useMemo(() => orders.filter(o => o.type === 'Online' && (
        ['Confirmed', 'Dispatched', 'Delivered', 'Returned', 'Exchanged', 'Hold'].includes(o.status) ||
        o.exchangeDetails ||
        o.isPartialExchange
    )), [orders]);
    const holdOrders = useMemo(() => orders.filter(o => o.type === 'Online' && o.status === 'Hold'), [orders]);
    const dispatchOrders = useMemo(() => orders.filter(o => o.type === 'Online' && ['Confirmed', 'Dispatched', 'Exchanged'].includes(o.status)), [orders]);
    const storeOrders = useMemo(() => orders.filter(o => o.type === 'Store'), [orders]);
    const exchangeOrders = useMemo(() => orders.filter(o => o.type === 'Online' && (o.status === 'Exchanged' || o.exchangeDetails || o.isPartialExchange)), [orders]);
    const cancelledReturnedOrders = useMemo(() => orders.filter(o => o.status === 'Cancelled' || o.status === 'Returned'), [orders]);

    const activeOrders = useMemo(() => orders.filter(o => !o.archived), [orders]);
    const archivedOrders = useMemo(() => orders.filter(o => o.archived), [orders]);

    // Pre-index inventory by uppercase code for O(1) lookups in child components
    const inventoryMap = useMemo(() => {
        const map = new Map();
        inventory.forEach(item => { if (item.code) map.set(item.code.toUpperCase(), item); });
        return map;
    }, [inventory]);

    const activeInventory = useMemo(() => inventory.filter(i => !i.archived), [inventory]);
    const archivedInventory = useMemo(() => inventory.filter(i => i.archived), [inventory]);

    // Memoize shared prop objects so child components receive stable references
    const commonProps = useMemo(() => ({ inventory: activeInventory, locations, orders, user, onEdit: handleEditInventory, onDelete: handleDeleteInventory, onAdd: handleAddInventory, adjustments: inventoryAdjustments }), [activeInventory, locations, orders, user, handleEditInventory, handleDeleteInventory, handleAddInventory, inventoryAdjustments]);
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
            case 'inventory-archive': return userRole !== 'qmt' ? <InventoryArchiveTab inventory={archivedInventory} locations={locations} onRestore={handleRestoreInventory} /> : <div className="p-10 text-center text-slate-400">Access denied.</div>;
            case 'stock-location': return <StockLocationTab locations={locations} />;
            case 'monthly-profit': return userRole === 'master' ? <MonthlyProfitTab orders={orders} inventory={inventory} expenses={expenses} /> : <div className="p-10 text-center text-slate-400">Master access required.</div>;
            case 'primary': return <PrimaryOrders orders={primaryOrders} onUpdate={handleUpdateStatus} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} userRole={userRole} />;
            case 'confirmed': return <ConfirmedOrders allOrders={activeOrders} orders={confirmedOrders} {...orderProps} userRole={userRole} />;
            case 'order-archive': return userRole !== 'qmt' ? <OrderArchiveTab orders={archivedOrders} onRestore={handleRestoreOrder} /> : <div className="p-10 text-center text-slate-400">Access denied.</div>;
            case 'hold': return <HoldTab orders={holdOrders} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} userRole={userRole} />;
            case 'dispatch': return <DispatchTab orders={dispatchOrders} onUpdate={handleUpdateStatus} onCreate={handleCreateOrder} userRole={userRole} />;
            case 'store-sales': return <StoreSales orders={storeOrders} {...orderProps} userRole={userRole} />;
            case 'exchange': return <ExchangeTab orders={exchangeOrders} onCreate={handleCreateOrder} onEdit={handleEditOrderWithStock} inventory={inventory} userRole={userRole} />;
            case 'cancelled': return <CancelledOrders orders={cancelledReturnedOrders} onUpdate={handleUpdateStatus} onDelete={handleDeleteOrder} onEdit={handleEditOrderWithStock} onCreate={handleCreateOrder} inventory={inventory} userRole={userRole} />;
            case 'online-sales': return <OnlineSalesTab {...orderProps} userRole={userRole} />;
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
                        onEdit={userRole === 'qmt' ? undefined : handleEditOrderWithStock}
                        onCreate={userRole === 'qmt' ? undefined : handleCreateOrder}
                        inventory={inventory}
                    />
                </Suspense>
            )}
        </div>
    );
}

export default App;