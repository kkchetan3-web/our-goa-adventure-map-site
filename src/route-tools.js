export const ROUTE_FIELDS = [
  "path",
  "distanceMeters",
  "durationMillis",
  "staticDurationMillis",
  "localizedValues",
  "routeLabels",
  "warnings",
  "viewport",
];

function routeLocation(stop, PlaceClass) {
  return stop.placeId && PlaceClass ? new PlaceClass({ id: stop.placeId }) : { lat: stop.lat, lng: stop.lng };
}

export function buildMainRouteRequest(stops, PlaceClass) {
  if (!Array.isArray(stops) || stops.length < 2) throw new Error("At least two ordered stops are required.");
  return {
    origin: routeLocation(stops[0], PlaceClass),
    destination: routeLocation(stops.at(-1), PlaceClass),
    intermediates: stops.slice(1, -1).map((stop) => ({ location: routeLocation(stop, PlaceClass), via: false })),
    optimizeWaypointOrder: false,
    travelMode: "TWO_WHEELER",
    routingPreference: "TRAFFIC_UNAWARE",
    polylineQuality: "HIGH_QUALITY",
    language: "en-IN",
    region: "IN",
    units: "METRIC",
    fields: ROUTE_FIELDS,
  };
}

export function buildSingleLegRequest(from, to, PlaceClass, { alternatives = false } = {}) {
  return {
    origin: routeLocation(from, PlaceClass),
    destination: routeLocation(to, PlaceClass),
    travelMode: "TWO_WHEELER",
    routingPreference: "TRAFFIC_UNAWARE",
    polylineQuality: "HIGH_QUALITY",
    language: "en-IN",
    region: "IN",
    units: "METRIC",
    computeAlternativeRoutes: Boolean(alternatives),
    fields: ROUTE_FIELDS,
  };
}

export function routePathToCoordinates(path = []) {
  return path.filter((point) => point && typeof point === "object").map((point) => {
    const lat = typeof point.lat === "function" ? point.lat() : point.lat;
    const lng = typeof point.lng === "function" ? point.lng() : point.lng;
    return { lat: Number(lat), lng: Number(lng) };
  }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export function formatDistance(meters) {
  if (meters == null || meters === "" || !Number.isFinite(Number(meters))) return "Not available";
  const km = Number(meters) / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDuration(milliseconds) {
  if (milliseconds == null || milliseconds === "" || !Number.isFinite(Number(milliseconds))) return "Not available";
  const minutes = Math.round(Number(milliseconds) / 60000);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours} hr ${remaining} min` : `${minutes} min`;
}

export function routeStatusLabel(route) {
  if (!route) return "No Google route loaded";
  if (route.distanceMeters == null || route.durationMillis == null) return "Google route loaded; some summary fields were not returned";
  return "Google Routes result loaded in this session";
}
