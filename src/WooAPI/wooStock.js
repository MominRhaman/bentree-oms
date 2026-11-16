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
    // One ID per stock operation: a retry sends the same ID, and the Cloud
    // Function skips the items it already adjusted, so nothing moves twice.
    const opId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    const label = (p) => `${p.code}${p.size ? ` (${p.size})` : ''} x${p.qty}`;
    for (;;) {
        let problem = '';
        try {
            const result = await fn({ products, delta, opId });
            console.log('[WooStock] adjusted:', result.data.adjusted, 'items');
            const failed = result.data.failed || [];
            if (failed.length === 0) return;
            problem = failed.map(f => `- ${label(f)}: ${f.reason}`).join('\n');
        } catch (err) {
            console.error('[WooStock] Failed:', err?.message || err);
            problem = `- ${err?.message || err}`;
        }
        console.error('[WooStock] Website stock not updated:\n' + problem);
        // OMS inventory is already updated; only the website stock is behind.
        const retry = window.confirm(
            `Website stock was NOT ${delta < 0 ? 'reduced' : 'increased'} for:\n${problem}\n\n` +
            'OMS inventory is already updated. Retry the website update now?\n' +
            '(Items that already succeeded will not be changed again.)'
        );
        if (!retry) return;
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
 * After a partial return / partial exchange: make the stock the website
 * order holds match the OMS order's remaining products, without changing
 * its line items, so a later website cancel or refund cannot give returned
 * or exchanged-out items back a second time. Changes no stock itself.
 *
 * @param {object} orderData - { wc_order_id, products }
 */
export async function wooSyncOrderStock(orderData) {
    if (!orderData?.wc_order_id) return;
    const fn = httpsCallable(functions, 'wooSyncOrderStock');
    try {
        const result = await fn(orderData);
        console.log(`[WooSyncStock] Order ${orderData.wc_order_id}:`, result.data);
    } catch (err) {
        console.error('[WooSyncStock] Failed:', err?.message || err);
        alert(`Website order #${orderData.wc_order_id} could not be updated after this return/exchange:\n${err?.message || err}\n\nSave the order again to retry.`);
    }
}

/**
 * Push an existing OMS order to the website (e.g. one removed from
 * WooCommerce). The Cloud Function reads the order from Firestore, links an
 * order already on the website instead of creating a duplicate, and changes
 * neither website nor OMS stock. Throws on failure so the caller can show it.
 *
 * @param {string} orderId - OMS Firestore order doc ID
 * @returns {object} { result: 'pushed' | 'exists', wcOrderId, warnings? }
 */
export async function wooPushOrder(orderId) {
    const fn = httpsCallable(functions, 'wooPushOrder');
    const result = await fn({ orderId });
    return result.data;
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

