import { findCampus } from "./campuses.js";
import { enrichListingWithGooglePlace, formatPropertyTitle } from "./googlePlaces.js";
import { listListings } from "./store.js";
import { withListingQuality } from "./listingQuality.js";
import { withListingFreshness } from "./freshness.js";

const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

function milesBetween(a, b) {
  if (!a?.latitude || !a?.longitude || !b?.latitude || !b?.longitude) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

function roomTypeFor(record) {
  if (record.bedrooms === 0) return "Studio";
  if (record.propertyType === "Apartment" || record.propertyType === "Multi-Family") return "Private room";
  return record.propertyType || "Rental";
}

function areaFor(record, campus) {
  return record.neighborhood ||
    record.subdivision ||
    (record.zipCode ? `${record.city || campus.city} ${record.zipCode}` : null) ||
    record.city ||
    campus.city;
}

function unitNumberFor(record) {
  const direct = record.unitNumber || record.unit || record.addressLine2;
  if (direct) return String(direct).replace(/^(?:unit|apt\.?|apartment|#)\s*/i, "").trim() || null;
  const match = record.formattedAddress?.match(/(?:unit|apt\.?|apartment|#)\s*([\w-]+)/i);
  return match?.[1] || null;
}

function streetAddressFor(record, campus) {
  const street = record.addressLine1 || record.formattedAddress?.split(",")[0];
  const cleaned = street?.replace(/\s+(?:unit|apt\.?|apartment|#)\s*[\w-]+\s*$/i, "").trim();
  return cleaned || `${record.city || campus.city}, ${record.state || campus.state}`;
}

function amenitiesFor(record) {
  const values = [record.amenities, record.features, record.laundryType, record.petPolicy]
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name);
      return value ? [value] : [];
    });
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

async function enrichWithConcurrency(listings, concurrency = 4) {
  const enriched = new Array(listings.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < listings.length) {
      const index = nextIndex++;
      try {
        enriched[index] = await enrichListingWithGooglePlace(listings[index]);
      } catch (error) {
        enriched[index] = {
          ...listings[index],
          enrichment: {
            source: "google-places",
            status: "request-error",
            message: error.message
          }
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, listings.length) }, worker));
  return enriched;
}

function normalizeRentCastListing(record, campus) {
  const distance = milesBetween(campus, record);
  const rent = Number(record.price || record.rent || 0);
  const listedDate = record.listedDate || record.createdDate || record.lastSeenDate || new Date().toISOString();
  const unitNumber = unitNumberFor(record);
  const streetAddress = streetAddressFor(record, campus);

  return {
    id: `rentcast-${record.id}`,
    externalId: record.id,
    source: "RentCast",
    sourceUrl: record.listingAgent?.website || record.listingOffice?.website || null,
    title: formatPropertyTitle(null, streetAddress, unitNumber),
    unitNumber,
    streetAddress,
    university: campus.university,
    city: record.city || campus.city,
    state: record.state || campus.state,
    type: "Marketplace rental",
    pricingBasis: "entire-unit",
    availableBeds: Math.max(1, Number(record.bedrooms || 1)),
    rent,
    deposit: 0,
    availableFrom: listedDate.slice(0, 10),
    availableTo: record.removedDate?.slice?.(0, 10) || "",
    area: areaFor(record, campus),
    address: record.formattedAddress || `${record.city || campus.city}, ${record.state || campus.state}`,
    latitude: Number.isFinite(Number(record.latitude)) ? Number(record.latitude) : null,
    longitude: Number.isFinite(Number(record.longitude)) ? Number(record.longitude) : null,
    distanceToCampus: distance ?? campus.radius,
    furnished: Boolean(record.furnished),
    utilitiesIncluded: Array.isArray(record.utilitiesIncluded) ? record.utilitiesIncluded : [],
    amenities: amenitiesFor(record),
    roomType: roomTypeFor(record),
    roommatesNeeded: 1,
    genderPreference: "No preference",
    pets: record.petsAllowed === true ? "Pets allowed" : record.petsAllowed === false ? "No pets" : record.petPolicy || "Ask host",
    smoking: "Ask host",
    tags: [
      "Live API",
      record.propertyType || "Rental",
      record.bedrooms === 0 ? "Studio" : record.bedrooms ? `${record.bedrooms} bed` : "Bedrooms listed"
    ],
    description: `${record.formattedAddress || "Rental listing"} listed through RentCast. Verify student fit, lease terms, utilities, and roommate details before contacting.`,
    postedBy: record.listingAgent?.name || record.listingOffice?.name || "Marketplace host",
    verified: false,
    riskLevel: "medium",
    createdAt: record.lastSeenDate || listedDate
  };
}

function fallbackListings(campus, filters) {
  return listListings({
    university: campus?.university || filters.university,
    city: filters.city,
    state: filters.state,
    maxRent: filters.maxRent
  });
}

export async function getLiveRentalListings(filters = {}) {
  const campus = findCampus(filters.university) || {
    university: filters.university?.trim(),
    city: filters.city?.trim(),
    state: filters.state?.trim()?.toUpperCase(),
    radius: Number(filters.radius || 5)
  };

  if (!campus.university) {
    return {
      source: "seed",
      status: "missing-university",
      message: "Enter a U.S. university to search live rental listings.",
      listings: listListings(filters)
    };
  }

  if (!campus.latitude && (!campus.city || !campus.state)) {
    return {
      source: "seed",
      status: "missing-location",
      message: "Add city and state for universities that are not in the campus lookup yet.",
      listings: fallbackListings(campus, filters)
    };
  }

  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    return {
      source: "seed",
      status: "missing-api-key",
      message: "Add RENTCAST_API_KEY to use live RentCast rental listings.",
      listings: fallbackListings(campus, filters)
    };
  }

  const params = new URLSearchParams({
    status: "Active",
    limit: String(filters.limit || 24)
  });

  if (campus.latitude && campus.longitude) {
    params.set("latitude", String(campus.latitude));
    params.set("longitude", String(campus.longitude));
    params.set("radius", String(campus.radius));
  } else {
    params.set("city", campus.city);
    params.set("state", campus.state);
  }

  if (filters.maxRent) {
    params.set("price", `0:${filters.maxRent}`);
  }

  const response = await fetch(`${RENTCAST_BASE_URL}/listings/rental/long-term?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey
    }
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    return {
      source: "seed",
      status: "api-error",
      message: `RentCast returned ${response.status}. Showing fallback listings.`,
      details: details.slice(0, 240),
      listings: fallbackListings(campus, filters)
    };
  }

  const records = await response.json();
  const requestedCity = filters.city?.trim().toLowerCase();
  const requestedState = filters.state?.trim().toLowerCase();
  const normalizedListings = records
    .map((record) => normalizeRentCastListing(record, campus))
    .filter((listing) => listing.rent > 0)
    .filter((listing) => !requestedCity || listing.city?.trim().toLowerCase() === requestedCity)
    .filter((listing) => !requestedState || listing.state?.trim().toLowerCase() === requestedState)
    .sort((a, b) => a.distanceToCampus - b.distanceToCampus);
  const listings = (await enrichWithConcurrency(normalizedListings)).map((listing) => withListingQuality(withListingFreshness(listing)));

  return {
    source: "rentcast",
    status: "ok",
    message: `Loaded ${listings.length} live rental listings from RentCast near ${campus.university}.`,
    listings
  };
}
