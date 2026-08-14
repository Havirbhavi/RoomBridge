function numberOr(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function monthsBetween(start, end) {
  if (!start || !end) return null;
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || to <= from) return null;
  return Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24 * 30.44)));
}

function inferredPricingBasis(listing) {
  if (listing.pricingBasis) return listing.pricingBasis;
  return /room|shared/i.test(`${listing.roomType || ""} ${listing.type || ""}`) ? "per-person" : "entire-unit";
}

export function withListingQuality(listing) {
  const photos = Array.isArray(listing.photos) ? listing.photos : [];
  const photoLabels = photos.map((photo) => String(photo.label || "").toLowerCase());
  const pricingBasis = inferredPricingBasis(listing);
  const availableBeds = Math.max(1, numberOr(listing.availableBeds, numberOr(listing.roommatesNeeded, 1)));
  const leaseMonths = numberOr(listing.leaseMonths, monthsBetween(listing.availableFrom, listing.availableTo));
  const verification = {
    identity: Boolean(listing.verification?.identity ?? listing.verified),
    address: Boolean(listing.verification?.address ?? listing.verified),
    availability: ["fresh", "current"].includes(listing.freshness?.status),
    photos: Boolean(listing.verification?.photos ?? photos.length >= 3),
    lease: Boolean(listing.verification?.lease ?? listing.leaseVerified)
  };
  const checks = [
    Boolean(listing.address),
    Boolean(listing.unitNumber || listing.streetAddress),
    numberOr(listing.rent, 0) > 0,
    Boolean(pricingBasis),
    availableBeds > 0,
    Boolean(listing.availableFrom),
    Boolean(listing.availableTo || leaseMonths),
    photoLabels.some((label) => label.includes("bedroom")),
    photoLabels.some((label) => label.includes("kitchen") || label.includes("common")),
    photoLabels.some((label) => label.includes("bathroom")),
    Boolean(listing.roomType),
    Boolean(listing.description)
  ];
  const score = Math.round(checks.filter(Boolean).length / checks.length * 100);

  return {
    ...listing,
    pricingBasis,
    availableBeds,
    leaseMonths,
    quality: {
      score,
      level: score >= 90 ? "complete" : score >= 70 ? "strong" : "basic",
      photoCount: photos.length,
      verification,
      verifiedCount: Object.values(verification).filter(Boolean).length,
      verificationCount: Object.keys(verification).length
    }
  };
}
