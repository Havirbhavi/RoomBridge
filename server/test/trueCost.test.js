import assert from "node:assert/strict";
import test from "node:test";
import { calculateTrueCost } from "../src/trueCost.js";

test("calculates monthly extras and total move-in cost", () => {
  const costs = calculateTrueCost({
    rent: 1000,
    utilitiesMonthly: 90,
    parkingMonthly: 60,
    internetMonthly: 35,
    rentersInsuranceMonthly: 15,
    otherMonthlyFees: 20,
    deposit: 500,
    applicationFee: 45,
    administrationFee: 100
  });
  assert.equal(costs.monthlyExtras, 220);
  assert.equal(costs.monthlyTotal, 1220);
  assert.equal(costs.oneTimeTotal, 645);
  assert.equal(costs.moveInTotal, 1865);
  assert.equal(costs.completeness, "complete");
});

test("does not invent undisclosed charges", () => {
  const costs = calculateTrueCost({ rent: "825", deposit: "400" });
  assert.equal(costs.monthlyTotal, 825);
  assert.equal(costs.moveInTotal, 1225);
  assert.equal(costs.completeness, "rent-only");
});

test("normalizes invalid and negative values to zero", () => {
  const costs = calculateTrueCost({ rent: "not-a-number", parkingFee: -50, applicationFee: 25 });
  assert.equal(costs.monthlyTotal, 0);
  assert.equal(costs.oneTimeTotal, 25);
});
