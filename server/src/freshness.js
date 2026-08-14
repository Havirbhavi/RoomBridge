const DAY_MS = 24 * 60 * 60 * 1000;

export function listingFreshness(listing, now = new Date()) {
  if (listing.availabilityStatus === "leased" || listing.availabilityStatus === "unavailable") {
    return {
      status: "unavailable",
      label: "No longer available",
      daysSinceConfirmation: null,
      confirmedAt: listing.lastConfirmedAt || null
    };
  }

  const confirmedAt = new Date(listing.lastConfirmedAt || listing.createdAt || "");
  if (Number.isNaN(confirmedAt.getTime())) {
    return {
      status: "unconfirmed",
      label: "Availability unconfirmed",
      daysSinceConfirmation: null,
      confirmedAt: null
    };
  }

  const days = Math.max(0, Math.floor((now.getTime() - confirmedAt.getTime()) / DAY_MS));
  if (days <= 3) {
    return {
      status: "fresh",
      label: days === 0 ? "Confirmed today" : `Confirmed ${days} day${days === 1 ? "" : "s"} ago`,
      daysSinceConfirmation: days,
      confirmedAt: confirmedAt.toISOString()
    };
  }
  if (days <= 7) {
    return {
      status: "current",
      label: `Confirmed ${days} days ago`,
      daysSinceConfirmation: days,
      confirmedAt: confirmedAt.toISOString()
    };
  }
  if (days <= 14) {
    return {
      status: "check",
      label: "Confirm with host",
      daysSinceConfirmation: days,
      confirmedAt: confirmedAt.toISOString()
    };
  }
  return {
    status: "stale",
    label: "Availability may be outdated",
    daysSinceConfirmation: days,
    confirmedAt: confirmedAt.toISOString()
  };
}

export function withListingFreshness(listing, now = new Date()) {
  return { ...listing, freshness: listingFreshness(listing, now) };
}
