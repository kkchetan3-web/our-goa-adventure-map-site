export const NEARBY_RESTAURANT_TYPES = ["restaurant", "cafe"];
export const MAX_RESTAURANTS_PER_STOP = 20;
export const PLACE_SEARCH_FIELDS = ["id", "displayName", "location", "formattedAddress", "primaryType", "primaryTypeDisplayName"];

export function buildNearbyRestaurantRequest(stop, radiusMeters, maxResultCount = MAX_RESTAURANTS_PER_STOP) {
  if (!stop || !Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lng))) {
    throw new Error("A valid route stop coordinate is required for nearby restaurant search.");
  }
  const radius = Number(radiusMeters);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) {
    throw new Error("Search radius must be greater than 0 and no more than 50 km.");
  }
  const count = Number(maxResultCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESTAURANTS_PER_STOP) {
    throw new Error(`Result limit must be between 1 and ${MAX_RESTAURANTS_PER_STOP}.`);
  }
  return {
    fields: [...PLACE_SEARCH_FIELDS],
    includedTypes: [...NEARBY_RESTAURANT_TYPES],
    locationRestriction: {
      center: { lat: Number(stop.lat), lng: Number(stop.lng) },
      radius,
    },
    maxResultCount: count,
    rankPreference: "DISTANCE",
    language: "en",
    region: "IN",
  };
}

export function locationToLatLng(location) {
  if (!location) return null;
  const lat = typeof location.lat === "function" ? location.lat() : location.lat;
  const lng = typeof location.lng === "function" ? location.lng() : location.lng;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    ? { lat: Number(lat), lng: Number(lng) }
    : null;
}

export function distanceKmBetween(a, b) {
  const first = locationToLatLng(a);
  const second = locationToLatLng(b);
  if (!first || !second) return Infinity;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(second.lat - first.lat);
  const dLng = radians(second.lng - first.lng);
  const value = Math.min(1, Math.sin(dLat / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(dLng / 2) ** 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function mergeNearbyRestaurants(resultsByStop) {
  const merged = new Map();
  for (const { stop, places = [] } of resultsByStop) {
    if (!stop) continue;
    for (const place of places) {
      if (!place?.id || !place.location) continue;
      const entry = merged.get(place.id) ?? {
        id: place.id,
        displayName: place.displayName || "Google Place",
        location: place.location,
        formattedAddress: place.formattedAddress || "",
        primaryType: place.primaryType || "",
        primaryTypeDisplayName: place.primaryTypeDisplayName || "",
        nearStops: [],
      };
      if (!entry.nearStops.some((near) => near.stopId === stop.id)) {
        entry.nearStops.push({
          stopId: stop.id,
          stopOrder: stop.order,
          distanceKm: distanceKmBetween(place.location, stop),
        });
      }
      merged.set(place.id, entry);
    }
  }
  return [...merged.values()];
}
