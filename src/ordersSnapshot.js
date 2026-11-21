// Orders listener: turns each Firestore snapshot into the orders array the app uses.
//
// The result is exactly what this code produced before, on every snapshot:
//   const data = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
//   data.sort(byCreatedAtDesc);
// but d.data() + the object copy (the costly part) now run only for documents
// that were added or modified in that snapshot (snap.docChanges()); unchanged
// orders keep their already-converted object. The array is still built in the
// snapshot's own document order and sorted with the same stable comparator, so
// orders with equal (or missing) createdAt keep the same relative order as before.
//
// Create one per listener subscription (a new user / role / listener starts with
// an empty cache), so no order from an earlier subscription can be kept.

// Newest first: createdAt seconds, then nanoseconds; missing timestamps count as 0.
export const compareOrdersByCreatedAtDesc = (a, b) =>
    ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)) ||
    ((b.createdAt?.nanoseconds || 0) - (a.createdAt?.nanoseconds || 0));

// 'estimate' gives a just-created order (serverTimestamp still pending) its
// local time instead of null, so it sorts to the top immediately.
const toOrder = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });

export const createOrdersSnapshotReader = () => {
    const byId = new Map();
    return (snap) => {
        snap.docChanges().forEach(change => {
            if (change.type === 'removed') byId.delete(change.doc.id);
            else byId.set(change.doc.id, toOrder(change.doc));
        });
        const data = snap.docs.map(d => {
            let order = byId.get(d.id);
            if (order === undefined) { // not expected: a document without a change entry
                order = toOrder(d);
                byId.set(d.id, order);
            }
            return order;
        });
        data.sort(compareOrdersByCreatedAtDesc);
        return data;
    };
};
