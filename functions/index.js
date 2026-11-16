const {setGlobalOptions} = require("firebase-functions");
const {onRequest, onCall, HttpsError} = require("firebase-functions/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");
const {GOOGLE_ACCOUNTS, CREDENTIAL_ACCOUNTS} = require("./accounts");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

setGlobalOptions({maxInstances: 10});

// Must match the appId used in src/firebase.js
const APP_ID = "1:863146464502:web:ce12de37fc9ba2240148d7";

// ── Role-based access for callable functions ────────────────────────────────
// Role comes from the server-issued custom token claim (credential logins)
// or the Google allow-list (Google logins, verified email only).
const ALL_ROLES = ["master", "employee", "qmt"];
const FULL_ACCESS_ROLES = ["master", "employee"];

const getCallerRole = (request) => {
  const token = (request.auth && request.auth.token) || {};
  if (typeof token.role === "string") return token.role;
  if (token.email && token.email_verified === true) {
    return GOOGLE_ACCOUNTS[token.email] || null;
  }
  return null;
};

// Throws "unauthenticated" (HTTP 401) or "permission-denied" (HTTP 403).
const requireRole = (request, allowedRoles, action) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }
  const role = getCallerRole(request);
  if (!allowedRoles.includes(role)) {
    logger.warn("Callable blocked by role", {
      action, role, uid: request.auth.uid,
    });
    throw new HttpsError(
        "permission-denied",
        `Your account (${role || "no role"}) is not allowed to ${action}.`,
    );
  }
  return role;
};

// ── credentialLogin onCall ───────────────────────────────────────────────────
// Verifies username/password on the server and returns a custom token that
// carries the account role as a claim, so Firestore rules can trust it.
exports.credentialLogin = onCall(async (request) => {
  const {username, password} = request.data || {};
  const userKey = String(username || "").trim();
  const account = CREDENTIAL_ACCOUNTS[userKey];
  if (!account || account.pass !== String(password || "")) {
    throw new HttpsError(
        "permission-denied", "Invalid Username or Password.",
    );
  }
  const token = await admin.auth().createCustomToken(`cred_${userKey}`, {
    role: account.role,
  });
  return {token, role: account.role, name: account.name};
});

// Normalize legacy size keys to OMS canonical form (must match src/utils.js)
const SIZE_ALIASES = {"XXL": "2XL", "XXXL": "3XL"};
const normalizeSize = (s) => {
  const upper = (s || "").trim().toUpperCase();
  return SIZE_ALIASES[upper] || upper;
};

const ordersCol = () =>
  db.collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("orders");

const inventoryCol = () =>
  db.collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("inventory");

const adjustmentsCol = () =>
  db.collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("inventoryAdjustments");

// Per-operation record of website stock adjustments (wooAdjustStock retry
// safety). Written only by Cloud Functions.
const stockOpsCol = () =>
  db.collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("wooStockOps");

// Short-lived per-product / per-variation locks for wooAdjustStock.
// Written only by Cloud Functions.
const stockLocksCol = () =>
  db.collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("wooStockLocks");

const STOCK_LOCK_LEASE_MS = 60000;
const STOCK_LOCK_WAIT_MS = 45000;

/**
 * Runs fn while holding the lock for one website product or variation.
 * WooCommerce's REST API can only set an absolute stock_quantity, so two
 * OMS stock operations reading and writing the same item at once could
 * overwrite each other. Different items don't block each other. The lock
 * is a lease: if its holder crashes, it expires after STOCK_LOCK_LEASE_MS.
 * @param {string} key - WooCommerce product ID or "productId_variationId".
 * @param {Function} fn - async work done while holding the lock.
 * @return {Promise<*>} fn's result.
 */
async function withStockLock(key, fn) {
  const ref = stockLocksCol().doc(key);
  const owner = crypto.randomUUID();
  const giveUpAt = Date.now() + STOCK_LOCK_WAIT_MS;
  for (;;) {
    const got = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const lock = snap.exists ? snap.data() : null;
      if (lock && Number(lock.expiresAtMs || 0) > Date.now()) return false;
      tx.set(ref, {owner, expiresAtMs: Date.now() + STOCK_LOCK_LEASE_MS});
      return true;
    });
    if (got) break;
    if (Date.now() > giveUpAt) {
      throw new Error("Website stock for this product is busy; try again.");
    }
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
  }
  try {
    return await fn();
  } finally {
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().owner === owner) tx.delete(ref);
      });
    } catch (e) {
      logger.warn("Could not release stock lock (it will expire)",
          {key, err: e.message});
    }
  }
}

// WooCommerce order status → Bentree OMS status
const STATUS_MAP = {
  "pending": "Pending",
  "processing": "Pending",
  "on-hold": "Hold",
  "completed": "Delivered",
  "cancelled": "Cancelled",
  "refunded": "Returned",
  "failed": "Cancelled",
};

// Statuses that mean stock should be returned to inventory
const RESTORE_STATUSES = new Set(["Cancelled", "Returned"]);

// ── Inventory helpers ────────────────────────────────────────────────────────

/**
 * Apply a qty change to one product in inventory.
 * qty > 0 restores stock; qty < 0 deducts stock.
 * @param {object} p - Product with {code, size}.
 * @param {number} qty - Amount to add (positive) or remove (negative).
 * @param {object} [logCtx] - Optional movement log context.
 */
async function applyStockChange(p, qty, logCtx) {
  const code = (p.code || "").toUpperCase();
  if (!code || qty === 0) return;

  const snap = await inventoryCol()
      .where("code", "==", code)
      .limit(1)
      .get();

  if (snap.empty) {
    logger.warn("Inventory item not found", {code});
    return;
  }

  const invDoc = snap.docs[0];
  const item = invDoc.data();
  let stockBefore = null;

  if (item.type === "Variable") {
    const stockKeys = Object.keys(item.stock || {});
    const normalizedSize = normalizeSize(p.size);
    // Match by canonical form — "XXL" finds "2XL" key, etc.
    const actualKey = stockKeys.find(
        (k) => normalizeSize(k) === normalizedSize,
    );
    if (!actualKey) {
      logger.warn("Size not found in inventory", {
        code, size: p.size, normalized: normalizedSize,
      });
      return;
    }
    stockBefore = Number((item.stock || {})[actualKey] || 0);
    await invDoc.ref.update({
      [`stock.${actualKey}`]: FieldValue.increment(qty),
    });
  } else {
    stockBefore = Number(item.totalStock || 0);
    await invDoc.ref.update({
      totalStock: FieldValue.increment(qty),
    });
  }

  const action = qty < 0 ? "deducted" : "restored";
  logger.info("Stock " + action, {
    code, size: p.size || "—", qty: Math.abs(qty),
  });

  if (logCtx) {
    await writeMovementLog(p, stockBefore, qty, logCtx);
  }
}

/**
 * Write per-unit movement log entries to inventoryAdjustments.
 * @param {object} p - product ref {code, name, size}
 * @param {number|null} stockBefore - stock level before this change
 * @param {number} qty - signed qty (negative = deduct, positive = restore)
 * @param {{actionType:string, reference:string, date:string}} ctx
 */
async function writeMovementLog(p, stockBefore, qty, ctx) {
  const {actionType, reference, date} = ctx;
  const units = Math.abs(qty);
  const qtyChange = qty < 0 ? -1 : 1;
  const col = adjustmentsCol();
  const batch = db.batch();
  let sb = stockBefore;
  for (let u = 0; u < units; u++) {
    const stockAfter = typeof sb === "number" ? sb + qtyChange : null;
    batch.set(col.doc(), {
      productCode: (p.code || "").toUpperCase(),
      productName: p.name || "",
      size: p.size || "Free",
      previousQty: sb,
      newQty: stockAfter,
      change: qtyChange,
      adjustmentType: qtyChange > 0 ? "Add" : "Minus",
      actionType,
      adjustedBy: "Website",
      reference: reference || "—",
      date: date || new Date().toISOString().split("T")[0],
      timestamp: FieldValue.serverTimestamp(),
      source: "order",
    });
    sb = stockAfter;
  }
  await batch.commit();
}

/**
 * Deduct stock for every product in the list.
 * @param {Array} products
 * @param {object} [logCtx] - optional logging context
 */
async function deductInventory(products, logCtx) {
  await Promise.all((products || []).map((p) =>
    applyStockChange(p, -Number(p.qty || 0), logCtx),
  ));
}

/**
 * Restore stock for every product in the list.
 * @param {Array} products
 * @param {object} [logCtx] - optional logging context
 */
async function restoreInventory(products, logCtx) {
  await Promise.all((products || []).map((p) =>
    applyStockChange(p, Number(p.qty || 0), logCtx),
  ));
}

/**
 * Build a qty map keyed by "CODE|SIZE" for diff comparison.
 * @param {Array} products
 * @return {object}
 */
