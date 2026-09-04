import { authenticate, unauthenticated } from "../shopify.server";
import { getFedExTracking } from "../services/fedex.server";
import { getLeopardsTracking } from "../services/leopards.server";
import { determineCourier, normalizeTracking } from "../utils/tracking.server";

const ORDER_QUERY = `#graphql
  query OrderForTracking($query: String!) {
    orders(first: 1, query: $query) {
      nodes {
        id
        name
        createdAt
        email
        phone
        displayFinancialStatus
        displayFulfillmentStatus
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress {
          name address1 address2 city province zip country
        }
        lineItems(first: 100) {
          nodes {
            title quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            image { url }
          }
        }
        fulfillments {
          status
          trackingInfo { company number url }
        }
      }
    }
  }
`;

const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeContact(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s()-]/g, "");
}

function isContactMatch(order, contact) {
  const normalized = normalizeContact(contact);
  return [order.email, order.phone]
    .filter(Boolean)
    .map(normalizeContact)
    .some((value) => value === normalized);
}

function orderQuery(orderNumber) {
  const name = String(orderNumber).trim().replace(/^#/, "");
  return `name:#${name}`;
}

function allowRequest(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const entry = recentRequests.get(forwardedFor);

  if (!entry || now - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
    recentRequests.set(forwardedFor, { startedAt: now, count: 1 });
    return true;
  }

  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX_REQUESTS;
}

function getStoreDomain(request) {
  const configuredDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase();
  const requestUrl = new URL(request.url);
  const queryShop = requestUrl.searchParams.get("shop")?.trim().toLowerCase();

  if (queryShop?.endsWith(".myshopify.com")) return queryShop;

  const values = [
    requestUrl.toString(),
    request.headers.get("origin"),
    request.headers.get("referer"),
  ];

  for (const value of values) {
    if (!value) continue;
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      if (configuredDomain && hostname === configuredDomain) return hostname;
      if (hostname.endsWith(".myshopify.com")) return hostname;
    } catch {
      continue;
    }
  }

  return configuredDomain || null;
}

async function getAdminContext(request) {
  try {
    const context = await authenticate.public.appProxy(request);
    if (context.admin) return context.admin;
  } catch {
    // Theme-page POSTs do not include App Proxy HMAC parameters.
  }

  const shop = getStoreDomain(request);
  if (!shop) return null;

  const context = await unauthenticated.admin(shop);
  return context.admin;
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return response({ success: false, message: "Method not allowed." }, 405);
  }

  if (!allowRequest(request)) {
    return response(
      { success: false, message: "Too many requests. Please try again shortly." },
      429,
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ success: false, message: "Please send valid JSON." }, 400);
  }

  const orderNumber = String(payload?.order_number || "").trim();
  const contact = String(payload?.contact || "").trim();
  if (!orderNumber || !contact || orderNumber.length > 40 || contact.length > 200) {
    return response(
      { success: false, message: "Order number and email or phone are required." },
      400,
    );
  }

  try {
    const admin = await getAdminContext(request);
    if (!admin) {
      return response(
        { success: false, message: "Tracking is temporarily unavailable." },
        503,
      );
    }

    const graphqlResponse = await admin.graphql(ORDER_QUERY, {
      variables: { query: orderQuery(orderNumber) },
    });
    const result = await graphqlResponse.json();
    if (result.errors?.length) {
      console.error("Shopify order lookup failed", {
        count: result.errors.length,
      });
      return response(
        { success: false, message: "Tracking information is currently unavailable." },
        502,
      );
    }

    const order = result.data?.orders?.nodes?.[0];
    if (!order || !isContactMatch(order, contact)) {
      return response(
        { success: false, message: "We couldn't find an order matching those details." },
        404,
      );
    }

    const tracking = order.fulfillments
      ?.flatMap((fulfillment) => fulfillment.trackingInfo || [])
      .find((info) => info.number);
    if (!tracking) {
      return response(
        { success: false, message: "This order does not have tracking information yet." },
        404,
      );
    }

    const courier = determineCourier(tracking);
    if (!courier) {
      return response(
        { success: false, message: "Tracking information is currently unavailable." },
        503,
      );
    }

    const courierResult = courier === "fedex"
      ? await getFedExTracking(tracking.number)
      : await getLeopardsTracking(tracking.number);

    return response({ success: true, order: normalizeTracking(order, courierResult) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Order tracking request failed", {
      name: error?.name || "Error",
      code: error?.code || "unknown",
    });
    return response(
      {
        success: false,
        message: "Tracking information is temporarily unavailable. Please try again later.",
      },
      503,
    );
  }
}

export async function loader() {
  return response({ success: false, message: "Use POST to track an order." }, 405);
}