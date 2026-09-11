const REVIEW_TIMEOUT_MS = 5000;

export async function reviewListingSubmission(listing) {
  const baseUrl = String(process.env.LISTING_REVIEW_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    return {
      status: "not_configured",
      risk_score: null,
      reasons: [],
      checks: {},
      source: "express-fallback"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/listing-reviews`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(listing),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.message || "Listing review failed");
      error.status = response.status === 422 ? 422 : 502;
      error.details = payload.errors || {};
      throw error;
    }

    return { ...payload, source: "laravel" };
  } catch (error) {
    if (error.status) throw error;
    const unavailable = new Error(error.name === "AbortError"
      ? "Listing review timed out"
      : "Listing review service is unavailable");
    unavailable.status = 503;
    throw unavailable;
  } finally {
    clearTimeout(timer);
  }
}
