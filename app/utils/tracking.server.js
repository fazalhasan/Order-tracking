const STATUS_RULES = [
  ["Delivered", /deliver|received|pod/],
  ["Out for Delivery", /out\s*for\s*delivery|delivery\s*attempt/],
  ["Returned", /return|rto|refused/],
  ["Delayed", /delay|exception|hold|failed/],
  ["In Transit", /transit|on the way|depart|arriv|moving/],
  ["Shipped", /ship|pickup|picked up|dispatched|manifest/],
  ["Confirmed", /confirm|processed|packed/],
];

export function determineCourier(tracking) {
  const value = `${tracking.company || ""} ${tracking.url || ""}`.toLowerCase();
  if (/fedex|fed-ex/.test(value)) return "fedex";
  if (/leopard/.test(value)) return "leopards";
  return null;
}

export function mapStatus(value) {
  const normalized = String(value || "").toLowerCase();
  return STATUS_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] || "Confirmed";
}

function money(value) {
  if (!value) return "";
  return `${value.currencyCode} ${Number(value.amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizeTracking(order, courierResult) {
  const status = mapStatus(courierResult.status || order.displayFulfillmentStatus);
  const statusKey = {
    "Order Placed": "ordered",
    Confirmed: "confirmed",
    Shipped: "shipped",
    "In Transit": "transit",
    "Out for Delivery": "delivery",
    Delivered: "delivered",
    Delayed: "transit",
    Returned: "ordered",
  }[status] || "ordered";
  const events = (courierResult.events || []).map((event) => ({
    status: mapStatus(event.status || event.description),
    description: event.description || event.status || "Shipment update",
    date: event.date || "",
    location: event.location || "",
  }));

  return {
    order_number: order.name,
    order_date: new Date(order.createdAt).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }),
    payment_status: order.displayFinancialStatus || "",
    fulfillment_status: order.displayFulfillmentStatus || "",
    status: statusKey,
    status_label: status,
    estimated_delivery: courierResult.estimatedDelivery || "",
    items: order.lineItems.nodes.map((item) => ({
      title: item.title,
      image: item.image?.url || "",
      quantity: item.quantity,
      price: money(item.originalUnitPriceSet?.shopMoney),
    })),
    total_items: order.lineItems.nodes.reduce((total, item) => total + item.quantity, 0),
    subtotal: money(order.subtotalPriceSet?.shopMoney),
    discount: money(order.totalDiscountsSet?.shopMoney),
    shipping: money(order.totalShippingPriceSet?.shopMoney),
    tax: money(order.totalTaxSet?.shopMoney),
    total: money(order.totalPriceSet?.shopMoney),
    shipping_address: order.shippingAddress || null,
    tracking_history: events,
  };
}