const PLACES_BASE_URL = "https://places.googleapis.com/v1";

function areaFromAddressComponents(components = []) {
  const preferredTypes = [
    "neighborhood",
    "sublocality",
    "sublocality_level_1",
    "locality",
    "postal_town"
  ];

  for (const type of preferredTypes) {
    const component = components.find((item) => item.types?.includes(type));
    if (component?.longText) return component.longText;
  }

  return null;
}

function placeName(place) {
  return place.displayName?.text || null;
}

function placeContact(place) {
  return {
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    website: place.websiteUri || null,
    googleMapsUri: place.googleMapsUri || null,
    email: null
  };
}

export function formatPropertyTitle(propertyName, streetAddress, unitNumber) {
  const base = propertyName?.trim() || streetAddress?.trim() || "Address unavailable";
  const unit = unitNumber?.toString().trim().replace(/^(?:unit|apt\.?|apartment|#)\s*/i, "");
  return unit ? `${base} – Unit ${unit}` : base;
}

export async function enrichListingWithGooglePlace(listing) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      ...listing,
      enrichment: {
        source: "none",
        status: "missing-google-key",
        message: "Add GOOGLE_MAPS_API_KEY to enrich apartment names, areas, and contact details."
      }
    };
  }

  const query = [
    listing.address,
    listing.city,
    listing.state,
    listing.university,
    "apartment"
  ]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(`${PLACES_BASE_URL}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.addressComponents",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.googleMapsUri",
        "places.location"
      ].join(",")
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    return {
      ...listing,
      enrichment: {
        source: "google-places",
        status: "api-error",
        message: `Google Places returned ${response.status}.`,
        details: details.slice(0, 240)
      }
    };
  }

  const payload = await response.json();
  const place = payload.places?.[0];

  if (!place) {
    return {
      ...listing,
      enrichment: {
        source: "google-places",
        status: "not-found",
        message: "No Google Maps place matched this address."
      }
    };
  }

  const name = placeName(place);
  const area = areaFromAddressComponents(place.addressComponents);
  const contact = placeContact(place);

  return {
    ...listing,
    apartmentName: name,
    title: formatPropertyTitle(name, listing.streetAddress || listing.address, listing.unitNumber),
    area: area || listing.area,
    address: place.formattedAddress || listing.address,
    contact,
    enrichment: {
      source: "google-places",
      status: "ok",
      placeId: place.id,
      message: "Apartment details enriched from Google Places."
    }
  };
}
