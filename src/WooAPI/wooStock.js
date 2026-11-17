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
 * OMS → website exact stock: after an OMS inventory change, set each changed
 * item's website stock to the same quantity the OMS now has.
 * results = applyInventoryChanges() output [{code, size, before, after}].
 * The Cloud Function sets `after` when the website still shows `before`;
 * if the website shows something else (a website change not yet in OMS) it
 * keeps that newer value, applies only this change, and records the item as
 * a mismatch for reconciliation. The website never goes below 0.
 * Fire-and-forget safe — errors are logged and offered for retry.
 *
 * @param {Array} results - [{code, size, before, after}]
 */
export async function syncWooStock(results) {
    const items = (results || [])
        .filter(r => r && r.code && Number(r.before) !== Number(r.after))
        .map(r => ({ code: r.code, size: r.size || '', before: Number(r.before), after: Number(r.after) }));
    if (items.length === 0) return;
    const fn = httpsCallable(functions, 'wooSetStock');
    // One ID per stock operation: a retry sends the same ID, and the Cloud
    // Function skips the items it already set, so nothing moves twice.
    const opId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    const label = (p) => `${p.code}${p.size ? ` (${p.size})` : ''}`;
    for (;;) {
        let problem = '';
        try {
            const result = await fn({ items, opId });
            const rows = result.data.results || [];
            const mismatched = rows.filter(r => r.status === 'mismatch');
            if (mismatched.length > 0) {
                console.warn('[WooStock] OMS and website differ (recorded for reconciliation):',
                    mismatched.map(r => `${label(r)}: OMS ${r.omsQty}, website ${r.websiteQty}`).join('; '));
            }
            console.log('[WooStock] set:', rows.length, 'items');
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
            `Website stock was NOT updated to match OMS for:\n${problem}\n\n` +
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

// Answers of wooCheckOrderLink per OMS order + website order ID, so reopening
// the same order popup doesn't ask the website again for a short while.
// Only definite answers are kept; "unknown" (website not reachable) is asked
// again next time.
const linkCheckCache = new Map();
const LINK_CHECK_TTL_MS = 120000;

/**
 * Is the website order linked to this OMS order still on the website?
 * Read-only on the website; creates nothing.
 *
 * @param {string} orderId - OMS Firestore order doc ID
 * @param {number|string} wcOrderId - the linked website order ID
 * @returns {object} { state: 'exists'|'trash'|'missing'|'other'|'none'|'unknown', wcOrderId }
 */
export async function wooCheckOrderLink(orderId, wcOrderId) {
    const key = `${orderId}|${wcOrderId}`;
    const hit = linkCheckCache.get(key);
    if (hit && Date.now() - hit.at < LINK_CHECK_TTL_MS) return hit.result;
    const fn = httpsCallable(functions, 'wooCheckOrderLink');
    try {
        const { data } = await fn({ orderId });
        if (data.state !== 'unknown') linkCheckCache.set(key, { at: Date.now(), result: data });
        return data;
    } catch (err) {
        console.warn('[WooLinkCheck] Failed:', err?.message || err);
        return { state: 'unknown', wcOrderId, error: err?.message || String(err) };
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