function buildQtyMap(products) {
  const map = {};
  for (const p of (products || [])) {
    // Normalize size so "XXL" and "2XL" resolve to the same diff key
    const key = (p.code || "").toUpperCase() + "|" + normalizeSize(p.size);
    if (!map[key]) map[key] = {p, qty: 0};
    map[key].qty += Number(p.qty || 0);
  }
  return map;
}

/**
 * Sync inventory when order products change (exchange scenario).
 * Restores stock for removed/reduced items; deducts for added/increased ones.
 * @param {Array} oldProducts - Previously deducted products.
 * @param {Array} newProducts - Current order products.
 * @param {object} [logCtx] - optional logging context
 */
async function syncInventory(oldProducts, newProducts, logCtx) {
  const oldMap = buildQtyMap(oldProducts);
  const newMap = buildQtyMap(newProducts);
  const allKeys = new Set(
      [...Object.keys(oldMap), ...Object.keys(newMap)],
  );

  for (const key of allKeys) {
    const oldEntry = oldMap[key];
    const newEntry = newMap[key];
    const oldQty = oldEntry ? oldEntry.qty : 0;
    const newQty = newEntry ? newEntry.qty : 0;
    const diff = newQty - oldQty; // >0 = more ordered; <0 = fewer ordered
    if (diff === 0) continue;
    const ref = newEntry ? newEntry.p : oldEntry.p;
    // Negate diff: more ordered → deduct (negative), fewer → restore (positive)
    await applyStockChange(ref, -diff, logCtx);
  }
}

// ── WooCommerce order mapper ─────────────────────────────────────────────────

/**
 * Maps a WooCommerce order payload to the Bentree OMS order schema.
 * @param {object} data - Raw WooCommerce order object.
 * @return {object} Firestore-ready order document.
 */
function mapWooOrder(data) {
  const billing = data.billing || {};
  const shipping = data.shipping || {};

  const recipientName = [
    shipping.first_name || billing.first_name || "",
    shipping.last_name || billing.last_name || "",
  ].join(" ").trim();

  const rawPhone = billing.phone || shipping.phone || "";
  const recipientPhone = rawPhone.replace(/^\+88/, "");

  const email = billing.email || "";

  const recipientAddress = [
    shipping.address_1 || billing.address_1 || "",
    shipping.address_2 || billing.address_2 || "",
  ].filter(Boolean).join(", ");

  const recipientCity = shipping.city || billing.city || "";
  const deliveryZone =
    (recipientCity || "").toLowerCase().trim() === "dhaka" ?
      "Inside Dhaka" :
      "Outside Dhaka";
  const recipientZone = shipping.state || billing.state || "";

  const products = (data.line_items || []).map((item) => {
    const sizeMeta = (item.meta_data || []).find(
        (m) => m.key === "pa_size" ||
          m.key === "attribute_pa_size" ||
          m.key === "size" ||
          (m.display_key || "").toLowerCase() === "size",
    );
    const rawSize = sizeMeta ?
      (sizeMeta.display_value || sizeMeta.value || "") : "";
    // Normalize to OMS canonical form (e.g. "xxl"/"XXL" → "2XL")
    const size = normalizeSize(rawSize) || rawSize;
    const lineDiscount = Math.max(
        0,
        Number(item.subtotal || 0) - Number(item.total || 0),
    );
    return {
      code: item.sku || String(item.product_id || ""),
      name: item.name || "",
      size,
      qty: item.quantity || 1,
      price: Number(item.price || 0),
      discountValue: lineDiscount,
      discountType: "Fixed",
    };
  });

  const subtotal = (data.line_items || []).reduce(
      (s, item) => s + Number(item.subtotal || 0), 0,
  );

  let paymentType = "COD";
  const method = data.payment_method || "";
  if (method === "stripe" || method === "square" || method === "sslcommerz") {
    paymentType = "Card";
  } else if (method === "bacs") {
    paymentType = "Bank Transfer";
  }

  const status = STATUS_MAP[data.status] || "Pending";
  const dateStr = data.date_created ?
    data.date_created.split("T")[0] :
    new Date().toISOString().split("T")[0];

  const grandTotalNum = Number(data.total || 0);
  // "cod" is WooCommerce's built-in COD slug; all other gateways are online
  const isCOD = method.toLowerCase() === "cod";
  // For non-COD gateways (e.g. sslcommerz), WooCommerce sets status to
  // "processing" only after payment confirms. date_paid may arrive null
  // in the webhook payload due to a race condition, so we check both.
  const wooStatus = (data.status || "").toLowerCase();
  const isPrepaid = !isCOD && (
    !!(data.date_paid) ||
    wooStatus === "processing" ||
    wooStatus === "completed"
  );

  logger.info("💳 Payment detection", {
    orderId: data.id,
    payment_method: data.payment_method,
    woo_status: data.status,
    date_paid: data.date_paid || "null",
    isCOD,
    isPrepaid,
    advanceAmount: isPrepaid ? grandTotalNum : 0,
  });

  return {
    type: "Online",
    source: "WooCommerce",
    orderSource: "WooCommerce",
    wc_order_id: data.id,
    merchantOrderId: `WC-${data.id}`,
    status,
    subtotal,
    grandTotal: grandTotalNum,
    deliveryCharge: Number(data.shipping_total || 0),
    discountValue: 0,
    discountType: "Fixed",
    advanceAmount: isPrepaid ? grandTotalNum : 0,
    collectedAmount: isPrepaid ? grandTotalNum : 0,
    dueAmount: isPrepaid ? 0 : grandTotalNum,
    currency: data.currency || "BDT",
    paymentType,
    recipientName,
    recipientPhone,
    email,
    recipientAddress,
    deliveryZone,
    recipientCity,
    recipientZone,
    recipientArea: "",
    products,
    specialInstructions: data.customer_note || "",
    remarks: "",
    date: dateStr,
    // date_created is the store's local time without an offset (Bangladesh,
    // UTC+6), so parsing it on the UTC server put orders 6 hours in the future
    // and above newer OMS orders. date_created_gmt + "Z" is the real instant.
    createdAt: data.date_created_gmt ?
      new Date(data.date_created_gmt + "Z") :
      data.date_created ? new Date(data.date_created) : new Date(),
    updatedAt: new Date(),
  };
}

// ── Split-order (partial return / partial exchange) helpers ─────────────────

/**
 * Size of a WooCommerce line item, found the same way as in mapWooOrder.
 * @param {object} item - WooCommerce line item.
 * @return {string} OMS canonical size, or "".
 */
function wooItemSize(item) {
  const sizeMeta = (item.meta_data || []).find(
      (m) => m.key === "pa_size" ||
        m.key === "attribute_pa_size" ||
        m.key === "size" ||
        (m.display_key || "").toLowerCase() === "size",
  );
  const rawSize = sizeMeta ?
    (sizeMeta.display_value || sizeMeta.value || "") : "";
  return normalizeSize(rawSize) || rawSize;
}

/**
 * Number value of a line item meta key (0 when missing).
 * @param {object} item - WooCommerce line item.
 * @param {string} key - meta key.
 * @return {number}
 */
function wooItemMeta(item, key) {
  const m = (item.meta_data || []).find((x) => x.key === key);
  return m ? Number(m.value || 0) : 0;
}

/**
 * The OMS order doc linked to a WooCommerce order ID (or null).
 * @param {number|string} wcId - WooCommerce order ID.
 * @return {Promise<object|null>} Firestore DocumentReference.
 */
async function findOrderRefByWcId(wcId) {
  const directDoc = ordersCol().doc(String(wcId));
  const snap = await directDoc.get();
  if (snap.exists) return directDoc;
  const q = await ordersCol()
      .where("wc_order_id", "==", Number(wcId)).limit(1).get();
  return q.empty ? null : q.docs[0].ref;
}

/**
 * Records each website line's _restock_refunded_items after the OMS itself
 * changed it (wooSyncOrder / wooSyncOrderStock). syncSplitOrderFromWebhook
 * treats only increases beyond this baseline as website refund restocks.
 * @param {number|string} wcId - WooCommerce order ID.
 * @param {object} wcOrder - WooCommerce order after the OMS change.
 */
async function recordRestockBaseline(wcId, wcOrder) {
  try {
    const ref = await findOrderRefByWcId(wcId);
    if (!ref) return;
    const baseline = {};
    for (const item of (wcOrder.line_items || [])) {
      baseline[String(item.id)] = wooItemMeta(item, "_restock_refunded_items");
    }
    await ref.update({wcRestockBaseline: baseline});
  } catch (err) {
    logger.warn("Could not record restock baseline",
        {wcId, err: err.message});
  }
}

/**
 * Website webhook for an order split by an OMS partial return / partial
 * exchange. The OMS products are not overwritten (the website order still
 * lists the original items). Website-side stock events are applied to OMS
 * inventory, in one Firestore transaction with the order doc, so a repeated
 * or retried webhook can't apply them twice:
 *   - refund restock: the increase of a line's _restock_refunded_items over
 *     wcRestockBaseline, capped at what this OMS order still holds for that
 *     product (deductedProducts);
 *   - cancelled / refunded: whatever the OMS order still holds is restored
 *     and the OMS status becomes Cancelled / Returned.
 * Other statuses are left alone (processing would otherwise reset a
 * Dispatched / Delivered OMS status to Pending).
 * @param {object} data - WooCommerce order payload.
 * @param {string} docId - OMS order doc ID.
 * @return {Promise<object>} summary for the log.
 */
