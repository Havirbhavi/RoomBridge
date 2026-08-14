import { differenceInCalendarDays, parseISO } from "date-fns";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateScore(profileDate, listingDate) {
  if (!profileDate || !listingDate) return { points: 0, max: 15, tradeoff: "Move-in timing needs confirmation" };
  const days = Math.abs(differenceInCalendarDays(parseISO(profileDate), parseISO(listingDate)));
  if (!Number.isFinite(days)) return { points: 0, max: 15, tradeoff: "Move-in timing needs confirmation" };
  if (days <= 3) return { points: 15, max: 15, reason: "Move-in dates line up within 3 days" };
  if (days <= 10) return { points: 11, max: 15, reason: "Move-in timing is close" };
  if (days <= 21) return { points: 6, max: 15, reason: "Move-in timing is workable with planning" };
  return { points: 0, max: 15, tradeoff: `Available ${days} days from your preferred move-in` };
}

function budgetScore(profile, listing) {
  const monthlyCost = safeNumber(listing.costs?.monthlyTotal) ?? safeNumber(listing.rent);
  const budgetMin = safeNumber(profile.budgetMin) ?? 0;
  const budgetMax = safeNumber(profile.budgetMax);
  if (monthlyCost === null || budgetMax === null) {
    return { points: 0, max: 25, tradeoff: "Monthly cost or budget is incomplete" };
  }
  if (monthlyCost >= budgetMin && monthlyCost <= budgetMax) {
    return { points: 25, max: 25, reason: "Estimated monthly cost is inside your budget" };
  }
  const gap = monthlyCost < budgetMin ? budgetMin - monthlyCost : monthlyCost - budgetMax;
  const points = clamp(16 - Math.floor(gap / 75) * 3, 0, 16);
  return {
    points,
    max: 25,
    reason: points >= 10 ? "Estimated monthly cost is close to your budget" : null,
    tradeoff: monthlyCost > budgetMax ? `$${Math.round(gap)} above your monthly budget` : null
  };
}

function campusScore(profile, listing) {
  if (profile.university === listing.university) return { points: 20, max: 20, reason: `Matches ${listing.university}` };
  if (profile.city === listing.city && profile.state === listing.state) return { points: 10, max: 20, reason: `Located in ${listing.city}` };
  return { points: 0, max: 20, tradeoff: "This home is not near your selected campus" };
}

function preferenceScore(profile, listing) {
  const reasons = [];
  const tradeoffs = [];
  let points = 0;

  if ((profile.preferredAreas || []).includes(listing.area)) {
    points += 7;
    reasons.push(`Preferred area: ${listing.area}`);
  }
  if (profile.roomType && listing.roomType && (profile.roomType === listing.roomType || profile.roomType.includes(listing.roomType))) {
    points += 7;
    reasons.push("Room type matches");
  } else if (profile.roomType && listing.roomType) {
    tradeoffs.push(`Room type is ${listing.roomType}`);
  }
  if (listing.genderPreference === "No preference" || listing.genderPreference === profile.genderPreference) {
    points += 5;
    reasons.push("Household preference is compatible");
  } else if (listing.genderPreference && profile.genderPreference) {
    tradeoffs.push(`Household preference is ${listing.genderPreference}`);
  }
  if (listing.pets === profile.pets || listing.pets === "Cat okay" || profile.pets === "No pets") {
    points += 3;
    reasons.push("Pet preference is workable");
  }
  if (listing.smoking === profile.smoking) {
    points += 3;
    reasons.push("Smoking preference matches");
  } else if (listing.smoking) {
    tradeoffs.push(`Smoking policy is ${listing.smoking}`);
  }

  return { points, max: 25, reasons, tradeoffs };
}

function commuteScore(listing) {
  const miles = safeNumber(listing.distanceToCampus);
  if (miles === null) return { points: 0, max: 10, tradeoff: "Campus distance needs confirmation" };
  if (miles <= 0.5) return { points: 10, max: 10, reason: "Easy walk to campus" };
  if (miles <= 1) return { points: 8, max: 10, reason: "Within one mile of campus" };
  if (miles <= 2) return { points: 5, max: 10, reason: "Short bike or transit trip" };
  return { points: 1, max: 10, tradeoff: `${miles} miles from campus` };
}

function confidenceScore(listing) {
  const reasons = [];
  const tradeoffs = [];
  let points = 0;
  if (listing.verified) {
    points += 3;
    reasons.push("Listing is verified");
  } else {
    tradeoffs.push("Listing is not yet verified");
  }
  if (["fresh", "current"].includes(listing.freshness?.status)) {
    points += 2;
    reasons.push("Availability was recently confirmed");
  } else {
    tradeoffs.push("Confirm current availability");
  }
  return { points, max: 5, reasons, tradeoffs };
}

export function scoreListing(profile, listing) {
  const reasons = [];
  const tradeoffs = [];
  const categories = [];
  const results = [
    ["Budget", budgetScore(profile, listing)],
    ["Campus", campusScore(profile, listing)],
    ["Preferences", preferenceScore(profile, listing)],
    ["Move-in", dateScore(profile.moveInDate, listing.availableFrom)],
    ["Commute", commuteScore(listing)],
    ["Confidence", confidenceScore(listing)]
  ];

  results.forEach(([label, result]) => {
    categories.push({ label, score: result.points, max: result.max });
    if (result.reason) reasons.push(result.reason);
    if (result.reasons) reasons.push(...result.reasons);
    if (result.tradeoff) tradeoffs.push(result.tradeoff);
    if (result.tradeoffs) tradeoffs.push(...result.tradeoffs);
  });

  const score = clamp(categories.reduce((total, category) => total + category.score, 0), 0, 100);
  return {
    listing,
    score,
    strength: score >= 80 ? "Excellent" : score >= 65 ? "Strong" : score >= 45 ? "Possible" : "Low",
    reasons: [...new Set(reasons)].slice(0, 5),
    tradeoffs: [...new Set(tradeoffs)].slice(0, 4),
    categories
  };
}

export function getMatches(profile, listings) {
  return listings.map((listing) => scoreListing(profile, listing)).sort((a, b) => b.score - a.score);
}

export function findSavedSearchHits(search, listing) {
  const filters = search.filters;
  if (filters.university && listing.university !== filters.university) return false;
  if (filters.city && listing.city !== filters.city) return false;
  if (filters.state && listing.state !== filters.state) return false;
  if (filters.maxRent && listing.rent > filters.maxRent) return false;
  if (filters.areas?.length && !filters.areas.includes(listing.area)) return false;
  if (filters.genderPreference && listing.genderPreference !== "No preference" && listing.genderPreference !== filters.genderPreference) return false;
  if (filters.roomType && listing.roomType !== filters.roomType) return false;
  return true;
}
