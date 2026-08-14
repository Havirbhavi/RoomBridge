const API_URL = process.env.ROOMBRIDGE_API_URL || "http://127.0.0.1:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `RoomBridge API returned ${response.status}`);
  }
  return payload;
}

export async function searchRooms(filters = {}) {
  const params = new URLSearchParams();
  for (const key of ["university", "city", "state", "maxRent", "area", "type"]) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== "") {
      params.set(key, String(filters[key]));
    }
  }
  let listings = await request(`/listings${params.size ? `?${params}` : ""}`);
  const amenities = (filters.amenities || []).map((item) => item.toLowerCase());
  if (amenities.length) {
    listings = listings.filter((listing) => {
      const text = [
        listing.title, listing.description, listing.roomType, listing.pets,
        ...(listing.tags || []), ...(listing.utilitiesIncluded || []),
        listing.furnished ? "furnished" : ""
      ].join(" ").toLowerCase();
      return amenities.every((amenity) => text.includes(amenity));
    });
  }
  return listings;
}

export async function getListing(listingId) {
  const listings = await searchRooms();
  return listings.find((listing) => String(listing.id) === String(listingId)) || null;
}

export async function compareListings(listingIds, preferences = {}) {
  const listings = await searchRooms();
  const selected = listings.filter((listing) => listingIds.includes(String(listing.id)));
  if (!selected.length) throw new Error("No matching listing IDs were found");
  return request("/compare", {
    method: "POST",
    body: JSON.stringify({
      listings: selected.map((listing) => ({
        id: String(listing.id),
        title: listing.title,
        rent: Number(listing.rent) || 0,
        commute_minutes: Number.parseFloat(listing.commute?.walk || listing.walkMinutes) || 0,
        distance_miles: Number(listing.distanceToCampus) || null,
        room_type: listing.roomType || null,
        furnished: Boolean(listing.furnished),
        utilities_included: listing.utilitiesIncluded || [],
        amenities: listing.tags || [],
        pets: listing.pets || null,
        verified: Boolean(listing.verified)
      })),
      preferences,
      swipes: []
    })
  });
}

export const getRoomProofReport = (reportId) => request(`/roomproof/reports/${encodeURIComponent(reportId)}`);
export const getTrustGraph = (listingId) => request(`/roomproof/trust-graph/${encodeURIComponent(listingId)}`);