async function syncSplitOrderFromWebhook(data, docId) {
  const ref = ordersCol().doc(docId);
  const newStatus = STATUS_MAP[data.status] || null;
  const today = new Date().toISOString().split("T")[0];
  // Simple products have no size on the website line, while the OMS may
  // store "Free" for them, so those count as the same (empty) size.
  const keyOf = (code, size) => {
    const sz = normalizeSize(size || "");
    return `${String(code || "").trim().toUpperCase()}|` +
      `${sz === "FREE" || sz === "FREE SIZE" ? "" : sz}`;
  };

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const order = snap.exists ? snap.data() : {};
    const reference = order.merchantOrderId || `WC-${data.id}`;
    const stillDeducted = order.stockDeducted === true;

    // What this OMS order still holds, per product + size.
    const held = {};
    for (const p of (order.deductedProducts || [])) {
      const k = keyOf(p.code, p.size);
      if (!held[k]) held[k] = {p, qty: 0};
      held[k].qty += Number(p.qty || 0);
    }

    // 1. Website refund restocks since the last known baseline. A line
    // with no baseline yet (order split before baselines existed) only
    // gets one, so nothing unverified is restored.
    const hadBaseline = !!order.wcRestockBaseline;
    const baseline = order.wcRestockBaseline || {};
    const newBaseline = {};
    const restores = {};
    for (const item of (data.line_items || [])) {
      const id = String(item.id);
      const rr = wooItemMeta(item, "_restock_refunded_items");
      newBaseline[id] = rr;
      if (!hadBaseline || baseline[id] === undefined) continue;
      const delta = rr - Number(baseline[id] || 0);
      if (delta <= 0 || !stillDeducted) continue;
      const k = keyOf(item.sku || "", wooItemSize(item));
      const left = (held[k] ? held[k].qty : 0) -
        (restores[k] ? restores[k].qty : 0);
      const q = Math.min(delta, left);
      if (q > 0) {
        restores[k] = {
          p: held[k].p, qty: (restores[k] ? restores[k].qty : 0) + q,
          actionType: "Website Refund",
        };
      }
    }

    // 2. Cancelled / fully refunded on the website: restore the rest.
    const becomesInactive = RESTORE_STATUSES.has(newStatus);
    if (becomesInactive && stillDeducted) {
      for (const [k, h] of Object.entries(held)) {
        const already = restores[k] ? restores[k].qty : 0;
        if (h.qty - already > 0) {
          restores[k] = {
            p: h.p, qty: h.qty,
            actionType: newStatus === "Returned" ? "Full Return" : "Cancel",
          };
        }
      }
    }

    // Inventory docs (all reads before any write).
    const items = Object.entries(restores);
    const invSnaps = await Promise.all(items.map(([, r]) => tx.get(
        inventoryCol().where("code", "==",
            String(r.p.code || "").toUpperCase()).limit(1))));

    const restoredList = [];
    items.forEach(([k, r], i) => {
      const s = invSnaps[i];
      if (s.empty) {
        logger.warn("Inventory item not found", {code: r.p.code});
        return;
      }
      const invDoc = s.docs[0];
      const inv = invDoc.data();
      let stockBefore;
      if (inv.type === "Variable") {
        const actualKey = Object.keys(inv.stock || {}).find(
            (x) => normalizeSize(x) === normalizeSize(r.p.size));
        if (!actualKey) {
          logger.warn("Size not found in inventory",
              {code: r.p.code, size: r.p.size});
          return;
        }
        stockBefore = Number((inv.stock || {})[actualKey] || 0);
        tx.update(invDoc.ref,
            {[`stock.${actualKey}`]: FieldValue.increment(r.qty)});
      } else {
        stockBefore = Number(inv.totalStock || 0);
        tx.update(invDoc.ref, {totalStock: FieldValue.increment(r.qty)});
      }
      // Movement log entries, one per unit (same shape as writeMovementLog).
      let sb = stockBefore;
      for (let u = 0; u < r.qty; u++) {
        tx.set(adjustmentsCol().doc(), {
          productCode: (r.p.code || "").toUpperCase(),
          productName: r.p.name || "",
          size: r.p.size || "Free",
          previousQty: sb,
          newQty: sb + 1,
          change: 1,
          adjustmentType: "Add",
          actionType: r.actionType,
          adjustedBy: "Website",
          reference,
          date: today,
          timestamp: FieldValue.serverTimestamp(),
          source: "order",
        });
        sb += 1;
      }
      restoredList.push([k, r.qty, r.actionType]);
    });

    // Order doc: what is still held, the new baseline, inactive status.
    const remaining = [];
    for (const [k, h] of Object.entries(held)) {
      const left = h.qty - (restores[k] ? restores[k].qty : 0);
      if (left > 0) remaining.push({...h.p, qty: left});
    }
    const update = {wcRestockBaseline: newBaseline, updatedAt: new Date()};
    if (restoredList.length > 0) {
      update.deductedProducts = remaining;
      update.stockDeducted = remaining.length > 0;
    }
    if (becomesInactive && order.status !== newStatus) {
      update.status = newStatus;
      update.stockDeducted = false;
      update.deductedProducts = [];
    }
    tx.update(ref, update);
    return {restored: restoredList, status: update.status || order.status};
  });
}

// ── Webhook handler ──────────────────────────────────────────────────────────

/**
 * WooCommerce Webhook → Firestore
 *
 * order.created  → save order, deduct inventory (idempotent via flag)
 * order.updated  → sync order; restore/deduct/exchange inventory as needed
 * order.deleted  → soft-cancel order, restore inventory
 */
