import assert from "node:assert/strict";
import test from "node:test";
import { listingFreshness } from "../src/freshness.js";

const now = new Date("2026-07-28T12:00:00.000Z");

test("classifies recently confirmed listings as fresh or current", () => {
  assert.equal(listingFreshness({ lastConfirmedAt: "2026-07-28T08:00:00.000Z" }, now).status, "fresh");
  assert.equal(listingFreshness({ lastConfirmedAt: "2026-07-24T08:00:00.000Z" }, now).status, "current");
});

test("asks students to check aging listings and warns on stale listings", () => {
  assert.equal(listingFreshness({ lastConfirmedAt: "2026-07-18T08:00:00.000Z" }, now).status, "check");
  const stale = listingFreshness({ lastConfirmedAt: "2026-07-10T08:00:00.000Z" }, now);
  assert.equal(stale.status, "stale");
  assert.equal(stale.label, "Availability may be outdated");
});

test("prioritizes explicit unavailable and handles missing dates", () => {
  assert.equal(listingFreshness({ availabilityStatus: "leased" }, now).status, "unavailable");
  assert.equal(listingFreshness({}, now).status, "unconfirmed");
});
