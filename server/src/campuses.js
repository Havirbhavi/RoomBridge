export const campuses = [
  { university: "Penn State University", city: "State College", state: "PA", latitude: 40.7982, longitude: -77.8599, radius: 4 },
  { university: "Portland State University", city: "Portland", state: "OR", latitude: 45.5118, longitude: -122.6843, radius: 5 },
  { university: "Oregon State University", city: "Corvallis", state: "OR", latitude: 44.5638, longitude: -123.2794, radius: 5 },
  { university: "University of Oregon", city: "Eugene", state: "OR", latitude: 44.0448, longitude: -123.0726, radius: 5 },
  { university: "UCLA", city: "Los Angeles", state: "CA", latitude: 34.0689, longitude: -118.4452, radius: 5 },
  { university: "University of Texas at Austin", city: "Austin", state: "TX", latitude: 30.2849, longitude: -97.7341, radius: 5 },
  { university: "New York University", city: "New York", state: "NY", latitude: 40.7295, longitude: -73.9965, radius: 4 },
  { university: "Northeastern University", city: "Boston", state: "MA", latitude: 42.3398, longitude: -71.0892, radius: 4 }
];

export function findCampus(university) {
  const normalized = university?.trim().toLowerCase();
  return campuses.find((campus) => campus.university.toLowerCase() === normalized);
}