exports.woocommerceWebhook = onRequest(async (req, res) => {
  try {
    // ── 0. WooCommerce ping ───────────────────────────────────────────────
    const reqContentType = req.headers["content-type"] || "";
    const reqTopic = req.headers["x-wc-webhook-topic"] || "";
    if (!reqTopic &&
        reqContentType.includes("application/x-www-form-urlencoded")) {
      logger.info("WooCommerce ping received — acknowledged");
      return res.status(200).send("OK");
    }

    // ── 1. Signature verification ─────────────────────────────────────────
    const secret = process.env.WC_WEBHOOK_SECRET;
    const signature = req.headers["x-wc-webhook-signature"];

    if (!secret) {
      logger.error("WC_WEBHOOK_SECRET env var not set");
      return res.status(500).send("Server misconfiguration");
    }
    if (!signature) {
      logger.warn("Missing signature", {reqTopic, reqContentType});
      return res.status(400).send("Missing signature");
    }
    if (!req.rawBody) {
      logger.error("req.rawBody is not available");
      return res.status(500).send("Server error: no raw body");
    }

    const hash = crypto
        .createHmac("sha256", secret)
        .update(req.rawBody)
        .digest("base64");

    if (hash !== signature) {
      logger.warn("Invalid webhook signature", {
        expected: hash, received: signature,
      });
      return res.status(401).send("Invalid signature");
    }

    // ── 2. Parse payload ──────────────────────────────────────────────────
    const data = JSON.parse(req.rawBody.toString());
    const topic = req.headers["x-wc-webhook-topic"] || "";

    logger.info("WooCommerce webhook received", {orderId: data.id, topic});

    // Skip ORDER CREATION webhooks for orders that were created from
    // the OMS itself. wooOrders.js sets meta_data._oms_created=true
    // when creating orders via the WooCommerce API, so the webhook
    // doesn't create a duplicate Firestore document for orders already
    // saved by NewOrderForm.
    // IMPORTANT: this only applies to order.created. order.updated and
    // order.deleted must always be processed — otherwise a product
    // replaced directly on the website for an OMS-originated order
    // would never sync back into the OMS (the order keeps the
    // _oms_created tag forever, so it would silently skip every future
    // edit too).
    const meta = data.meta_data || [];
    const isOmsOrder = meta.some(
        (m) => m.key === "_oms_created" && m.value === "true",
    );

    // WooCommerce frequently fires a second order.updated webhook
    // within ~1s of order.created (an internal recalculation echo —
    // e.g. attribution/meta processing). The OMS already deducted
    // inventory for this order at creation time via its own flow
    // (e.g. NewOrderForm), but the Firestore doc isn't tagged with
    // stockDeducted/deductedProducts yet at that point. Without this
    // guard, that echo update gets treated as "previously cancelled,
    // now reactivated" and deducts stock a second time. Treat any
    // update/delete arriving within 60s of the order's own creation
    // as part of the same creation event and skip it too.
    const createdGmt = data.date_created_gmt ?
      new Date(data.date_created_gmt + "Z") : null;
    const sinceCreateMs = createdGmt ?
      Date.now() - createdGmt.getTime() : Infinity;
    const isCreationEcho = isOmsOrder && sinceCreateMs < 60000;

    if (isOmsOrder && (topic === "order.created" || isCreationEcho)) {
      logger.info("Skipping OMS-created order",
          {orderId: data.id, topic, sinceCreateMs});
      return res.status(200).send("OK");
    }

    // Resolve the Firestore document for this WooCommerce order.
    // Webhook-originated orders live at orders/{wcId}. OMS-originated
    // orders live at an auto-generated doc ID with wc_order_id stored
    // as a field. Without this lookup, an order.updated/deleted webhook
    // for an OMS-created order would create a duplicate document at
    // orders/{wcId} instead of updating the OMS's real document.
    let docId = String(data.id);

    // ── 3. Fetch existing order state (for inventory sync) ────────────────
    let existingSnap = await ordersCol().doc(docId).get();
    if (!existingSnap.exists) {
      const altQuery = await ordersCol()
          .where("wc_order_id", "==", data.id)
          .limit(1).get();
      if (!altQuery.empty) {
        docId = altQuery.docs[0].id;
        existingSnap = altQuery.docs[0];
      }
    }
    const existing = existingSnap.exists ? existingSnap.data() : {};
    const wasDeducted = existing.stockDeducted === true;
    const deductedProds = existing.deductedProducts || [];

    // ── 4a. Guard: OMS partial-return orders ─────────────────────────────
    // The OMS sets _oms_partial_return: true and trims products to keptItems.
    // Letting the webhook overwrite with the full WooCommerce payload would
    // restore all returned items and re-deduct stock incorrectly.
    // Partial-exchange originals are split the same way (kept items only).
    // They are no longer skipped outright: a website cancel or refund on
    // them must still reach OMS inventory. Step 4d handles them without
    // touching the OMS products (see syncSplitOrderFromWebhook).
    const isSplitOrder = existing._oms_partial_return === true ||
      existing._oms_partial_exchange === true;

    // ── 4c. Guard: bounce-back from OMS→Woo sync ───────────
    // handleEditOrderWithStock stamps _omsEditedAt synchronously, before
    // any background WooCommerce call (adjustWooStock / wooSyncOrder)
    // starts, so any webhook resulting from those calls is covered.
    // Window widened to 90s to absorb slower webhook delivery.
    if (existing._omsEditedAt) {
      const raw = existing._omsEditedAt;
      const editedAt = raw.toDate ?
        raw.toDate() : new Date(raw);
      const ageMs = Date.now() - editedAt.getTime();
      if (ageMs < 300000) {
        logger.info("Skipping webhook — OMS sync bounce",
            {orderId: data.id, ageMs});
        return res.status(200).send("OK");
      }
    }

    // ── 4b. order.deleted → restore stock + soft-cancel ──────────────────
    if (topic === "order.deleted") {
      if (wasDeducted) {
        const today = new Date().toISOString().split("T")[0];
        await restoreInventory(deductedProds, {
          actionType: "Order Delete",
          reference: existing.merchantOrderId || `WC-${data.id}`,
          date: today,
        });
        logger.info("Stock restored on delete", {orderId: data.id});
      }
      await ordersCol().doc(docId).set(
          {
            status: "Cancelled",
            updatedAt: new Date(),
            stockDeducted: false,
            deductedProducts: [],
          },
          {merge: true},
      );
      return res.status(200).send("Order deleted");
    }

    // ── 4d. Partial return / partial exchange orders ─────────────────────
    // Products stay as the OMS split them; only website cancel / refund
    // restocks are applied to OMS inventory.
    if (isSplitOrder) {
      const result = await syncSplitOrderFromWebhook(data, docId);
      logger.info("Split order webhook processed",
          {orderId: data.id, topic, ...result});
      return res.status(200).send("OK");
    }

    // ── 5. Save / update order document ──────────────────────────────────
    const orderData = mapWooOrder(data);

    if (isOmsOrder) {
      // This order originated in the OMS. A full merge of mapWooOrder's
      // output would clobber OMS-only bookkeeping fields (merchantOrderId,
      // orderSource, remarks, createdAt) with generic WooCommerce values.
      // Only sync the fields the website is genuinely authoritative for:
      // customer info, products/pricing, delivery charge, notes, status.
      // dueAmount is recalculated using the OMS's existing advance/
      // collected amounts so OMS payment tracking stays consistent.
      const advance = Number(existing.advanceAmount || 0);
      const collected = Number(existing.collectedAmount || 0);
      const scopedUpdate = {
        recipientName: orderData.recipientName,
        recipientPhone: orderData.recipientPhone,
        email: orderData.email,
        recipientAddress: orderData.recipientAddress,
        recipientCity: orderData.recipientCity,
        recipientZone: orderData.recipientZone,
        products: orderData.products,
        subtotal: orderData.subtotal,
        grandTotal: orderData.grandTotal,
        deliveryCharge: orderData.deliveryCharge,
        dueAmount: orderData.grandTotal - advance - collected,
        specialInstructions: orderData.specialInstructions,
        status: orderData.status,
        updatedAt: orderData.updatedAt,
      };
      await ordersCol().doc(docId).set(scopedUpdate, {merge: true});
    } else {
      await ordersCol().doc(docId).set(orderData, {merge: true});
    }
    logger.info("Order saved", {
      orderId: data.id, status: orderData.status,
    });

    // ── 6. Inventory management ───────────────────────────────────────────
    const logDate = new Date().toISOString().split("T")[0];
    if (topic === "order.created") {
      // Deduct once; flag prevents double-deduction on webhook retries.
      if (!wasDeducted) {
        await deductInventory(orderData.products, {
          actionType: "Online Order",
          reference: orderData.merchantOrderId || `WC-${data.id}`,
          date: logDate,
        });
        await ordersCol().doc(docId).update({
          stockDeducted: true,
          deductedProducts: orderData.products,
        });
        logger.info("Inventory deducted on create", {orderId: data.id});
      }
    } else if (topic === "order.updated") {
      if (RESTORE_STATUSES.has(orderData.status)) {
        // ── Cancelled / Returned: give stock back ───────────────────────
        if (wasDeducted) {
          const restoreType = orderData.status === "Returned" ?
            "Full Return" : "Cancel";
          await restoreInventory(deductedProds, {
            actionType: restoreType,
            reference: existing.merchantOrderId || `WC-${data.id}`,
            date: logDate,
          });
          await ordersCol().doc(docId).update({
            stockDeducted: false,
            deductedProducts: [],
          });
          logger.info("Stock restored on cancel/return", {
            orderId: data.id,
          });
        }
      } else {
        // ── Active status (Pending / Hold / Confirmed / Delivered) ──────
        if (wasDeducted) {
          // Sync differences — handles exchanges and qty changes
          await syncInventory(deductedProds, orderData.products, {
            actionType: "Order Edit",
            reference: existing.merchantOrderId || `WC-${data.id}`,
            date: logDate,
          });
          logger.info("Stock synced on update", {orderId: data.id});
        } else {
          // Previously cancelled/returned, now reactivated → fresh deduct
          await deductInventory(orderData.products, {
            actionType: "Online Order",
            reference: existing.merchantOrderId ||
              orderData.merchantOrderId || `WC-${data.id}`,
            date: logDate,
          });
          logger.info("Stock deducted on reactivation", {
            orderId: data.id,
          });
        }
        await ordersCol().doc(docId).update({
          stockDeducted: true,
          deductedProducts: orderData.products,
        });
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    logger.error("Webhook error:", error);
    return res.status(500).send("Server error");
  }
});

// ── WooCommerce proxy helpers ────────────────────────────────────────────────

/**
 * Create an authenticated axios instance for WooCommerce REST API.
 * @return {object} axios instance
 */
function makeWooApi() {
  const base = process.env.WC_BASE ||
    "https://bentreebd.com/wp-json/wc/v3";
  return axios.create({
    baseURL: base,
    auth: {
      username: process.env.WC_KEY || "",
      password: process.env.WC_SECRET || "",
    },
  });
}

/**
 * Resolve OMS products to WooCommerce line_items array.
 * @param {object} api - axios WooCommerce instance.
 * @param {Array} products - OMS [{code, size, qty}].
 * @return {Array} WooCommerce line_items.
 */
async function resolveWooLineItems(api, products) {
  const resolveOne = async (p) => {
    // Uppercase: WooCommerce SKU search is case-insensitive
    const sku = (p.code || "").trim().toUpperCase();
    if (!sku) return null;
    try {
      const {data} = await api.get("/products", {
        params: {sku, per_page: 1},
      });
      if (!data.length) {
        logger.warn("Woo SKU not found", {sku});
        return null;
      }
      const prod = data[0];
      logger.info("Woo product found", {
        sku, prodId: prod.id, type: prod.type, size: p.size,
      });

      if (prod.type === "variable") {
        const {data: vars} = await api.get(
            `/products/${prod.id}/variations`,
            {params: {per_page: 100}},
        );

        const up = normalizeSize(p.size || "");
        logger.info("Matching variation", {
          sku, size: p.size, normalized: up, totalVars: vars.length,
          varOptions: vars.map((vr) => ({
            id: vr.id,
            varSku: vr.sku,
            attrs: (vr.attributes || []).map((a) => a.option).join("|"),
          })),
        });

        // Strategy 1: Normalize both sides (handles XXL↔2XL, case differences)
        let v = vars.find((vr) =>
          vr.attributes.some((a) => normalizeSize(a.option || "") === up),
        );

        // Strategy 2: Variation SKU pattern — "BS5453-XL" or "BS5453XL"
        if (!v && up) {
          v = vars.find((vr) => {
            const vs = (vr.sku || "").toUpperCase();
            return vs === `${sku}-${up}` || vs === `${sku}${up}`;
          });
          if (v) {
            logger.info("Variation matched via SKU", {sku, varSku: v.sku});
          }
        }

        if (v) {
          logger.info("Variation resolved", {
            sku, variationId: v.id, size: p.size,
          });
          return {
            product_id: prod.id,
            variation_id: v.id,
            quantity: Number(p.qty || 1),
          };
        }
        logger.warn(
            "No variation matched — order item will lack size",
            {sku, size: p.size, normalized: up},
        );
        return {product_id: prod.id, quantity: Number(p.qty || 1)};
      } else if (prod.type === "variation") {
        // SKU matched a variation directly (not the parent)
        logger.info("SKU matched variation directly", {sku, varId: prod.id});
        return {
          product_id: prod.parent_id || prod.id,
          variation_id: prod.id,
          quantity: Number(p.qty || 1),
        };
      }
      return {
        product_id: prod.id,
        quantity: Number(p.qty || 1),
      };
    } catch (err) {
      logger.warn("Woo SKU resolve failed", {
        sku, err: (err.response && err.response.data) || err.message,
      });
      return null;
    }
  };
  const results = await Promise.all(
      (products || []).map(resolveOne),
  );
  return results.filter(Boolean);
}

// ── wooCreateOrder onCall ────────────────────────────────────────────────────

exports.wooCreateOrder = onCall(async (request) => {
  requireRole(request, ALL_ROLES, "create orders");
  const order = request.data || {};
  const api = makeWooApi();
  const lineItems = await resolveWooLineItems(api, order.products);

  const isStore = order.type === "Store";

  const parts = (order.recipientName || "Walk-in Customer").split(" ");
  const firstName = parts[0] || "Walk-in";
  const lastName = parts.slice(1).join(" ") || "Customer";

  // Online orders use paymentType; store orders use storePaymentMode
  const PAY_METHOD_MAP = {
    "Card": "stripe",
    "Bank Transfer": "bacs",
    "MFS": "bacs",
  };
  const PAY_TITLE_MAP = {
    "Card": "Card Payment",
    "Bank Transfer": "Bank Transfer",
    "MFS": "Mobile Banking (MFS)",
  };
  const rawPayment = order.paymentType || order.storePaymentMode || "";
  const payMethod = PAY_METHOD_MAP[rawPayment] || "cod";
  const payTitle = PAY_TITLE_MAP[rawPayment] || "Cash on Delivery";

  // Store orders are immediate walk-in sales: mark completed + paid
  const wcStatus = isStore ? "completed" : "processing";
  const setPaid = isStore;

  logger.info("wooCreateOrder: lineItems resolved", {
    count: lineItems.length,
  });
  if (lineItems.length === 0) {
    logger.warn(
        "wooCreateOrder: 0 line items — SKUs may be missing in WooCommerce",
    );
  }

  let resp;
  try {
    resp = await api.post("/orders", {
      payment_method: payMethod,
      payment_method_title: payTitle,
      set_paid: setPaid,
      status: wcStatus,
      billing: {
        first_name: firstName,
        last_name: lastName,
        phone: order.recipientPhone || "",
        address_1: order.recipientAddress || "",
        city: order.recipientCity || "",
        state: order.recipientZone || "",
        country: "BD",
        email: order.email || "noreply@bentreebd.com",
      },
      shipping: {
        first_name: firstName,
        last_name: lastName,
        address_1: order.recipientAddress || "",
        city: order.recipientCity || "",
        state: order.recipientZone || "",
        country: "BD",
      },
      line_items: lineItems,
      customer_note: order.specialInstructions ||
        order.remarks ||
        (isStore ? `Store sale by: ${order.salesByName || "—"}` : ""),
      meta_data: [
        {key: "_oms_created", value: "true"},
        {key: "_oms_order_type", value: order.type || "Online"},
      ],
    });
  } catch (err) {
    const wcData = (err.response && err.response.data) || {};
    const httpCode = (err.response && err.response.status) || 0;
    logger.error("wooCreateOrder POST /orders failed", {httpCode, wcData});
    throw err;
  }

  logger.info("WooCommerce order created via OMS", {
    wcId: resp.data.id,
  });
  return {id: resp.data.id, number: resp.data.number};
});

// ── wooAdjustStock onCall ────────────────────────────────────────────────────

exports.wooAdjustStock = onCall(async (request) => {
  requireRole(request, FULL_ACCESS_ROLES, "adjust website stock");
  const {products, delta, opId} = request.data || {};
  const api = makeWooApi();

  // ── Retry safety ──────────────────────────────────────────────────
  // The OMS sends an opId per stock operation. Items already adjusted
  // under that opId are skipped, so retrying a partly failed operation
  // only adjusts what failed, and a second copy of the same request
  // running at the same time is refused instead of applied twice.
  const opRef = opId ? stockOpsCol().doc(String(opId)) : null;
  const itemKey = (p, i) =>
    `${i}|${(p.code || "").trim().toUpperCase()}|` +
    `${normalizeSize(p.size || "")}|${Number(p.qty || 0)}|${delta}`;
  let done = {};
  if (opRef) {
    done = await db.runTransaction(async (tx) => {
      const snap = await tx.get(opRef);
      const op = snap.exists ? snap.data() : {};
      const startedMs = op.startedAt && op.startedAt.toDate ?
        op.startedAt.toDate().getTime() : 0;
      if (op.status === "running" && Date.now() - startedMs < 120000) {
        throw new HttpsError("aborted",
            "This website stock update is already running.");
      }
      tx.set(opRef, {
        status: "running", startedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return op.done || {};
    });
  }
  const failed = [];

  const adjustOne = async (p, i) => {
    const sku = (p.code || "").trim().toUpperCase();
    const qty = Number(p.qty || 0);
    if (!sku || qty === 0) return false;
    if (done[itemKey(p, i)]) return true;
    const fail = (reason) => {
      failed.push({code: sku, size: p.size || "", qty, reason});
      return false;
    };
    try {
      const {data} = await api.get("/products", {
        params: {sku, per_page: 1},
      });
      if (!data.length) {
        logger.warn("Woo product not found for stock", {sku});
        return fail("Product not found on the website");
      }
      const prod = data[0];

      if (prod.type === "variable") {
        const {data: vars} = await api.get(
            `/products/${prod.id}/variations`,
            {params: {per_page: 100}},
        );
        const up = normalizeSize(p.size || "");
        const v = vars.find((vr) =>
          vr.attributes.some(
              (a) => normalizeSize(a.option || "") === up,
          ),
        );
        if (!v) {
          logger.warn("Woo variation not found", {
            sku, size: p.size, normalized: up,
          });
          return fail(`Size ${p.size || "(none)"} not found on the website`);
        }
        // Read-then-write under a per-variation lock, re-reading the stock
        // inside it, so another OMS stock operation on the same variation
        // can't overwrite this change (see withStockLock).
        await withStockLock(`${prod.id}_${v.id}`, async () => {
          const {data: fresh} = await api.get(
              `/products/${prod.id}/variations/${v.id}`);
          const ns = Math.max(
              0, (fresh.stock_quantity || 0) + delta * qty,
          );
          await api.put(
              `/products/${prod.id}/variations/${v.id}`,
              {stock_quantity: ns},
          );
          logger.info("Woo variation stock adjusted", {sku, ns});
        });
      } else {
        await withStockLock(String(prod.id), async () => {
          const {data: fresh} = await api.get(`/products/${prod.id}`);
          const ns = Math.max(
              0, (fresh.stock_quantity || 0) + delta * qty,
          );
          await api.put(
              `/products/${prod.id}`,
              {stock_quantity: ns},
          );
          logger.info("Woo product stock adjusted", {sku, ns});
        });
      }
      done[itemKey(p, i)] = true;
      return true;
    } catch (err) {
      logger.warn("Woo stock adjust failed", {
        sku, err: (err.response && err.response.data) || err.message,
      });
      return fail((err.response && err.response.data &&
        err.response.data.message) || err.message || "Website error");
    }
  };

  const results = await Promise.all(
      (products || []).map(adjustOne),
  );
  if (opRef) {
    await opRef.set({
      status: failed.length ? "failed" : "done",
      done, failed, delta: delta || 0,
      finishedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  }
  if (failed.length) {
    logger.error("Website stock not updated for some products",
        {opId: opId || null, delta, failed});
  }
  return {adjusted: results.filter(Boolean).length, failed};
});

// ── wooUpdateOrder onCall ────────────────────────────────────────────────────

/**
 * Update a WooCommerce order's status (e.g. cancel it).
 * Cancelling triggers WooCommerce's built-in stock restoration.
 */
exports.wooUpdateOrder = onCall(async (request) => {
  requireRole(request, FULL_ACCESS_ROLES, "change order status");
  const {wcOrderId, status} = request.data || {};
  if (!wcOrderId) return {ok: false, reason: "missing wcOrderId"};
  const api = makeWooApi();
  await api.put(`/orders/${wcOrderId}`, {status});
  logger.info("WooCommerce order status updated",
      {wcOrderId, status});
  return {ok: true};
});

// ── wooSyncOrder onCall ─────────────────────────────────────────

/**
 * Push OMS order edits to WooCommerce.
 * Sets _omsEditedAt on the Firestore doc so the resulting
 * webhook bounce-back is skipped (see guard 4c above).
 */
exports.wooSyncOrder = onCall(async (request) => {
  requireRole(request, FULL_ACCESS_ROLES, "edit orders");
  const order = request.data || {};
  const wcId = order.wc_order_id;
  if (!wcId) return {ok: false, reason: "no wc_order_id"};

  const api = makeWooApi();
  const payload = {};

  // ── Customer / shipping info ────────────────────────────────
  const name = (order.recipientName || "").trim();
  if (name) {
    const parts = name.split(" ");
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ") || "";
    payload.billing = {
      first_name: first,
      last_name: last,
      phone: order.recipientPhone || "",
      address_1: order.recipientAddress || "",
      city: order.recipientCity || "",
      state: order.recipientZone || "",
    };
    payload.shipping = {
      first_name: first,
      last_name: last,
      address_1: order.recipientAddress || "",
      city: order.recipientCity || "",
      state: order.recipientZone || "",
    };
  }

  // ── Notes ───────────────────────────────────────────────────
  if (order.specialInstructions !== undefined ||
      order.remarks !== undefined) {
    payload.customer_note =
      order.specialInstructions ||
      order.remarks || "";
  }

  // ── Shipping total ──────────────────────────────────────────
  if (order.deliveryCharge !== undefined) {
    payload.shipping_lines = [{
      method_title: "Shipping",
      method_id: "flat_rate",
      total: String(Number(order.deliveryCharge || 0)),
    }];
  }

  // ── Products → line_items ───────────────────────────────────
  // Woo PUT keeps old items and appends new ones. To replace:
  // 1) Fetch current order for existing line_item IDs
  // 2) Reuse IDs for updated items (overwrites in place)
  // 3) Zero out any excess old items
  // 4) Add extra new items without an ID (appended)
  // Line items that will be removed but still hold website stock
  // (see "release" below).
  const releaseRemoved = [];
  if (order.products && order.products.length > 0) {
    const {data: wcOrder} = await api.get(`/orders/${wcId}`);
    const oldItems = wcOrder.line_items || [];
    const newItems =
      await resolveWooLineItems(api, order.products);

    const merged = [];
    // Overwrite old slots with new product data
    for (let i = 0; i < Math.max(oldItems.length, newItems.length); i++) {
      if (i < newItems.length && i < oldItems.length) {
        // Reuse existing line_item ID → in-place update
        merged.push({id: oldItems[i].id, ...newItems[i]});
      } else if (i < newItems.length) {
        // More new items than old → append (no id)
        merged.push(newItems[i]);
      } else {
        // More old items than new → zero out excess
        merged.push({
          id: oldItems[i].id,
          product_id: oldItems[i].product_id,
          quantity: 0, subtotal: "0", total: "0",
        });
      }
    }

    // ── Stock: website stock is changed only by wooAdjustStock ──
    // handleEditOrderWithStock already restores the old items and
    // deducts the new ones via adjustWooStock. For an order in
    // processing/completed/on-hold, WooCommerce's REST line-item update
    // ALSO adjusts stock (wc_maybe_adjust_line_item_product_stock:
    // new quantity minus the item's _reduced_stock), so every quantity
    // or product change was applied twice, and its writes raced with
    // adjustWooStock's read-then-write. Setting _reduced_stock to the
    // item's new quantity makes that difference 0, so WooCommerce
    // changes no stock here, while a later cancel still restores the
    // final quantity like any other website order.
    // _restock_refunded_items is reset to 0: the OMS products are what
    // the order holds, and a slot reused for another product (or a line
    // released by wooSyncOrderStock) must not keep an old restock count,
    // which would lower what a later cancel gives back.
    const WC_HOLDING = ["processing", "completed", "on-hold"];
    if (WC_HOLDING.includes(wcOrder.status)) {
      merged.forEach((li) => {
        li.meta_data = [
          {key: "_reduced_stock", value: Number(li.quantity || 0)},
          {key: "_restock_refunded_items", value: 0},
        ];
      });
    }

    // Removing an item (quantity 0) goes through WooCommerce's
    // remove_item(), which gives back the item's _reduced_stock for any
    // order status — on top of adjustWooStock's restore. Release those
    // items first (_reduced_stock 0, _restock_refunded_items = qty: the
    // line-item stock difference is 0, so this request changes no stock),
    // so the removal below has nothing to give back.
    for (let i = newItems.length; i < oldItems.length; i++) {
      const held = ((oldItems[i].meta_data || []).find(
          (x) => x.key === "_reduced_stock") || {}).value;
      if (Number(held || 0) > 0) {
        releaseRemoved.push({
          id: oldItems[i].id,
          meta_data: [
            {key: "_reduced_stock", value: 0},
            {key: "_restock_refunded_items",
              value: Number(oldItems[i].quantity || 0)},
          ],
        });
      }
    }
    payload.line_items = merged;
  }

  if (Object.keys(payload).length === 0) {
    return {ok: true, reason: "nothing to sync"};
  }

  // Stamp Firestore BEFORE pushing so the bounce-back
  // webhook is skipped by guard 4c.
  // Try direct doc path first (webhook-created orders),
  // then query by wc_order_id (OMS-created orders).
  try {
    const directDoc = ordersCol().doc(String(wcId));
    const snap = await directDoc.get();
    if (snap.exists) {
      await directDoc.update({
        _omsEditedAt: FieldValue.serverTimestamp(),
      });
    } else {
      const q = await ordersCol()
          .where("wc_order_id", "==", Number(wcId))
          .limit(1).get();
      if (!q.empty) {
        await q.docs[0].ref.update({
          _omsEditedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  } catch (stampErr) {
    logger.warn("Could not stamp _omsEditedAt",
        {wcId, err: stampErr.message});
  }

  if (releaseRemoved.length > 0) {
    await api.put(`/orders/${wcId}`, {line_items: releaseRemoved});
  }
  const {data: synced} = await api.put(`/orders/${wcId}`, payload);
  if (payload.line_items) {
    // These restocked counts were set by the OMS, not by a website refund.
    await recordRestockBaseline(wcId, synced);
  }
  logger.info("Woo order synced from OMS", {
    wcId, fields: Object.keys(payload),
  });
  return {ok: true};
});

// ── wooSyncOrderStock onCall ────────────────────────────────────

/**
 * Partial return / partial exchange: make the stock the website order still
 * holds match the OMS order, without changing its line items or totals.
 *
 * The OMS gives returned and exchanged-out items back to the website via
 * wooAdjustStock, but the website order kept them with _reduced_stock, so a
 * later cancel (wc_increase_stock_levels) or refund restock gave the same
 * items back a second time. Each line now holds only what the OMS order
 * still has: _reduced_stock = held qty, _restock_refunded_items = the rest
 * (WooCommerce's own record of restocked units). With quantity unchanged,
 * the REST line-item stock difference (qty - restocked - reduced) is 0, so
 * this request changes no stock. A line with _reduced_stock 0 is skipped by
 * both cancel and refund restock.
 */
exports.wooSyncOrderStock = onCall(async (request) => {
  requireRole(request, FULL_ACCESS_ROLES, "edit orders");
  const order = request.data || {};
  const wcId = order.wc_order_id;
  if (!wcId) return {ok: false, reason: "no wc_order_id"};

  const api = makeWooApi();
  const {data: wcOrder} = await api.get(`/orders/${wcId}`);
  // Only these statuses hold stock; any other order holds none to release.
  if (!["processing", "completed", "on-hold"].includes(wcOrder.status)) {
    return {ok: true, reason: `website order is ${wcOrder.status}`};
  }

  // Quantity the OMS order still has, per website product/variation.
  const byVariation = {};
  const byProduct = {}; // resolved without a variation (size not matched)
  for (const p of (order.products || [])) {
    const [li] = await resolveWooLineItems(api, [p]);
    if (!li) {
      throw new HttpsError("failed-precondition",
          `Product ${[p.code, p.size].filter(Boolean).join(" ")} ` +
          "was not found on the website.");
    }
    const qty = Number(p.qty || 0);
    if (li.variation_id) {
      const k = `${li.product_id}|${li.variation_id}`;
      byVariation[k] = (byVariation[k] || 0) + qty;
    } else {
      byProduct[li.product_id] = (byProduct[li.product_id] || 0) + qty;
    }
  }

  const metaOf = (item, key) => {
    const m = (item.meta_data || []).find((x) => x.key === key);
    return m ? Number(m.value || 0) : 0;
  };
  const updates = [];
  for (const item of (wcOrder.line_items || [])) {
    const qty = Number(item.quantity || 0);
    const k = `${item.product_id}|${item.variation_id || 0}`;
    let hold = Math.min(qty, byVariation[k] || 0);
    byVariation[k] = (byVariation[k] || 0) - hold;
    const fromProduct = Math.min(qty - hold, byProduct[item.product_id] || 0);
    byProduct[item.product_id] = (byProduct[item.product_id] || 0) -
      fromProduct;
    hold += fromProduct;
    if (metaOf(item, "_reduced_stock") === hold &&
        metaOf(item, "_restock_refunded_items") === qty - hold) {
      continue;
    }
    updates.push({
      id: item.id,
      meta_data: [
        {key: "_reduced_stock", value: hold},
        {key: "_restock_refunded_items", value: qty - hold},
      ],
    });
  }
  const notOnOrder = Object.values(byVariation)
      .concat(Object.values(byProduct)).filter((q) => q > 0).length;
  if (updates.length === 0) {
    await recordRestockBaseline(wcId, wcOrder);
    return {ok: true, updated: 0, notOnOrder};
  }

  // Stamp Firestore first so the bounce-back webhook is skipped (guard 4c).
  try {
    const directDoc = ordersCol().doc(String(wcId));
    const snap = await directDoc.get();
    const ref = snap.exists ? directDoc : await ordersCol()
        .where("wc_order_id", "==", Number(wcId)).limit(1).get()
        .then((q) => (q.empty ? null : q.docs[0].ref));
    if (ref) await ref.update({_omsEditedAt: FieldValue.serverTimestamp()});
  } catch (stampErr) {
    logger.warn("Could not stamp _omsEditedAt", {wcId, err: stampErr.message});
  }

  const {data: synced} =
    await api.put(`/orders/${wcId}`, {line_items: updates});
  // These restocked counts were set by the OMS, not by a website refund.
  await recordRestockBaseline(wcId, synced);
  logger.info("Woo order stock hold synced from OMS", {
    wcId, updated: updates.map((u) => [u.id, u.meta_data[0].value]),
    notOnOrder,
  });
  return {ok: true, updated: updates.length, notOnOrder};
});

// ── wooPushOrder onCall ─────────────────────────────────────────────────────

// OMS status → website status for a pushed order. Same targets the OMS
// already uses: Online orders are created as "processing", Delivered/Completed
// map to "completed", Cancelled/Returned map to "cancelled".
const PUSH_WC_STATUS = {
  "Pending": "processing",
  "Confirmed": "processing",
  "Dispatched": "processing",
  "Exchanged": "processing",
  "Hold": "on-hold",
  "Delivered": "completed",
  "Completed": "completed",
  "Cancelled": "cancelled",
  "Returned": "cancelled",
};
// WooCommerce reduces stock when an order enters one of these statuses.
const WC_STOCK_HOLDING_STATUSES =
  new Set(["processing", "completed", "on-hold"]);
const PUSH_LOCK_MS = 120000;

const phoneDigits = (s) => String(s || "").replace(/\D/g, "").slice(-10);

/**
 * True when a WooCommerce order is this OMS order: it carries our
 * _oms_doc_id tag, or (orders created before pushing existed) the same
 * customer phone number.
 * @param {object} wc - WooCommerce order.
 * @param {string} docId - OMS Firestore doc ID.
 * @param {object} order - OMS order.
 * @return {boolean}
 */
function isSameWooOrder(wc, docId, order) {
  const tag = (wc.meta_data || []).find((m) => m.key === "_oms_doc_id");
  if (tag) return String(tag.value) === docId;
  const omsPhone = phoneDigits(order.recipientPhone);
  const wcPhone = phoneDigits(
      (wc.billing && wc.billing.phone) || (wc.shipping && wc.shipping.phone));
  return !!omsPhone && omsPhone === wcPhone;
}

/**
 * GET /orders/{id}. Returns null only when WooCommerce says the ID is not
 * an order (deleted, or the ID now belongs to a product). Any other error
 * is thrown so a push never creates a duplicate because of a network error.
 * @param {object} api - axios WooCommerce instance.
 * @param {number|string} wcId - WooCommerce order ID.
 * @return {object|null}
 */
async function fetchWooOrderOrNull(api, wcId) {
  try {
    const {data} = await api.get(`/orders/${wcId}`);
    return data && data.id ? data : null;
  } catch (err) {
    const httpCode = (err.response && err.response.status) || 0;
    const code = (err.response && err.response.data &&
      err.response.data.code) || "";
    if ((httpCode === 404 || httpCode === 400) && /invalid_id/.test(code)) {
      return null;
    }
    throw err;
  }
}

/**
 * Finds a website order created by an earlier, unfinished push of this OMS
 * order (e.g. the POST succeeded but the response or the Firestore write
 * failed). Scans orders created since that attempt for our _oms_doc_id tag.
 * @param {object} api - axios WooCommerce instance.
 * @param {string} docId - OMS Firestore doc ID.
 * @param {Date} since - Start of the first unfinished attempt.
 * @return {object|null}
 */
async function findPushedWooOrder(api, docId, since) {
  const after = new Date(since.getTime() - 5 * 60000).toISOString();
  for (let page = 1; page <= 10; page++) {
    const {data} = await api.get("/orders", {
      params: {
        after, dates_are_gmt: true, status: "any",
        per_page: 100, page, orderby: "date", order: "asc",
      },
    });
    const hit = (data || []).find((wc) => (wc.meta_data || []).some(
        (m) => m.key === "_oms_doc_id" && String(m.value) === docId));
    if (hit) return hit;
    if (!data || data.length < 100) return null;
  }
  return null;
}

/**
 * Push an existing OMS order to the website (e.g. one that was removed from
 * WooCommerce), without changing website or OMS inventory.
 *
 * Stock: the order is created with _order_stock_reduced=true, so
 * WooCommerce's wc_maybe_reduce_stock_levels() skips it when the order moves
 * to processing/completed/on-hold. Line items are added while the new order is
 * still "pending", so the REST line-item stock adjustment doesn't run either.
 * Each line item gets _reduced_stock=qty so later edits/cancels treat the order
 * like any other website order that already holds its stock. Cancelled orders
 * get neither flag, so WooCommerce has nothing to restore. OMS inventory is not
 * touched; the order.created webhook is skipped via _oms_created.
 *
 * Duplicates: an order already on the website (by wc_order_id, or found from an
 * earlier unfinished push) is linked instead of creating another one. A lock
 * on the Firestore doc stops two pushes of the same order running at once.
 */
exports.wooPushOrder = onCall(async (request) => {
  requireRole(request, FULL_ACCESS_ROLES, "push orders to the website");
  const docId = String((request.data && request.data.orderId) || "");
  if (!docId) throw new HttpsError("invalid-argument", "Missing order ID.");

  const ref = ordersCol().doc(docId);
  const pushedBy = (request.auth.token && (request.auth.token.name ||
    request.auth.token.email)) || request.auth.uid;

  // ── 1. Lock (one push at a time per order) ──────────────────────────
  const order = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Order not found in OMS.");
    }
    const data = snap.data();
    const prev = data.wcPush || {};
    const startedMs = prev.attemptStartedAt && prev.attemptStartedAt.toDate ?
      prev.attemptStartedAt.toDate().getTime() : 0;
    if (prev.status === "pushing" && Date.now() - startedMs < PUSH_LOCK_MS) {
      throw new HttpsError("aborted",
          "This order is already being pushed. Please wait a moment.");
    }
    tx.update(ref, {
      "wcPush.status": "pushing",
      "wcPush.attemptStartedAt": FieldValue.serverTimestamp(),
      "wcPush.unresolvedSince": prev.unresolvedSince ||
        FieldValue.serverTimestamp(),
      "wcPush.error": null,
      // Skip any webhook bounce-back while the push runs (guard 4c).
      "_omsEditedAt": FieldValue.serverTimestamp(),
    });
    return {...data, wcPush: prev};
  });

  const api = makeWooApi();
  const oldWcId = order.wc_order_id || null;

  const finish = async (result, wc, extra = {}) => {
    await ref.update({
      "wc_order_id": wc.id,
      "wcPush.status": result,
      "wcPush.wcOrderId": wc.id,
      "wcPush.previousWcOrderId": oldWcId && Number(oldWcId) !== wc.id ?
        oldWcId : (order.wcPush.previousWcOrderId || null),
      "wcPush.websiteTotal": Number(wc.total || 0),
      "wcPush.pushedAt": FieldValue.serverTimestamp(),
      "wcPush.pushedBy": pushedBy,
      "wcPush.unresolvedSince": null,
      "wcPush.error": null,
      "_omsEditedAt": FieldValue.serverTimestamp(),
    });
    logger.info("wooPushOrder done", {docId, result, wcId: wc.id, oldWcId});
    return {result, wcOrderId: wc.id, ...extra};
  };

  try {
    // ── 2. Already on the website? ──────────────────────────────────
    if (oldWcId) {
      const wc = await fetchWooOrderOrNull(api, oldWcId);
      if (wc && isSameWooOrder(wc, docId, order)) {
        if (wc.status === "trash") {
          throw new HttpsError("failed-precondition",
              `Website order #${wc.id} is in the WooCommerce Trash. ` +
              "Restore it from WooCommerce instead of pushing again.");
        }
        return await finish("exists", wc);
      }
      if (wc) {
        logger.warn("wooPushOrder: wc_order_id belongs to another order",
            {docId, oldWcId});
      }
    }
    if (order.wcPush.unresolvedSince && order.wcPush.unresolvedSince.toDate) {
      const wc = await findPushedWooOrder(
          api, docId, order.wcPush.unresolvedSince.toDate());
      if (wc) return await finish("exists", wc);
    }

    // ── 3. Build the website order from the OMS order ───────────────
    const wcStatus = PUSH_WC_STATUS[order.status] || "processing";
    const holdsStock = WC_STOCK_HOLDING_STATUSES.has(wcStatus);
    const products = order.products || [];
    if (products.length === 0) {
      throw new HttpsError("failed-precondition", "Order has no products.");
    }

    // resolveWooLineItems treats any error as "SKU not found", so check the
    // website is reachable first to report connection errors correctly.
    await api.get("/orders", {params: {per_page: 1}});

    const warnings = [];
    const lineItems = [];
    for (const p of products) {
      const [li] = await resolveWooLineItems(api, [p]);
      if (!li) {
        const label = [p.code || "(no code)", p.size].filter(Boolean).join(" ");
        throw new HttpsError("failed-precondition",
            `Product ${label} was not found on the website.`);
      }
      if (p.size && !li.variation_id) {
        warnings.push(`${p.code} ${p.size}: size not matched on the website`);
      }
      const qty = Number(p.qty || 0);
      const base = Number(p.price || 0) * qty;
      const dv = Number(p.discountValue || 0);
      // Webhook orders store the line price after discount (mapWooOrder);
      // OMS orders store the list price with the discount separate.
      const fromWoo = order.source === "WooCommerce";
      const itemDisc = p.discountType === "Fixed" ? dv : base * (dv / 100);
      const subtotal = fromWoo ? base + dv : base;
      const total = fromWoo ? base : base - itemDisc;
      lineItems.push({
        ...li,
        quantity: qty,
        subtotal: subtotal.toFixed(2),
        total: Math.max(0, total).toFixed(2),
        meta_data: holdsStock ? [{key: "_reduced_stock", value: qty}] : [],
      });
    }

    const deliveryCharge = Number(order.deliveryCharge || 0);
    const grandTotal = Number(order.grandTotal || 0);
    const itemsTotal = lineItems.reduce((s, li) => s + Number(li.total), 0);
    // Order-level discount / any OMS adjustment, so the website total
    // matches the OMS grand total.
    const adjust =
      Math.round((grandTotal - itemsTotal - deliveryCharge) * 100) / 100;

    const parts = (order.recipientName || "Walk-in Customer").trim().split(" ");
    const firstName = parts[0] || "Walk-in";
    const lastName = parts.slice(1).join(" ") || "Customer";

    const PAY_METHOD_MAP = {
      "Card": "stripe", "Bank Transfer": "bacs", "MFS": "bacs",
    };
    const PAY_TITLE_MAP = {
      "Card": "Card Payment",
      "Bank Transfer": "Bank Transfer",
      "MFS": "Mobile Banking (MFS)",
    };
    const rawPayment = order.paymentType || order.storePaymentMode || "";

    const address = {
      first_name: firstName,
      last_name: lastName,
      address_1: order.recipientAddress || "",
      city: order.recipientCity || "",
      state: order.recipientZone || "",
      country: "BD",
    };

    const payload = {
      payment_method: PAY_METHOD_MAP[rawPayment] || "cod",
      payment_method_title: PAY_TITLE_MAP[rawPayment] || "Cash on Delivery",
      status: wcStatus,
      billing: {
        ...address,
        phone: order.recipientPhone || "",
        email: order.email || "noreply@bentreebd.com",
      },
      shipping: address,
      line_items: lineItems,
      shipping_lines: deliveryCharge ? [{
        method_title: "Shipping", method_id: "flat_rate",
        total: deliveryCharge.toFixed(2),
      }] : [],
      fee_lines: adjust ? [{
        name: adjust < 0 ? "Discount" : "Adjustment",
        tax_status: "none",
        total: adjust.toFixed(2),
      }] : [],
      customer_note: order.specialInstructions || order.remarks || "",
      meta_data: [
        {key: "_oms_created", value: "true"},
        {key: "_oms_order_type", value: order.type || "Online"},
        {key: "_oms_pushed", value: "true"},
        {key: "_oms_doc_id", value: docId},
        {key: "_oms_original_wc_id", value: oldWcId ? String(oldWcId) : ""},
        {key: "_oms_merchant_order_id", value: order.merchantOrderId || ""},
        {key: "_oms_original_date", value: order.date || ""},
        {key: "_oms_status", value: order.status || ""},
        {key: "_oms_payment_type", value: rawPayment},
        {key: "_oms_advance_amount", value: String(order.advanceAmount || 0)},
        {key: "_oms_collected_amount",
          value: String(order.collectedAmount || 0)},
        {key: "_oms_due_amount", value: String(order.dueAmount || 0)},
        // Stock: see the function comment above.
        {key: "_order_stock_reduced", value: holdsStock ? "yes" : "no"},
        {key: "_new_order_email_sent", value: "true"},
      ],
    };

    // ── 4. Create ───────────────────────────────────────────────────
    let wc;
    try {
      ({data: wc} = await api.post("/orders", payload));
    } catch (err) {
      const wcData = (err.response && err.response.data) || {};
      logger.error("wooPushOrder POST /orders failed", {
        docId, httpCode: (err.response && err.response.status) || 0, wcData,
      });
      throw new HttpsError("unavailable",
          `Website rejected the order: ${wcData.message || err.message}`);
    }

    if (Math.abs(Number(wc.total || 0) - grandTotal) >= 0.01) {
      warnings.push(
          `Website total ${wc.total} differs from OMS total ${grandTotal}`);
    }

    // Order note for staff (not sent to the customer). Not critical.
    try {
      await api.post(`/orders/${wc.id}/notes`, {
        note: `Pushed from OMS by ${pushedBy}. ` +
          (oldWcId ? `Original website order #${oldWcId}. ` : "") +
          `OMS order ${order.merchantOrderId || docId}, ` +
          `status ${order.status}, ` +
          `date ${order.date || "-"}. Stock was not changed.`,
        customer_note: false,
      });
    } catch (noteErr) {
      logger.warn("wooPushOrder: note failed", {docId, err: noteErr.message});
    }

    return await finish("pushed", wc, {warnings});
  } catch (err) {
    const message = err instanceof HttpsError ? err.message :
      ((err.response && err.response.data && err.response.data.message) ||
        err.message || "Unknown error");
    logger.error("wooPushOrder failed", {docId, message});
    try {
      await ref.update({
        "wcPush.status": "failed",
        "wcPush.error": message,
        "wcPush.failedAt": FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn("wooPushOrder: could not save failure", {docId});
    }
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", `Push failed: ${message}`);
  }
});

// Runs daily at midnight — permanently deletes inventory items that have been
// archived for 30+ days and have not been restored.
exports.purgeOldArchivedInventory = onSchedule("every 24 hours", async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snapshot = await db
      .collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("inventory")
      .where("archived", "==", true)
      .where("archivedAt", "<=", cutoff)
      .get();

  if (snapshot.empty) {
    logger.info("[ArchivePurge] No expired archived items found.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  logger.info("[ArchivePurge] Permanently deleted expired items.",
      {count: snapshot.size});
});

// Runs daily — deletes order records archived for 30+ days.
// NEVER deletes sales reports, order history, or related business records.
exports.purgeOldArchivedOrders = onSchedule("every 24 hours", async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snapshot = await db
      .collection("artifacts").doc(APP_ID)
      .collection("public").doc("data")
      .collection("orders")
      .where("archived", "==", true)
      .where("archivedAt", "<=", cutoff)
      .get();

  if (snapshot.empty) {
    logger.info("[OrderArchivePurge] No expired archived orders found.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  logger.info("[OrderArchivePurge] Deleted expired archived orders.",
      {count: snapshot.size});
});

