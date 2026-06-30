import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/**
 * Adjust WooCommerce product stock quantities via Cloud Function proxy.
 * Fire-and-forget safe — errors are logged but never thrown.
 *
 * @param {Array}  products - [{code, size, qty}]
 * @param {number} delta    - +1 to restore stock, -1 to deduct stock
 */
export async function adjustWooStock(products, delta) {
    const fn = httpsCallable(functions, 'wooAdjustStock');
    try {
        const result = await fn({ products, delta });
        console.log('[WooStock] adjusted:', result.data.adjusted, 'items');
    } catch (err) {
        console.error('[WooStock] Failed:', err?.message || err);
    }
}

/**
 * Update a WooCommerce order's status via Cloud Function proxy.
 * Cancelling a WooCommerce order triggers its built-in stock restoration.
 *
 * @param {number|string} wcOrderId - WooCommerce order ID
 * @param {string} status - e.g. 'cancelled', 'processing', 'completed'
 */
export async function wooUpdateOrder(wcOrderId, status) {
    if (!wcOrderId) return;
    const fn = httpsCallable(functions, 'wooUpdateOrder');
    try {
        await fn({ wcOrderId, status });
        console.log(`[WooOrder] Order ${wcOrderId} status → ${status}`);
    } catch (err) {
        console.error('[WooOrder] Update failed:', err?.message || err);
    }
}

/**
 * Sync OMS order edits (customer, products, notes, shipping)
 * to WooCommerce. Fire-and-forget safe.
 *
 * @param {object} orderData - OMS order (must include wc_order_id)
 */
export async function wooSyncOrder(orderData) {
    if (!orderData?.wc_order_id) return;
    const fn = httpsCallable(functions, 'wooSyncOrder');
    try {
        await fn(orderData);
        console.log(`[WooSync] Order ${orderData.wc_order_id} synced`);
    } catch (err) {
        console.error('[WooSync] Failed:', err?.message || err);
    }
}

