const FEDEX_API_BASE = process.env.FEDEX_ENVIRONMENT === "sandbox"
  ? "https://apis-sandbox.fedex.com"
  : "https://apis.fedex.com";

async function requestJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await fetch(url, { ...options, signal: controller.signal });
    const body = await result.json().catch(() => null);
    if (!result.ok) throw new Error(`FedEx request failed: ${result.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function requireConfig() {
  for (const key of ["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET", "FEDEX_ACCOUNT_NUMBER"]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
}

export async function getFedExTracking(trackingNumber) {
  requireConfig();
  const credentials = await requestJson(`${FEDEX_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.FEDEX_CLIENT_ID,
      client_secret: process.env.FEDEX_CLIENT_SECRET,
    }),
  });

  const result = await requestJson(`${FEDEX_API_BASE}/track/v1/trackingnumbers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.access_token}`,
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
    }),
  });
  const completed = result.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!completed) throw new Error("FedEx tracking number not found");

  return {
    status: completed.latestStatusDetail?.description || completed.latestStatusDetail?.code,
    estimatedDelivery: completed.estimatedDeliveryTimeWindow?.window?.begins || "",
    events: (completed.scanEvents || []).map((event) => ({
      status: event.eventDescription || event.eventType,
      description: event.eventDescription || event.eventType,
      date: event.date,
      location: [event.scanLocation?.city, event.scanLocation?.stateOrProvince]
        .filter(Boolean).join(", "),
    })),
  };
}