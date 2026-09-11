import test from "node:test";
import assert from "node:assert/strict";
import { reviewListingSubmission } from "../src/listingReview.js";

test("uses the local fallback when Laravel is not configured", async () => {
  const previousUrl = process.env.LISTING_REVIEW_URL;
  delete process.env.LISTING_REVIEW_URL;

  try {
    const result = await reviewListingSubmission({ rent: 1000 });
    assert.equal(result.status, "not_configured");
    assert.equal(result.source, "express-fallback");
  } finally {
    if (previousUrl === undefined) delete process.env.LISTING_REVIEW_URL;
    else process.env.LISTING_REVIEW_URL = previousUrl;
  }
});

test("returns a Laravel moderation decision", async () => {
  const previousUrl = process.env.LISTING_REVIEW_URL;
  const previousFetch = global.fetch;
  process.env.LISTING_REVIEW_URL = "http://listing-review:8010";
  global.fetch = async (url, options) => {
    assert.equal(url, "http://listing-review:8010/api/listing-reviews");
    assert.equal(options.method, "POST");
    return new Response(JSON.stringify({ status: "approved", risk_score: 0 }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await reviewListingSubmission({ rent: 1000 });
    assert.equal(result.status, "approved");
    assert.equal(result.source, "laravel");
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.LISTING_REVIEW_URL;
    else process.env.LISTING_REVIEW_URL = previousUrl;
  }
});
