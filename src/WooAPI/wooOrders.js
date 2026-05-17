import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/**
 * Create an order in WooCommerce via Cloud Function proxy.
 * The Cloud Function tags the order with _oms_created=true so the
 * webhook handler ignores it and avoids a duplicate Firestore document.
 *
 * @param {object} order - OMS order (recipientName, phone, address, products…)
 * @returns {object} { id, number } from WooCommerce
 */
export async function createWooOrder(order) {
    const fn = httpsCallable(functions, 'wooCreateOrder');
    const result = await fn(order);
    return result.data;
}
