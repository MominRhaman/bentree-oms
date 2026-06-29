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
 */
async function applyStockChange(p, qty) {
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
    await invDoc.ref.update({
      [`stock.${actualKey}`]: FieldValue.increment(qty),
    });
  } else {
    await invDoc.ref.update({
      totalStock: FieldValue.increment(qty),
    });
  }

  const action = qty < 0 ? "deducted" : "restored";
  logger.info("Stock " + action, {
    code, size: p.size || "—", qty: Math.abs(qty),
  });
}

/**
 * Deduct stock for every product in the list.
 * @param {Array} products
 */
async function deductInventory(products) {
  for (const p of (products || [])) {
    await applyStockChange(p, -Number(p.qty || 0));
  }
}

/**
 * Restore stock for every product in the list.
 * @param {Array} products
 */
async function restoreInventory(products) {
  for (const p of (products || [])) {
    await applyStockChange(p, Number(p.qty || 0));
  }
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
 */
async function syncInventory(oldProducts, newProducts) {
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
    await applyStockChange(ref, -diff);
  }
}

// ── WooCommerce order mapper ─────────────────────────────────────────────────

/**
 * Maps a WooCommerce order payload to the Bentree OMS order schema.
 * @param {object} data - Raw WooCommerce order object.
 * @return {object} Firestore-ready order document.
 */
function mapWooOrder(data) {
  console.log(data, "Woo payload");
  const billing = data.billing || {};
  const shipping = data.shipping || {};

  const recipientName = [
    shipping.first_name || billing.first_name || "",
    shipping.last_name || billing.last_name || "",
  ].join(" ").trim();

  const recipientPhone = billing.phone || shipping.phone || "";

  const recipientAddress = [
    shipping.address_1 || billing.address_1 || "",
    shipping.address_2 || billing.address_2 || "",
  ].filter(Boolean).join(", ");

  const recipientCity = shipping.city || billing.city || "";
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
    recipientAddress,
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

    // Skip orders that were created from the OMS itself.
    // wooOrders.js sets meta_data._oms_created=true when creating orders
    // via the WooCommerce API, so the webhook doesn't create a duplicate
    // Firestore document for orders already saved by NewOrderForm.
    const meta = data.meta_data || [];
    const isOmsOrder = meta.some(
        (m) => m.key === "_oms_created" && m.value === "true",
    );
    if (isOmsOrder) {
      logger.info("Skipping OMS-created order", {orderId: data.id});
      return res.status(200).send("OK");
    }

    const docId = String(data.id);

    // ── 3. Fetch existing order state (for inventory sync) ────────────────
    const existingSnap = await ordersCol().doc(docId).get();
    const existing = existingSnap.exists ? existingSnap.data() : {};
    const wasDeducted = existing.stockDeducted === true;
    const deductedProds = existing.deductedProducts || [];

    // ── 4a. Guard: OMS partial-return orders ─────────────────────────────
    // The OMS sets _oms_partial_return: true and trims products to keptItems.
    // Letting the webhook overwrite with the full WooCommerce payload would
    // restore all returned items and re-deduct stock incorrectly.
    if (existing._oms_partial_return === true) {
      logger.info("Skipping webhook — OMS partial return", {orderId: data.id});
      return res.status(200).send("OK");
    }

    // ── 4b. order.deleted → restore stock + soft-cancel ──────────────────
    if (topic === "order.deleted") {
      if (wasDeducted) {
        await restoreInventory(deductedProds);
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
    await ordersCol().doc(docId).set(orderData, {merge: true});
    logger.info("Order saved", {
      orderId: data.id, status: orderData.status,
    });

    // ── 6. Inventory management ───────────────────────────────────────────
    if (topic === "order.created") {
      // Deduct once; flag prevents double-deduction on webhook retries.
      if (!wasDeducted) {
        await deductInventory(orderData.products);
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
          await restoreInventory(deductedProds);
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
          await syncInventory(deductedProds, orderData.products);
          logger.info("Stock synced on update", {orderId: data.id});
        } else {
          // Previously cancelled/returned, now reactivated → fresh deduct
          await deductInventory(orderData.products);
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
  const items = [];
  for (const p of (products || [])) {
    // Uppercase: WooCommerce SKU search is case-insensitive
    const sku = (p.code || "").trim().toUpperCase();
    if (!sku) continue;
    try {
      const {data} = await api.get("/products", {
        params: {sku, per_page: 1},
      });
      if (!data.length) {
        logger.warn("Woo SKU not found", {sku});
        continue;
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
          items.push({
            product_id: prod.id,
            variation_id: v.id,
            quantity: Number(p.qty || 1),
          });
        } else {
          logger.warn("No variation matched — order item will lack size", {
            sku, size: p.size, normalized: up,
          });
          items.push({product_id: prod.id, quantity: Number(p.qty || 1)});
        }
      } else if (prod.type === "variation") {
        // SKU matched a variation directly (not the parent)
        logger.info("SKU matched variation directly", {sku, varId: prod.id});
        items.push({
          product_id: prod.parent_id || prod.id,
          variation_id: prod.id,
          quantity: Number(p.qty || 1),
        });
      } else {
        items.push({
          product_id: prod.id,
          quantity: Number(p.qty || 1),
        });
      }
    } catch (err) {
      logger.warn("Woo SKU resolve failed", {
        sku, err: (err.response && err.response.data) || err.message,
      });
    }
  }
  return items;
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
  console.log(order, "Payment");
  const rawPayment = order.paymentType || order.storePaymentMode || "";
  const payMethod = PAY_METHOD_MAP[rawPayment] || "cod";
  const payTitle = PAY_TITLE_MAP[rawPayment] || "Cash on Delivery";

  // Store orders are immediate walk-in sales: mark completed + paid
  const wcStatus = isStore ? "completed" : "processing";
  const setPaid = isStore;

  const resp = await api.post("/orders", {
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

  logger.info("WooCommerce order created via OMS", {
    wcId: resp.data.id,
  });
  return {id: resp.data.id, number: resp.data.number};
});

// ── wooAdjustStock onCall ────────────────────────────────────────────────────

exports.wooAdjustStock = onCall(async (request) => {
  const {products, delta} = request.data || {};
  const api = makeWooApi();
  let adjusted = 0;

  for (const p of (products || [])) {
    const sku = (p.code || "").trim().toUpperCase();
    const qty = Number(p.qty || 0);
    if (!sku || qty === 0) continue;

    try {
      const {data} = await api.get("/products", {
        params: {sku, per_page: 1},
      });
      if (!data.length) {
        logger.warn("Woo product not found for stock", {sku});
        continue;
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
          continue;
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
      adjusted++;
    } catch (err) {
      logger.warn("Woo stock adjust failed", {
        sku, err: (err.response && err.response.data) || err.message,
      });
    }
  }

  return {adjusted};
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
  logger.info("WooCommerce order status updated", {wcOrderId, status});
  return {ok: true};
});

