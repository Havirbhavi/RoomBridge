const OVERPASS_URLS = [
  process.env.OVERPASS_API_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
].filter(Boolean);
const cache = new Map();
const CACHE_MS = 1000 * 60 * 30;

function categoryFor(tags = {}) {
  if (tags.public_transport || tags.highway === "bus_stop" || ["station", "halt", "tram_stop"].includes(tags.railway)) return "transit";
  if (["supermarket", "convenience", "greengrocer"].includes(tags.shop)) return "groceries";
  if (tags.amenity === "library") return "libraries";
  if (["hospital", "clinic", "pharmacy", "doctors"].includes(tags.amenity)) return "healthcare";
  if (["cafe", "fast_food", "restaurant"].includes(tags.amenity) && /24\/7|24:00|00:00/i.test(tags.opening_hours || "")) return "late-night";
  return null;
}

export async function nearbyStudentContext(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    const error = new Error("Valid latitude and longitude are required");
    error.status = 400;
    throw error;
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return cached.value;

  const query = `[out:json][timeout:8];
(
  node(around:1800,${lat},${lng})["public_transport"];
  node(around:1800,${lat},${lng})["highway"="bus_stop"];
  node(around:1800,${lat},${lng})["railway"~"station|halt|tram_stop"];
  node(around:1800,${lat},${lng})["shop"~"supermarket|convenience|greengrocer"];
  node(around:1800,${lat},${lng})["amenity"~"library|hospital|clinic|pharmacy|doctors"];
  node(around:1800,${lat},${lng})["amenity"~"cafe|fast_food|restaurant"]["opening_hours"~"24/7|24:00|00:00"];
);
out body 120;`;

  let payload;
  let lastError;
  for (const endpoint of OVERPASS_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Map context provider returned ${response.status}`);
      payload = await response.json();
      break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!payload) throw lastError || new Error("Nearby map context is unavailable");

  {
    const counts = new Map();
    const places = (payload.elements || []).flatMap((element) => {
      const category = categoryFor(element.tags);
      const placeLat = Number(element.lat ?? element.center?.lat);
      const placeLng = Number(element.lon ?? element.center?.lon);
      if (!category || !Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return [];
      const count = counts.get(category) || 0;
      if (count >= 14) return [];
      counts.set(category, count + 1);
      return [{
        id: `${element.type}-${element.id}`,
        category,
        name: element.tags?.name || element.tags?.brand || {
          transit: "Transit stop",
          groceries: "Grocery store",
          libraries: "Library",
          healthcare: "Health service",
          "late-night": "Open late"
        }[category],
        latitude: placeLat,
        longitude: placeLng,
        openingHours: element.tags?.opening_hours || null
      }];
    });
    const value = { center: { latitude: lat, longitude: lng }, radiusMeters: 1800, places, source: "OpenStreetMap" };
    cache.set(key, { createdAt: Date.now(), value });
    return value;
  }
}
