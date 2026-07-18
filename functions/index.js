const {setGlobalOptions} = require("firebase-functions");
const {onRequest, onCall} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

setGlobalOptions({maxInstances: 10});

// Must match the appId used in src/firebase.js
const APP_ID = "1:863146464502:web:ce12de37fc9ba2240148d7";

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
    createdAt: data.date_created ?
      new Date(data.date_created) : new Date(),
    updatedAt: new Date(),
  };
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
    if (existing._oms_partial_return === true) {
      logger.info("Skipping webhook — OMS partial return",
          {orderId: data.id});
      return res.status(200).send("OK");
    }

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
      if (ageMs < 90000) {
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
  const {products, delta} = request.data || {};
  const api = makeWooApi();

  const adjustOne = async (p) => {
    const sku = (p.code || "").trim().toUpperCase();
    const qty = Number(p.qty || 0);
    if (!sku || qty === 0) return false;
    try {
      const {data} = await api.get("/products", {
        params: {sku, per_page: 1},
      });
      if (!data.length) {
        logger.warn("Woo product not found for stock", {sku});
        return false;
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
          return false;
        }
        const ns = Math.max(
            0, (v.stock_quantity || 0) + delta * qty,
        );
        await api.put(
            `/products/${prod.id}/variations/${v.id}`,
            {stock_quantity: ns},
        );
        logger.info("Woo variation stock adjusted", {sku, ns});
      } else {
        const ns = Math.max(
            0, (prod.stock_quantity || 0) + delta * qty,
        );
        await api.put(
            `/products/${prod.id}`,
            {stock_quantity: ns},
        );
        logger.info("Woo product stock adjusted", {sku, ns});
      }
      return true;
    } catch (err) {
      logger.warn("Woo stock adjust failed", {
        sku, err: (err.response && err.response.data) || err.message,
      });
      return false;
    }
  };

  const results = await Promise.all(
      (products || []).map(adjustOne),
  );
  return {adjusted: results.filter(Boolean).length};
});

// ── wooUpdateOrder onCall ────────────────────────────────────────────────────

/**
 * Update a WooCommerce order's status (e.g. cancel it).
 * Cancelling triggers WooCommerce's built-in stock restoration.
 */
exports.wooUpdateOrder = onCall(async (request) => {
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

  await api.put(`/orders/${wcId}`, payload);
  logger.info("Woo order synced from OMS", {
    wcId, fields: Object.keys(payload),
  });
  return {ok: true};
});

