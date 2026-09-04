/*
 * Leopards API contracts differ by merchant account. Configure the official
 * endpoint and field mapping from the merchant's Leopards documentation before
 * enabling this adapter. An invented request could leak credentials or return
 * incorrect delivery data, so this adapter fails closed until configured.
 */
export async function getLeopardsTracking() {
  if (!process.env.LEOPARDS_API_URL) {
    throw new Error("Leopards API adapter is not configured");
  }
  throw new Error(
    "Configure Leopards request and response mapping from the official merchant API documentation",
  );
}